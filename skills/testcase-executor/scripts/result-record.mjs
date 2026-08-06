import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  FINAL_STATUSES,
  associateResultWithSource,
  getAssociatedSource,
  readExecutionResult,
  readTestcaseSource,
  requireAbsolutePath,
  requireNonEmptyString,
  serializeExecutionResult,
  validateExecutionResult,
  validateTestcaseSource,
} from "./testcase-data-utils.mjs";

const SOURCE_CASE_INDEX = new WeakMap();

function requirePositiveInteger(value, field) {
  if (!Number.isInteger(value) || value < 1) {
    throw new TypeError(`${field} must be a positive integer`);
  }
  return value;
}

function normalizeStatus(value) {
  const status = requireNonEmptyString(value, "status").toUpperCase();
  if (!FINAL_STATUSES.has(status)) {
    throw new TypeError(`unsupported status: ${status}`);
  }
  return status;
}

function aggregateStatuses(statuses) {
  if (statuses.some((status) => status === "FAILED")) return "FAILED";
  if (statuses.some((status) => status === "BLOCKED")) return "BLOCKED";
  return "PASSED";
}

function sourceCaseIndex(source) {
  let index = SOURCE_CASE_INDEX.get(source);
  if (!index) {
    index = new Map(source.testcases.map((testcase) => [testcase.id, testcase]));
    SOURCE_CASE_INDEX.set(source, index);
  }
  return index;
}

function resolveSourceCase(result, caseId) {
  const normalizedCaseId = requireNonEmptyString(caseId, "caseId");
  const source = getAssociatedSource(result);
  const testcase = sourceCaseIndex(source).get(normalizedCaseId);
  if (!testcase) {
    throw new RangeError(`caseId does not exist in Source: ${normalizedCaseId}`);
  }
  return { source, testcase, caseId: normalizedCaseId };
}

function ensureCaseResult(result, caseId) {
  const current = result.cases[caseId];
  if (current) {
    if (!current.steps || typeof current.steps !== "object" || Array.isArray(current.steps)) {
      throw new TypeError(`result.cases[${caseId}].steps must be an object`);
    }
    return current;
  }
  const created = { steps: {} };
  result.cases[caseId] = created;
  return created;
}

function normalizeScreenshots(screenshots) {
  if (!Array.isArray(screenshots)) {
    throw new TypeError("screenshots must be an array");
  }
  return screenshots.map((screenshot, index) => {
    const value = requireNonEmptyString(screenshot, `screenshots[${index}]`);
    if (!value.startsWith("execute-testcase/screenshots/")) {
      throw new TypeError(
        `screenshots[${index}] must start with execute-testcase/screenshots/`,
      );
    }
    return value;
  });
}

export { readExecutionResult, readTestcaseSource };

export function recordSystem({ result, system }) {
  getAssociatedSource(result);
  result.system = requireNonEmptyString(system, "system");
  return result;
}

export function recordCaseContext({
  result,
  caseId,
  pageId,
  actualUrl,
}) {
  const resolved = resolveSourceCase(result, caseId);
  const caseResult = ensureCaseResult(result, resolved.caseId);
  caseResult.page_id = requireNonEmptyString(pageId, "pageId");
  if (actualUrl !== undefined) {
    caseResult.actual_url =
      actualUrl === null ? null : requireNonEmptyString(actualUrl, "actualUrl");
  }
  return result;
}

export function recordStep({
  result,
  caseId,
  stepNo,
  actual,
  status,
  screenshots = [],
}) {
  const resolved = resolveSourceCase(result, caseId);
  const normalizedStepNo = requirePositiveInteger(stepNo, "stepNo");
  const sourceStep = resolved.testcase.steps[normalizedStepNo - 1];
  if (!sourceStep || sourceStep.step !== normalizedStepNo) {
    throw new RangeError(
      `stepNo does not exist in Source case ${resolved.caseId}: ${normalizedStepNo}`,
    );
  }
  const caseResult = ensureCaseResult(result, resolved.caseId);
  caseResult.steps[String(normalizedStepNo)] = {
    actual: requireNonEmptyString(actual, "actual"),
    result: normalizeStatus(status),
    screenshots: normalizeScreenshots(screenshots),
  };
  caseResult.result = null;
  result.result = null;
  return result;
}

export function finalizeResult({ source, result }) {
  validateTestcaseSource(source);
  associateResultWithSource(result, source);
  validateExecutionResult(result, { source });

  const caseStatuses = source.testcases.map((testcase) => {
    const caseResult = result.cases[testcase.id];
    if (!caseResult) {
      throw new Error(`Incomplete result: ${testcase.case_name} has no result entry`);
    }
    const stepStatuses = testcase.steps.map((step) => {
      const stepResult = caseResult.steps[String(step.step)];
      if (!stepResult || !FINAL_STATUSES.has(stepResult.result)) {
        throw new Error(`Incomplete result: ${testcase.case_name} step ${step.step}`);
      }
      return stepResult.result;
    });
    caseResult.result = aggregateStatuses(stepStatuses);
    return caseResult.result;
  });

  result.result = aggregateStatuses(caseStatuses);
  validateExecutionResult(result, { source });
  return result;
}

export async function writeExecutionResult({ source, result, outputPath }) {
  const normalizedPath = requireAbsolutePath(outputPath, "outputPath");
  const temporaryPath = `${normalizedPath}.tmp-${process.pid}-${Date.now()}`;
  const serialized = serializeExecutionResult(result, { source });
  await mkdir(path.dirname(normalizedPath), { recursive: true });
  try {
    await writeFile(temporaryPath, serialized, { encoding: "utf8", flag: "wx" });
    await rename(temporaryPath, normalizedPath);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
  return normalizedPath;
}

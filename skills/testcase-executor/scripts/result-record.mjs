import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  FINAL_STATUSES,
  associateResultWithReport,
  getAssociatedReport,
  readExecutionResult,
  readTestcaseMarkdown,
  requireAbsolutePath,
  requireNonEmptyString,
  serializeExecutionResult,
  validateExecutionResult,
  validateTestcaseReport,
} from "./testcase-data-utils.mjs";

const REPORT_CASE_INDEX = new WeakMap();

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

function aggregateCaseStatus(testcase, caseResult) {
  if (!caseResult) return null;
  const stepStatuses = testcase.steps.map(
    (step) => caseResult.steps[String(step.step)]?.result,
  );
  if (stepStatuses.some((status) => !FINAL_STATUSES.has(status))) return null;
  return aggregateStatuses(stepStatuses);
}

function refreshAggregates({ report, result }) {
  report.testcases.forEach((testcase) => {
    const caseResult = result.cases[testcase.case_name];
    if (caseResult) {
      caseResult.result = aggregateCaseStatus(testcase, caseResult);
    }
  });
  return result;
}

function reportCaseIndex(report) {
  let index = REPORT_CASE_INDEX.get(report);
  if (!index) {
    index = new Map(
      report.testcases.map((testcase) => [testcase.case_name, testcase]),
    );
    REPORT_CASE_INDEX.set(report, index);
  }
  return index;
}

function resolveReportCase(result, caseName) {
  const normalizedCaseName = requireNonEmptyString(caseName, "caseName");
  const report = getAssociatedReport(result);
  const testcase = reportCaseIndex(report).get(normalizedCaseName);
  if (!testcase) {
    throw new RangeError(`caseName does not exist in testcase Markdown: ${normalizedCaseName}`);
  }
  return { report, testcase, caseName: normalizedCaseName };
}

function ensureCaseResult(result, caseName) {
  const current = result.cases[caseName];
  if (current) {
    if (!current.steps || typeof current.steps !== "object" || Array.isArray(current.steps)) {
      throw new TypeError(`result.cases[${JSON.stringify(caseName)}].steps must be an object`);
    }
    return current;
  }
  const created = { result: null, steps: {} };
  result.cases[caseName] = created;
  return created;
}

function normalizeScreenshots(screenshots, environment) {
  if (!Array.isArray(screenshots)) {
    throw new TypeError("screenshots must be an array");
  }
  return screenshots.map((screenshot, index) => {
    if (!screenshot || typeof screenshot !== "object" || Array.isArray(screenshot)) {
      throw new TypeError(`screenshots[${index}] must be an object`);
    }
    const name = requireNonEmptyString(screenshot.name, `screenshots[${index}].name`);
    const screenshotPath = requireNonEmptyString(
      screenshot.path,
      `screenshots[${index}].path`,
    ).replaceAll("\\", "/");
    if (
      screenshotPath.startsWith("/") ||
      screenshotPath.split("/").includes("..") ||
      !screenshotPath.startsWith(`${environment.toLowerCase()}-screenshots/`)
    ) {
      throw new TypeError(
        `screenshots[${index}].path must be inside ${environment.toLowerCase()}-screenshots/`,
      );
    }
    return { name, path: screenshotPath };
  });
}

export { readExecutionResult, readTestcaseMarkdown };

export function recordCaseContext({
  result,
  caseName,
  pageName,
  pageUrl,
}) {
  const resolved = resolveReportCase(result, caseName);
  const caseResult = ensureCaseResult(result, resolved.caseName);
  caseResult.page = requireNonEmptyString(pageName, "pageName");
  if (pageUrl !== undefined) {
    caseResult.url =
      pageUrl === null ? null : requireNonEmptyString(pageUrl, "pageUrl");
  }
  return result;
}

export function recordStep({
  result,
  caseName,
  stepNo,
  actual,
  status,
  screenshots = [],
}) {
  const resolved = resolveReportCase(result, caseName);
  const normalizedStepNo = requirePositiveInteger(stepNo, "stepNo");
  const reportStep = resolved.testcase.steps[normalizedStepNo - 1];
  if (!reportStep || reportStep.step !== normalizedStepNo) {
    throw new RangeError(
      `stepNo does not exist in testcase ${resolved.caseName}: ${normalizedStepNo}`,
    );
  }
  const caseResult = ensureCaseResult(result, resolved.caseName);
  const normalizedScreenshots = normalizeScreenshots(
    screenshots,
    resolved.report.environment,
  );
  caseResult.steps[String(normalizedStepNo)] = {
    actual: requireNonEmptyString(actual, "actual"),
    result: normalizeStatus(status),
    ...(normalizedScreenshots.length > 0
      ? { screenshots: normalizedScreenshots }
      : {}),
  };
  refreshAggregates({ report: resolved.report, result });
  return result;
}

export function finalizeResult({ report, result }) {
  validateTestcaseReport(report);
  associateResultWithReport(result, report);
  validateExecutionResult(result, { report });
  refreshAggregates({ report, result });

  report.testcases.forEach((testcase) => {
    const caseResult = result.cases[testcase.case_name];
    if (!caseResult) {
      throw new Error(`Incomplete result: ${testcase.case_name} has no result entry`);
    }
    testcase.steps.forEach((step) => {
      const stepResult = caseResult.steps[String(step.step)];
      if (!stepResult || !FINAL_STATUSES.has(stepResult.result)) {
        throw new Error(`Incomplete result: ${testcase.case_name} step ${step.step}`);
      }
    });
  });

  validateExecutionResult(result, { report });
  return result;
}

export async function writeExecutionResult({ report, result, outputPath }) {
  const normalizedPath = requireAbsolutePath(outputPath, "outputPath");
  const expectedName = `${report.environment.toLowerCase()}-execution-result.json`;
  if (path.basename(normalizedPath) !== expectedName) {
    throw new TypeError(
      `outputPath must end with ${expectedName}`,
    );
  }
  const temporaryPath = `${normalizedPath}.tmp-${process.pid}-${Date.now()}`;
  const serialized = serializeExecutionResult(result, { report });
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

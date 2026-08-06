import { readFile } from "node:fs/promises";
import path from "node:path";

export const FINAL_STATUSES = new Set(["PASSED", "FAILED", "BLOCKED"]);
export const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const SOURCE_ASSIGNMENT_PATTERN =
  /^\uFEFF?\s*window\.TESTCASE_SOURCE\s*=\s*([\s\S]*?)\s*;\s*$/;
const RESULT_ASSIGNMENT_PATTERN =
  /^\uFEFF?\s*window\.TESTCASE_EXECUTION_RESULT\s*=\s*([\s\S]*?)\s*;\s*$/;
const RESULT_SOURCE = new WeakMap();

export function requireNonEmptyString(value, field) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${field} must be a non-empty string`);
  }
  return value.trim();
}

export function requireAbsolutePath(value, field) {
  const normalized = requireNonEmptyString(value, field);
  return path.resolve(normalized);
}

export function normalizeEnvironment(value = "uat") {
  const environment = requireNonEmptyString(value, "environment").toLowerCase();
  if (environment !== "uat" && environment !== "pre") {
    throw new TypeError("environment must be uat or pre");
  }
  return environment;
}

function requireObject(value, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${field} must be an object`);
  }
  return value;
}

function requireUuid(value, field) {
  const uuid = requireNonEmptyString(value, field);
  if (!UUID_PATTERN.test(uuid)) {
    throw new TypeError(`${field} must be a standard UUID`);
  }
  return uuid;
}

function requireExactKeys(value, expectedKeys, field) {
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    throw new TypeError(`${field} fields must be exactly: ${expected.join(", ")}`);
  }
}

function requireAllowedKeys(value, allowedKeys, field) {
  const allowed = new Set(allowedKeys);
  const unsupported = Object.keys(value).filter((key) => !allowed.has(key));
  if (unsupported.length > 0) {
    throw new TypeError(`${field} contains unsupported fields: ${unsupported.join(", ")}`);
  }
}

function requireEnvironment(value, field) {
  if (value !== "UAT" && value !== "PRE") {
    throw new TypeError(`${field} must be UAT or PRE`);
  }
  return value;
}

function requireStatusOrNull(value, field) {
  if (value === null) return null;
  if (!FINAL_STATUSES.has(value)) {
    throw new TypeError(`${field} must be PASSED, FAILED, BLOCKED, or null`);
  }
  return value;
}

function parseAssignment(sourceText, pattern, field) {
  if (typeof sourceText !== "string") {
    throw new TypeError(`${field} text must be a string`);
  }
  const match = sourceText.match(pattern);
  if (!match) {
    throw new TypeError(`${field} file must contain only its window assignment`);
  }
  try {
    return JSON.parse(match[1]);
  } catch (error) {
    throw new TypeError(`${field} must contain strict JSON: ${error.message}`);
  }
}

export function parseTestcaseSourceText(sourceText) {
  return parseAssignment(sourceText, SOURCE_ASSIGNMENT_PATTERN, "TESTCASE_SOURCE");
}

export function validateTestcaseSource(source, { environment } = {}) {
  requireObject(source, "TESTCASE_SOURCE");
  requireExactKeys(
    source,
    ["source_id", "environment", "prd_name", "testcases"],
    "TESTCASE_SOURCE",
  );
  requireUuid(source.source_id, "TESTCASE_SOURCE.source_id");
  requireEnvironment(source.environment, "TESTCASE_SOURCE.environment");
  if (environment) {
    const selected = normalizeEnvironment(environment).toUpperCase();
    if (source.environment !== selected) {
      throw new TypeError(
        `Source environment ${source.environment} does not match selected environment ${selected}`,
      );
    }
  }
  requireNonEmptyString(source.prd_name, "TESTCASE_SOURCE.prd_name");
  if (!Array.isArray(source.testcases) || source.testcases.length === 0) {
    throw new TypeError("TESTCASE_SOURCE.testcases must be a non-empty array");
  }

  const caseIds = new Set();
  source.testcases.forEach((testcase, caseIndex) => {
    const caseField = `TESTCASE_SOURCE.testcases[${caseIndex}]`;
    requireObject(testcase, caseField);
    requireExactKeys(
      testcase,
      ["id", "case_name", "module_path", "precondition", "steps"],
      caseField,
    );
    const caseId = requireUuid(testcase.id, `${caseField}.id`).toLowerCase();
    if (caseIds.has(caseId)) {
      throw new TypeError(`${caseField}.id must be unique`);
    }
    caseIds.add(caseId);
    requireNonEmptyString(testcase.case_name, `${caseField}.case_name`);
    if (!Array.isArray(testcase.module_path) || testcase.module_path.length === 0) {
      throw new TypeError(`${caseField}.module_path must be a non-empty array`);
    }
    testcase.module_path.forEach((moduleName, moduleIndex) => {
      requireNonEmptyString(moduleName, `${caseField}.module_path[${moduleIndex}]`);
    });
    if (typeof testcase.precondition !== "string") {
      throw new TypeError(`${caseField}.precondition must be a string`);
    }
    if (!Array.isArray(testcase.steps) || testcase.steps.length === 0) {
      throw new TypeError(`${caseField}.steps must be a non-empty array`);
    }
    testcase.steps.forEach((step, stepIndex) => {
      const stepField = `${caseField}.steps[${stepIndex}]`;
      requireObject(step, stepField);
      requireExactKeys(step, ["step", "action", "expected"], stepField);
      if (!Number.isInteger(step.step) || step.step !== stepIndex + 1) {
        throw new TypeError(`${stepField}.step must be continuous from 1`);
      }
      requireNonEmptyString(step.action, `${stepField}.action`);
      requireNonEmptyString(step.expected, `${stepField}.expected`);
    });
  });
  return source;
}

export async function readTestcaseSource(inputPath, { environment } = {}) {
  const sourcePath = requireAbsolutePath(inputPath, "inputPath");
  const source = parseTestcaseSourceText(await readFile(sourcePath, "utf8"));
  return validateTestcaseSource(source, { environment });
}

export function parseExecutionResultText(sourceText) {
  return parseAssignment(
    sourceText,
    RESULT_ASSIGNMENT_PATTERN,
    "TESTCASE_EXECUTION_RESULT",
  );
}

export function associateResultWithSource(result, source) {
  requireObject(result, "TESTCASE_EXECUTION_RESULT");
  validateTestcaseSource(source);
  RESULT_SOURCE.set(result, source);
  return result;
}

export function getAssociatedSource(result) {
  const source = RESULT_SOURCE.get(result);
  if (!source) {
    throw new TypeError("execution result is not associated with a validated Source");
  }
  return source;
}

export function validateExecutionResult(result, { source } = {}) {
  requireObject(result, "TESTCASE_EXECUTION_RESULT");
  requireExactKeys(
    result,
    ["source_id", "system", "environment", "result", "cases"],
    "TESTCASE_EXECUTION_RESULT",
  );
  requireUuid(result.source_id, "TESTCASE_EXECUTION_RESULT.source_id");
  if (result.system !== null) {
    requireNonEmptyString(result.system, "TESTCASE_EXECUTION_RESULT.system");
  }
  requireEnvironment(result.environment, "TESTCASE_EXECUTION_RESULT.environment");
  requireStatusOrNull(result.result, "TESTCASE_EXECUTION_RESULT.result");
  requireObject(result.cases, "TESTCASE_EXECUTION_RESULT.cases");

  let sourceCases = null;
  if (source) {
    validateTestcaseSource(source);
    if (result.source_id.toLowerCase() !== source.source_id.toLowerCase()) {
      throw new TypeError("execution result source_id does not match Source");
    }
    if (result.environment !== source.environment) {
      throw new TypeError("execution result environment does not match Source");
    }
    sourceCases = new Map(source.testcases.map((testcase) => [testcase.id, testcase]));
  }

  Object.entries(result.cases).forEach(([caseId, caseResult]) => {
    requireUuid(caseId, `TESTCASE_EXECUTION_RESULT.cases key ${caseId}`);
    const sourceCase = sourceCases?.get(caseId);
    if (sourceCases && !sourceCase) {
      throw new TypeError(`execution result contains unknown testcase UUID ${caseId}`);
    }
    const caseField = `TESTCASE_EXECUTION_RESULT.cases[${caseId}]`;
    requireObject(caseResult, caseField);
    requireAllowedKeys(
      caseResult,
      ["page_id", "actual_url", "result", "steps"],
      caseField,
    );
    if (caseResult.page_id !== undefined) {
      requireNonEmptyString(caseResult.page_id, `${caseField}.page_id`);
    }
    if (caseResult.actual_url !== undefined && caseResult.actual_url !== null) {
      requireNonEmptyString(caseResult.actual_url, `${caseField}.actual_url`);
    }
    if (caseResult.result !== undefined) {
      requireStatusOrNull(caseResult.result, `${caseField}.result`);
    }
    requireObject(caseResult.steps, `${caseField}.steps`);
    Object.entries(caseResult.steps).forEach(([stepNumber, stepResult]) => {
      if (
        !/^\d+$/.test(stepNumber) ||
        Number(stepNumber) < 1 ||
        String(Number(stepNumber)) !== stepNumber
      ) {
        throw new TypeError(`${caseField}.steps contains invalid step ${stepNumber}`);
      }
      if (sourceCase && !sourceCase.steps[Number(stepNumber) - 1]) {
        throw new TypeError(`${caseField}.steps contains unknown step ${stepNumber}`);
      }
      const stepField = `${caseField}.steps[${stepNumber}]`;
      requireObject(stepResult, stepField);
      requireExactKeys(stepResult, ["actual", "result", "screenshots"], stepField);
      requireNonEmptyString(stepResult.actual, `${stepField}.actual`);
      if (!FINAL_STATUSES.has(stepResult.result)) {
        throw new TypeError(`${stepField}.result must be PASSED, FAILED, or BLOCKED`);
      }
      if (!Array.isArray(stepResult.screenshots)) {
        throw new TypeError(`${stepField}.screenshots must be an array`);
      }
      stepResult.screenshots.forEach((screenshot, screenshotIndex) => {
        const value = requireNonEmptyString(
          screenshot,
          `${stepField}.screenshots[${screenshotIndex}]`,
        );
        if (!value.startsWith("execute-testcase/screenshots/")) {
          throw new TypeError(
            `${stepField}.screenshots[${screenshotIndex}] must be relative to the requirement Viewer`,
          );
        }
      });
    });
  });

  if (source) associateResultWithSource(result, source);
  return result;
}

export async function readExecutionResult(inputPath, { source } = {}) {
  const resultPath = requireAbsolutePath(inputPath, "inputPath");
  const result = parseExecutionResultText(await readFile(resultPath, "utf8"));
  return validateExecutionResult(result, { source });
}

export function serializeExecutionResult(result, { source } = {}) {
  validateExecutionResult(result, { source });
  return `window.TESTCASE_EXECUTION_RESULT = ${JSON.stringify(result, null, 2)};\n`;
}

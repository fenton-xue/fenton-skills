import { readFile } from "node:fs/promises";

export const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const SOURCE_ASSIGNMENT_PATTERN =
  /^\s*window\.TESTCASE_SOURCE\s*=\s*([\s\S]*?)\s*;\s*$/;

function requireObject(value, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${field} must be an object`);
  }
  return value;
}

function requireString(value, field, { allowEmpty = false } = {}) {
  if (typeof value !== "string" || (!allowEmpty && value.trim() === "")) {
    throw new TypeError(`${field} must be ${allowEmpty ? "a string" : "a non-empty string"}`);
  }
  return value;
}

function requireUuid(value, field) {
  requireString(value, field);
  if (!UUID_PATTERN.test(value)) {
    throw new TypeError(`${field} must be a standard UUID`);
  }
  return value;
}

function requireEnvironment(value, field) {
  requireString(value, field);
  if (value !== "UAT" && value !== "PRE") {
    throw new TypeError(`${field} must be UAT or PRE`);
  }
  return value;
}

function requireExactKeys(value, allowedKeys, field) {
  const actualKeys = Object.keys(value).sort();
  const expectedKeys = [...allowedKeys].sort();
  if (
    actualKeys.length !== expectedKeys.length ||
    actualKeys.some((key, index) => key !== expectedKeys[index])
  ) {
    throw new TypeError(
      `${field} fields must be exactly: ${expectedKeys.join(", ")}`,
    );
  }
}

export function parseTestcaseSourceText(sourceText) {
  if (typeof sourceText !== "string") {
    throw new TypeError("sourceText must be a string");
  }
  const match = sourceText.match(SOURCE_ASSIGNMENT_PATTERN);
  if (!match) {
    throw new TypeError(
      "Source file must contain only window.TESTCASE_SOURCE = {...};",
    );
  }
  try {
    return JSON.parse(match[1]);
  } catch (error) {
    throw new TypeError(`TESTCASE_SOURCE must be strict JSON: ${error.message}`);
  }
}

export function validateTestcaseSource(source) {
  requireObject(source, "TESTCASE_SOURCE");
  requireExactKeys(
    source,
    ["source_id", "environment", "prd_name", "testcases"],
    "TESTCASE_SOURCE",
  );
  requireUuid(source.source_id, "TESTCASE_SOURCE.source_id");
  requireEnvironment(source.environment, "TESTCASE_SOURCE.environment");
  requireString(source.prd_name, "TESTCASE_SOURCE.prd_name");
  if (!Array.isArray(source.testcases) || source.testcases.length === 0) {
    throw new TypeError("TESTCASE_SOURCE.testcases must be a non-empty array");
  }

  source.testcases.forEach((testcase, caseIndex) => {
    const caseField = `TESTCASE_SOURCE.testcases[${caseIndex}]`;
    requireObject(testcase, caseField);
    requireExactKeys(
      testcase,
      ["id", "case_name", "module_path", "precondition", "steps"],
      caseField,
    );
    requireUuid(testcase.id, `${caseField}.id`);
    requireString(testcase.case_name, `${caseField}.case_name`);
    if (!Array.isArray(testcase.module_path) || testcase.module_path.length === 0) {
      throw new TypeError(`${caseField}.module_path must be a non-empty array`);
    }
    testcase.module_path.forEach((moduleName, moduleIndex) => {
      requireString(moduleName, `${caseField}.module_path[${moduleIndex}]`);
    });
    requireString(testcase.precondition, `${caseField}.precondition`, {
      allowEmpty: true,
    });
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
      requireString(step.action, `${stepField}.action`);
      requireString(step.expected, `${stepField}.expected`);
    });
  });

  return source;
}

export async function readTestcaseSource(inputPath) {
  const sourceText = await readFile(inputPath, "utf8");
  return validateTestcaseSource(parseTestcaseSourceText(sourceText));
}

export function serializeTestcaseSource(source) {
  validateTestcaseSource(source);
  return `window.TESTCASE_SOURCE = ${JSON.stringify(source, null, 2)};\n`;
}

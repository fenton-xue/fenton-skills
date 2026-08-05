import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const FINAL_STATUSES = new Set(["PASSED", "FAILED", "BLOCKED"]);
const ASSIGNMENT_PREFIX = "window.TESTCASE_RESULT = ";

function requireString(value, field) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${field} must be a non-empty string`);
  }
  return value.trim();
}

function requirePositiveInteger(value, field) {
  if (!Number.isInteger(value) || value < 1) {
    throw new TypeError(`${field} must be a positive integer`);
  }
  return value;
}

function normalizeStatus(value) {
  const status = requireString(value, "status").toUpperCase();
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

function resolveTestcase(result, caseNo) {
  const normalizedCaseNo = requirePositiveInteger(caseNo, "caseNo");
  const testcase = result?.testcases?.[normalizedCaseNo - 1];
  if (!testcase) throw new RangeError(`caseNo out of range: ${caseNo}`);
  return testcase;
}

export function parseExecutionPlan(sourceText) {
  if (typeof sourceText !== "string") {
    throw new TypeError("sourceText must be a string");
  }
  const trimmed = sourceText.trim();
  if (!trimmed.startsWith(ASSIGNMENT_PREFIX) || !trimmed.endsWith(";")) {
    throw new TypeError(
      "execution plan must use window.TESTCASE_RESULT = {...}; format",
    );
  }
  return JSON.parse(
    trimmed.slice(ASSIGNMENT_PREFIX.length, -1).trim(),
  );
}

export async function readExecutionPlan(inputPath) {
  const normalizedPath = path.resolve(requireString(inputPath, "inputPath"));
  return parseExecutionPlan(await readFile(normalizedPath, "utf8"));
}

export function recordCaseUrl({ result, caseNo, actualUrl }) {
  resolveTestcase(result, caseNo).actual_url = requireString(
    actualUrl,
    "actualUrl",
  );
  return result;
}

export function recordStep({
  result,
  caseNo,
  stepNo,
  actual,
  status,
  screenshots = [],
}) {
  const testcase = resolveTestcase(result, caseNo);
  const normalizedStepNo = requirePositiveInteger(stepNo, "stepNo");
  const step = testcase.steps?.find((item) => item.step === normalizedStepNo);
  if (!step) throw new RangeError(`stepNo not found: ${stepNo}`);
  if (!Array.isArray(screenshots)) {
    throw new TypeError("screenshots must be an array");
  }

  step.actual = requireString(actual, "actual");
  step.result = normalizeStatus(status);
  step.screenshots = screenshots.map((item) =>
    requireString(item, "screenshot"),
  );
  return result;
}

export function finalizeResult({ result }) {
  const testcaseStatuses = result.testcases.map((testcase) => {
    const stepStatuses = testcase.steps.map((step) => {
      if (!FINAL_STATUSES.has(step.result)) {
        throw new Error(
          `Incomplete result: ${testcase.case_name} step ${step.step}`,
        );
      }
      return step.result;
    });
    testcase.result = aggregateStatuses(stepStatuses);
    return testcase.result;
  });
  result.result = aggregateStatuses(testcaseStatuses);
  return result;
}

export async function writeExecutionPlan({ result, outputPath }) {
  const normalizedPath = path.resolve(
    requireString(outputPath, "outputPath"),
  );
  const temporaryPath = `${normalizedPath}.tmp-${process.pid}-${Date.now()}`;
  await mkdir(path.dirname(normalizedPath), { recursive: true });
  try {
    await writeFile(
      temporaryPath,
      `${ASSIGNMENT_PREFIX}${JSON.stringify(result, null, 2)};\n`,
      { encoding: "utf8", flag: "wx" },
    );
    await rename(temporaryPath, normalizedPath);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
  return normalizedPath;
}

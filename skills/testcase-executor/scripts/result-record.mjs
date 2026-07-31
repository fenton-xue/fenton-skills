import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const FINAL_STATUSES = new Set(["PASSED", "FAILED", "BLOCKED"]);

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

function copyStringArray(value, field) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new TypeError(`${field} must be a non-empty array`);
  }
  value.forEach((item, index) => {
    if (typeof item !== "string" || item.trim() === "") {
      throw new TypeError(`${field}[${index}] must be a non-empty string`);
    }
  });
  return [...value];
}

function copyOptionalString(value, field) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  if (typeof value !== "string") {
    throw new TypeError(`${field} must be a string or null`);
  }
  return value;
}

function formatTime(date, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );

  return {
    runId:
      `${parts.year}${parts.month}${parts.day}_` +
      `${parts.hour}${parts.minute}${parts.second}`,
    timestamp:
      `${parts.year}-${parts.month}-${parts.day} ` +
      `${parts.hour}:${parts.minute}:${parts.second}`,
  };
}

function aggregateStatuses(statuses) {
  if (statuses.some((status) => status === "FAILED")) {
    return "FAILED";
  }
  if (statuses.some((status) => status === "BLOCKED")) {
    return "BLOCKED";
  }
  return "PASSED";
}

function yamlScalar(value) {
  if (value === null) {
    return "null";
  }
  if (typeof value === "boolean" || typeof value === "number") {
    return String(value);
  }
  return JSON.stringify(value);
}

function toYaml(value, indent = 0) {
  const prefix = " ".repeat(indent);
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return `${prefix}[]`;
    }
    return value
      .map((item) => {
        if (item === null || typeof item !== "object") {
          return `${prefix}- ${yamlScalar(item)}`;
        }
        return `${prefix}-\n${toYaml(item, indent + 2)}`;
      })
      .join("\n");
  }
  if (value && typeof value === "object") {
    return Object.entries(value)
      .map(([key, item]) => {
        if (item !== null && typeof item === "object") {
          return `${prefix}${key}:\n${toYaml(item, indent + 2)}`;
        }
        return `${prefix}${key}: ${yamlScalar(item)}`;
      })
      .join("\n");
  }
  return `${prefix}${yamlScalar(value)}`;
}

export function createResult({
  executionPlan,
  environment,
  startedAt = new Date(),
  timeZone = "Asia/Shanghai",
}) {
  if (!executionPlan || typeof executionPlan !== "object") {
    throw new TypeError("executionPlan must be an object");
  }
  const system = requireString(executionPlan.system, "executionPlan.system");
  const prdName = requireString(
    executionPlan.prd_name,
    "executionPlan.prd_name",
  );
  if (!Array.isArray(executionPlan.testcases) || executionPlan.testcases.length === 0) {
    throw new TypeError("executionPlan.testcases must be a non-empty array");
  }
  const started = formatTime(startedAt, timeZone);
  return {
    system,
    prd_name: prdName,
    environment: requireString(environment, "environment").toUpperCase(),
    run_id: started.runId,
    started_at: started.timestamp,
    finished_at: null,
    result: null,
    testcases: executionPlan.testcases.map((testcase) => {
      const caseName = requireString(testcase.case_name, "case_name");
      const pageId = requireString(testcase.page_id, "page_id");
      if (!Array.isArray(testcase.steps) || testcase.steps.length === 0) {
        throw new TypeError(`${caseName} steps must be a non-empty array`);
      }

      return {
        case_name: caseName,
        module_path: copyStringArray(testcase.module_path, "module_path"),
        page_id: pageId,
        actual_url: null,
        result: null,
        precondition: copyOptionalString(
          testcase.precondition,
          "precondition",
        ),
        steps: testcase.steps.map((step) => ({
          step: requirePositiveInteger(step.step, "step"),
          action: requireString(step.action, "action"),
          expected: requireString(step.expected, "expected"),
          actual: null,
          result: null,
          screenshots: [],
        })),
      };
    }),
  };
}

export function recordCaseUrl({ result, caseNo, actualUrl }) {
  const testcase = result?.testcases?.[
    requirePositiveInteger(caseNo, "caseNo") - 1
  ];
  if (!testcase) {
    throw new RangeError(`caseNo out of range: ${caseNo}`);
  }

  testcase.actual_url = requireString(actualUrl, "actualUrl");
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
  const testcase = result?.testcases?.[
    requirePositiveInteger(caseNo, "caseNo") - 1
  ];
  if (!testcase) {
    throw new RangeError(`caseNo out of range: ${caseNo}`);
  }
  const step = testcase.steps.find(
    (item) => item.step === requirePositiveInteger(stepNo, "stepNo"),
  );
  if (!step) {
    throw new RangeError(`stepNo not found: ${stepNo}`);
  }

  const normalizedStatus = requireString(status, "status").toUpperCase();
  if (!FINAL_STATUSES.has(normalizedStatus)) {
    throw new TypeError(`unsupported status: ${normalizedStatus}`);
  }
  if (!Array.isArray(screenshots)) {
    throw new TypeError("screenshots must be an array");
  }

  step.actual = requireString(actual, "actual");
  step.result = normalizedStatus;
  step.screenshots = screenshots.map((item) =>
    requireString(item, "screenshot"),
  );
  return result;
}

export function finalizeResult({
  result,
  finishedAt = new Date(),
  timeZone = "Asia/Shanghai",
}) {
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
  result.finished_at = formatTime(finishedAt, timeZone).timestamp;
  return result;
}

export async function writeResult({ result, outputPath }) {
  const normalizedPath = requireString(outputPath, "outputPath");
  if (!path.isAbsolute(normalizedPath)) {
    throw new TypeError("outputPath must be an absolute path");
  }

  await mkdir(path.dirname(normalizedPath), { recursive: true });
  const temporaryPath = `${normalizedPath}.tmp-${Date.now()}`;
  try {
    await writeFile(temporaryPath, `${toYaml(result)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
    await rename(temporaryPath, normalizedPath);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
  return normalizedPath;
}

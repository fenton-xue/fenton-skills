import { readFile } from "node:fs/promises";
import path from "node:path";

export const FINAL_STATUSES = new Set(["PASSED", "FAILED", "BLOCKED"]);

const RESULT_REPORT = new WeakMap();
const VALID_ENVIRONMENTS = new Set(["UAT", "PRE"]);

export function requireNonEmptyString(value, field) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${field} must be a non-empty string`);
  }
  return value.trim();
}

export function requireAbsolutePath(value, field) {
  const normalized = requireNonEmptyString(value, field);
  if (!path.isAbsolute(normalized)) {
    throw new TypeError(`${field} must be an absolute path`);
  }
  return path.normalize(normalized);
}

export function normalizeEnvironment(value = "uat") {
  const environment = requireNonEmptyString(value, "environment").toLowerCase();
  if (environment !== "uat" && environment !== "pre") {
    throw new TypeError("environment must be uat or pre");
  }
  return environment;
}

function invalidMarkdown(message) {
  return new TypeError(`Invalid testcase Markdown: ${message}`);
}

function requireObject(value, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${field} must be an object`);
  }
  return value;
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

function requireStatusOrNull(value, field) {
  if (value === null) return null;
  if (!FINAL_STATUSES.has(value)) {
    throw new TypeError(`${field} must be PASSED, FAILED, BLOCKED, or null`);
  }
  return value;
}

function trimBlankLines(lines) {
  const result = [...lines];
  while (result[0]?.trim() === "") result.shift();
  while (result.at(-1)?.trim() === "") result.pop();
  return result;
}

function unquote(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function parseFrontmatter(source) {
  const metadata = {};
  source.split("\n").forEach((line, index) => {
    if (line.trim() === "") return;
    const match = line.match(/^([A-Za-z][A-Za-z0-9_-]*)\s*:\s*(.*?)\s*$/);
    if (!match) {
      throw invalidMarkdown(`frontmatter line ${index + 1} is not a key-value pair`);
    }
    if (Object.hasOwn(metadata, match[1])) {
      throw invalidMarkdown(`frontmatter field ${match[1]} is duplicated`);
    }
    metadata[match[1]] = unquote(match[2]);
  });
  return metadata;
}

function requireMetadata(metadata, field) {
  const value = metadata[field];
  if (typeof value !== "string" || value.trim() === "") {
    throw invalidMarkdown(`frontmatter field ${field} is required`);
  }
  return value.trim();
}

function parseModulePath(lines, caseName) {
  const headingIndex = lines.findIndex((line) => /^###\s+/.test(line));
  const headerLines = headingIndex < 0 ? lines : lines.slice(0, headingIndex);
  const fieldIndexes = headerLines.flatMap((line, index) =>
    /^\s*\*\*module_path:\*\*\s*$/.test(line) ? [index] : [],
  );
  if (fieldIndexes.length !== 1) {
    throw invalidMarkdown(`testcase "${caseName}" must contain one module_path field`);
  }
  const modulePath = [];
  for (const line of headerLines.slice(fieldIndexes[0] + 1)) {
    if (line.trim() === "") continue;
    const match = line.match(/^\s*[-*]\s+(.+?)\s*$/);
    if (!match || match[1].trim() === "") {
      throw invalidMarkdown(
        `testcase "${caseName}" module_path must be a Markdown unordered list`,
      );
    }
    modulePath.push(match[1].trim());
  }
  if (modulePath.length === 0) {
    throw invalidMarkdown(
      `testcase "${caseName}" module_path must contain at least one item`,
    );
  }
  return modulePath;
}

function splitLevelThreeSections(lines, caseName) {
  const sections = [];
  let current = null;
  lines.forEach((line) => {
    const heading = line.match(/^###\s+(.+?)\s*$/);
    if (heading) {
      if (current) {
        sections.push({ title: current.title, lines: trimBlankLines(current.lines) });
      }
      current = { title: heading[1].trim(), lines: [] };
    } else if (current) {
      current.lines.push(line);
    }
  });
  if (current) {
    sections.push({ title: current.title, lines: trimBlankLines(current.lines) });
  }
  const duplicate = sections.find(
    (section, index) =>
      sections.findIndex((candidate) => candidate.title === section.title) !== index,
  );
  if (duplicate) {
    throw invalidMarkdown(
      `testcase "${caseName}" has duplicate section "${duplicate.title}"`,
    );
  }
  return sections;
}

function fieldMatch(line) {
  return line.match(
    /^\s*(?:\*\*|__)(action|expected):(?:\*\*|__)\s*(.*?)\s*$/,
  );
}

function parseStepFields(lines, caseName, stepNumber) {
  const fields = [];
  lines.forEach((line, index) => {
    const match = fieldMatch(line);
    if (match) fields.push({ name: match[1], inline: match[2], index });
  });
  for (const field of ["action", "expected"]) {
    if (fields.filter((candidate) => candidate.name === field).length !== 1) {
      throw invalidMarkdown(
        `testcase "${caseName}" step ${stepNumber} must contain one ${field} field`,
      );
    }
  }
  const actionField = fields.find((field) => field.name === "action");
  const expectedField = fields.find((field) => field.name === "expected");
  if (actionField.index > expectedField.index) {
    throw invalidMarkdown(
      `testcase "${caseName}" step ${stepNumber} expected must follow action`,
    );
  }

  function readField(field, nextIndex) {
    const content = trimBlankLines([
      ...(field.inline ? [field.inline] : []),
      ...lines.slice(field.index + 1, nextIndex),
    ]).join("\n");
    if (content.trim() === "") {
      throw invalidMarkdown(
        `testcase "${caseName}" step ${stepNumber} ${field.name} must not be empty`,
      );
    }
    return content;
  }

  return {
    action: readField(actionField, expectedField.index),
    expected: readField(expectedField, lines.length),
  };
}

function parseTestcase(caseName, lines) {
  const modulePath = parseModulePath(lines, caseName);
  const sections = splitLevelThreeSections(lines, caseName);
  const unsupported = sections.find(
    (section) => section.title !== "前置条件" && !/^步骤\s+\d+$/.test(section.title),
  );
  if (unsupported) {
    throw invalidMarkdown(
      `testcase "${caseName}" has unsupported section "${unsupported.title}"`,
    );
  }
  const preconditions = sections.filter((section) => section.title === "前置条件");
  if (preconditions.length !== 1) {
    throw invalidMarkdown(`testcase "${caseName}" must contain one 前置条件 section`);
  }
  const precondition = preconditions[0].lines.join("\n").trim();
  if (precondition === "") {
    throw invalidMarkdown(
      `testcase "${caseName}" precondition must not be empty; use - when none`,
    );
  }
  const stepSections = sections.filter((section) => /^步骤\s+\d+$/.test(section.title));
  if (stepSections.length === 0) {
    throw invalidMarkdown(`testcase "${caseName}" must contain at least one step`);
  }
  const steps = stepSections.map((section, index) => {
    const step = Number(section.title.match(/\d+$/)[0]);
    if (step !== index + 1) {
      throw invalidMarkdown(`testcase "${caseName}" steps must be continuous from 1`);
    }
    return { step, ...parseStepFields(section.lines, caseName, step) };
  });
  return {
    case_name: requireNonEmptyString(caseName, "testcase name"),
    module_path: modulePath,
    precondition,
    steps,
  };
}

export function parseTestcaseMarkdown(markdown) {
  if (typeof markdown !== "string") {
    throw new TypeError("markdown must be a string");
  }
  const normalized = markdown.replace(/^\uFEFF/, "").replaceAll("\r\n", "\n");
  const frontmatterMatch = normalized.match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
  if (!frontmatterMatch) throw invalidMarkdown("file-level frontmatter is required");
  const metadata = parseFrontmatter(frontmatterMatch[1]);
  const environment = requireMetadata(metadata, "environment");
  if (!VALID_ENVIRONMENTS.has(environment)) {
    throw invalidMarkdown("frontmatter field environment must be UAT or PRE");
  }
  const title = requireMetadata(metadata, "title");
  const createdAt = requireMetadata(metadata, "created_at");
  if (Number.isNaN(Date.parse(createdAt))) {
    throw invalidMarkdown("frontmatter field created_at must be a valid date-time");
  }

  const body = normalized.slice(frontmatterMatch[0].length);
  const levelOneHeadings = [...body.matchAll(/^#\s+(.+?)\s*$/gm)];
  if (
    levelOneHeadings.length !== 1 ||
    levelOneHeadings[0][1].trim() !== "测试用例"
  ) {
    throw invalidMarkdown(
      'document must contain exactly one level-one heading "测试用例"',
    );
  }
  const caseMatches = [...body.matchAll(/^##\s+(.+?)\s*$/gm)];
  if (caseMatches.length === 0) throw invalidMarkdown("at least one testcase is required");
  if (levelOneHeadings[0].index > caseMatches[0].index) {
    throw invalidMarkdown(
      'level-one heading "测试用例" must appear before all testcases',
    );
  }
  const testcases = caseMatches.map((match, index) => {
    const start = match.index + match[0].length;
    const end = caseMatches[index + 1]?.index ?? body.length;
    return parseTestcase(match[1].trim(), body.slice(start, end).split("\n"));
  });
  const duplicate = testcases.find(
    (testcase, index) =>
      testcases.findIndex((candidate) => candidate.case_name === testcase.case_name) !==
      index,
  );
  if (duplicate) {
    throw invalidMarkdown(`testcase name is duplicated: ${duplicate.case_name}`);
  }
  return { environment, title, created_at: createdAt, testcases };
}

export function validateTestcaseReport(report, { environment } = {}) {
  requireObject(report, "testcase report");
  if (!Array.isArray(report.testcases) || report.testcases.length === 0) {
    throw new TypeError("testcase report must contain testcases");
  }
  if (environment) {
    const selected = normalizeEnvironment(environment).toUpperCase();
    if (report.environment !== selected) {
      throw new TypeError(
        `testcase environment ${report.environment} does not match selected environment ${selected}`,
      );
    }
  }
  return report;
}

export async function readTestcaseMarkdown(inputPath, { environment } = {}) {
  const markdownPath = requireAbsolutePath(inputPath, "inputPath");
  const report = parseTestcaseMarkdown(await readFile(markdownPath, "utf8"));
  return validateTestcaseReport(report, { environment });
}

export function parseExecutionResultText(jsonText) {
  if (typeof jsonText !== "string") {
    throw new TypeError("execution result text must be a string");
  }
  try {
    return JSON.parse(jsonText.replace(/^\uFEFF/, ""));
  } catch (error) {
    throw new TypeError(`execution result must be valid JSON: ${error.message}`);
  }
}

export function associateResultWithReport(result, report) {
  requireObject(result, "execution result");
  validateTestcaseReport(report);
  RESULT_REPORT.set(result, report);
  return result;
}

export function getAssociatedReport(result) {
  const report = RESULT_REPORT.get(result);
  if (!report) {
    throw new TypeError("execution result is not associated with validated testcases");
  }
  return report;
}

function validateScreenshot(screenshot, field, environment) {
  requireObject(screenshot, field);
  requireExactKeys(screenshot, ["name", "path"], field);
  requireNonEmptyString(screenshot.name, `${field}.name`);
  const screenshotPath = requireNonEmptyString(screenshot.path, `${field}.path`)
    .replaceAll("\\", "/");
  if (
    screenshotPath.startsWith("/") ||
    screenshotPath.split("/").includes("..") ||
    !(environment
      ? screenshotPath.startsWith(`${environment.toLowerCase()}-screenshots/`)
      : /^(?:uat|pre)-screenshots\//.test(screenshotPath))
  ) {
    throw new TypeError(
      `${field}.path must be inside the selected environment screenshot directory`,
    );
  }
}

export function validateExecutionResult(result, { report } = {}) {
  requireObject(result, "execution result");
  requireExactKeys(result, ["cases"], "execution result");
  requireObject(result.cases, "execution result.cases");

  let reportCases = null;
  if (report) {
    validateTestcaseReport(report);
    reportCases = new Map(
      report.testcases.map((testcase) => [testcase.case_name, testcase]),
    );
  }

  Object.entries(result.cases).forEach(([caseName, caseResult]) => {
    const reportCase = reportCases?.get(caseName);
    if (reportCases && !reportCase) {
      throw new TypeError(`execution result contains unknown testcase: ${caseName}`);
    }
    const caseField = `execution result.cases[${JSON.stringify(caseName)}]`;
    requireObject(caseResult, caseField);
    requireAllowedKeys(caseResult, ["page", "url", "result", "steps"], caseField);
    if (caseResult.page !== undefined) {
      requireNonEmptyString(caseResult.page, `${caseField}.page`);
    }
    if (caseResult.url !== undefined && caseResult.url !== null) {
      requireNonEmptyString(caseResult.url, `${caseField}.url`);
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
      if (reportCase && !reportCase.steps[Number(stepNumber) - 1]) {
        throw new TypeError(`${caseField}.steps contains unknown step ${stepNumber}`);
      }
      const stepField = `${caseField}.steps[${stepNumber}]`;
      requireObject(stepResult, stepField);
      requireAllowedKeys(stepResult, ["actual", "result", "screenshots"], stepField);
      requireNonEmptyString(stepResult.actual, `${stepField}.actual`);
      if (!FINAL_STATUSES.has(stepResult.result)) {
        throw new TypeError(`${stepField}.result must be PASSED, FAILED, or BLOCKED`);
      }
      if (stepResult.screenshots !== undefined) {
        if (!Array.isArray(stepResult.screenshots)) {
          throw new TypeError(`${stepField}.screenshots must be an array`);
        }
        stepResult.screenshots.forEach((screenshot, screenshotIndex) => {
          validateScreenshot(
            screenshot,
            `${stepField}.screenshots[${screenshotIndex}]`,
            report?.environment,
          );
        });
      }
    });
  });

  if (report) associateResultWithReport(result, report);
  return result;
}

export async function readExecutionResult(inputPath, { report } = {}) {
  const resultPath = requireAbsolutePath(inputPath, "inputPath");
  const result = parseExecutionResultText(await readFile(resultPath, "utf8"));
  return validateExecutionResult(result, { report });
}

export function serializeExecutionResult(result, { report } = {}) {
  validateExecutionResult(result, { report });
  const canonical = {
    cases: Object.fromEntries(
      Object.entries(result.cases).map(([caseName, caseResult]) => [
        caseName,
        {
          ...(caseResult.result !== undefined ? { result: caseResult.result } : {}),
          ...(caseResult.page !== undefined ? { page: caseResult.page } : {}),
          ...(caseResult.url !== undefined ? { url: caseResult.url } : {}),
          steps: Object.fromEntries(
            Object.entries(caseResult.steps).map(([stepNumber, stepResult]) => [
              stepNumber,
              {
                result: stepResult.result,
                actual: stepResult.actual,
                ...(stepResult.screenshots !== undefined
                  ? {
                      screenshots: stepResult.screenshots.map((screenshot) => ({
                        name: screenshot.name,
                        path: screenshot.path,
                      })),
                    }
                  : {}),
              },
            ]),
          ),
        },
      ]),
    ),
  };
  return `${JSON.stringify(canonical, null, 2)}\n`;
}

import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SUPPORTED_ENVIRONMENTS = new Set(["uat", "pre"]);

function formatError(lineNumber, message) {
  return new Error(`Line ${lineNumber}: ${message}`);
}

function requireText(value, lineNumber, field) {
  const normalized = value.trim();
  if (normalized === "") {
    throw formatError(lineNumber, `${field} cannot be empty`);
  }
  return normalized;
}

function requirePath(value, field) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${field} must be a non-empty path`);
  }
  return path.resolve(value);
}

function normalizeEnvironment(value = "uat") {
  if (typeof value !== "string") {
    throw new TypeError("environment must be a string");
  }
  const environment = value.trim().toLowerCase();
  if (!SUPPORTED_ENVIRONMENTS.has(environment)) {
    throw new TypeError("environment must be uat or pre");
  }
  return environment;
}

export function parseTestcases(sourceText, { environment = "uat" } = {}) {
  if (typeof sourceText !== "string") {
    throw new TypeError("sourceText must be a string");
  }

  const normalizedEnvironment = normalizeEnvironment(environment);
  const lines = sourceText.replace(/^\uFEFF/, "").split(/\r?\n/);
  const testcases = [];
  let modulePath = [];
  let currentCase = null;

  function finalizeCase() {
    if (!currentCase) return;
    if (currentCase.module_path.length === 0) {
      throw formatError(currentCase.lineNumber, "module path is missing");
    }

    const numbers = [
      ...new Set([
        ...currentCase.actions.keys(),
        ...currentCase.expectedResults.keys(),
      ]),
    ].sort((left, right) => left - right);

    if (numbers.length === 0) {
      throw formatError(currentCase.lineNumber, "test steps are missing");
    }

    numbers.forEach((number, index) => {
      if (number !== index + 1) {
        throw formatError(
          currentCase.lineNumber,
          `step numbers must be continuous from 1; found ${number}`,
        );
      }
      if (!currentCase.actions.has(number)) {
        throw formatError(currentCase.lineNumber, `步骤描述${number} is missing`);
      }
      if (!currentCase.expectedResults.has(number)) {
        throw formatError(currentCase.lineNumber, `预期结果${number} is missing`);
      }
    });

    testcases.push({
      case_name: currentCase.case_name,
      module_path: currentCase.module_path,
      page_id: null,
      actual_url: null,
      result: null,
      precondition: null,
      steps: numbers.map((number) => ({
        step: number,
        action: currentCase.actions.get(number),
        expected: currentCase.expectedResults.get(number),
        actual: null,
        result: null,
        screenshots: [],
      })),
    });
    currentCase = null;
  }

  lines.forEach((rawLine, index) => {
    const lineNumber = index + 1;
    const line = rawLine.trim();
    if (line === "") return;

    const moduleMatch = line.match(
      /^([一二三四五六七八九十百]+级模块)\s*[:：]\s*(.*)$/,
    );
    if (moduleMatch) {
      finalizeCase();
      const previousLine = lines
        .slice(0, index)
        .reverse()
        .find((candidate) => candidate.trim() !== "");
      if (previousLine?.trim().startsWith("预期结果")) {
        modulePath = [];
      }
      modulePath.push(requireText(moduleMatch[2], lineNumber, moduleMatch[1]));
      return;
    }

    const caseMatch = line.match(/^用例名称\s*[:：]\s*(.*)$/);
    if (caseMatch) {
      finalizeCase();
      currentCase = {
        lineNumber,
        case_name: requireText(caseMatch[1], lineNumber, "用例名称"),
        module_path: [...modulePath],
        actions: new Map(),
        expectedResults: new Map(),
      };
      return;
    }

    const actionMatch = line.match(/^步骤描述(\d+)\s*[:：]\s*(.*)$/);
    if (actionMatch) {
      if (!currentCase) {
        throw formatError(lineNumber, "步骤描述 appears before 用例名称");
      }
      const number = Number(actionMatch[1]);
      if (currentCase.actions.has(number)) {
        throw formatError(lineNumber, `duplicate 步骤描述${number}`);
      }
      currentCase.actions.set(
        number,
        requireText(actionMatch[2], lineNumber, `步骤描述${number}`),
      );
      return;
    }

    const expectedMatch = line.match(/^预期结果(\d+)\s*[:：]\s*(.*)$/);
    if (expectedMatch) {
      if (!currentCase) {
        throw formatError(lineNumber, "预期结果 appears before 用例名称");
      }
      const number = Number(expectedMatch[1]);
      if (currentCase.expectedResults.has(number)) {
        throw formatError(lineNumber, `duplicate 预期结果${number}`);
      }
      currentCase.expectedResults.set(
        number,
        requireText(expectedMatch[2], lineNumber, `预期结果${number}`),
      );
      return;
    }

    throw formatError(lineNumber, `unsupported field: ${line}`);
  });

  finalizeCase();
  if (testcases.length === 0) throw new Error("No testcases found");

  return {
    system: null,
    prd_name: null,
    environment: normalizedEnvironment.toUpperCase(),
    result: null,
    testcases,
  };
}

export function serializeExecutionPlan(executionPlan) {
  return `window.TESTCASE_RESULT = ${JSON.stringify(executionPlan, null, 2)};\n`;
}

export async function writeExecutionPlan({
  inputPath,
  outputDir,
  environment = "uat",
}) {
  const sourcePath = requirePath(inputPath, "inputPath");
  const targetDir = requirePath(outputDir, "outputDir");
  const normalizedEnvironment = normalizeEnvironment(environment);
  const sourceText = await readFile(sourcePath, "utf8");
  const executionPlan = parseTestcases(sourceText, {
    environment: normalizedEnvironment,
  });
  const targetPath = path.join(
    targetDir,
    `${normalizedEnvironment}-execution-plan.js`,
  );

  await mkdir(path.join(targetDir, "screenshots"), { recursive: true });
  const temporaryPath = path.join(
    targetDir,
    `.${path.basename(targetPath)}.tmp-${process.pid}-${Date.now()}`,
  );
  try {
    await writeFile(temporaryPath, serializeExecutionPlan(executionPlan), {
      encoding: "utf8",
      flag: "wx",
    });
    await rename(temporaryPath, targetPath);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }

  return {
    executionPlan,
    outputPath: targetPath,
    testcaseCount: executionPlan.testcases.length,
    environment: normalizedEnvironment,
  };
}

function parseCliArguments(args) {
  const options = { environment: "uat" };
  const argumentMap = new Map([
    ["--input", "inputPath"],
    ["--output-dir", "outputDir"],
    ["--env", "environment"],
  ]);

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    const key = argumentMap.get(argument);
    if (!key) throw new Error(`Unsupported argument: ${argument}`);
    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for ${argument}`);
    }
    if (key !== "environment" && options[key]) {
      throw new Error(`Duplicate argument: ${argument}`);
    }
    options[key] = value;
    index += 1;
  }

  if (!options.inputPath || !options.outputDir) {
    throw new Error(
      "Usage: node create-execution-plan.mjs --input <source.md> --output-dir <execute-testcase> [--env uat|pre]",
    );
  }
  return options;
}

async function main() {
  const result = await writeExecutionPlan(
    parseCliArguments(process.argv.slice(2)),
  );
  process.stdout.write(
    `${JSON.stringify({
      outputPath: result.outputPath,
      testcaseCount: result.testcaseCount,
      environment: result.environment,
    })}\n`,
  );
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}

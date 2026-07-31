import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

export function parseTestcases(sourceText) {
  if (typeof sourceText !== "string") {
    throw new TypeError("sourceText must be a string");
  }

  const lines = sourceText.replace(/^\uFEFF/, "").split(/\r?\n/);
  const testcases = [];
  let modulePath = [];
  let currentCase = null;

  function finalizeCase() {
    if (!currentCase) {
      return;
    }
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
        throw formatError(
          currentCase.lineNumber,
          `步骤描述${number} is missing`,
        );
      }
      if (!currentCase.expectedResults.has(number)) {
        throw formatError(
          currentCase.lineNumber,
          `预期结果${number} is missing`,
        );
      }
    });

    testcases.push({
      case_name: currentCase.case_name,
      module_path: currentCase.module_path,
      page_id: null,
      precondition: null,
      steps: numbers.map((number) => ({
        step: number,
        action: currentCase.actions.get(number),
        expected: currentCase.expectedResults.get(number),
      })),
    });
    currentCase = null;
  }

  lines.forEach((rawLine, index) => {
    const lineNumber = index + 1;
    const line = rawLine.trim();
    if (line === "") {
      return;
    }

    const moduleMatch = line.match(
      /^([一二三四五六七八九十百]+级模块)\s*[:：]\s*(.*)$/,
    );
    if (moduleMatch) {
      finalizeCase();
      if (modulePath.length > 0 && currentCase === null) {
        const previousLine = lines
          .slice(0, index)
          .reverse()
          .find((candidate) => candidate.trim() !== "");
        if (previousLine?.trim().startsWith("预期结果")) {
          modulePath = [];
        }
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
  if (testcases.length === 0) {
    throw new Error("No testcases found");
  }

  return {
    system: null,
    testcases,
  };
}

function yamlScalar(value) {
  if (value === null) {
    return "null";
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}

export function serializeExecutionPlan(executionPlan) {
  const lines = [
    `system: ${yamlScalar(executionPlan.system)}`,
    "",
    "testcases:",
  ];

  executionPlan.testcases.forEach((testcase, testcaseIndex) => {
    if (testcaseIndex > 0) {
      lines.push("");
    }
    lines.push(`  - case_name: ${yamlScalar(testcase.case_name)}`);
    lines.push("    module_path:");
    testcase.module_path.forEach((moduleName) => {
      lines.push(`      - ${yamlScalar(moduleName)}`);
    });
    lines.push(`    page_id: ${yamlScalar(testcase.page_id)}`);
    lines.push(`    precondition: ${yamlScalar(testcase.precondition)}`);
    lines.push("    steps:");
    testcase.steps.forEach((step, stepIndex) => {
      if (stepIndex > 0) {
        lines.push("");
      }
      lines.push(`      - step: ${step.step}`);
      lines.push(`        action: ${yamlScalar(step.action)}`);
      lines.push(`        expected: ${yamlScalar(step.expected)}`);
    });
  });

  return `${lines.join("\n")}\n`;
}

function requirePath(value, field) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${field} must be a non-empty path`);
  }
  return path.resolve(value);
}

export async function writeExecutionPlan({ inputPath, outputPath }) {
  const sourcePath = requirePath(inputPath, "inputPath");
  const targetPath = requirePath(outputPath, "outputPath");
  const sourceText = await readFile(sourcePath, "utf8");
  const executionPlan = parseTestcases(sourceText);

  await mkdir(path.dirname(targetPath), { recursive: true });
  const temporaryPath = path.join(
    path.dirname(targetPath),
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
  };
}

function parseCliArguments(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument !== "--input" && argument !== "--output") {
      throw new Error(`Unsupported argument: ${argument}`);
    }
    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for ${argument}`);
    }
    const key = argument === "--input" ? "inputPath" : "outputPath";
    if (options[key]) {
      throw new Error(`Duplicate argument: ${argument}`);
    }
    options[key] = value;
    index += 1;
  }

  if (!options.inputPath || !options.outputPath) {
    throw new Error(
      "Usage: node parse-testcase.mjs --input <source.md> --output <execution-plan.yaml>",
    );
  }
  return options;
}

async function main() {
  const options = parseCliArguments(process.argv.slice(2));
  const result = await writeExecutionPlan(options);
  process.stdout.write(
    `${JSON.stringify({
      outputPath: result.outputPath,
      testcaseCount: result.testcaseCount,
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

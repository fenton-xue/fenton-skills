import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  associateResultWithReport,
  normalizeEnvironment,
  readExecutionResult,
  readTestcaseMarkdown,
  requireAbsolutePath,
  serializeExecutionResult,
  validateExecutionResult,
} from "./testcase-data-utils.mjs";

export async function createOrResumeExecutionResult({
  requirementDir,
  environment = "uat",
}) {
  const targetDir = requireAbsolutePath(requirementDir, "requirementDir");
  const normalizedEnvironment = normalizeEnvironment(environment);
  const testcaseDir = path.join(targetDir, "测试用例");
  const markdownPath = path.join(
    testcaseDir,
    `${normalizedEnvironment}-testcases.md`,
  );
  const executionDir = path.join(testcaseDir, "execute-testcase");
  const screenshotsDir = path.join(
    executionDir,
    `${normalizedEnvironment}-screenshots`,
  );
  const resultPath = path.join(
    executionDir,
    `${normalizedEnvironment}-execution-result.json`,
  );
  const report = await readTestcaseMarkdown(markdownPath, {
    environment: normalizedEnvironment,
  });

  await mkdir(screenshotsDir, { recursive: true });
  let result;
  let resumed = false;
  try {
    result = await readExecutionResult(resultPath, { report });
    resumed = true;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    result = associateResultWithReport({ cases: {} }, report);
    try {
      await writeFile(resultPath, serializeExecutionResult(result, { report }), {
        encoding: "utf8",
        flag: "wx",
      });
    } catch (writeError) {
      if (writeError.code !== "EEXIST") throw writeError;
      result = await readExecutionResult(resultPath, { report });
      resumed = true;
    }
  }

  validateExecutionResult(result, { report });

  return {
    report,
    result,
    testcaseDir,
    markdownPath,
    resultPath,
    screenshotsDir,
    testcaseCount: report.testcases.length,
    environment: normalizedEnvironment,
    resumed,
  };
}

function parseCliArguments(args) {
  const options = { environment: "uat" };
  const argumentMap = new Map([
    ["--requirement-dir", "requirementDir"],
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
    options[key] = value;
    index += 1;
  }
  if (!options.requirementDir) {
    throw new Error(
      "Usage: node create-execution-result.mjs --requirement-dir <requirement-dir> [--env uat|pre]",
    );
  }
  return options;
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  createOrResumeExecutionResult(parseCliArguments(process.argv.slice(2)))
    .then((result) => {
      process.stdout.write(
        `${JSON.stringify({
          markdownPath: result.markdownPath,
          resultPath: result.resultPath,
          screenshotsDir: result.screenshotsDir,
          testcaseCount: result.testcaseCount,
          environment: result.environment,
          resumed: result.resumed,
        })}\n`,
      );
    })
    .catch((error) => {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
    });
}

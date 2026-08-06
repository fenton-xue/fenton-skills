import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  associateResultWithSource,
  normalizeEnvironment,
  readExecutionResult,
  readTestcaseSource,
  requireAbsolutePath,
  serializeExecutionResult,
} from "./testcase-data-utils.mjs";

async function requireFile(filePath, message) {
  try {
    await access(filePath);
  } catch (error) {
    if (error.code === "ENOENT") throw new Error(message);
    throw error;
  }
}

export async function createOrResumeExecutionResult({
  requirementDir,
  environment = "uat",
}) {
  const targetDir = requireAbsolutePath(requirementDir, "requirementDir");
  const normalizedEnvironment = normalizeEnvironment(environment);
  const environmentValue = normalizedEnvironment.toUpperCase();
  const sourcePath = path.join(
    targetDir,
    `${normalizedEnvironment}-testcase-source.js`,
  );
  const viewerPath = path.join(
    targetDir,
    `${normalizedEnvironment}-testcase-viewer.html`,
  );
  const executionDir = path.join(targetDir, "execute-testcase");
  const screenshotsDir = path.join(executionDir, "screenshots");
  const resultPath = path.join(
    executionDir,
    `${normalizedEnvironment}-execution-result.js`,
  );

  await requireFile(
    sourcePath,
    `${path.basename(sourcePath)} does not exist; ${environmentValue} execution cannot start`,
  );
  await requireFile(
    viewerPath,
    `${path.basename(viewerPath)} does not exist; generate or copy the Viewer first`,
  );
  const source = await readTestcaseSource(sourcePath, {
    environment: normalizedEnvironment,
  });

  await mkdir(screenshotsDir, { recursive: true });
  let result;
  let resumed = false;
  try {
    result = await readExecutionResult(resultPath, { source });
    resumed = true;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    result = associateResultWithSource(
      {
        source_id: source.source_id,
        system: null,
        environment: environmentValue,
        result: null,
        cases: {},
      },
      source,
    );
    try {
      await writeFile(resultPath, serializeExecutionResult(result, { source }), {
        encoding: "utf8",
        flag: "wx",
      });
    } catch (writeError) {
      if (writeError.code !== "EEXIST") throw writeError;
      result = await readExecutionResult(resultPath, { source });
      resumed = true;
    }
  }

  return {
    source,
    result,
    sourcePath,
    viewerPath,
    resultPath,
    screenshotsDir,
    testcaseCount: source.testcases.length,
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
          sourcePath: result.sourcePath,
          viewerPath: result.viewerPath,
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

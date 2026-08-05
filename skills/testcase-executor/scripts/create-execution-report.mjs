import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const EXECUTION_PLAN_TOKEN = "__EXECUTION_PLAN_JS__";
const CREATED_AT_TOKEN = "__REPORT_CREATED_AT__";
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = path.join(
  SCRIPT_DIR,
  "..",
  "assets",
  "execution-report-template.html",
);

function requirePath(value, field) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${field} must be a non-empty path`);
  }
  return path.resolve(value);
}

function normalizeEnvironment(value = "uat") {
  const environment = String(value).trim().toLowerCase();
  if (environment !== "uat" && environment !== "pre") {
    throw new TypeError("environment must be uat or pre");
  }
  return environment;
}

function formatCreatedAt(date = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Shanghai",
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
  return (
    `${parts.year}-${parts.month}-${parts.day} ` +
    `${parts.hour}:${parts.minute}:${parts.second}`
  );
}

export async function createExecutionReport({
  outputDir,
  environment = "uat",
}) {
  const targetDir = requirePath(outputDir, "outputDir");
  const normalizedEnvironment = normalizeEnvironment(environment);
  const template = await readFile(TEMPLATE_PATH, "utf8");
  for (const token of [EXECUTION_PLAN_TOKEN, CREATED_AT_TOKEN]) {
    if (!template.includes(token)) {
      throw new Error(`template token is missing: ${token}`);
    }
  }

  const outputPath = path.join(
    targetDir,
    `${normalizedEnvironment}-execution-report.html`,
  );
  const temporaryPath = `${outputPath}.tmp-${process.pid}-${Date.now()}`;
  const report = template
    .replaceAll(
      EXECUTION_PLAN_TOKEN,
      `./${normalizedEnvironment}-execution-plan.js`,
    )
    .replaceAll(CREATED_AT_TOKEN, formatCreatedAt());

  await mkdir(targetDir, { recursive: true });
  try {
    await writeFile(temporaryPath, report, {
      encoding: "utf8",
      flag: "wx",
    });
    await rename(temporaryPath, outputPath);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
  return outputPath;
}

function parseCliArguments(args) {
  const options = { environment: "uat" };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument !== "--output-dir" && argument !== "--env") {
      throw new Error(`Unsupported argument: ${argument}`);
    }
    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for ${argument}`);
    }
    if (argument === "--output-dir") options.outputDir = value;
    if (argument === "--env") options.environment = value;
    index += 1;
  }
  if (!options.outputDir) {
    throw new Error(
      "Usage: node create-execution-report.mjs --output-dir <execute-testcase> [--env uat|pre]",
    );
  }
  return options;
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  createExecutionReport(parseCliArguments(process.argv.slice(2)))
    .then((outputPath) => process.stdout.write(`${JSON.stringify({ outputPath })}\n`))
    .catch((error) => {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
    });
}

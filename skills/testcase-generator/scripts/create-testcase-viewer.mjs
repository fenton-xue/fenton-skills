import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { readTestcaseSource } from "./testcase-source-utils.mjs";

const SOURCE_SCRIPT_TOKEN = "__TESTCASE_SOURCE_JS__";
const CREATED_AT_TOKEN = "__REPORT_CREATED_AT__";
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = path.join(
  SCRIPT_DIR,
  "..",
  "assets",
  "execution-report-template.html",
);

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

export async function createTestcaseViewer(sourcePath) {
  const resolvedSourcePath = path.resolve(sourcePath);
  if (path.basename(resolvedSourcePath) !== "uat-testcase-source.js") {
    throw new TypeError("source file must be named uat-testcase-source.js");
  }
  const source = await readTestcaseSource(resolvedSourcePath);
  if (source.environment !== "UAT") {
    throw new TypeError("uat-testcase-source.js environment must be UAT");
  }
  const template = await readFile(TEMPLATE_PATH, "utf8");
  for (const token of [SOURCE_SCRIPT_TOKEN, CREATED_AT_TOKEN]) {
    if (!template.includes(token)) {
      throw new Error(`shared template token is missing: ${token}`);
    }
  }

  const outputPath = path.join(
    path.dirname(resolvedSourcePath),
    "uat-testcase-viewer.html",
  );
  const temporaryPath = `${outputPath}.tmp-${process.pid}-${Date.now()}`;
  const viewer = template
    .replaceAll(SOURCE_SCRIPT_TOKEN, "./uat-testcase-source.js")
    .replaceAll(CREATED_AT_TOKEN, formatCreatedAt());

  await mkdir(path.dirname(outputPath), { recursive: true });
  try {
    await writeFile(temporaryPath, viewer, { encoding: "utf8", flag: "wx" });
    await rename(temporaryPath, outputPath);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }

  return { outputPath, testcaseCount: source.testcases.length, sourceId: source.source_id };
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const sourcePath = process.argv[2];
  if (!sourcePath || process.argv.length !== 3) {
    process.stderr.write(
      "Usage: node create-testcase-viewer.mjs <uat-testcase-source.js>\n",
    );
    process.exitCode = 1;
  } else {
    createTestcaseViewer(sourcePath)
      .then((result) => process.stdout.write(`${JSON.stringify(result)}\n`))
      .catch((error) => {
        process.stderr.write(`${error.message}\n`);
        process.exitCode = 1;
      });
  }
}

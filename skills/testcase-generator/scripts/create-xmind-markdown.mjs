import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { readTestcaseMarkdown } from "./testcase-markdown-utils.mjs";

const DEFAULT_PRIORITY = "P2";
const INPUT_NAME_PATTERN = /^(uat|pre)-testcases\.md$/;

function prefix(level) {
  return `${"    ".repeat(level - 1)}- `;
}

function caseName(value) {
  const name = value.trim();
  return /^cs(?=#)/i.test(name) ? name : `cs${name}`;
}

function escapeTopicLine(line) {
  return line
    .replace(/^(\d+)\.\s+/, "$1.")
    .replace(/^([-+*])\s+/, "$1");
}

function contentLines(value) {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map(escapeTopicLine);
}

function formatTopic(level, value) {
  const lines = contentLines(value);
  if (lines.length === 0) return [];
  const indent = "    ".repeat(level - 1);
  const result = [];
  lines.forEach((line, index) => {
    const isLast = index === lines.length - 1;
    const suffix = isLast ? "" : "\\";
    result.push(index === 0 ? `${indent}- ${line}${suffix}` : `${indent}  ${line}${suffix}`);
    if (!isLast) result.push(`${indent}  \\`);
  });
  return result;
}

export function createXmindMarkdown(report) {
  const lines = [`${prefix(1)}${report.title}`, ""];
  let lastModules = [];

  report.testcases.forEach((testcase) => {
    testcase.module_path.forEach((moduleName, index) => {
      if (index >= lastModules.length || lastModules[index] !== moduleName) {
        lines.push(`${prefix(index + 2)}${moduleName}`);
        lastModules = lastModules.slice(0, index);
        lastModules[index] = moduleName;
      }
    });
    lastModules = lastModules.slice(0, testcase.module_path.length);

    const testcaseLevel = testcase.module_path.length + 2;
    const stepLevel = testcaseLevel + 1;
    const expectedLevel = stepLevel + 1;
    lines.push(`${prefix(testcaseLevel)}${caseName(testcase.case_name)}`);
    const precondition = testcase.precondition.trim();
    if (precondition && precondition !== "-") {
      lines.push(...formatTopic(stepLevel, `pc${precondition}`));
    }
    lines.push(`${prefix(stepLevel)}tp${DEFAULT_PRIORITY}`);
    testcase.steps.forEach((step) => {
      lines.push(...formatTopic(stepLevel, step.action));
      lines.push(...formatTopic(expectedLevel, step.expected));
    });
  });

  return `${lines.join("\n")}\n`;
}

export async function createXmindMarkdownFile(inputPath, outputPath) {
  const resolvedInputPath = path.resolve(inputPath);
  if (!INPUT_NAME_PATTERN.test(path.basename(resolvedInputPath))) {
    throw new TypeError("input file must be named uat-testcases.md or pre-testcases.md");
  }
  const report = await readTestcaseMarkdown(resolvedInputPath);
  const expectedEnvironment = path.basename(resolvedInputPath).startsWith("uat-")
    ? "UAT"
    : "PRE";
  if (report.environment !== expectedEnvironment) {
    throw new TypeError(
      `${path.basename(resolvedInputPath)} environment must be ${expectedEnvironment}`,
    );
  }
  const resolvedOutputPath = outputPath
    ? path.resolve(outputPath)
    : path.join(
        path.dirname(resolvedInputPath),
        `${path.basename(resolvedInputPath, ".md")}.xmind.md`,
      );
  await writeFile(resolvedOutputPath, createXmindMarkdown(report), "utf8");
  return { outputPath: resolvedOutputPath, testcaseCount: report.testcases.length };
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const [, , testcaseMarkdownPath, outputPath, ...extra] = process.argv;
  if (!testcaseMarkdownPath || extra.length > 0) {
    process.stderr.write(
      "Usage: node create-xmind-markdown.mjs <uat|pre-testcases.md> [output.md]\n",
    );
    process.exitCode = 1;
  } else {
    createXmindMarkdownFile(testcaseMarkdownPath, outputPath)
      .then((result) => process.stdout.write(`${JSON.stringify(result)}\n`))
      .catch((error) => {
        process.stderr.write(`${error.message}\n`);
        process.exitCode = 1;
      });
  }
}

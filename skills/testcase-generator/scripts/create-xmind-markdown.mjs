import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { readTestcaseSource } from "./testcase-source-utils.mjs";

const DEFAULT_PRIORITY = "P2";

function prefix(level) {
  return `${"    ".repeat(level - 1)}- `;
}

function caseName(value) {
  const name = value.trim();
  return /^cs(?=#)/i.test(name) ? name : `cs${name}`;
}

export function createXmindMarkdown(source) {
  const lines = [`${prefix(1)}${source.prd_name}`, ""];
  let lastModules = [];

  source.testcases.forEach((testcase) => {
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
    if (testcase.precondition.trim() !== "") {
      lines.push(`${prefix(stepLevel)}pc${testcase.precondition.trim()}`);
    }
    lines.push(`${prefix(stepLevel)}tp${DEFAULT_PRIORITY}`);
    testcase.steps.forEach((step) => {
      lines.push(`${prefix(stepLevel)}${step.action}`);
      lines.push(`${prefix(expectedLevel)}${step.expected}`);
    });
  });

  return `${lines.join("\n")}\n`;
}

export async function createXmindMarkdownFile(inputPath, outputPath) {
  const resolvedInputPath = path.resolve(inputPath);
  const source = await readTestcaseSource(resolvedInputPath);
  const resolvedOutputPath = outputPath
    ? path.resolve(outputPath)
    : path.join(path.dirname(resolvedInputPath), "xmind-testcase-source.md");
  await writeFile(resolvedOutputPath, createXmindMarkdown(source), "utf8");
  return { outputPath: resolvedOutputPath, testcaseCount: source.testcases.length };
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const [, , inputPath, outputPath, ...extra] = process.argv;
  if (!inputPath || extra.length > 0) {
    process.stderr.write(
      "Usage: node create-xmind-markdown.mjs <uat|pre-testcase-source.js> [output.md]\n",
    );
    process.exitCode = 1;
  } else {
    createXmindMarkdownFile(inputPath, outputPath)
      .then((result) => process.stdout.write(`${JSON.stringify(result)}\n`))
      .catch((error) => {
        process.stderr.write(`${error.message}\n`);
        process.exitCode = 1;
      });
  }
}

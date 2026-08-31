import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const VALID_ENVIRONMENTS = new Set(["UAT", "PRE"]);

function invalid(message) {
  return new TypeError(`Invalid testcase Markdown: ${message}`);
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
      throw invalid(`frontmatter line ${index + 1} is not a key-value pair`);
    }
    if (Object.hasOwn(metadata, match[1])) {
      throw invalid(`frontmatter field ${match[1]} is duplicated`);
    }
    metadata[match[1]] = unquote(match[2]);
  });
  return metadata;
}

function requireMetadata(metadata, field) {
  const value = metadata[field];
  if (typeof value !== "string" || value.trim() === "") {
    throw invalid(`frontmatter field ${field} is required`);
  }
  return value.trim();
}

function splitLevelThreeSections(lines, caseName) {
  const sections = [];
  let current = null;
  lines.forEach((line) => {
    const heading = line.match(/^###\s+(.+?)\s*$/);
    if (heading) {
      if (current) {
        sections.push({
          title: current.title,
          lines: trimBlankLines(current.lines),
        });
      }
      current = { title: heading[1].trim(), lines: [] };
    } else if (current) {
      current.lines.push(line);
    }
  });
  if (current) {
    sections.push({
      title: current.title,
      lines: trimBlankLines(current.lines),
    });
  }
  const duplicate = sections.find(
    (section, index) =>
      sections.findIndex((candidate) => candidate.title === section.title) !== index,
  );
  if (duplicate) {
    throw invalid(`testcase "${caseName}" has duplicate section "${duplicate.title}"`);
  }
  return sections;
}

function parseModulePath(lines, caseName) {
  const headingIndex = lines.findIndex((line) => /^###\s+/.test(line));
  const headerLines = headingIndex < 0 ? lines : lines.slice(0, headingIndex);
  const fieldIndexes = headerLines.flatMap((line, index) =>
    /^\s*\*\*module_path:\*\*\s*$/.test(line) ? [index] : [],
  );
  if (fieldIndexes.length !== 1) {
    throw invalid(`testcase "${caseName}" must contain one module_path field`);
  }
  const modulePath = [];
  for (const line of headerLines.slice(fieldIndexes[0] + 1)) {
    if (line.trim() === "") continue;
    const match = line.match(/^\s*[-*]\s+(.+?)\s*$/);
    if (!match || match[1].trim() === "") {
      throw invalid(`testcase "${caseName}" module_path must be a Markdown unordered list`);
    }
    modulePath.push(match[1].trim());
  }
  if (modulePath.length === 0) {
    throw invalid(`testcase "${caseName}" module_path must contain at least one item`);
  }
  return modulePath;
}

function fieldMatch(line) {
  return line.match(/^\s*(?:\*\*|__)(action|expected):(?:\*\*|__)\s*(.*?)\s*$/);
}

function parseStepFields(lines, caseName, stepNumber) {
  const fields = [];
  lines.forEach((line, index) => {
    const match = fieldMatch(line);
    if (match) fields.push({ name: match[1], inline: match[2], index });
  });
  for (const field of ["action", "expected"]) {
    const matches = fields.filter((candidate) => candidate.name === field);
    if (matches.length !== 1) {
      throw invalid(
        `testcase "${caseName}" step ${stepNumber} must contain one ${field} field`,
      );
    }
  }
  const actionField = fields.find((field) => field.name === "action");
  const expectedField = fields.find((field) => field.name === "expected");
  if (actionField.index > expectedField.index) {
    throw invalid(`testcase "${caseName}" step ${stepNumber} expected must follow action`);
  }

  function readField(field, nextIndex) {
    const content = trimBlankLines([
      ...(field.inline ? [field.inline] : []),
      ...lines.slice(field.index + 1, nextIndex),
    ]).join("\n");
    if (content.trim() === "") {
      throw invalid(
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
  if (!caseName) throw invalid("testcase name must not be empty");
  const modulePath = parseModulePath(lines, caseName);
  const sections = splitLevelThreeSections(lines, caseName);
  const allowedSection = (title) => title === "前置条件" || /^步骤\s+\d+$/.test(title);
  const unsupported = sections.find((section) => !allowedSection(section.title));
  if (unsupported) {
    throw invalid(`testcase "${caseName}" has unsupported section "${unsupported.title}"`);
  }
  const preconditions = sections.filter((section) => section.title === "前置条件");
  if (preconditions.length !== 1) {
    throw invalid(`testcase "${caseName}" must contain one 前置条件 section`);
  }
  const precondition = preconditions[0].lines.join("\n").trim();
  if (precondition === "") {
    throw invalid(`testcase "${caseName}" precondition must not be empty; use - when none`);
  }
  const stepSections = sections.filter((section) => /^步骤\s+\d+$/.test(section.title));
  if (stepSections.length === 0) {
    throw invalid(`testcase "${caseName}" must contain at least one step`);
  }
  const steps = stepSections.map((section, index) => {
    const step = Number(section.title.match(/\d+$/)[0]);
    if (step !== index + 1) {
      throw invalid(`testcase "${caseName}" steps must be continuous from 1`);
    }
    return { step, ...parseStepFields(section.lines, caseName, step) };
  });
  return {
    case_name: caseName,
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
  if (!frontmatterMatch) throw invalid("file-level frontmatter is required");
  const metadata = parseFrontmatter(frontmatterMatch[1]);
  const environment = requireMetadata(metadata, "environment");
  if (!VALID_ENVIRONMENTS.has(environment)) {
    throw invalid("frontmatter field environment must be UAT or PRE");
  }
  const title = requireMetadata(metadata, "title");
  const createdAt = requireMetadata(metadata, "created_at");
  if (Number.isNaN(Date.parse(createdAt))) {
    throw invalid("frontmatter field created_at must be a valid date-time");
  }

  const body = normalized.slice(frontmatterMatch[0].length);
  const levelOneHeadings = [...body.matchAll(/^#\s+(.+?)\s*$/gm)];
  if (
    levelOneHeadings.length !== 1 ||
    levelOneHeadings[0][1].trim() !== "测试用例"
  ) {
    throw invalid('document must contain exactly one level-one heading "测试用例"');
  }
  const caseMatches = [...body.matchAll(/^##\s+(.+?)\s*$/gm)];
  if (caseMatches.length === 0) throw invalid("at least one testcase is required");
  if (levelOneHeadings[0].index > caseMatches[0].index) {
    throw invalid('level-one heading "测试用例" must appear before all testcases');
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
    throw invalid(`testcase name is duplicated: ${duplicate.case_name}`);
  }

  return {
    environment,
    title,
    created_at: createdAt,
    testcases,
  };
}

export function validateTestcaseMarkdown(markdown) {
  return parseTestcaseMarkdown(markdown);
}

export async function readTestcaseMarkdown(inputPath) {
  return parseTestcaseMarkdown(await readFile(inputPath, "utf8"));
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const [, , inputPath, ...extra] = process.argv;
  if (!inputPath || extra.length > 0) {
    process.stderr.write(
      "Usage: node testcase-markdown-utils.mjs <uat|pre-testcases.md>\n",
    );
    process.exitCode = 1;
  } else {
    readTestcaseMarkdown(inputPath)
      .then((report) =>
        process.stdout.write(
          `${JSON.stringify({
            environment: report.environment,
            title: report.title,
            testcaseCount: report.testcases.length,
          })}\n`,
        ),
      )
      .catch((error) => {
        process.stderr.write(`${error.message}\n`);
        process.exitCode = 1;
      });
  }
}

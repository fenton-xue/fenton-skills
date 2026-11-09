#!/usr/bin/env node
// 测试用例执行结果：按 case_id / step_id 关联用例 Markdown，结果文件不保存用例内容。
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { parseArgs } from "node:util";

const HELP = `用法：
  node result.mjs status <用例.md> [--prune]
  node result.mjs show   <用例.md> --case <名称片段|case_id>
  node result.mjs record <用例.md> --case <名称片段|case_id> --step <N|N,M|all> --result <PASSED|FAILED|BLOCKED> --actual <实际结果>

结果文件：<用例目录>/execute-testcase/<uat|pre>-execution-result.json

status  按用例顺序列出名称与执行进度；--prune 删除用例中已不存在的 case_id / step_id 的结果
show    输出一条用例原文（不含 ID）和已记录的结果
record  记录步骤结果，步骤号取用例当前编号；全部步骤有结果后自动汇总用例结果
--case  名称片段匹配到多条时列出候选，需改用更完整的名称或 case_id`;

const STATUSES = ["PASSED", "FAILED", "BLOCKED"];
const ID_LINE = (field) => new RegExp(`^\\s*(?:\\*\\*)?${field}:(?:\\*\\*)?\\s*(\\S+)`);
const CASE_ID = ID_LINE("case_id");
const STEP_ID = ID_LINE("step_id");

function fail(message) {
  console.error(message);
  process.exit(1);
}

function parseTestcases(mdPath) {
  const text = readFileSync(mdPath, "utf8").replace(/\r\n/g, "\n");
  const frontmatter = text.startsWith("---\n") ? text.slice(4, text.indexOf("\n---", 4)) : "";
  const env = (
    frontmatter.match(/^environment:\s*["']?(\w+)/m)?.[1] ??
    basename(mdPath).match(/^(uat|pre)-/i)?.[1] ??
    fail("无法确定环境：frontmatter 缺少 environment，文件名也不是 uat-/pre- 开头")
  ).toLowerCase();

  const cases = [];
  let current = null;
  let step = null;
  for (const line of text.split("\n")) {
    const heading = line.match(/^##\s+(.+?)\s*$/);
    if (heading) {
      current = { name: heading[1], caseId: null, lines: [], steps: [] };
      cases.push(current);
      step = null;
      continue;
    }
    if (!current) continue;
    const caseId = line.match(CASE_ID);
    if (caseId && !current.caseId) {
      current.caseId = caseId[1];
      continue;
    }
    const stepHeading = line.match(/^###\s*步骤\s*(\d+)/);
    if (stepHeading) {
      step = { no: Number(stepHeading[1]), stepId: null };
      current.steps.push(step);
    }
    const stepId = line.match(STEP_ID);
    if (stepId && step && !step.stepId) {
      step.stepId = stepId[1];
      continue;
    }
    current.lines.push(line);
  }
  return { env, cases };
}

function resultPath(mdPath, env) {
  return join(dirname(mdPath), "execute-testcase", `${env}-execution-result.json`);
}

function loadResult(path) {
  if (!existsSync(path)) return { cases: {} };
  const data = JSON.parse(readFileSync(path, "utf8"));
  data.cases ??= {};
  return data;
}

function saveResult(path, cases, data) {
  for (const testcase of cases) {
    const record = data.cases[testcase.caseId];
    if (record) record.result = caseResult(testcase, record);
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(`${path}.tmp`, `${JSON.stringify(data, null, 2)}\n`);
  renameSync(`${path}.tmp`, path);
}

function caseResult(testcase, record) {
  const results = testcase.steps.map((step) => record?.steps?.[step.stepId]?.result);
  if (results.length === 0 || results.some((result) => !result)) return null;
  if (results.includes("FAILED")) return "FAILED";
  if (results.includes("BLOCKED")) return "BLOCKED";
  return "PASSED";
}

function findCase(cases, key) {
  if (!key) fail("缺少 --case");
  const byId = cases.filter((testcase) => testcase.caseId?.toLowerCase() === key.toLowerCase());
  const exact = cases.filter((testcase) => testcase.name === key);
  const partial = cases.filter((testcase) => testcase.name.includes(key));
  const matched = [byId, exact, partial].find((list) => list.length > 0) ?? [];
  if (matched.length === 1) return requireIds(matched[0]);
  if (matched.length === 0) fail(`未找到用例：${key}`);
  fail(`匹配到 ${matched.length} 条用例，请指定更完整的名称或 case_id：\n${matched.map((c) => `  ${c.name}  ${c.caseId}`).join("\n")}`);
}

function requireIds(testcase) {
  if (!testcase.caseId) fail(`用例缺少 case_id：${testcase.name}`);
  const missing = testcase.steps.filter((step) => !step.stepId).map((step) => step.no);
  if (missing.length) fail(`用例 ${testcase.name} 的步骤 ${missing.join(",")} 缺少 step_id`);
  return testcase;
}

function progress(testcase, record) {
  const done = testcase.steps.filter((step) => record?.steps?.[step.stepId]?.result).length;
  return `${done}/${testcase.steps.length}`;
}

function status(cases, data, path, prune) {
  const counts = { PASSED: 0, FAILED: 0, BLOCKED: 0, 进行中: 0, 未执行: 0 };
  for (const testcase of cases) {
    const record = data.cases[testcase.caseId];
    const result = caseResult(testcase, record);
    const done = progress(testcase, record);
    const label = result ?? (done.startsWith("0/") ? "未执行" : "进行中");
    counts[label] += 1;
    console.log(`[${label}] ${done}  ${testcase.name}`);
  }
  console.log(`\n共 ${cases.length} 条：${Object.entries(counts).filter(([, n]) => n).map(([k, n]) => `${k} ${n}`).join("，")}`);

  const caseIds = new Map(cases.map((testcase) => [testcase.caseId, testcase]));
  const orphans = [];
  for (const [caseId, record] of Object.entries(data.cases)) {
    const testcase = caseIds.get(caseId);
    if (!testcase) {
      orphans.push(`case ${caseId}`);
      if (prune) delete data.cases[caseId];
      continue;
    }
    const stepIds = new Set(testcase.steps.map((step) => step.stepId));
    for (const stepId of Object.keys(record.steps ?? {})) {
      if (stepIds.has(stepId)) continue;
      orphans.push(`step ${stepId}（${testcase.name}）`);
      if (prune) delete record.steps[stepId];
    }
  }
  if (orphans.length === 0) return;
  console.log(`\n${prune ? "已删除" : "存在"} ${orphans.length} 条用例中已不存在的结果${prune ? "" : "（--prune 清理）"}：\n${orphans.map((o) => `  ${o}`).join("\n")}`);
  if (prune) saveResult(path, cases, data);
}

function show(testcase, data) {
  const record = data.cases[testcase.caseId];
  console.log(`## ${testcase.name}\n${testcase.lines.join("\n").trim()}`);
  const recorded = testcase.steps.filter((step) => record?.steps?.[step.stepId]);
  if (recorded.length === 0) return;
  console.log(`\n已记录结果（${progress(testcase, record)}，用例结果：${caseResult(testcase, record) ?? "未完成"}）：`);
  for (const step of recorded) {
    const { result, actual } = record.steps[step.stepId];
    console.log(`  步骤 ${step.no} ${result}：${actual}`);
  }
}

function record(testcase, data, path, cases, values) {
  const result = values.result?.toUpperCase();
  if (!STATUSES.includes(result)) fail(`--result 只能是 ${STATUSES.join(" / ")}`);
  if (!values.actual?.trim()) fail("缺少 --actual");
  if (!values.step) fail("缺少 --step");
  const steps =
    values.step === "all"
      ? testcase.steps
      : values.step.split(",").map((no) => {
          const step = testcase.steps.find((candidate) => candidate.no === Number(no.trim()));
          return step ?? fail(`用例 ${testcase.name} 没有步骤 ${no}`);
        });

  const entry = (data.cases[testcase.caseId] ??= { result: null, steps: {} });
  entry.steps ??= {};
  for (const step of steps) entry.steps[step.stepId] = { result, actual: values.actual.trim() };
  saveResult(path, cases, data);
  console.log(
    `已记录 ${testcase.name} 步骤 ${steps.map((step) => step.no).join(",")} → ${result}；` +
      `用例结果：${entry.result ?? `未完成（${progress(testcase, entry)}）`}`,
  );
}

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    case: { type: "string" },
    step: { type: "string" },
    result: { type: "string" },
    actual: { type: "string" },
    prune: { type: "boolean" },
    help: { type: "boolean", short: "h" },
  },
});
const [command, mdPath] = positionals;
if (values.help || !command) {
  console.log(HELP);
  process.exit(0);
}
if (!mdPath || !existsSync(mdPath)) fail(`用例文件不存在：${mdPath ?? "（未提供）"}`);

const { env, cases } = parseTestcases(mdPath);
const path = resultPath(mdPath, env);
const data = loadResult(path);

if (command === "status") status(cases, data, path, values.prune);
else if (command === "show") show(findCase(cases, values.case), data);
else if (command === "record") record(findCase(cases, values.case), data, path, cases, values);
else fail(`未知命令：${command}\n\n${HELP}`);

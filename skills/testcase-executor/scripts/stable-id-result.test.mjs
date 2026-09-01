import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createOrResumeExecutionResult } from "./create-execution-result.mjs";
import {
  associateResultWithReport,
  parseTestcaseMarkdown,
  serializeExecutionResult,
  validateExecutionResult,
} from "./testcase-data-utils.mjs";
import {
  finalizeResult,
  recordCaseContext,
  recordStep,
  writeExecutionResult,
} from "./result-record.mjs";

const CASE_ID = "550e8400-e29b-41d4-a716-446655440001";
const UNKNOWN_CASE_ID = "550e8400-e29b-41d4-a716-446655440099";
const STEP_A = "550e8400-e29b-41d4-a716-446655440101";
const STEP_B = "550e8400-e29b-41d4-a716-446655440102";
const UNKNOWN_STEP_ID = "550e8400-e29b-41d4-a716-446655440199";

function markdown({ name = "#84313-01-原名称", reversed = false } = {}) {
  const steps = reversed
    ? [
        [STEP_B, "操作 B", "预期 B"],
        [STEP_A, "操作 A", "预期 A"],
      ]
    : [
        [STEP_A, "操作 A", "预期 A"],
        [STEP_B, "操作 B", "预期 B"],
      ];
  return `---
environment: UAT
title: "#84313 稳定关联"
created_at: 2026-08-27T08:30:00.000Z
---

# 测试用例

## ${name}

**case_id:** ${CASE_ID}

**module_path:**

- 模块

### 前置条件

-

${steps
  .map(
    ([stepId, action, expected], index) => `### 步骤 ${index + 1}

**step_id:** ${stepId}

**action:**

${action}

**expected:**

${expected}`,
  )
  .join("\n\n")}
`;
}

function completedResult(report) {
  const result = associateResultWithReport({ cases: {} }, report);
  recordCaseContext({
    result,
    caseId: CASE_ID,
    pageName: "稳定关联页",
    pageUrl: "https://example.test/stable",
  });
  recordStep({
    result,
    caseId: CASE_ID,
    stepId: STEP_A,
    actual: "实际 A",
    status: "PASSED",
  });
  recordStep({
    result,
    caseId: CASE_ID,
    stepId: STEP_B,
    actual: "实际 B",
    status: "BLOCKED",
  });
  return result;
}

test("parses and validates stable IDs", () => {
  const report = parseTestcaseMarkdown(markdown());
  assert.equal(report.testcases[0].case_id, CASE_ID);
  assert.deepEqual(
    report.testcases[0].steps.map((step) => step.step_id),
    [STEP_A, STEP_B],
  );
  assert.throws(
    () => parseTestcaseMarkdown(markdown().replace(`**case_id:** ${CASE_ID}\n`, "")),
    /must contain one case_id field/,
  );
  assert.throws(
    () => parseTestcaseMarkdown(markdown().replace(CASE_ID, "invalid")),
    /case_id must be a valid UUID/,
  );
  assert.throws(
    () => parseTestcaseMarkdown(markdown().replace(`**step_id:** ${STEP_A}\n`, "")),
    /must contain one step_id field/,
  );
  assert.throws(
    () => parseTestcaseMarkdown(markdown().replace(STEP_A, "invalid-step")),
    /step_id must be a valid UUID/,
  );
  assert.throws(
    () => parseTestcaseMarkdown(markdown().replace(STEP_B, STEP_A)),
    /step_id is duplicated/,
  );
  const source = markdown();
  const duplicateCaseBody = source
    .slice(source.indexOf("\n## "))
    .replace("#84313-01-原名称", "#84313-02-另一名称");
  assert.throws(
    () => parseTestcaseMarkdown(`${source}${duplicateCaseBody}`),
    /case_id is duplicated/,
  );
});

test("records, aggregates, serializes, and finalizes by UUID", () => {
  const report = parseTestcaseMarkdown(markdown());
  const result = completedResult(report);
  assert.equal(result.cases[CASE_ID].result, "BLOCKED");
  assert.deepEqual(Object.keys(result.cases[CASE_ID].steps), [STEP_A, STEP_B]);
  finalizeResult({ report, result });
  const serialized = serializeExecutionResult(result, { report });
  assert.deepEqual(JSON.parse(serialized), result);
});

test("keeps results associated after testcase rename and step reorder", () => {
  const originalReport = parseTestcaseMarkdown(markdown());
  const result = completedResult(originalReport);
  const updatedReport = parseTestcaseMarkdown(
    markdown({ name: "#84313-01-新名称", reversed: true }),
  );
  validateExecutionResult(result, { report: updatedReport });
  finalizeResult({ report: updatedReport, result });
  assert.equal(result.cases[CASE_ID].steps[STEP_A].actual, "实际 A");
  assert.equal(result.cases[CASE_ID].steps[STEP_B].actual, "实际 B");
});

test("rejects legacy keys and unknown UUIDs", () => {
  const report = parseTestcaseMarkdown(markdown());
  const step = { result: "PASSED", actual: "实际" };
  assert.throws(
    () =>
      validateExecutionResult(
        { cases: { "#84313-01-原名称": { steps: {} } } },
        { report },
      ),
    /case key must be a valid UUID/,
  );
  assert.throws(
    () =>
      validateExecutionResult(
        { cases: { [CASE_ID]: { steps: { 1: step } } } },
        { report },
      ),
    /steps key must be a valid UUID/,
  );
  assert.throws(
    () =>
      validateExecutionResult(
        { cases: { [UNKNOWN_CASE_ID]: { steps: {} } } },
        { report },
      ),
    /unknown case_id/,
  );
  assert.throws(
    () =>
      validateExecutionResult(
        { cases: { [CASE_ID]: { steps: { [UNKNOWN_STEP_ID]: step } } } },
        { report },
      ),
    /unknown step_id/,
  );
});

test("creates, writes, and resumes UUID-keyed execution results", async () => {
  const requirementDir = await mkdtemp(path.join(os.tmpdir(), "stable-id-result-"));
  const testcaseDir = path.join(requirementDir, "测试用例");
  await mkdir(testcaseDir, { recursive: true });
  const markdownPath = path.join(testcaseDir, "uat-testcases.md");
  await writeFile(markdownPath, markdown(), "utf8");

  const created = await createOrResumeExecutionResult({ requirementDir });
  assert.equal(created.resumed, false);
  const result = completedResult(created.report);
  await writeExecutionResult({
    report: created.report,
    result,
    outputPath: created.resultPath,
  });

  await writeFile(
    markdownPath,
    markdown({ name: "#84313-01-恢复后的名称", reversed: true }),
    "utf8",
  );
  const resumed = await createOrResumeExecutionResult({ requirementDir });
  assert.equal(resumed.resumed, true);
  assert.equal(resumed.result.cases[CASE_ID].steps[STEP_A].actual, "实际 A");
  assert.match(await readFile(resumed.resultPath, "utf8"), new RegExp(CASE_ID));
});

test("refuses to resume a legacy name-keyed result", async () => {
  const requirementDir = await mkdtemp(path.join(os.tmpdir(), "legacy-result-"));
  const testcaseDir = path.join(requirementDir, "测试用例");
  const executionDir = path.join(testcaseDir, "execute-testcase");
  await mkdir(executionDir, { recursive: true });
  await writeFile(path.join(testcaseDir, "uat-testcases.md"), markdown(), "utf8");
  await writeFile(
    path.join(executionDir, "uat-execution-result.json"),
    `${JSON.stringify({ cases: { "#84313-01-原名称": { steps: {} } } }, null, 2)}\n`,
    "utf8",
  );
  await assert.rejects(
    createOrResumeExecutionResult({ requirementDir }),
    /case key must be a valid UUID/,
  );
});

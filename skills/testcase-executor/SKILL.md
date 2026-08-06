---
name: testcase-executor
description: 执行 testcase-generator 生成的结构化人工测试用例，按 UAT 或 PRE 读取对应 JavaScript Source，创建或恢复稀疏 execution-result.js，结合页面知识完成 UI 功能验证，持续记录实际结果、状态和截图，并由既有 Viewer 自动展示。用于执行测试用例、自动完成 UI 功能验证或维护测试执行结果。
---

# 测试用例执行

读取当前环境的结构化 Source，执行用例并持续更新稀疏 Result。Viewer 由 testcase-generator 生成，本 Skill 不生成新的 HTML。

## 环境与目录

默认使用 `uat`。仅当用户明确选择 PRE 时使用 `pre`。

```text
<需求目录>/
├── uat-testcase-source.js
├── uat-testcase-viewer.html
├── pre-testcase-source.js
├── pre-testcase-viewer.html
└── execute-testcase/
    ├── uat-execution-result.js
    ├── pre-execution-result.js
    └── screenshots/
```

选择 PRE 时必须存在 `pre-testcase-source.js` 和 `pre-testcase-viewer.html`。缺失时停止执行并提示用户，不回退 UAT，不复制或生成 PRE 文件。

## Source

仅支持 `{env}-testcase-source.js`。文件只能包含一次严格 JSON 对象赋值：

```js
window.TESTCASE_SOURCE = {
  "source_id": "文档标准UUID",
  "environment": "UAT",
  "prd_name": "#84313 需求名称",
  "testcases": [
    {
      "id": "用例标准UUID",
      "case_name": "#84313-01-测试点描述",
      "module_path": ["一级模块", "二级模块"],
      "precondition": "",
      "steps": [
        {
          "step": 1,
          "action": "可直接执行的操作",
          "expected": "明确的预期结果"
        }
      ]
    }
  ]
};
```

完整示例见 [references/uat-testcase-source.example.js](references/uat-testcase-source.example.js)。脚本提取赋值右侧对象并使用 `JSON.parse()`，不 import 或执行 Source 文件。

校验内容：

- `source_id` 和用例 `id` 为标准 UUID，用例 UUID 唯一。
- `environment` 与当前选择环境一致。
- `prd_name`、`case_name`、`module_path`、`action`、`expected` 有效且非空。
- `precondition` 必须存在并为字符串，允许空字符串。
- 每条用例的步骤编号从 `1` 连续递增。

## 创建或恢复 Result

运行：

```bash
node "<testcase-executor目录>/scripts/create-execution-result.mjs" \
  --requirement-dir "<需求目录>" \
  --env "<uat|pre>"
```

`--env` 可省略，默认 `uat`。脚本读取并校验 Source，确认对应 Viewer 存在，创建 `execute-testcase/screenshots/`，然后创建或恢复 `execute-testcase/{env}-execution-result.js`。

Result 已存在时读取原文件，并校验 `source_id` 和 `environment`；校验通过后恢复已有执行数据，不覆盖文件。校验失败时停止执行。

空 Result：

```js
window.TESTCASE_EXECUTION_RESULT = {
  "source_id": "对应环境Source的文档UUID",
  "system": null,
  "environment": "UAT",
  "result": null,
  "cases": {}
};
```

Result 只保存执行上下文和已产生的结果，禁止保存 `prd_name`、`case_name`、`module_path`、`precondition`、`action`、`expected`。尚未执行的用例和步骤不预先写入。

完整示例见 [references/execution-result.example.js](references/execution-result.example.js)。

## 补充执行上下文并 Review

1. 根据项目上下文、路径或用户指令填写顶层 `system`。
2. 根据 `module_path` 和页面知识，为对应用例 UUID 填写稳定的 `page_id`。
3. 执行到目标页面后，将当前 URL 填入 `actual_url`。

用例上下文可先写为：

```js
"用例UUID": {
  "page_id": "qc-report-review",
  "steps": {}
}
```

补充 `system` 和 `page_id` 后原子写回 Result，并向用户提供当前环境 Viewer 链接、用例数量和待补字段摘要。收到用户明确确认后再执行页面操作；用户提出修改时更新同一 Result 并再次提交 Review。

## 记录 Result

使用 [scripts/result-record.mjs](scripts/result-record.mjs) 读取 Source 和 Result。读取 Result 时必须传入 Source，使记录函数能够校验用例 UUID 和步骤编号：

```js
var resultTools = await import(
  "<testcase-executor目录>/scripts/result-record.mjs"
);
var sourcePath = "<需求目录>/<env>-testcase-source.js";
var resultPath = "<需求目录>/execute-testcase/<env>-execution-result.js";
var source = await resultTools.readTestcaseSource(sourcePath, {
  environment: "<uat|pre>",
});
var executionResult = await resultTools.readExecutionResult(resultPath, {
  source,
});

resultTools.recordSystem({
  result: executionResult,
  system: "QC",
});

resultTools.recordCaseContext({
  result: executionResult,
  caseId: "用例UUID",
  pageId: "qc-report-review",
  actualUrl: "https://example.test/page",
});

resultTools.recordStep({
  result: executionResult,
  caseId: "用例UUID",
  stepNo: 1,
  actual: "页面显示22条结果",
  status: "PASSED",
  screenshots: [
    "execute-testcase/screenshots/uat_case01_step01_01_result.png",
  ],
});

await resultTools.writeExecutionResult({
  source,
  result: executionResult,
  outputPath: resultPath,
});
```

用例通过 `result.cases[caseId]` 直接关联，步骤通过 `result.cases[caseId].steps[String(stepNo)]` 直接关联。`caseNo` 只用于截图文件名。

`recordStep` 强制校验：

- `caseId` 存在于 Source。
- `stepNo` 存在于对应 Source 用例。
- `actual` 非空。
- `status` 为 `PASSED`、`FAILED` 或 `BLOCKED`。
- `screenshots` 为字符串数组，路径以 `execute-testcase/screenshots/` 开头。

每完成一个步骤或一条用例就调用 `writeExecutionResult` 原子写回，避免执行中断时丢失已完成结果。Viewer 每 3 秒重新加载 Source 和 Result，数据变化后自动更新显示。

## 等待页面请求与 DOM 稳定

在 Microsoft Edge 中使用「Agent Request Waiter」插件判断页面是否可以截图和断言。

插件状态：

- `READY`：绿色图标，Badge 为 `OK`。
- `ARMED`：蓝色图标，等待目标请求。
- `WAITING`：橙色图标，Badge 为 pending 数量。
- `ERROR`：红色图标，Badge 为 `!`。

从当前页面根元素读取：

```js
const root = document.documentElement;
const state = {
  status: root.dataset.agentRequestWaiterStatus,
  pending: Number(root.dataset.agentRequestWaiterPending),
  roundId: root.dataset.agentRequestWaiterRoundId,
};
```

对会产生请求的关键操作：

1. 记录 ARM 前的 `roundId`。
2. 派发 ARM 命令：

```js
document.dispatchEvent(
  new CustomEvent("agent-request-waiter-command", { detail: "ARM" }),
);
```

3. 每 `100ms` 读取状态，直到进入 `ARMED` 且获得新的非空 `roundId`。
4. 保存为 `armedRoundId` 后执行页面操作。
5. 每 `500ms` 读取状态；页面跳转后重新获取根元素。响应超过 `10s` 时可降低为每 `1–2s` 一次。
6. 仅当 `status === "READY"`、`pending === 0`、`roundId === armedRoundId` 同时满足后截图和断言。

默认 `READY` 的空 `roundId` 不代表操作完成。`WAITING` 时继续等待，不用固定延时替代。`ERROR` 时停止当前流程并报告插件错误。不产生网络请求的操作直接根据 DOM 或视觉变化判断。

## 执行与结果判定

1. 根据页面知识进入目标页面并确认识别特征。
2. 检查并满足 `precondition`。
3. 记录当前 URL 和页面上下文。
4. 按 Source 顺序执行每个 `action`。
5. 页面稳定后对照 `expected` 填写 `actual`、状态和截图。
6. 每完成一步立即原子写回 Result。

状态：

- `PASSED`：操作完成，预期结果满足。
- `FAILED`：操作完成，预期结果明确不满足。
- `BLOCKED`：因页面、环境、账号、数据或识别问题无法完成验证。

找不到操作目标时重新读取页面并重试一次。页面状态与用例不一致或无法可靠判断时，将对应步骤记录为 `BLOCKED`。

## 保存截图

将 Computer Use 返回的临时截图 URL 传给 [scripts/save-screenshot.mjs](scripts/save-screenshot.mjs)：

```js
var { saveScreenshot } = await import(
  "<testcase-executor目录>/scripts/save-screenshot.mjs"
);

var savedScreenshot = await saveScreenshot({
  screenshotUrl: state.screenshot.url,
  requirementDir: "<需求目录>",
  environment: "<uat|pre>",
  caseNo: 1,
  stepNo: 5,
  shotNo: 2,
  label: "page2",
});
```

脚本将文件保存到 `<需求目录>/execute-testcase/screenshots/`，返回相对于需求目录 Viewer 的路径：

```text
execute-testcase/screenshots/{env}_case{用例序号}_step{步骤序号}_{截图序号}_{说明}.png
```

脚本禁止覆盖同名截图。说明使用小写英文、数字和单下划线。

以下情况必须截图：

1. 预期结果需要页面内容证明。
2. 验证结果跨页面或分页。
3. 结果为 `FAILED` 或 `BLOCKED`。
4. 保存、提交、审核、删除等操作引起关键业务状态变化。

等待页面稳定后截图，尽量同时包含页面标题、查询条件和结果区域。每条 `PASSED` 用例至少保留一组核心结果截图；`FAILED` 和 `BLOCKED` 至少保留一张截图。一张截图可以被多个步骤引用。

## 完成汇总

全部步骤完成后，同时传入 Source 和 Result：

```js
resultTools.finalizeResult({
  source,
  result: executionResult,
});
await resultTools.writeExecutionResult({
  source,
  result: executionResult,
  outputPath: resultPath,
});
```

汇总前逐条检查 Source 中所有用例和步骤。缺少任一步骤结果时禁止完成。状态优先级为 `FAILED`、`BLOCKED`、`PASSED`；先汇总步骤到用例，再汇总用例到顶层。

完成后向用户提供既有的 `{env}-testcase-viewer.html` 链接和结果摘要。执行期间只更新 `{env}-execution-result.js`，由 Viewer 自动刷新并展示结果。

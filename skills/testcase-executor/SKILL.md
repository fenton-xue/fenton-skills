---
name: testcase-executor
description: 使用 Computer Use 执行人工测试用例，将“模块、用例名称、步骤描述、预期结果”纯文本直接转换为可执行的 JavaScript 计划，结合页面知识完成 UI 功能验证，记录实际结果、截图证据并生成可直接通过 file:// 打开的 HTML 报告。用于执行测试用例、自动完成 UI 功能验证或生成测试执行报告。
---

# 测试用例执行

将人工测试用例作为只读输入，生成完整的 JavaScript 执行计划，经用户 Review 后执行，并在同一文件中补充结果。

## 确定环境

默认使用 `uat`。用户明确提到“预发布”“复测”或 `PRE` 时使用 `pre`。

环境用于以下文件名和数据字段：

- 执行计划：`{env}-execution-plan.js`
- 执行报告：`{env}-execution-report.html`
- `environment`：`UAT` 或 `PRE`

## 创建执行目录

将源测试用例所在的需求目录作为 `<需求目录>`，使用以下结构：

```text
<需求目录>/
└── execute-testcase/
    ├── uat-execution-plan.js
    ├── uat-execution-report.html
    ├── pre-execution-plan.js
    ├── pre-execution-report.html
    └── screenshots/
```

只创建当前环境对应的计划和报告。所有文件直接放在 `execute-testcase/`，截图统一放在 `execute-testcase/screenshots/`。

## 生成执行计划

正式用例包含动态层级的 `一级模块`、`二级模块`、`三级模块`等字段，以及 `用例名称`、`步骤描述N` 和 `预期结果N`。需要确认源格式时读取 [references/testcase-source.example.md](references/testcase-source.example.md)。

运行 [scripts/create-execution-plan.mjs](scripts/create-execution-plan.mjs)：

```bash
node "<testcase-executor目录>/scripts/create-execution-plan.mjs" \
  --input "<测试用例文件>" \
  --output-dir "<需求目录>/execute-testcase" \
  --env "<uat|pre>"
```

`--env` 可省略，默认生成 `uat-execution-plan.js`。脚本同时创建 `screenshots/`。

执行计划使用以下形式，可直接被 HTML 通过 `<script>` 加载：

```js
window.TESTCASE_RESULT = { /* 完整执行数据 */ };
```

脚本一次性生成最终结果所需的全部键：

- 顶层：`system`、`prd_name`、`environment`、`result`、`testcases`
- 用例：`case_name`、`module_path`、`page_id`、`actual_url`、`result`、`precondition`、`steps`
- 步骤：`step`、`action`、`expected`、`actual`、`result`、`screenshots`

初始时 `system`、`prd_name`、`page_id`、`actual_url`、各级 `result` 和 `actual` 为 `null`，`screenshots` 为空数组。结构示例见 [references/execution-plan.example.js](references/execution-plan.example.js)。

## 补充页面信息

生成计划后补充以下字段：

1. 根据项目上下文、路径或用户指令填写 `system`。
2. 将 `<需求目录>` 最末级目录名原样写入 `prd_name`。
3. 根据 `module_path` 查询 `.agent/page/{system}/menu.yaml` 和 `.agent/page/{system}/{page_id}.yaml`，为每条用例填写稳定的 `page_id`。
4. 保留源用例的 `case_name`、`module_path`、`action` 和 `expected`。
5. 保留 `precondition`；源用例和用户均未提供时保持 `null`。
6. `actual_url`、`result`、`actual` 和 `screenshots` 留待执行时填写。

页面知识只记录功能与页面关系。DOM、Accessibility 元素、CSS Selector、XPath、临时元素索引和坐标在执行时从当前页面获取。

## 用户 Review

补充页面信息并保存 `{env}-execution-plan.js` 后，向用户提供用例数量、待补字段摘要和文件链接，然后结束当前轮次。收到用户明确确认后再执行页面操作；用户提出修改时更新同一 JS 文件并再次提交 Review。

## 等待页面请求与 DOM 稳定

在 Microsoft Edge 中使用「Agent Request Waiter」插件判断页面是否可以截图和断言。

插件状态：

- `READY`：绿色图标，Badge 为 `OK`。
- `ARMED`：蓝色图标，等待目标请求。
- `WAITING`：橙色图标，Badge 为 pending 数量。
- `ERROR`：红色图标，Badge 为 `!`。

从当前页面根元素读取状态：

```js
const root = document.documentElement;
const state = {
  status: root.dataset.agentRequestWaiterStatus,
  pending: Number(root.dataset.agentRequestWaiterPending),
  roundId: root.dataset.agentRequestWaiterRoundId,
};
```

对会产生请求的关键按钮操作，按以下顺序执行：

1. 记录 ARM 前的 `roundId`。
2. 派发 ARM 命令：

```js
document.dispatchEvent(
  new CustomEvent("agent-request-waiter-command", {
    detail: "ARM",
  }),
);
```

3. 默认每 `100ms` 重新读取一次状态，直到 `status === "ARMED"`、`roundId` 非空且不同于 ARM 前的值。
4. 将新值保存为 `armedRoundId`。
5. 执行页面操作。
6. 默认每 `500ms` 重新读取一次插件状态。页面跳转后重新获取 `document.documentElement`，继续使用同一个 `armedRoundId` 校验。如果连续 `10s` 仍发现请求未结束，说明接口响应较慢，可根据实际情况将读取频率降低为每 `1–2s` 一次。
7. 仅当 `status === "READY"`、`pending === 0` 且 `roundId === armedRoundId` 全部满足后截图和断言。

默认 `READY` 的 `roundId` 为空，不代表某次操作完成，不得只判断 `status === "READY"`。`ARMED` 一分钟内未检测到请求时会恢复默认 `READY` 并清空 `roundId`，该状态不得判定为操作完成。

`WAITING` 表示请求或页面仍未稳定，继续等待插件状态，不使用固定等待时间替代。`ERROR` 时停止当前流程并报告插件错误。

DOM 中没有插件属性时，检查插件是否启用、页面是否刷新以及当前页面是否允许扩展注入。必要时可点击工具栏图标执行 ARM、取消和状态确认。不产生网络请求的操作不使用插件，直接根据 DOM 或视觉变化判断。

## 执行用例

1. 根据页面知识进入目标页面并确认页面识别特征。
2. 记录当前浏览器 URL 到用例的 `actual_url`。
3. 按顺序执行每个 `action`。
4. 对会产生请求的关键按钮，在操作前 ARM「Agent Request Waiter」，操作后按 `armedRoundId` 等待请求和 DOM 稳定。
5. 对不产生网络请求的操作，根据 DOM 或视觉变化确认状态稳定。
6. 页面稳定后对照 `expected` 填写 `actual`、步骤 `result` 和 `screenshots`。
7. 汇总步骤状态为用例状态，再汇总所有用例状态为顶层 `result`。
8. 每完成一条用例就将最新结果写回同一个 `{env}-execution-plan.js`。

结果判定：

- `PASSED`：操作完成，预期结果全部满足。
- `FAILED`：操作完成，至少一个预期结果明确不满足。
- `BLOCKED`：因页面、环境、账号、数据或识别问题无法完成验证。

找不到操作目标时重新读取页面并重试一次。页面状态与用例不一致或无法可靠判断时，将当前用例记录为 `BLOCKED`。

## 记录结果

使用 [scripts/result-record.mjs](scripts/result-record.mjs) 读取、更新并原地写回执行计划：

```js
var resultTools = await import(
  "<testcase-executor目录>/scripts/result-record.mjs"
);
var planPath = "<需求目录>/execute-testcase/<env>-execution-plan.js";
var executionResult = await resultTools.readExecutionPlan(planPath);

resultTools.recordCaseUrl({
  result: executionResult,
  caseNo: 1,
  actualUrl: "https://example.test/page",
});

resultTools.recordStep({
  result: executionResult,
  caseNo: 1,
  stepNo: 1,
  actual: "页面显示22条结果",
  status: "PASSED",
  screenshots: ["screenshots/uat_case01_step01_01_result.png"],
});

await resultTools.writeExecutionPlan({
  result: executionResult,
  outputPath: planPath,
});
```

全部步骤执行完成后汇总并再次写回：

```js
resultTools.finalizeResult({ result: executionResult });
await resultTools.writeExecutionPlan({
  result: executionResult,
  outputPath: planPath,
});
```

## 保存截图

将 Computer Use 返回的临时截图 URL 传给 [scripts/save-screenshot.mjs](scripts/save-screenshot.mjs)：

```js
var { saveScreenshot } = await import(
  "<testcase-executor目录>/scripts/save-screenshot.mjs"
);

var savedScreenshot = await saveScreenshot({
  screenshotUrl: state.screenshot.url,
  outputDir: "<需求目录>/execute-testcase/screenshots",
  environment: "<uat|pre>",
  caseNo: 1,
  stepNo: 5,
  shotNo: 2,
  label: "page2",
});
```

将返回的 `relativePath` 写入步骤的 `screenshots`。文件名格式为：

```text
{env}_case{用例序号}_step{步骤序号}_{截图序号}_{内容说明}.png
```

序号从 `01` 开始；内容说明使用简短的小写英文、数字和下划线。脚本禁止覆盖同名截图。

截图用于证明测试结论。以下情况必须截图：

1. 预期结果需要页面内容证明。
2. 验证结果跨页面或分页。
3. 用例结果为 `FAILED` 或 `BLOCKED`。
4. 保存、提交、审核、删除等操作引起关键业务状态变化。

等待页面稳定后截图，尽量同时包含页面标题、查询条件和结果区域。每条 `PASSED` 用例至少保留一组核心结果截图；`FAILED` 和 `BLOCKED` 至少保留一张截图。一张截图可以被多个步骤引用。

## 生成执行报告

全部用例执行完成并写回执行计划后，运行 [scripts/create-execution-report.mjs](scripts/create-execution-report.mjs)：

```bash
node "<testcase-executor目录>/scripts/create-execution-report.mjs" \
  --output-dir "<需求目录>/execute-testcase" \
  --env "<uat|pre>"
```

脚本复制固定的 [assets/execution-report-template.html](assets/execution-report-template.html)，将数据文件占位符绑定为同环境的 `{env}-execution-plan.js`，并生成 `{env}-execution-report.html`。

报告头部显示大写的 `UAT` 或 `PRE`，下一行显示报告文件创建时间，格式为 `YYYY-MM-DD HH:mm:ss`。创建时间由报告生成脚本在创建 HTML 时写入模板。

报告通过 `file://` 直接打开，无需本地服务。页面固定提供：

- ALL / PASSED / FAILED / BLOCKED 数量卡片筛选。
- 根据 `module_path` 实际层数生成的动态导航。
- 点击导航后自动展开并定位用例。
- `action`、`expected`、`actual`、`result` 展示。
- 截图缩略图和灯箱放大。
- 每 3 秒检查执行计划 JS，数据变化时自动重新渲染。

向用户提供 `{env}-execution-report.html` 文件链接。

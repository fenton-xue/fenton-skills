---
name: testcase-executor
description: 执行 testcase-generator 生成的 UAT 或 PRE 黑盒功能测试用例 Markdown，创建或恢复 JSON 执行结果，操作页面完成验证，并持续记录用例状态、实际结果和截图。用于执行测试用例、自动完成 UI 功能验证或维护执行结果。
---

# 测试用例执行

读取当前环境的测试用例 Markdown，通过脚本创建和维护执行结果 JSON，按步骤完成页面验证并保存证据。模型负责执行与判定；文件结构、关联关系、校验和序列化由脚本负责。

## 环境与目录

默认使用 `uat`。仅当用户明确选择 PRE 时使用 `pre`。

```text
<需求目录>/测试用例/
├── uat-testcases.md
├── pre-testcases.md
└── execute-testcase/
    ├── uat-execution-result.json
    ├── pre-execution-result.json
    ├── uat-screenshots/
    └── pre-screenshots/
```

选择 PRE 时必须存在 `pre-testcases.md`。缺失时停止执行并提示用户，不回退 UAT，不复制或生成 PRE 文件。

## 测试用例 Markdown

仅支持 `<uat|pre>-testcases.md`。脚本读取并校验 testcase-generator 的当前格式：

- frontmatter 包含有效的 `environment`、`title`、`created_at`，且环境与当前选择一致。
- 一级标题为“测试用例”，至少存在一条二级标题格式的用例。
- 报告内完整用例名称唯一；该名称是执行结果中的关联键。
- `module_path` 非空，前置条件区块存在。
- 每条用例至少有一个步骤，步骤从 1 开始连续编号。
- 每个步骤包含非空的 `action` 和 `expected`。

Markdown 中的原生有序列表和换行按原内容读取。执行时按语义处理分点内容，不把 Markdown 标记当作页面输入。

## 创建或恢复执行结果

运行：

```bash
node "<testcase-executor目录>/scripts/create-execution-result.mjs" \
  --requirement-dir "<需求目录>" \
  --env "<uat|pre>"
```

`--env` 可省略，默认 `uat`。脚本会：

1. 读取并校验 `测试用例/<env>-testcases.md`。
2. 创建 `测试用例/execute-testcase/<env>-screenshots/`。
3. 创建或恢复 `测试用例/execute-testcase/<env>-execution-result.json`。
4. 已有结果存在时，校验其中的用例名称和步骤编号，不覆盖原有记录。

新建结果只包含空的 `cases` 对象。尚未执行的用例和步骤不预先写入。结果格式由脚本维护：

- `cases` 以完整用例名称为键。
- 用例记录可包含 `page`、`url`、`result` 和 `steps`。
- 步骤记录包含 `result`、`actual`，有证据时包含 `screenshots`。
- 截图记录包含 `name` 和相对于执行结果目录的 `path`。

不要手写、拼接或直接覆写执行结果 JSON。

## 补充执行上下文并 Review

1. 根据 `module_path`、项目上下文和页面知识，为每条用例确定明确的页面名称。
2. 已进入目标页面时记录当前页面 URL；尚未进入时可以暂不写 URL。
3. 使用 `recordCaseContext` 写入页面上下文并原子保存结果。
4. 向用户提供环境、用例数量、页面规划和待确认项，收到明确确认后再执行页面操作。

用户提出修改时更新同一 JSON，并再次提交 Review。

## 记录执行结果

使用 [scripts/result-record.mjs](scripts/result-record.mjs) 读取 Markdown 和结果。读取结果时必须传入 Markdown 解析所得报告，使记录函数能够校验完整用例名称和步骤编号：

```js
var resultTools = await import(
  "<testcase-executor目录>/scripts/result-record.mjs"
);
var markdownPath = "<需求目录>/测试用例/<env>-testcases.md";
var resultPath =
  "<需求目录>/测试用例/execute-testcase/<env>-execution-result.json";
var report = await resultTools.readTestcaseMarkdown(markdownPath, {
  environment: "<uat|pre>",
});
var executionResult = await resultTools.readExecutionResult(resultPath, {
  report,
});

resultTools.recordCaseContext({
  result: executionResult,
  caseName: "#84313-01-测试点描述",
  pageName: "订单审核页",
  pageUrl: "https://example.test/orders/review",
});

resultTools.recordStep({
  result: executionResult,
  caseName: "#84313-01-测试点描述",
  stepNo: 1,
  actual: "页面展示22条结果",
  status: "PASSED",
  screenshots: [
    {
      name: "uat_case01_step01_01_result.png",
      path: "uat-screenshots/uat_case01_step01_01_result.png",
    },
  ],
});

await resultTools.writeExecutionResult({
  report,
  result: executionResult,
  outputPath: resultPath,
});
```

`recordStep` 强制校验：

- `caseName` 存在于 Markdown，且使用完整用例名称精确关联。
- `stepNo` 存在于对应用例。
- `actual` 非空。
- `status` 为 `PASSED`、`FAILED` 或 `BLOCKED`。
- 截图包含非空的 `name` 和 `path`，路径位于当前环境的截图目录。

每次记录步骤后自动重新汇总用例状态：当前用例存在未执行步骤时为 `null`；全部步骤完成后按 `FAILED`、`BLOCKED`、`PASSED` 的优先级生成用例级结果。每完成一个步骤或一条用例就调用 `writeExecutionResult` 原子写回，避免执行中断时丢失记录。

## 等待页面请求与 DOM 稳定

在 Microsoft Edge 中使用「Agent Request Waiter」插件判断页面是否可以截图和断言。先按浏览器技能连接 Edge，复用当前受控标签页 `tab`。状态读取使用 `tab.playwright.evaluate()`；发送命令使用该标签页受支持的 CDP 能力，在真实页面环境中执行。

插件状态：

- `READY`：绿色图标，Badge 为 `OK`。
- `ARMED`：蓝色图标，等待目标请求。
- `WAITING`：橙色图标，Badge 为 pending 数量。
- `ERROR`：红色图标，Badge 为 `!`。

### 读取状态

每次重新读取当前页面根元素，避免页面跳转后使用旧引用：

```js
const readWaiterState = () => tab.playwright.evaluate(() => {
  const root = document.documentElement;
  const pending = root.dataset.agentRequestWaiterPending;
  return {
    status: root.dataset.agentRequestWaiterStatus,
    pending: pending == null || pending === "" ? null : Number(pending),
    roundId: root.dataset.agentRequestWaiterRoundId,
  };
});

const state = await readWaiterState();
```

`status`、`roundId` 属性缺失，或 `pending` 不是非负整数时，不能用该状态判定完成。空 `roundId` 的 `READY` 仅表示空闲。

### JS 布防与完成判定

`tab.playwright.evaluate()` 是只读接口，不能用于派发事件。首次使用当前标签页的 CDP 能力前，读取其接口文档：

```js
const waiterCdp = await tab.capabilities.get("cdp");
nodeRepl.write(await waiterCdp.documentation());
```

对会产生请求的关键操作：

1. 确认上一业务操作已经结束，读取并保存 ARM 前的 `roundId`。正在等待业务请求时不重新布防。
2. 通过 CDP 发送 ARM 命令：

```js
const armResponse = await waiterCdp.send(
  "Runtime.evaluate",
  {
    expression: `document.dispatchEvent(
      new CustomEvent("agent-request-waiter-command", { detail: "ARM" })
    )`,
    returnByValue: true,
  },
  { timeoutMs: 5000 },
);

if (armResponse.exceptionDetails) {
  throw new Error("Agent Request Waiter ARM 脚本执行失败");
}
```

3. 在控制端每 `100ms` 调用 `readWaiterState()`，最多等待 `3s`，确认 `status === "ARMED"` 且获得不同于 ARM 前值的非空 `roundId`。脚本返回成功或 `dispatchEvent()` 返回 `true` 都不能替代此确认。
4. 保存为 `armedRoundId` 后，通过浏览器交互接口执行页面操作；抽屉、弹窗等需先确认展开且目标可操作。
5. 在控制端每 `500ms` 读取状态；响应超过 `10s` 时可降低为每 `1–2s` 一次。每次读取完成后再安排下一次，不在一个长时间等待的 CDP 调用中阻塞后续页面操作。
6. 仅当 `status === "READY"`、`pending === 0`、`roundId === armedRoundId` 同时满足后截图和断言。

请求可能很快完成，不要求每次轮询都捕获到中间的 `WAITING`。页面跳转后仍校验同一轮次；轮次丢失或变化时停止自动判定，不把其他轮次的 `READY` 当作本次完成。

等待使用用例或环境规定的超时，未指定时默认 `60s`。`WAITING` 时继续按状态等待；持续 `ARMED` 时检查页面操作是否实际触发，不能据此判定成功或盲目重复提交。达到超时仍无法确认时记录当前状态和页面证据，将步骤标为 `BLOCKED`。`ERROR` 时停止当前流程并报告插件错误。不产生网络请求的操作直接根据 DOM 或视觉变化判断。

### 布防异常与图标回退

ARM 未确认时，不执行业务操作。先核对受控标签页、当前 URL 和插件状态；必要时激活目标标签页并重新读取。确认没有正在等待的业务操作后，最多重试一次 JS 布防。不要为恢复插件而自动刷新包含未保存输入的页面。

CDP 不可用或重试仍未确认时，可按 Computer Use 技能点击目标 Edge 标签页的插件图标。点击前必须读取最新状态：

- `READY`：点击一次发起布防，再按相同规则确认新的非空 `roundId`。
- `ARMED`：图标再次点击会取消布防并清空轮次。若已确认是本次新轮次，直接继续业务操作，不再点击；无法确认轮次归属时停止并报告。
- `WAITING`：等待已有操作完成，不点击图标或重新发送 ARM。
- `ERROR` 或状态无法读取：停止并报告，不以图标颜色替代轮次校验。

图标回退仍无法确认布防时，将步骤标为 `BLOCKED`。回退只处理业务操作前的布防，不自动重放已执行的业务操作。

## 执行与结果判定

1. 根据页面知识进入目标页面并确认识别特征。
2. 检查并满足 `precondition`。
3. 记录页面名称和当前 URL。
4. 按 Markdown 顺序执行每个 `action`。
5. 页面稳定后对照 `expected` 填写 `actual`、状态和截图。
6. 每完成一步立即原子写回结果。

状态：

- `PASSED`：操作完成，预期结果满足。
- `FAILED`：操作完成，预期结果明确不满足。
- `BLOCKED`：因页面、环境、账号、数据或识别问题无法完成验证。

找不到操作目标时重新读取页面并重试一次。页面状态与用例不一致或无法可靠判断时，将对应步骤记录为 `BLOCKED`。

## 保存截图

普通页面证据默认使用当前受控 Edge 标签页的页面级截图接口，不使用 Computer Use 的整窗口截图：

```js
var screenshotBytes = await tab.screenshot();
```

截图后将原始字节传给 [scripts/save-screenshot.mjs](scripts/save-screenshot.mjs)：

```js
var { saveScreenshot } = await import(
  "<testcase-executor目录>/scripts/save-screenshot.mjs"
);

var savedScreenshot = await saveScreenshot({
  screenshotBytes,
  requirementDir: "<需求目录>",
  environment: "<uat|pre>",
  caseNo: 1,
  stepNo: 5,
  shotNo: 2,
  label: "page2",
});
```

`savedScreenshot` 的 `name` 和 `path` 可直接放入 `recordStep.screenshots`。仅当证据必须包含浏览器标签栏、地址栏、扩展弹窗、系统对话框，或页面级截图无法捕获的原生控件时，才使用 Computer Use 整窗口截图；回退时将 `state.screenshot.url` 作为 `screenshotUrl` 传入同一脚本。

脚本根据文件头识别 JPEG、PNG 或 WebP，不转码、不压缩、不缩放。文件保存到：

```text
<需求目录>/测试用例/execute-testcase/<env>-screenshots/
```

文件名为：

```text
{env}_case{用例序号}_step{步骤序号}_{截图序号}_{说明}.{jpg|png|webp}
```

脚本禁止覆盖同名截图。说明使用小写英文、数字和单下划线。

以下情况必须截图：

1. 预期结果需要页面内容证明。
2. 验证结果跨页面或分页。
3. 结果为 `FAILED` 或 `BLOCKED`。
4. 保存、提交、审核、删除等操作引起关键业务状态变化。

等待页面稳定后截图，尽量同时包含页面标题、查询条件和结果区域。每条 `PASSED` 用例至少保留一组核心结果截图；`FAILED` 和 `BLOCKED` 至少保留一张截图。一张截图可以被多个步骤引用。

## 完成汇总

全部步骤完成后执行最终完整性校验并写回：

```js
resultTools.finalizeResult({
  report,
  result: executionResult,
});
await resultTools.writeExecutionResult({
  report,
  result: executionResult,
  outputPath: resultPath,
});
```

`finalizeResult` 逐条检查 Markdown 中所有用例和步骤；缺少任一步骤结果时禁止完成。完成后向用户提供测试用例 Markdown、执行结果 JSON、用例状态摘要和截图目录链接。

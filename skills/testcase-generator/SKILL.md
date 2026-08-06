---
name: testcase-generator
description: 专业生成和维护结构化黑盒功能测试用例。用于根据需求文档生成测试用例、写测试用例、设计测试用例、更新 uat-testcase-source.js、生成统一用例查看页，或将用例转化为可导入 XMind 的 Markdown 格式。
---

# 黑盒功能测试用例生成器

只设计功能测试（黑盒），不涉及接口、性能、安全和自动化测试。将稳定的用例定义直接保存为结构化 JavaScript 数据，供人工 Review、转化为可导入 XMind 的 Markdown 格式，以及交由 testcase-executor 执行。

## 输出文件

在需求文档所在的最末级目录只生成并维护 UAT 文件：

```text
<需求目录>/
├── uat-testcase-source.js
└── uat-testcase-viewer.html
```

禁止自动生成 `pre-testcase-source.js` 和 `pre-testcase-viewer.html`。

`uat-testcase-source.js` 是必需数据源。文件只能包含一次全局变量赋值，对象必须是严格 JSON：

```js
window.TESTCASE_SOURCE = {
  "source_id": "UAT文档级标准UUID",
  "environment": "UAT",
  "prd_name": "#84313 需求名称",
  "testcases": [
    {
      "id": "用例标准UUID",
      "case_name": "#84313-01-测试点描述",
      "module_path": [
        "一级模块",
        "二级模块"
      ],
      "precondition": "",
      "steps": [
        {
          "step": 1,
          "action": "可直接执行的操作描述",
          "expected": "明确、确定、可观察的预期结果"
        }
      ]
    }
  ]
};
```

完整示例见 [references/uat-testcase-source.example.js](references/uat-testcase-source.example.js)。

Source 只保存稳定定义，字段仅限：

- 顶层：`source_id`、`environment`、`prd_name`、`testcases`
- 用例：`id`、`case_name`、`module_path`、`precondition`、`steps`
- 步骤：`step`、`action`、`expected`

禁止写入 `system`、`page_id`、`actual_url`、`result`、`actual`、`screenshots`。这些执行数据由 testcase-executor 写入 `execute-testcase/{uat|pre}-execution-result.js`。

## UUID 与步骤编号

1. 新建 UAT 文档时为 `source_id` 生成标准 UUID；后续更新同一 UAT 文档时始终保留。
2. 新增用例时生成新的标准 UUID，并写入用例 `id`。
3. 修改用例名称、模块、前置条件、步骤操作或预期结果时保留用例 UUID。
4. 调整用例顺序时保留用例 UUID。
5. 删除的 UUID 永不复用。
6. 拆分用例时由原主体保留 UUID，新拆出的用例生成新 UUID。
7. 合并用例时保留其中一个 UUID，另一个 UUID 废弃且不再复用。
8. 步骤不使用 UUID；每条用例内的 `step` 必须从 `1` 开始连续递增。
9. 用例名称中的两位编号只用于展示，独立于 UUID。
10. 每次写入后必须校验 `source_id`、用例 UUID 的格式，以及步骤编号的连续性。

可使用 Node.js 生成新 UUID：

```bash
node -e 'console.log(crypto.randomUUID())'
```

## 生成范围

1. 根据用户确认的范围设计用例，并结合整个需求文档理解业务意图。
2. 用户明确指定一个小标题时，只生成或更新该小标题对应的用例。
3. 用户未指定小标题时，停止生成并询问是否需要覆盖整篇文档。
4. 用户确认覆盖整篇文档后，一次性生成全部小标题的用例并交付 Review。
5. 用户不需要覆盖整篇文档时，等待用户指定小标题。

## 模块与用例命名

1. 阅读全文后整体规划 `module_path`，层级数量按业务结构动态确定。
2. 模块名称可按业务语义优化，不必机械复用需求标题。
3. 每条用例必须写出完整 `module_path`。
4. `case_name` 使用 `{需求号}-{两位编号}-{测试点描述}`，例如 `#84313-07-登录按钮验证`。
5. 需求号从需求文档文件名提取。
6. 编号从 `01` 开始，并在跨最小级模块时重置。最小级模块是 `module_path` 的最后一项。
7. `prd_name` 使用包含需求号的完整需求名称，例如 `#84313 登录能力优化`。

## 步骤设计

1. `action` 必须是测试人员可直接执行的真实操作，包含进入页面、选择条件、输入数据、点击、勾选、粘贴、提交、保存、查询或审核等动作。
2. 将规则、展示逻辑、字段说明和限制条件转换为可执行操作，禁止直接复述需求。
3. 相近操作聚合在同一用例中，使用多个步骤覆盖并列场景，避免拆成大量单步骤用例。
4. 并列步骤之间没有逻辑依赖时，在 `action` 开头使用括号标明当前场景。
5. 每个步骤同时包含一个 `action` 和一个 `expected`，两者严格一一对应。
6. 一个步骤只验证一个明确测试点；不同测试点拆成不同步骤。
7. `step` 按数组顺序从 `1` 连续递增。
8. 覆盖需求支持的主要操作路径，例如手动输入、批量粘贴、弹窗选择和列表勾选。
9. 分支、权限、范围和优先级必须设计明确测试点；优先项与兜底项分别验证。
10. 输入类操作在 `action` 中写出具体、中性的测试数据。禁止单独增加测试数据字段。

## 预期结果

1. `expected` 必须明确、确定、可观察，只描述一种系统表现。
2. 禁止使用“若”“如果”“取决于”“视情况”等假设性或条件性表述。
3. 预期结果只写系统实际表现，不写测试意图、原因解释或操作说明。
4. 条件分支拆成独立步骤，每个步骤只描述一种确定状态。

## 前置条件

1. 每条用例必须包含字符串字段 `precondition`。
2. 只填写执行后续 `action`、验证对应 `expected` 所必需的页面状态、数据状态、账号权限和测试环境。
3. 内容必须与当前测试点直接相关，禁止填写“XX系统测试环境可用”等通用环境说明。
4. 无特殊前置条件时使用空字符串 `"precondition": ""`。
5. 禁止单独增加优先级字段。

## 更新既有用例

1. 读取现有 `uat-testcase-source.js`，基于 `id` 识别原用例。
2. Review 修改稳定定义时原地更新，并按 UUID 规则保留或新增用例 UUID。
3. 新增内容追加到对应模块；删除内容时不复用已删除 UUID。
4. 修改步骤结构后提示该用例已有执行结果需要清空并重新执行。
5. 保存后确认同目录存在 `uat-testcase-viewer.html`；缺失时运行查看器生成脚本。已有查看页自动加载最新数据。

## 生成统一查看页

运行：

```bash
node "<testcase-generator目录>/scripts/create-testcase-viewer.mjs" "<需求目录>/uat-testcase-source.js"
```

`uat-testcase-viewer.html` 加载同目录的 `uat-testcase-source.js`，并可选加载 `execute-testcase/uat-execution-result.js`。复制并重命名为 `pre-testcase-viewer.html` 后，按文件名前缀加载对应的 PRE 文件。

## 转化为可导入 XMind 的 Markdown 格式

运行：

```bash
node "<testcase-generator目录>/scripts/create-xmind-markdown.mjs" "<需求目录>/<uat|pre>-testcase-source.js" [输出文件.md]
```

## PRE 复制流程

1. 仅当用户明确要求生成 PRE 版本时，将 `uat-testcase-source.js` 复制为 `pre-testcase-source.js`，将 `uat-testcase-viewer.html` 复制为 `pre-testcase-viewer.html`。
2. 为 PRE Source 重新生成 `source_id`，并将 `environment` 改为 `PRE`。
3. 将 `precondition`、`action`、`expected` 中的环境相关数据替换为 PRE 数据。
4. 保留 `prd_name`、用例 UUID、`case_name`、`module_path`、步骤编号、操作结构和步骤数量。

## 工作流程

1. 读取完整需求文档并确定生成范围。
2. 读取已有 `uat-testcase-source.js`；不存在时创建 UAT 文档，生成 `source_id` 并写入 `"environment": "UAT"`。
3. 设计整体模块结构和测试点。
4. 生成或更新结构化用例，遵守 UUID 保留规则。
5. 确认同目录存在 `uat-testcase-viewer.html`；缺失时立即运行 `create-testcase-viewer.mjs` 创建。`uat-testcase-source.js` 与 `uat-testcase-viewer.html` 必须同时存在，在两者就绪前禁止暂停或交付。
6. 向用户提供用例数量、变更摘要、`uat-testcase-source.js` 和 `uat-testcase-viewer.html` 链接，然后暂停等待 Review。
7. 根据 Review 更新同一数据文件，由已有查看页自动加载最新数据。
8. 指定小标题模式下，等待用户说“下一个”后再生成下一批。

指定小标题模式一次只处理一个阶段；整篇文档模式必须先获得用户确认。自动生成阶段只创建 UAT Source 与 Viewer，不创建 PRE 文件。

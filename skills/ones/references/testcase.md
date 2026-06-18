# 测试用例

当前测试用例只开放两个高层工具：`find_test_cases` 和 `upsert_test_case`。不要调用或描述旧的底层工具、批量工具、删除工具或用例库 CRUD。

## 可用工具

### `find_test_cases`

用途：在某个用例库内查找测试用例。

参数：

- `library_id: str`，必填，用例库 ID。
- `query: str`，必填，可匹配用例名称、`uuid`、`number` 或 `key`。
- `module_path: list[str] | None = None`，可选，模块名称路径，例如 `['WEB QC', '新版QCAPP', '日志', '提交报告']`。
- `exact: bool = True`，可选，默认精确匹配；设为 `false` 时做包含匹配。
- `team_id: str | None = None`，可选，覆盖默认团队 ID。

行为：

- 如果传 `module_path`，工具会用模块名称路径查找模块 UUID，并复用本地模块缓存。
- 查询不会创建模块。
- 底层会拉取用例库 cases 后在 MCP 侧过滤。
- 如果找不到模块或用例，如实反馈给用户；必要时让用户确认用例库 ID、模块路径、用例名称或编号。

示例：

```json
{
  "library_id": "8WeKJafQ",
  "query": "#84358-01-提交报告校验失败日志",
  "exact": true
}
```

限定模块路径：

```json
{
  "library_id": "8WeKJafQ",
  "query": "185630",
  "module_path": ["WEB QC", "新版QCAPP", "日志", "提交报告"],
  "exact": true
}
```

### `upsert_test_case`

用途：新增或更新单条测试用例。这是测试用例唯一推荐写入口。

参数：

- `library_id: str`，必填，用例库 ID。
- `module_path: list[str]`，必填，完整模块名称路径。
- `name: str`，必填，用例名称。
- `steps: list[dict]`，必填，多个步骤。每步至少包含：
  - `description`：步骤描述。
  - `expected_result`：预期结果。
- `extra_payload: dict | None = None`，可选，透传给 ONES 的额外字段。
- `team_id: str | None = None`，可选。

行为：

- 会根据 `module_path` 查找模块 UUID；路径中缺失的模块会逐级新建并写入本地缓存。
- 会按最终模块 UUID + 用例名称查找现有用例。
- 找到 1 条则更新；找不到则新增；找到多条则拒绝更新，避免误改。
- 新增用例未传优先级时默认 P2。
- 只处理单条用例，不暴露批量新增、删除、用例库 CRUD 等底层能力。

示例：

```json
{
  "library_id": "8WeKJafQ",
  "module_path": ["WEB QC", "新版QCAPP", "日志", "提交报告"],
  "name": "#84358-01-提交报告校验失败日志",
  "steps": [
    {
      "description": "执行提交报告操作并触发失败日志场景。",
      "expected_result": "页面展示提交失败提示，并记录对应失败日志。"
    }
  ]
}
```

## 推荐流程

1. 如果用户不知道 `library_id`，先要求用户提供；当前 MCP 没有暴露“列出用例库”的 tool。
2. 写入前建议调用 `find_test_cases`，用 `library_id`、用例名称和必要的 `module_path` 确认现有用例。
3. 确认写入目标后调用 `upsert_test_case`。如果用户给出多条用例，逐条处理，避免把它描述成批量 tool。
4. 命中多条同名用例导致拒绝更新时，让用户补充更精确的模块路径或用例名称。

## 不支持

- 删除测试用例。
- 列出或管理用例库。
- 批量新增、批量更新或批量删除测试用例。
- 单独创建测试模块；模块创建由 `upsert_test_case` 内部处理。
- 测试计划和计划用例操作。
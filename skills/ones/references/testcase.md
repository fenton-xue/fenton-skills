# 测试用例


## 可用工具

### `find_test_cases`

用途：查找测试用例。当前只保留两种高层用法：用例 ID/编号查询，或模块 URL + 用例名称查询。

参数：

- `test_case_id: str | None = None`，可选。推荐的用例 ID/编号查询入口，例如 `185627` 或其他 ONES 用例编号/ID。
- `module_url: str | None = None`，可选。ONES 测试用例模块链接，例如 `https://1s.oristand.com/project/#/testcase/team/63FL1oSZ/plan/RNA3SLPj/library/8WeKJafQ/module/7zWxxxgo`。
- `name: str | None = None`，可选。配合 `module_url` 使用时表示用例名称。


行为：

- 用例 ID/编号查询不需要用例库 ID。
- 模块 URL 查询会包含该模块和所有子模块；不要把它解释成只查 URL 指向模块本身。
- 如果找不到用例，如实反馈给用户；必要时让用户确认用例 ID/编号、模块 URL 或用例名称。

1. 按用例 ID/编号查询示例：

```json
{
  "test_case_id": "185627"
}
```

实测 `test_case_id="185627"` 可命中：`uuid=RCs8mNAt`、`name=#84358-01-发送邮件校验失败日志`、`number=185627`、`module_uuid=Pv3cx36Z`。

2. 按模块 URL + 用例名称查询示例：

```json
{
  "module_url": "https://1s.oristand.com/project/#/testcase/team/63FL1oSZ/plan/RNA3SLPj/library/8WeKJafQ/module/7zWxxxgo",
  "name": "#84358-01-发送邮件校验失败日志"
}
```

这个模式会查 `module_id=7zWxxxgo` 对应模块及其所有子模块；目标用例可以位于子模块 `Pv3cx36Z` 下。实测命中同一条用例：`uuid=RCs8mNAt`、`number=185627`、`module_uuid=Pv3cx36Z`。

### `upsert_test_case`

用途：新增或更新单条测试用例。这是测试用例唯一推荐写入口。`library_id` 必填，MCP 不提供默认用例库；由 SKILL 根据用户语境选择或向用户确认用例库。

已知用例库：

| 用例库 | `library_id` |
| --- | --- |
| WEB QC | `8WeKJafQ` |
| 海运系统 | `NjC6YyGV` |

参数：

- `library_id: str`，必填，用例库 ID。由 SKILL 根据用户上下文选择：WEB QC 用 `8WeKJafQ`，海运系统用 `NjC6YyGV`；无法判断时先让用户确认。
- `module_path: list[str]`，必填。由 SKILL 把用户给的本地模块层级整理成模块 `path` 数组；可以是完整模块路径，也可以是本地用例里的简略/后缀模块路径，例如 `["样板报告", "发送邮件", "收件人+添加收件人"]`。简略/后缀模块的存在是因为前面有些固定模块，每次都写出来太冗余了；`module_path` 中提供的第一个模块名称确认存在时，后续模块若不存在会自动新建。
- `name: str`，必填。由 SKILL 从用户本地用例名称字段整理成 MCP 入参。
- `steps: list[dict]`，必填。由 SKILL 把本地步骤描述/预期结果字段整理成数组；每步至少包含：
  - `description`：步骤描述。
  - `expected_result`：预期结果。
- `extra_payload: dict | None = None`，可选，透传给 ONES 的额外字段。
- `team_id: str | None = None`，可选。

行为：

- 成功时，根据 MCP 返回的 `action`、用例信息和模块信息，告诉用户本次是新增还是更新。
- 如果 MCP 返回模块路径无法解析、命中多个候选或父路径不唯一，把错误里的候选路径反馈给用户，并要求用户提供更高级或更完整的模块路径。
- 用户补充路径后，用新的 `module_path` 再次调用 `upsert_test_case`。
- 如果 MCP 返回同名用例命中多条并拒绝更新，要求用户补充更精确的模块路径或用例名称。

示例：

```json
{
  "library_id": "8WeKJafQ",
  "module_path": ["样板报告", "发送邮件", "收件人+添加收件人"],
  "name": "#84358-02-收件人为空必填校验",
  "steps": [
    {
      "description": "使用供应商邮箱为空的已下载样板报告进入发送邮件页面",
      "expected_result": "收件人字段未带出邮箱，显示添加收件人提示"
    },
    {
      "description": "保持收件人为空，填写发送邮件其他必填内容后点击发送",
      "expected_result": "系统提示收件人不能为空，请确认！"
    }
  ]
}
```

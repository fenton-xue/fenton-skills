# ONES 工具索引

本文件只用于路由。当前 `ones-mcp-tools` MCP Server 只暴露 4 个工具。

## 测试用例

读取 `testcase.md`，当用户提到：

- 在某个用例库中按名称、`uuid`、`number` 或 `key` 查找测试用例
- 按模块名称路径限定查找范围
- 新增或更新单条测试用例
- 测试步骤、预期结果、模块路径、`library_id`

## Wiki

读取 `wiki.md`，当用户提到：

- 通过 ONES Wiki 页面链接读取页面
- 把 Wiki 页面转换或导出为 Markdown
- 在指定父 Wiki 页面下导入 Markdown，新建协同 Wiki 子页面

## 明确不支持的请求

当前 MCP 没有暴露这些 tool，不能沿用旧文档或猜测底层接口：

- 测试计划、计划用例、执行信息
- 删除测试用例、删除 Wiki
- 更新已有 Wiki 页面正文或覆盖发布
- Wiki 页面列表、页面组列表、草稿管理
- 用例库列表、用例库详情、用例库 CRUD
- 批量新增、批量更新或批量删除测试用例
- 新版 OpenAPI、OAuth、Bearer token、浏览器 token 认证流程

## 跨领域任务

- “把 Wiki 页面内容生成测试用例”：读取 `wiki.md` 获取页面内容，再读取 `testcase.md`，用 `upsert_test_case` 新增或更新单条用例。
- “查一下这个 wiki 并导出”：读取 `wiki.md`，调用 `get_wiki_page_by_url`，使用返回的 `export_filename` 和 `body_markdown` 写出正文。
- “把某个用例加入测试计划”：说明当前 MCP 没有测试计划相关工具，不能执行添加计划用例。
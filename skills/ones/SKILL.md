---
name: ones
description: "Use when 用户需要通过 ones-mcp-tools MCP Server 查找或新增/更新 ONES 测试用例，或读取 ONES Wiki 链接、把 Markdown 导入为 Wiki 子页面。"
---

# ONES

使用本 skill 操作当前 `ones-mcp-tools` MCP Server。当前服务只暴露 4 个 MCP tool：`find_test_cases`、`upsert_test_case`、`get_wiki_page_by_url`、`import_wiki_markdown_page`。

## 核心规则

- 只使用 ONES 旧版 Open API。不要引导用户使用新版 OpenAPI、OAuth、Bearer token、浏览器 localStorage token、JWT 或对象存储 token。
- 认证由 MCP Server 通过账号密码登录旧版 `/project/api/project/auth/login` 处理。多用户共享时用不同端口隔离不同用户实例。
- 如果 ONES MCP tools 不可用，或看不到上述 4 个工具，提示用户启用或重启 MCP 客户端，让 `ones-mcp-tools` 重新加载。
- 当前没有测试计划工具，也没有删除测试用例、删除 Wiki、更新 Wiki 正文、页面列表、用例库 CRUD 或批量新增工具。
- 如果用户不知道 `library_id`，要求用户提供，并说明当前 MCP 没有暴露“列出用例库”的 tool。
- 返回结果时优先给出对象名称、ID、执行结果和下一步建议；不要倾倒完整原始响应，除非用户要求调试。

## 路由

- 测试用例查找、新增、更新：读取 `references/testcase.md`。
- Wiki 页面链接读取、导出 Markdown、新建 Wiki 子页面：读取 `references/wiki.md`。
- 跨领域任务，例如“把 Wiki 内容整理成测试用例”：先读取 `wiki.md` 获取内容，再读取 `testcase.md` 写入用例。
- 用户要求测试计划、删除、Wiki 正文更新、用例库列表或用例库 CRUD 时，不调用旧工具；直接说明当前 MCP 未暴露对应能力。

## 推荐工作流

1. 判断是测试用例还是 Wiki 任务，并读取对应 reference。
2. 查找测试用例时优先使用 `find_test_cases`；写入测试用例前建议先查找确认现有用例。
3. 写入测试用例只使用 `upsert_test_case`，并且一次只处理单条用例。
4. 读取 Wiki 链接使用 `get_wiki_page_by_url`；导出 Markdown 时使用返回的 `export_filename` 和 `body_markdown`。
5. 新建 Wiki 页面只使用 `import_wiki_markdown_page`，它会在父页面下导入 Markdown 生成子页面，不会覆盖或更新父页面。

## 局域网共享配置

服务端运行多用户实例后，每个用户使用不同 MCP URL，例如：

- `http://192.168.16.44:8101/mcp`
- `http://192.168.16.44:8102/mcp`

对方 MCP JSON 可写：

```json
{
  "mcpServers": {
    "ones-mcp-tools": {
      "url": "http://192.168.16.44:8102/mcp"
    }
  }
}
```
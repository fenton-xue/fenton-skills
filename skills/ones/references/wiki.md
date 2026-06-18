# Wiki

当前 Wiki 只开放两个工具：`get_wiki_page_by_url` 和 `import_wiki_markdown_page`。不要调用或描述旧的页面列表、草稿、删除、正文更新或强制覆盖发布流程。

## 可用工具

### `get_wiki_page_by_url`

用途：通过 ONES Wiki 页面链接获取页面详情并转换为 Markdown。

参数：

- `wiki_url: str`，必填，例如 `https://1s.oristand.com/wiki/#/team/63FL1oSZ/space/WUc7QyRP/page/SVxEtovb`。
- `version: int | None = None`，可选，读取指定版本。

行为：

- 从链接中解析 `team_id`、`space_id`、`page_id`。
- 返回结构化结果，包括页面元信息、`markdown`、`body_markdown`、`export_filename` 等。
- `markdown` 保留原始转换结果。
- `body_markdown` 会在首个一级标题与页面标题一致时移除该重复标题，更适合直接导出为 md 正文。
- 对带 `ref_uuid` 的协同页面，会读取 online_page 内容并转换成 Markdown。

推荐：用户给 Wiki 链接时优先调用该工具；如果用户说“查一下这个 wiki 并导出”，导出文件应使用 `export_filename` 和 `body_markdown`。

### `import_wiki_markdown_page`

用途：通过导入 Markdown，在指定父 Wiki 页面下新建协同 Wiki 页面。

参数：

- `parent_wiki_url: str`，必填，父页面链接，例如 `https://1s.oristand.com/wiki/#/team/63FL1oSZ/space/WUc7QyRP/page/PYqupts4`。
- `filename: str`，必填，导入的 Markdown 文件名；未带 `.md` 时会自动补上。
- `markdown: str`，必填，Markdown 正文。
- `poll_timeout_seconds: float = 60.0`，可选，等待导入任务完成的超时时间。

行为：

- 会解析父页面 URL，准备附件上传，上传 Markdown，调用上传回调，再触发 `/wiki/api/wiki/team/{team_id}/file/import`。
- 会轮询队列直到导入完成或超时。
- 返回导入任务信息、`resource_uuid`、`task`、`task_extra`、`created_pages` 等。
- 这是 Wiki 新增入口，只会在父页面下新建子页面，不会覆盖或更新父页面本身。

示例：

```json
{
  "parent_wiki_url": "https://1s.oristand.com/wiki/#/team/63FL1oSZ/space/WUc7QyRP/page/PYqupts4",
  "filename": "接口巡检说明.md",
  "markdown": "# 接口巡检说明\n\n正文内容..."
}
```

## 推荐流程

1. 读取或导出 Wiki：调用 `get_wiki_page_by_url`，输出标题、页面 ID、版本和 Markdown 摘要；需要落盘时使用 `export_filename` + `body_markdown`。
2. 新建 Wiki 子页面：确认父页面 URL、文件名和 Markdown 正文后调用 `import_wiki_markdown_page`。
3. 如果用户要求更新已有页面正文，说明当前 MCP 只能导入 Markdown 新建子页面，不能直接更新已有页面。

## 不支持

- 列出 Wiki 页面组或页面树。
- 创建普通 Wiki 页面、更新已有页面正文、删除页面。
- 草稿管理、发布草稿、强制覆盖发布。
- 通过新版 OpenAPI 或浏览器 token 操作 Wiki。
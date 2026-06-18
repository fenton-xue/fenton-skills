# Wiki

当前 Wiki 只开放两个工具：`get_wiki_page_by_url` 和 `import_wiki_markdown_page`。不要调用或描述旧的页面列表、草稿、删除、正文更新或强制覆盖发布流程。

## 可用工具

### `get_wiki_page_by_url`

用途：通过 ONES Wiki 页面链接获取页面详情并转换为 Markdown。

参数：

- `wiki_url: str`，必填，例如 `https://1s.oristand.com/wiki/#/team/63FL1oSZ/space/WUc7QyRP/page/SVxEtovb`。

行为：

- 用户给 Wiki 链接时，调用该工具获取页面内容。
- 如果用户要求导出，先向用户确认保存路径，再正式创建 Markdown 文件。文件的第一个一级标题表示文件名；写入正文时去掉这个一级标题。

### `import_wiki_markdown_page`

用途：通过导入 Markdown，在指定父 Wiki 页面下新建协同 Wiki 页面。

参数：

- `parent_wiki_url: str`，必填，父页面链接，例如 `https://1s.oristand.com/wiki/#/team/63FL1oSZ/space/WUc7QyRP/page/PYqupts4`。
- `filename: str`，必填，导入的 Markdown 文件名。
- `markdown: str`，必填，Markdown 正文。
- `poll_timeout_seconds: float = 60.0`，可选，等待导入任务完成的超时时间。

行为：

- 确认父页面链接、文件名和 Markdown 正文后，调用该工具导入 Markdown。
- 导入结果只用于向用户说明是否新建成功以及新页面信息；该工具只会在父页面下新建子页面，不会覆盖或更新父页面本身。

示例：

```json
{
  "parent_wiki_url": "https://1s.oristand.com/wiki/#/team/63FL1oSZ/space/WUc7QyRP/page/PYqupts4",
  "filename": "接口巡检说明.md",
  "markdown": "# 接口巡检说明\n\n正文内容..."
}
```

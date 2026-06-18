# Wiki

当前 Wiki 开放三个工具：`get_wiki_page_by_url`、`export_wiki_page_markdown` 和 `import_wiki_markdown_page`。不要调用或描述未暴露的 Wiki 更新、删除或列表工具。

## 可用工具

### `get_wiki_page_by_url`

用途：通过 ONES Wiki 页面链接获取页面内容。

参数：

- `wiki_url: str`，必填，例如 `https://1s.oristand.com/wiki/#/team/63FL1oSZ/space/WUc7QyRP/page/SVxEtovb`。

行为：

- 用户给 Wiki 链接并要求查看或读取页面时，调用该工具获取页面内容。

### `export_wiki_page_markdown`

用途：通过 ONES Wiki 页面链接导出本地 Markdown 文件。

参数：

- `wiki_url: str`，必填，ONES Wiki 页面链接。
- `output_dir: str | None = None`，可选，导出目录。
- `filename: str | None = None`，可选，导出的 Markdown 文件名。
- `version: int | None = None`，可选，导出指定版本。

行为：

- 用户要求导出 Wiki 时，优先调用该工具，不要用读取工具手动落盘。
- 如果用户要求导出，先向用户确认保存路径，再正式创建 Markdown 文件。文件的第一个一级标题表示文件名；写入正文时去掉这个一级标题。
- 工具会写出 Markdown 文件，并把正文图片保存到同级 `assets/` 后改为相对路径；图片下载失败时保留原链接，并把失败信息反馈给用户。
- 该工具只导出本地文件，不更新 Wiki。

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

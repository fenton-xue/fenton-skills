# Wiki

当前 Wiki 面向用户的页面流程主要使用 `get_wiki_page_by_url` 和 `import_wiki_markdown_page`。`download_wiki_image_resource` 仅作为本地导出图片处理脚本使用的图片下载能力，不单独作为用户流程描述。不要调用或描述未暴露的 Wiki 更新、删除或列表工具。

## 可用工具

### `get_wiki_page_by_url`

用途：通过 ONES Wiki 页面链接获取页面内容。

参数：

- `wiki_url: str`，必填，例如 `https://1s.oristand.com/wiki/#/team/63FL1oSZ/space/WUc7QyRP/page/SVxEtovb`。

行为：

- 用户给 Wiki 链接并要求查看或读取页面时，调用该工具获取页面内容。
- 用户要求导出 Wiki 为本地 Markdown 时，也先调用该工具获取结构化页面数据。
- 创建 Markdown 时不要盲用返回的 `markdown/body_markdown`，因为它可能缺失表格、列表、代码块。优先基于 `online_page.content` 的结构化内容还原正文。
- 导出文件名优先使用返回的 `export_filename`，否则使用 `page.title + ".md"`。
- 如果用户要求导出，先向用户确认保存路径，再正式创建 Markdown 文件。文件的第一个一级标题表示文件名；写入正文时去掉这个一级标题。
- 如果导出的 Markdown 里含有图片，则使用本地导出图片处理脚本处理。

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

## 本地导出图片处理脚本

固定脚本：`scripts/process_wiki_images.py`

用途：批量扫描本地 Markdown 中的图片引用，下载或复制图片到同级 `assets/`，并把成功处理的图片引用改写为本地相对路径。脚本处理 ONES Wiki 图片时使用 MCP 工具 `download_wiki_image_resource` 下载资源。

基本用法：

```bash
python "$SKILL_DIR\scripts\process_wiki_images.py" "<待处理 Markdown 文件路径>" --wiki-url "<ONES Wiki 页面链接>" --token "<get_wiki_page_by_url 返回的 online_page.token>"
```

脚本行为：

- 支持处理 `![](xxx.png)`、`![image](xxx.png)`、远程图片 URL、本地同目录图片文件。
- 成功下载或复制后改写为 `![alt](assets/xxx.png)`。
- 失败时保留原引用，不破坏 Markdown。
- 写出 `<原文件>.images.report.json`，记录成功、失败和候选下载 URL。
- ONES Wiki 图片资源需要 `online_page.token`；运行脚本时通过 `--token` 传入。
- 脚本使用的 MCP 图片下载工具是 `download_wiki_image_resource`，入参包括资源绝对 URL、输出目录和可选文件名。资源 URL 必须带 `get_wiki_page_by_url` 返回的 `online_page.token`；只传不带 token 的 URL 会返回 `403 Forbidden resource`。
- 资源 URL 使用绝对地址，形态为 `/wiki/api/wiki/editor/{team_id}/{ref_uuid}/resources/{filename}?token={online_page.token}`。

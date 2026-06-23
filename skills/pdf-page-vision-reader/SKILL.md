---
name: pdf-page-vision-reader
description: 当用户提供本地 PDF 路径和明确的物理页码，并要求读取、查看、总结、提取、核对或理解这些 PDF 页面内容时使用。触发词包括“看第3页”“读取第2-4页”“这个PDF第5页写了什么”等请求。
---

# PDF 页面视觉读取

把用户指定的 PDF 物理页面渲染成图片，再用视觉能力阅读页面内容。

## 硬性规则

1. 用户必须同时提供 PDF 路径和页码；缺少页码时停止，不猜、不先读全文、不询问目录页。
2. 页码表示 PDF 文件的物理页面序号，从 1 开始。第 1 页就是 PDF 的第 1 张页面。
3. 不使用 PDF page label，不读取页面上印刷的页码，不处理封面、目录、罗马数字或正文页偏移。
4. 不做文本层抽取、不做 OCR、不判断 PDF 类型；所有页面都渲染成图片后阅读。
5. 页码必须是正整数、逗号列表或闭区间，例如 `1`、`2,5`、`3-6`。页码越界或格式错误时停止。
6. 阅读完成后删除本次渲染目录。

## 操作流程

1. 从用户请求中提取 PDF 路径和页码。
2. 运行渲染脚本：

```bash
python skills/pdf-page-vision-reader/scripts/render_pdf_pages.py render --pdf "/path/to/file.pdf" --pages "2,4-5"
```

需要更清晰的小字或表格时提高 DPI：

```bash
python skills/pdf-page-vision-reader/scripts/render_pdf_pages.py render --pdf "/path/to/file.pdf" --pages "2" --dpi 400
```

3. 根据脚本输出的 `pages[].image_path` 逐张查看图片并理解内容。
4. 回答用户当前问题。按用户问题组织答案，不套固定模板。
5. 阅读完成后运行脚本输出的 `cleanup_command` 删除临时图片。

## 脚本说明

渲染输出默认位于本 skill 的 `.tmp/` 下。该目录只保存本次运行需要的页面图片和 `manifest.json`，用完必须清理。

清理命令格式：

```bash
python skills/pdf-page-vision-reader/scripts/render_pdf_pages.py cleanup --dir "/absolute/path/to/skills/pdf-page-vision-reader/.tmp/run-..."
```

## 常见停止条件

- 用户没有给页码。
- PDF 路径不存在或不是文件。
- 页码不是正整数、范围倒置、重复或超出 PDF 页数。
- PDF 加密且用户没有提供可用密码。
- 当前 Python 环境缺少 PyMuPDF。

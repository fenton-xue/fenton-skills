---
name: ones
description: "Use when 用户需要通过 ones-mcp-tools MCP Server 查找或新增/更新 ONES 测试用例，或读取/导出 ONES Wiki 链接、处理 Wiki 导出图片、把 Markdown 导入为 Wiki 子页面。"
---

# ONES MCP 工具

本 skill 用于根据用户意图选择对应参考文件。当前 `ones-mcp-tools` MCP Server 暴露 5 个工具。

核心职责边界：MCP 是 ONES 接口适配层，负责稳定工具、认证、接口调用、错误返回、缓存读写和最小必要的 URL 解析；SKILL 是工作流/语义转换层，负责把用户自然语言或本地测试用例数据转换、补全、追问成 MCP 入参。

## 测试用例

读取 `references/testcase.md`，当用户提到：

- 按 ONES 用例 ID、编号、`uuid` 或 `key` 查找测试用例
- 通过测试用例模块 URL 和用例名称查找用例
- 新增或更新单条测试用例
- 测试步骤、预期结果、模块 URL、模块路径、`library_id`

## Wiki

读取 `references/wiki.md`，当用户提到：

- 通过 ONES Wiki 页面链接读取页面
- 把 Wiki 页面导出为本地 Markdown 文件
- 处理 Wiki 导出图片资源
- 在指定父 Wiki 页面下导入 Markdown，新建协同 Wiki 子页面

# fenton-skills

个人 Codex skills 集合仓库。

本仓库按多 skill 集合方式组织，每个 skill 放在 `skills/<skill-name>/` 下，并包含独立的 `SKILL.md`、脚本、参考资料或元数据。

## 安装

按需安装单个 skill：

```bash
npx skills add https://github.com/fenton-xue/fenton-skills --skill <skill-name>
```

示例：

```bash
npx skills add https://github.com/fenton-xue/fenton-skills --skill weekly-report
```

## Skill 列表

| Skill | 用途 |
| --- | --- |
| `link-skill` | 将本仓库中的 skill 文件夹通过 Junction 链接部署到其他项目。 |
| `ones` | 通过 `ones-mcp-tools` MCP Server 查找、新增或更新 ONES 测试用例，并处理 ONES Wiki 读取和导入。 |
| `test-func-doc-generator` | 根据需求文档和测试用例文档生成面向测试工程师的测试功能文档。 |
| `testcase-generator` | 根据需求文档生成黑盒功能测试用例，并支持转换为 XMind 可导入 Markdown。 |
| `thread-orchestrator` | 通过主线程统筹多个 Codex 线程，拆解任务、分派工作线程，并按需接入审查线程。 |
| `weekly-report` | 从 Google Calendar 需求排期生成测试周报填写内容，优先输出可复制到表格的 CSV。 |

## 目录结构

```text
skills/
  <skill-name>/
    SKILL.md
    agents/
    references/
    scripts/
```

其中只有 `SKILL.md` 是必需文件；`agents/`、`references/`、`scripts/` 按 skill 实际需要添加。

## 维护约定

- 新 skill 放在 `skills/<skill-name>/`。
- skill 名称使用小写字母、数字和连字符。
- `SKILL.md` 使用 UTF-8 编码。
- 脚本和文档默认使用 LF 换行，由 `.gitattributes` 统一控制。

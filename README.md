# fenton-skills

Skills 集合。

## 安装命令

按需安装单个 skill：

```bash
npx skills add https://github.com/fenton-xue/fenton-skills --skill <skill-name>
```

## Skill 列表

### thread-orchestrator

通过主线程统筹多个 Codex 线程，将任务拆解给工作线程执行，并按需由审查线程检查成果。

```bash
npx skills add https://github.com/fenton-xue/fenton-skills --skill thread-orchestrator
```

### weekly-report

根据 Google Calendar 需求排期生成测试周报填写内容。

```bash
npx skills add https://github.com/fenton-xue/fenton-skills --skill weekly-report
```

### link-skill

将本项目中的 skill 文件夹通过目录联接部署到其他项目。

```bash
npx skills add https://github.com/fenton-xue/fenton-skills --skill link-skill
```

### ones

通过 ones-mcp-tools MCP Server 查找或新增/更新 ONES 测试用例，或读取 ONES Wiki 链接、把 Markdown 导入为 Wiki 子页面。

```bash
npx skills add https://github.com/fenton-xue/fenton-skills --skill ones
```

### testcase-generator

根据需求文档生成黑盒功能测试用例。

```bash
npx skills add https://github.com/fenton-xue/fenton-skills --skill testcase-generator
```

### test-func-doc-generator

根据需求文档和测试用例文档生成测试功能文档。

```bash
npx skills add https://github.com/fenton-xue/fenton-skills --skill test-func-doc-generator
```

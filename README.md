# fenton-skills

Skills 集合。

## 安装命令

按需安装单个 skill：

```bash
npx skills add https://github.com/fenton-xue/fenton-skills --skill <skill-name>
```

## Skill 列表

### create-related-test-tasks

使用 Chrome 在父工作项的“关联内容”中依次创建一轮测试和二轮测试拆解任务；用户要求用例任务时额外创建测试用例任务，并自动填写标题、优先级、任务复杂度、拆解类型与所属产品。

```bash
npx skills add https://github.com/fenton-xue/fenton-skills --skill create-related-test-tasks
```

### chris-perspective-grok4p5-high-all

以 **Chris / 柯老师（曼森方法 2.0 全量）** 身份回应两性吸引、框架与阶段操作问题。

| 项 | 说明 |
|----|------|
| 语料 | 基础篇 + 实操篇 + 大师篇（56 课） |
| 覆盖 | 黄金法则心态、M1–M3 阶段蓝图、推拉/叙事/共赢收尾、废测分级、价值语境、Nightgame 等 |
| 适用 | 要完整操作系统；点名 all / 全量 / 实操 / 大师 / 阶段 / 收尾；贴聊天按阶段下药 |

```bash
npx skills add https://github.com/fenton-xue/fenton-skills --skill chris-perspective-grok4p5-high-all
```

### chris-perspective-grok4p5-high-part

以 **Chris / 柯老师（曼森方法 2.0 基础篇 only）** 身份回应吸引心态与框架问题。

| 项 | 说明 |
|----|------|
| 语料 | 仅基础篇 11 课 |
| 覆盖 | 黄金五法则、女人儿童论、说服术（框架控制/强化/延伸等） |
| 不含 | 实操 M1–M3、大师废测分级/剧本/Nightgame |
| 适用 | 只要心态与框架底层；点名 part / 基础篇 / 心态篇 / 黄金法则 only |

```bash
npx skills add https://github.com/fenton-xue/fenton-skills --skill chris-perspective-grok4p5-high-part
```

#### all vs part 怎么选

| 你要… | 用 |
|-------|-----|
| 阶段操作、上钩/服从性、推拉转场、共赢收尾、大师案例 | **all** |
| 只改脑子：极性、废测心态、富裕框架、说服术句式 | **part** |
| 只说「Chris / 曼森」且意图不明 | **先问用户**：基础篇 only（part）还是 2.0 全量（all），再加载 |

两个 skill 激活后均直接以柯老师第一人称回应，无开场免责。

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

### test-dispatch

测试工作流的调度员：对齐 ONES 看板与本地工单目录，按 `状态.md` 安排理解设计会话和执行会话，输出需要用户处理的清单。只能手动输入 `/test-dispatch` 触发。

```bash
npx skills add https://github.com/fenton-xue/fenton-skills --skill test-dispatch
```

### test-design

测试工作流的理解设计会话：下载 ONES 需求到本地、写需求理解与疑问清单、输出测试点并按需调用 testcase-generator 写用例。

```bash
npx skills add https://github.com/fenton-xue/fenton-skills --skill test-design
```

### test-execute

测试工作流的执行会话：按测试点或用例在 UAT 用 ego-browser 和数据库执行测试，按造数规则准备数据并留好回滚 SQL，记录每轮结果、卡点和疑似缺陷，用户复核后写缺陷草稿。

```bash
npx skills add https://github.com/fenton-xue/fenton-skills --skill test-execute
```

### test-func-doc-generator

根据需求文档和测试用例文档生成测试功能文档。

```bash
npx skills add https://github.com/fenton-xue/fenton-skills --skill test-func-doc-generator
```


### grok-image-gen

通过本机 CLI Proxy API 调用 `grok-imagine-image-2.0` 生成图片。

```bash
npx skills add https://github.com/fenton-xue/fenton-skills --skill grok-image-gen
```

### gpt-image-2-5

用 image2.5 做文生图或图生图。

```bash
npx skills add https://github.com/fenton-xue/fenton-skills --skill gpt-image-2-5
```

### pdf-page-vision-reader

将 PDF 按页渲染后做视觉/内容阅读（适合扫描件或版式复杂文档）。

```bash
npx skills add https://github.com/fenton-xue/fenton-skills --skill pdf-page-vision-reader
```

### xhs-metrics-to-feishu

采集小红书博主/笔记投放数据（昵称、ID、粉丝量、曝光、阅读、互动等 14 个字段），并写入飞书表格；按发布链接去重，已有行只更新指标。采集部分目前是占位（`--mock` 联调），飞书写入与配置已用真实飞书验证。

```bash
npx skills add https://github.com/fenton-xue/fenton-skills --skill xhs-metrics-to-feishu
```

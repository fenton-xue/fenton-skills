---
name: xhs-metrics-to-feishu
description: 采集小红书博主/笔记的投放数据（昵称、ID、粉丝量、类型、主页链接、发布链接、发布时间、曝光、阅读、点赞、收藏、评论、转发、总互动），并写入飞书表格；按「发布链接」去重，已存在的行只更新指标。当用户提到小红书数据回填、笔记数据同步、把小红书数据写到飞书表格时使用。
---

# 小红书数据 → 飞书表格

两段式流程：**第一段**用脚本拿到结构化数据（JSON），**第二段**用脚本把 JSON 写进飞书表格。两段之间只通过 JSON 文件对接，互不依赖。

## 数据契约（两段共用）

一条记录对应一篇笔记，字段名即飞书表头，共 14 个，完整定义见 [references/schema.md](references/schema.md)：

小红书昵称 / ID / 粉丝量（W） / 类型 / 主页链接 / 发布链接 / 发布时间 / 曝光量 / 阅读量 / 点赞 / 收藏 / 评论 / 转发 / 总互动

第一段的输出必须是 JSON 数组，每个元素是以上述 14 个字段名为键的对象。

## 第一段：采集（待补充）

> TODO：用户补充。需要写清楚：
> 1. 脚本入口与参数（例如输入是博主主页链接列表还是笔记链接列表）
> 2. 登录态/Cookie 从哪里取
> 3. 失败与限流时的处理方式
>
> 脚本放在 `scripts/fetch_xhs.py`。目前该文件是**占位实现**：`--mock` 输出 3 条模拟数据，不带 `--mock` 会报未实现。替换其中的 `fetch_real()` 即可，输出格式不要变。

```bash
agent-python scripts/fetch_xhs.py --mock --output /tmp/xhs.json
```

## 第二段：写入飞书表格

脚本：`scripts/feishu_sheet.py`，只依赖 Python 标准库。

### 前置条件

飞书侧的完整操作（建应用、开权限、发布、建表、授权）已用 ego-browser 实操跑通，步骤、坑和本次实例见 [references/feishu-runbook.md](references/feishu-runbook.md)：

- 换账号/企业：走 runbook 全部 9 步
- 同一应用换新表格：只做 runbook 第 6–8 步（新建表格、取 token、把应用加为可编辑协作者）

凭证只通过环境变量 `FEISHU_APP_ID` / `FEISHU_APP_SECRET` 提供（本机写在 `~/.zshrc`，新开终端生效）；也可临时用 `--env-file` 指向一个 `export KEY=VALUE` 格式的文件。Secret 不要写进对话、文档或仓库。`--spreadsheet` 传表格自身的 token（runbook 第 7 步取得），不要传 `/wiki/` 节点。

### 执行步骤

1. 先只做本地校验，不碰网络，确认字段齐全、数值可解析：

   ```bash
   agent-python scripts/feishu_sheet.py --input /tmp/xhs.json --validate-only
   ```

2. 干跑：真实读取飞书表格，打印将新增/更新多少行，但不写入：

   ```bash
   agent-python scripts/feishu_sheet.py --input /tmp/xhs.json \
     --spreadsheet "https://xxx.feishu.cn/sheets/shtcnXXXX" --sheet "小红书数据" --dry-run
   ```

3. 确认计划无误后去掉 `--dry-run` 正式写入。

### 写入行为

- 按表头名定位列，不依赖列顺序；表头缺失任何一个字段会直接报错，不会猜。
- 表头为空的新表会自动写入 14 个表头。
- 以「发布链接」为键：不存在 → 追加新行；已存在 → 只覆盖这 14 个字段所在的单元格，表里手动加的其他列不会被动。`--on-duplicate skip` 可改为跳过。
- 「主页链接」「发布链接」写成可点击的超链接；ID 一律按文本写，避免长数字被转成科学计数。
- 输出一行 JSON 汇总：`{"appended": n, "updated": n, "skipped": n, ...}`。

## 失败排查

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| `99991663` / `99991661` | token 无效 | 检查 `FEISHU_APP_ID` / `FEISHU_APP_SECRET` |
| `91403` / `403 Forbidden` | 应用不是该表格的协作者 | 表格右上角「分享」，搜应用名，授予「可编辑」（runbook 第 8 步） |
| `90202` range in request is wrong | 追加时 range 行数小于写入行数 | 脚本已处理；若自改代码需保持 range 行数 ≥ 写入行数 |
| 分享面板搜不到应用 | 未加机器人能力或版本未发布 | runbook 第 3、4 步 |
| `1310213` / 权限不足 | 应用没开通表格权限 | 开发者后台开通 `sheets:spreadsheet`，并发布版本 |
| `wiki` 链接解析失败 | 表格在知识库里 | 需额外开通 `wiki:wiki:readonly`，或改传表格自身的 `/sheets/` 链接 |
| 表头缺失报错 | 表头与契约不一致 | 对照 references/schema.md 改表头 |

## 目录

```
xhs-metrics-to-feishu/
├── SKILL.md
├── scripts/
│   ├── fetch_xhs.py        # 第一段：采集（当前为占位 + 模拟数据）
│   └── feishu_sheet.py     # 第二段：写飞书表格
├── references/
│   ├── schema.md           # 字段契约
│   ├── feishu-runbook.md   # 飞书侧实操手册（已验证）+ 本次实例 + 验证记录
│   ├── pitfalls.md         # 踩坑与修复记录 + 假设核对表（新坑追加到这里）
│   └── feishu-setup.md     # 飞书配置概要与接口清单
└── tests/
    ├── e2e_fake_feishu.py  # 用本地假飞书服务验证写入逻辑
    └── fixtures/
        └── xhs-mock.json   # fetch_xhs.py --mock 生成的 3 条模拟数据
```

## 维护约定

- 遇到新问题先记入 [references/pitfalls.md](references/pitfalls.md)，再改代码
- 改了接口行为相关的逻辑，同步更新 `tests/e2e_fake_feishu.py`；假服务通过不等于飞书接受，放量前先小批量真实写入
- 本 skill 的所有记录都在本目录内，交接时整目录带走

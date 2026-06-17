---
name: weekly-report
description: 生成测试周报填写内容。用于用户要求“生成周报”“写周报”“本周工作内容”“下周工作计划”“双周计划”“腾讯文档周报/测试三组周报模板”时，从 Google Calendar 需求排期获取活动，并通过 Chrome 插件查看日历页面颜色来区分编写用例、初测、复测阶段，计算进度、预计上线时间，并优先输出本地 CSV 文件，便于复制粘贴到表格。
---

# 测试周报生成

## 概述

根据 Google Calendar 需求排期生成本地周报草稿。默认产物是 UTF-8 编码的 CSV 文件，用户可以打开后复制到微信/腾讯文档表格；Markdown 仅作为调试阅读格式。

## 工作流程

1. 计算周报前先读取 `references/weekly-report-rules.md`。
2. 按 `Asia/Shanghai` 时区确定 `today`。用户未指定日期时，使用当前对话日期。
3. 从 Google Calendar 获取本周周一到下下周周五范围内的活动标题、开始日期、结束日期。
4. 使用 Chrome 插件打开或接管 Google Calendar 页面，通过 `scripts/extract_calendar_event_colors.mjs` 提取同一批活动的颜色并补充阶段。不要根据活动标题推断阶段。
5. 日历原始数据不需要留存；优先在内存中处理，或通过 `--input -` 从标准输入传给脚本。
6. 如果因工具限制必须写临时输入文件，生成周报后立即删除该临时文件。
7. 运行 `scripts/generate_weekly_report.py` 生成可复制的 CSV 周报草稿。
8. 回复用户生成文件路径，并提醒哪些空值需要用户自行补充。

## 日历数据要求

Google Calendar 连接器只用于读取活动排期：

- 查询范围必须有边界：本周周一 `00:00:00+08:00` 到下下周周五次日 `00:00:00+08:00`。
- 读取活动标题、开始日期、结束日期。
- 不依赖 Google Calendar 连接器返回颜色；当前连接器拿不到可靠事件颜色。

颜色必须通过 Chrome 插件和脚本补充：

- 打开同一时间范围的 Google Calendar 周视图或月视图。
- 调用 `scripts/extract_calendar_event_colors.mjs`，传入 Google Calendar 连接器读取到的活动数组。
- 脚本会提取页面元素颜色，并把过往活动的低亮度颜色归一化为原始颜色类别。
- 跨月或跨周活动不要拆成多条让模型拼接；以 Google Calendar 连接器的开始/结束日期为准，脚本只负责从 Chrome 插件页面补颜色，并按事件 ID 或日期重叠匹配回原活动。
- 如果同一工单存在多个阶段，而页面元素缺少可匹配的事件 ID 和日期范围，脚本不能把无日期颜色强行套到阶段上，应停止并要求人工补充颜色/阶段。
- 如果脚本无法识别颜色，停止生成并要求用户手动补充颜色/阶段。没有颜色时不能可靠区分阶段。

默认活动颜色映射：

- `8` / 石墨黑 / `#e1e1e1` = 编写用例
- `9` / 孔雀蓝 / `#5484ed` = 初测
- `10` / 鼠尾草绿 / `#51b749` = 复测

## 输入 JSON

创建 UTF-8 JSON，结构示例：

```json
{
  "today": "2026-05-29",
  "owner": "薛丰推",
  "holidays": ["2026-06-10"],
  "events": [
    {
      "summary": "#89608 海运系统消息中心搭建",
      "start": "2026-05-25T00:00:00",
      "end": "2026-05-30T00:00:00",
      "backgroundColor": "#e1e1e1"
    }
  ]
}
```

可识别字段别名：

- 标题：`summary`、`title`、`display_title`
- 颜色：`color_id`、`colorId`、`color`、`color_name`、`颜色`、`color_hex`、`colorHex`、`background`、`backgroundColor`、`background_color`、`borderColor`、`css_color`、`颜色值`
- 阶段：`stage`、`阶段`。仅当阶段已经由颜色推导或由用户明确提供时才使用。

## 脚本用法

先用 Chrome 插件接管的 Google Calendar 页面运行取色脚本，为日历活动补充颜色：

```js
const mod = await import("D:/Workspace/FentonWorkspace/.agents/skills/weekly-report/scripts/extract_calendar_event_colors.mjs");
const colorEvents = await mod.extractCalendarEventColors(tab, { calendarEvents: googleCalendarEvents });
const weeklyReportEvents = mod.mergeCalendarEventsWithColors(googleCalendarEvents, colorEvents);
```

在工作区根目录运行：

```bash
python .agents/skills/weekly-report/scripts/generate_weekly_report.py --input - --output .agent/weekly-report/weekly-report-20260529.csv --format csv --no-summary
```

调试时如必须使用输入文件，文件只能临时放在 `.agent/weekly-report/`，生成周报后立即删除：

```bash
python .agents/skills/weekly-report/scripts/generate_weekly_report.py --input .agent/weekly-report/temp-events-20260529.json --output .agent/weekly-report/weekly-report-20260529.csv --format csv --no-summary
```

可选参数：

- 输出 CSV：`--format csv`。如果 `--output` 后缀是 `.csv`，不传该参数也会自动输出 CSV。
- 输出 Markdown/纯文本：`--format md`
- 增加占用工作日的节假日：`--holiday 2026-06-10 --holiday 2026-06-11`
- 指定生成日期：`--today 2026-05-29`
- 运行内置样例：`--demo`

## 输出规则

CSV 文件按区块组织：

1. `一. 本周工作内容`
2. `二. 下周工作计划`
3. `三. 双周计划`

本周和下周区块使用四列：`需求名称`、`负责人`、`进度`、`（预计）完成时间`。进度列中 `初测` 显示为 `UAT`，`复测` 显示为 `PRE`，其他逻辑不变。双周计划区块使用一列 `内容`。输出文件只放周报正文内容；空值需要补充时，在回复中提醒用户即可。

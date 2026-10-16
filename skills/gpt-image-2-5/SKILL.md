---
name: gpt-image-2-5
description: 用 image2.5 做文生图或图生图。用于用户要文生图、图生图、image2.5 或 image 2.5。不要用于 OpenAI imagegen、矢量/SVG/代码绘图，也不要生成视频。
---

# GPT Image 2.5

生图只运行本技能里的脚本。模型固定为 `gpt-image-2.5`。不要手写 curl，也不要另写请求代码。

## 前置

- 环境变量 `WOKEY_API_KEY`
- 当前进程没有该变量时，脚本会读取本机 shell 配置里的同名导出。不要自行打开或打印密钥
- 可用 `WOKEY_BASE_URL` 覆盖默认地址 `https://api.wokey.ai`

## 用法

1. 用户已有明确提示词，或双方沟通后确定了最终版本：把这个提示词原封不动传给脚本，不要改写、润色或补充。
2. 用户要画原型图，且没有确定提示词：由模型按自己的理解编写提示词。
3. 输出路径以用户明确指定的路径为准。用户没有指定时，文件必须放在当前工作目录内。没有工作目录时写到 `/tmp`。
4. 用 `agent-python` 运行脚本。当前项目由 uv 管理时改用 `uv run python`。不要用系统 `python` 或 `python3`。

文生图：

```bash
agent-python <skill_dir>/scripts/generate_image.py \
  --prompt "日出时安静的湖面" \
  --size 1536x1024 \
  --out "$PWD/lake.png"
```

图生图：

```bash
agent-python <skill_dir>/scripts/generate_image.py \
  --prompt "把天空改成紫色，并加一只猫" \
  --image "/abs/path/input.png" \
  --out "$PWD/edited.png"
```

5. 按脚本打印的 `paths` 把图片展示给用户，并报告最终保存路径。
6. 输出文件已存在时脚本会拒绝覆盖。只有用户明确要求替换时才加 `--force`。

## 参数

| 参数 | 说明 |
|------|------|
| `--prompt` / `--prompt-file` | 提示词，必填其一 |
| `--out` | 输出文件的绝对路径。用户指定的路径优先；未指定时必须位于当前工作目录内，没有工作目录时用 `/tmp` |
| `--size` | `WIDTHxHEIGHT`，每边 128–4096。省略或 `auto` 时接口默认 `1024x1024` |
| `--image` | 参考图。传入后走图生图 |
| `--force` | 覆盖已有输出文件 |

常用尺寸：`1024x1024`、`1536x1024`、`1024x1536`。

## 边界

- 一次只生成 1 张，脚本使用同步接口并直接保存 `b64_json`。
- 请求超时或网关 5xx 后不要立刻用相同参数重试，以免重复计费。
- 视频、OpenAI imagegen、矢量或代码绘图不走这个技能。

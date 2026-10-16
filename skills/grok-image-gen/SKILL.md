---
name: grok-image-gen
description: 通过本机 CLI Proxy API 调用 grok-imagine-image-2.0 生成图片。用于用户要 Grok Imagine / grok-imagine-image-2.0 出图，或明确走 CLI Proxy 生图。不要用于 OpenAI gpt-image、矢量/SVG/代码绘图，也不要生成视频。
---

# Grok Image Gen

用捆绑脚本调用本机 CLI Proxy 的 `POST /v1/images/generations`，模型固定为 `grok-imagine-image-2.0`。不要手写一次性 curl/SDK。

## 前置条件

- CLI Proxy 已在本机运行，默认 `http://127.0.0.1:8317/v1`
- 认证读取 `CLIPROXY_API_KEY` 或 `OPENAI_API_KEY`；都未设置时使用本机 CLI Proxy `config.yaml` 的 `api-keys`（当前为 `123456`）
- 可用 `CLIPROXY_BASE_URL` 覆盖默认地址

## 操作

1. 整理用户的出图描述。用户已经写得很具体时只做规范化，不要添戏。
2. 确定输出路径：用户指定了就用指定路径；否则写到当前工作区的可交付目录。
3. 用当前环境的 Python 运行脚本（`agent-python` 或 `uv run python`，不要用系统 `python`/`python3`）：

```bash
agent-python <skill_dir>/scripts/generate_image.py --prompt "一只陶瓷咖啡杯的产品照片" --out "/abs/path/coffee.png"
```

常用可选参数：

```bash
agent-python <skill_dir>/scripts/generate_image.py \
  --prompt "日出时的山地风景" \
  --aspect-ratio 16:9 \
  --resolution 2k \
  --quality low \
  --n 1 \
  --out "/abs/path/mountain.jpg"
```

4. 根据脚本打印的 `paths` 把图片展示给用户，并报告最终保存路径。
5. 不要覆盖已有文件，除非用户明确要求替换。

## 参数

| 参数 | 说明 |
|------|------|
| `--prompt` / `--prompt-file` | 出图描述，必填其一 |
| `--out` | 输出文件路径。`n>1` 时写成 `name-1.ext`、`name-2.ext` |
| `--n` | 同提示词的变体数量，1–10，默认 1 |
| `--aspect-ratio` | `1:1`、`16:9`、`9:16`、`4:3`、`3:4`、`3:2`、`2:3`、`2:1`、`1:2`、`19.5:9`、`9:19.5`、`20:9`、`9:20`、`21:9`、`5:2`、`auto`。省略则让模型自选 |
| `--resolution` | `1k`（默认）、`2k`、`1.5k` |
| `--quality` | 仅此模型支持：`low`、`medium`、`auto`（默认） |
| `--response-format` | 默认 `b64_json`，便于直接落盘 |

## 边界

- 编辑已有图片、多图参考、视频生成都不走这个 skill。
- 普通 OpenAI 位图生成走 `imagegen`，不要切到这里。

#!/usr/bin/env python3
"""通过 CLI Proxy API 调用 grok-imagine-image-2.0 生成图片。"""

from __future__ import annotations

import argparse
import base64
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

DEFAULT_BASE_URL = "http://127.0.0.1:8317/v1"
DEFAULT_API_KEY = "123456"
DEFAULT_MODEL = "grok-imagine-image-2.0"
ASPECT_RATIOS = (
    "1:1",
    "3:4",
    "4:3",
    "9:16",
    "16:9",
    "2:3",
    "3:2",
    "9:19.5",
    "19.5:9",
    "9:20",
    "20:9",
    "1:2",
    "2:1",
    "21:9",
    "5:2",
    "auto",
)
RESOLUTIONS = ("1k", "2k", "1.5k")
QUALITIES = ("low", "medium", "auto")
RESPONSE_FORMATS = ("url", "b64_json")
MAGIC_TYPES = (
    (b"\x89PNG\r\n\x1a\n", "image/png", ".png"),
    (b"\xff\xd8\xff", "image/jpeg", ".jpg"),
    (b"RIFF", "image/webp", ".webp"),
)


class UserError(Exception):
    """面向使用者的可解释错误。"""


def die(message: str, code: int = 1) -> None:
    print(message, file=sys.stderr)
    raise SystemExit(code)


def read_prompt(prompt: str | None, prompt_file: str | None) -> str:
    if prompt and prompt_file:
        raise UserError("只能使用 --prompt 或 --prompt-file 之一。")
    if prompt_file:
        path = Path(prompt_file)
        if not path.is_file():
            raise UserError(f"找不到 prompt 文件：{path}")
        text = path.read_text(encoding="utf-8").strip()
        if not text:
            raise UserError("prompt 文件为空。")
        return text
    if prompt is not None:
        text = prompt.strip()
        if not text:
            raise UserError("prompt 不能为空。")
        return text
    raise UserError("必须提供 --prompt 或 --prompt-file。")


def resolve_api_key() -> str:
    for name in ("CLIPROXY_API_KEY", "OPENAI_API_KEY"):
        value = os.environ.get(name, "").strip()
        if value:
            return value
    return DEFAULT_API_KEY


def resolve_base_url() -> str:
    value = os.environ.get("CLIPROXY_BASE_URL", "").strip() or DEFAULT_BASE_URL
    return value.rstrip("/")


def guess_extension(image_bytes: bytes, mime_type: str | None) -> str:
    if mime_type:
        mapping = {
            "image/png": ".png",
            "image/jpeg": ".jpg",
            "image/jpg": ".jpg",
            "image/webp": ".webp",
        }
        if mime_type.lower() in mapping:
            return mapping[mime_type.lower()]
    for magic, _mime, ext in MAGIC_TYPES:
        if image_bytes.startswith(magic):
            if magic == b"RIFF" and image_bytes[8:12] != b"WEBP":
                continue
            return ext
    return ".jpg"


def output_paths(out: Path, count: int, ext: str) -> list[Path]:
    if count == 1:
        if out.suffix:
            return [out]
        return [out.with_suffix(ext)]
    stem = out.stem if out.suffix else out.name
    parent = out.parent
    return [parent / f"{stem}-{index}{ext}" for index in range(1, count + 1)]


def ensure_writable(paths: list[Path]) -> None:
    for path in paths:
        if path.exists():
            raise UserError(f"输出文件已存在，拒绝覆盖：{path}")
        path.parent.mkdir(parents=True, exist_ok=True)


def http_json(url: str, api_key: str, payload: dict) -> dict:
    body = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=body,
        method="POST",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=180) as response:
            raw = response.read()
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise UserError(f"CLI Proxy 返回 HTTP {exc.code}：{detail}") from exc
    except urllib.error.URLError as exc:
        raise UserError(
            f"无法连接 CLI Proxy（{url}）：{exc.reason}。请确认本机服务已启动。"
        ) from exc
    try:
        data = json.loads(raw.decode("utf-8"))
    except json.JSONDecodeError as exc:
        raise UserError("CLI Proxy 返回了无法解析的 JSON。") from exc
    if not isinstance(data, dict):
        raise UserError("CLI Proxy 返回格式无效。")
    return data


def download_url(url: str) -> bytes:
    request = urllib.request.Request(url, method="GET")
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            return response.read()
    except urllib.error.URLError as exc:
        raise UserError(f"下载生成图片失败：{url}") from exc


def extract_image(item: dict, response_format: str) -> tuple[bytes, str | None]:
    mime_type = item.get("mime_type")
    if response_format == "b64_json":
        encoded = item.get("b64_json")
        if not encoded:
            raise UserError("响应缺少 b64_json。")
        try:
            return base64.b64decode(encoded), mime_type
        except Exception as exc:  # noqa: BLE001
            raise UserError("无法解码 b64_json。") from exc
    url = item.get("url")
    if not url:
        raise UserError("响应缺少 url。")
    return download_url(url), mime_type


def build_payload(args: argparse.Namespace, prompt: str) -> dict:
    payload: dict = {
        "model": DEFAULT_MODEL,
        "prompt": prompt,
        "n": args.n,
        "response_format": args.response_format,
    }
    if args.aspect_ratio:
        payload["aspect_ratio"] = args.aspect_ratio
    if args.resolution:
        payload["resolution"] = args.resolution
    if args.quality:
        payload["quality"] = args.quality
    return payload


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="通过 CLI Proxy API 调用 grok-imagine-image-2.0 生成图片。"
    )
    parser.add_argument("--prompt", help="出图描述")
    parser.add_argument("--prompt-file", help="从文件读取出图描述")
    parser.add_argument("--out", required=True, help="输出文件路径")
    parser.add_argument("--n", type=int, default=1, help="变体数量，1-10，默认 1")
    parser.add_argument("--aspect-ratio", choices=ASPECT_RATIOS)
    parser.add_argument("--resolution", choices=RESOLUTIONS, default="1k")
    parser.add_argument("--quality", choices=QUALITIES, default="auto")
    parser.add_argument(
        "--response-format",
        choices=RESPONSE_FORMATS,
        default="b64_json",
    )
    parser.add_argument(
        "--print-request",
        action="store_true",
        help="只打印请求体，不实际调用 API",
    )
    args = parser.parse_args(argv)
    if args.n < 1 or args.n > 10:
        parser.error("--n 必须在 1 到 10 之间")
    return args


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        prompt = read_prompt(args.prompt, args.prompt_file)
        payload = build_payload(args, prompt)
        if args.print_request:
            print(json.dumps(payload, ensure_ascii=False, indent=2))
            return 0

        base_url = resolve_base_url()
        api_key = resolve_api_key()
        result = http_json(f"{base_url}/images/generations", api_key, payload)
        items = result.get("data")
        if not isinstance(items, list) or not items:
            raise UserError("响应中没有 data 图片列表。")
        if len(items) != args.n:
            raise UserError(f"请求 {args.n} 张，实际返回 {len(items)} 张。")

        first_bytes, first_mime = extract_image(items[0], args.response_format)
        ext = guess_extension(first_bytes, first_mime)
        paths = output_paths(Path(args.out).expanduser().resolve(), len(items), ext)
        ensure_writable(paths)

        saved: list[str] = []
        for index, (item, path) in enumerate(zip(items, paths)):
            image_bytes, mime_type = (
                (first_bytes, first_mime)
                if index == 0
                else extract_image(item, args.response_format)
            )
            if path.suffix.lower() not in {".png", ".jpg", ".jpeg", ".webp"}:
                path = path.with_suffix(guess_extension(image_bytes, mime_type))
                if path.exists():
                    raise UserError(f"输出文件已存在，拒绝覆盖：{path}")
            path.write_bytes(image_bytes)
            saved.append(str(path))

        print(
            json.dumps(
                {
                    "model": DEFAULT_MODEL,
                    "count": len(saved),
                    "paths": saved,
                },
                ensure_ascii=False,
                indent=2,
            )
        )
        return 0
    except UserError as exc:
        die(str(exc))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

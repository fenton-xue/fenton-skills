#!/usr/bin/env python3
"""通过 Wokey 图片生成 API 调用 gpt-image-2.5。"""

from __future__ import annotations

import argparse
import base64
import json
import os
import re
import sys
import urllib.error
import urllib.request
import uuid
from pathlib import Path

DEFAULT_BASE_URL = "https://api.wokey.ai"
DEFAULT_MODEL = "gpt-image-2.5"
IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".gif"}
SIZE_RE = re.compile(r"^(\d+)x(\d+)$", re.IGNORECASE)


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


def normalize_size(size: str | None) -> str | None:
    if size is None:
        return None
    text = size.strip()
    if not text:
        return None
    if text.lower() == "auto":
        return "auto"
    match = SIZE_RE.fullmatch(text)
    if not match:
        raise UserError("size 必须是 WIDTHxHEIGHT 或 auto，例如 1536x1024。")
    width, height = int(match.group(1)), int(match.group(2))
    if not (128 <= width <= 4096 and 128 <= height <= 4096):
        raise UserError("size 的每一边必须在 128 到 4096 像素之间。")
    return f"{width}x{height}"


def resolve_base_url() -> str:
    value = os.environ.get("WOKEY_BASE_URL", "").strip() or DEFAULT_BASE_URL
    value = value.rstrip("/")
    if value.endswith("/v1"):
        value = value[:-3]
    if not value.startswith(("http://", "https://")):
        raise UserError("WOKEY_BASE_URL 必须是 http 或 https 地址。")
    return value


def resolve_api_key() -> str:
    value = os.environ.get("WOKEY_API_KEY", "").strip()
    if value:
        return value
    value = shell_api_key()
    if value:
        return value
    raise UserError("未设置 WOKEY_API_KEY。")


def parse_assignment(raw: str) -> str:
    text = raw.strip()
    if not text:
        return ""
    if text[0] in {'"', "'"}:
        quote = text[0]
        end = text.find(quote, 1)
        if end < 0:
            return ""
        return text[1:end].strip()
    token = text.split()[0]
    if token.startswith("#") or any(char in token for char in "$`"):
        return ""
    return token


def shell_api_key() -> str:
    home = Path.home()
    paths = (
        home / ".zshenv",
        home / ".zprofile",
        home / ".zshrc",
        home / ".bash_profile",
        home / ".bashrc",
        home / ".profile",
    )
    found = ""
    for path in paths:
        if not path.is_file():
            continue
        try:
            lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
        except OSError:
            continue
        for line in lines:
            stripped = line.strip()
            if not stripped or stripped.startswith("#"):
                continue
            if stripped.startswith("export "):
                stripped = stripped[len("export ") :].strip()
            if not stripped.startswith("WOKEY_API_KEY="):
                continue
            value = parse_assignment(stripped.split("=", 1)[1])
            if value:
                found = value
    return found


def sniff_image(image_bytes: bytes) -> tuple[str, str]:
    if image_bytes.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png", ".png"
    if image_bytes.startswith(b"\xff\xd8\xff"):
        return "image/jpeg", ".jpg"
    if image_bytes.startswith(b"GIF87a") or image_bytes.startswith(b"GIF89a"):
        return "image/gif", ".gif"
    if image_bytes.startswith(b"RIFF") and image_bytes[8:12] == b"WEBP":
        return "image/webp", ".webp"
    raise UserError("图片必须是 PNG、JPEG、WEBP 或 GIF。")


def compatible_extension(path: Path, detected: str) -> bool:
    suffix = path.suffix.lower()
    if suffix == detected:
        return True
    return suffix == ".jpeg" and detected == ".jpg"


def output_path(out: Path, detected: str) -> Path:
    if out.suffix.lower() in IMAGE_EXTENSIONS and compatible_extension(out, detected):
        return out
    if out.suffix.lower() in IMAGE_EXTENSIONS:
        return out.with_suffix(detected)
    if out.suffix:
        return out.with_suffix(detected)
    return Path(str(out) + detected)


def ensure_parent(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)


def refuse_existing(path: Path, force: bool) -> None:
    if path.exists() and not force:
        raise UserError(f"输出文件已存在，拒绝覆盖：{path}")
    if path.exists() and path.is_dir():
        raise UserError(f"输出路径是目录：{path}")


def decode_b64(value: str) -> bytes:
    cleaned = "".join(value.split())
    padding = (-len(cleaned)) % 4
    try:
        return base64.b64decode(cleaned + ("=" * padding), validate=False)
    except Exception as exc:  # noqa: BLE001
        raise UserError("无法解码 b64_json。") from exc


def error_message(payload: object) -> str:
    if not isinstance(payload, dict):
        return ""
    error = payload.get("error")
    if isinstance(error, dict):
        message = error.get("message") or error.get("code") or ""
        return str(message)
    if isinstance(error, str):
        return error
    return ""


def request_json(url: str, api_key: str, payload: dict) -> dict:
    body = json.dumps(payload).encode("utf-8")
    return perform_request(
        url,
        api_key,
        body,
        {"Content-Type": "application/json"},
    )


def encode_multipart(
    fields: list[tuple[str, str]],
    filename: str,
    mime: str,
    content: bytes,
) -> tuple[bytes, str]:
    boundary = f"----gptimage{uuid.uuid4().hex}"
    chunks: list[bytes] = []
    for name, value in fields:
        chunks.append(
            (
                f"--{boundary}\r\n"
                f'Content-Disposition: form-data; name="{name}"\r\n\r\n'
                f"{value}\r\n"
            ).encode("utf-8")
        )
    safe_name = Path(filename).name.replace('"', "").replace("\r", "").replace("\n", "")
    chunks.append(
        (
            f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="image"; filename="{safe_name}"\r\n'
            f"Content-Type: {mime}\r\n\r\n"
        ).encode("utf-8")
        + content
        + b"\r\n"
    )
    chunks.append(f"--{boundary}--\r\n".encode("utf-8"))
    return b"".join(chunks), boundary


def perform_request(url: str, api_key: str, body: bytes, headers: dict[str, str]) -> dict:
    request = urllib.request.Request(
        url,
        data=body,
        method="POST",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Accept": "application/json",
            **headers,
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=300) as response:
            raw = response.read()
            status = response.status
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")[:2000]
        message = f"Wokey 返回 HTTP {exc.code}：{detail}"
        if exc.code in {429, 500, 502, 503, 504, 529}:
            message += " 不要立刻用相同参数重试，以免重复计费。"
        raise UserError(message) from exc
    except TimeoutError as exc:
        raise UserError("请求超时。不要立刻用相同参数重试，以免重复计费。") from exc
    except urllib.error.URLError as exc:
        if isinstance(exc.reason, TimeoutError):
            raise UserError("请求超时。不要立刻用相同参数重试，以免重复计费。") from exc
        raise UserError(f"无法连接 Wokey（{url}）：{exc.reason}") from exc

    if status == 202:
        raise UserError("接口返回了异步任务。这个脚本只处理同步图片结果，没有代为轮询。")
    try:
        data = json.loads(raw.decode("utf-8"))
    except json.JSONDecodeError as exc:
        raise UserError("Wokey 返回了无法解析的 JSON。") from exc
    if not isinstance(data, dict):
        raise UserError("Wokey 返回格式无效。")
    message = error_message(data)
    if message and "data" not in data:
        raise UserError(f"Wokey 返回错误：{message}")
    return data


def extract_image(data: dict) -> tuple[bytes, str | None]:
    items = data.get("data")
    if not isinstance(items, list) or not items or not isinstance(items[0], dict):
        raise UserError("响应中没有 data[0]。")
    item = items[0]
    encoded = item.get("b64_json")
    if not isinstance(encoded, str) or not encoded.strip():
        raise UserError("响应缺少 data[0].b64_json。")
    image_bytes = decode_b64(encoded)
    if not image_bytes:
        raise UserError("b64_json 解码后为空。")
    revised = item.get("revised_prompt")
    return image_bytes, revised if isinstance(revised, str) and revised else None


def build_generation(prompt: str, size: str | None) -> tuple[str, dict]:
    payload: dict = {"model": DEFAULT_MODEL, "prompt": prompt}
    if size:
        payload["size"] = size
    return "/v1/images/generations", payload


def read_reference(path_text: str) -> tuple[Path, bytes, str]:
    path = Path(path_text).expanduser()
    if not path.is_file():
        raise UserError(f"找不到参考图：{path}")
    content = path.read_bytes()
    mime, _ext = sniff_image(content)
    return path, content, mime


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="通过 Wokey 调用 gpt-image-2.5 生成图片。")
    parser.add_argument("--prompt", help="提示词")
    parser.add_argument("--prompt-file", help="从文件读取提示词")
    parser.add_argument("--out", required=True, help="输出文件路径")
    parser.add_argument("--size", help="WIDTHxHEIGHT 或 auto")
    parser.add_argument("--image", help="参考图路径。传入后改为图生图")
    parser.add_argument("--force", action="store_true", help="覆盖已有输出文件")
    parser.add_argument("--print-request", action="store_true", help="只打印请求，不调用 API")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        prompt = read_prompt(args.prompt, args.prompt_file)
        size = normalize_size(args.size)
        out = Path(args.out).expanduser().resolve()
        if out.exists() and out.is_dir():
            raise UserError(f"输出路径是目录：{out}")
        if not args.print_request:
            refuse_existing(out, args.force)

        base_url = resolve_base_url()
        if args.image:
            image_path, image_bytes, mime = read_reference(args.image)
            endpoint = "/v1/images/edits"
            fields = [("model", DEFAULT_MODEL), ("prompt", prompt)]
            if size:
                fields.append(("size", size))
            if args.print_request:
                print(
                    json.dumps(
                        {
                            "method": "POST",
                            "url": f"{base_url}{endpoint}",
                            "form": dict(fields),
                            "image": str(image_path),
                            "image_bytes": len(image_bytes),
                            "image_mime": mime,
                        },
                        ensure_ascii=False,
                        indent=2,
                    )
                )
                return 0
            body, boundary = encode_multipart(fields, image_path.name, mime, image_bytes)
            result = perform_request(
                f"{base_url}{endpoint}",
                resolve_api_key(),
                body,
                {"Content-Type": f"multipart/form-data; boundary={boundary}"},
            )
        else:
            endpoint, payload = build_generation(prompt, size)
            if args.print_request:
                print(
                    json.dumps(
                        {
                            "method": "POST",
                            "url": f"{base_url}{endpoint}",
                            "json": payload,
                        },
                        ensure_ascii=False,
                        indent=2,
                    )
                )
                return 0
            result = request_json(f"{base_url}{endpoint}", resolve_api_key(), payload)

        image_bytes, revised_prompt = extract_image(result)
        _mime, detected = sniff_image(image_bytes)
        saved = output_path(out, detected)
        refuse_existing(saved, args.force)
        ensure_parent(saved)
        saved.write_bytes(image_bytes)
        output = {
            "model": DEFAULT_MODEL,
            "endpoint": endpoint,
            "count": 1,
            "paths": [str(saved)],
        }
        if size:
            output["size"] = size
        if revised_prompt:
            output["revised_prompt"] = revised_prompt
        print(json.dumps(output, ensure_ascii=False, indent=2))
        return 0
    except UserError as exc:
        die(str(exc))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

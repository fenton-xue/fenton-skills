#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Post-process image references in Markdown files created from ONES Wiki query data.

The ONES MCP export tool is intentionally not used by this script. The expected
workflow is:

1. Call get_wiki_page_by_url.
2. Create a Markdown file from the returned page data.
3. Run this script on that Markdown file to download image resources and rewrite
   successful references to assets/<filename>.

The script is conservative: failed downloads keep the original Markdown reference
and are recorded in a JSON report next to the Markdown file.
"""
from __future__ import annotations

import argparse
import json
import re
import shutil
import sys
import time
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Iterable
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlparse
from urllib.request import Request, urlopen

IMAGE_RE = re.compile(r"!\[([^\]]*)\]\(([^)\s]+)(?:\s+\"[^\"]*\")?\)")
META_RE = re.compile(r"<!--\s*ones-([a-zA-Z0-9_-]+):\s*(.*?)\s*-->")
RAW_RESOURCE_RE = re.compile(r"^[A-Za-z0-9_-]+\.(?:png|jpe?g|gif|webp|bmp|svg)$", re.IGNORECASE)


@dataclass
class ImageResult:
    source: str
    target: str | None
    status: str
    candidates: list[str]
    error: str | None = None


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Download ONES Wiki image refs in a Markdown file and rewrite them to local assets."
    )
    parser.add_argument("markdown", help="Markdown file path to process")
    parser.add_argument("--wiki-url", help="Original ONES Wiki page URL. Can also be provided in a metadata comment.")
    parser.add_argument(
        "--token",
        help="ONES online_page.token from get_wiki_page_by_url.",
    )
    parser.add_argument(
        "--assets-dir",
        default="assets",
        help="Asset directory relative to the Markdown file. Default: assets",
    )
    parser.add_argument(
        "--resource-url-template",
        action="append",
        default=[],
        help=(
            "Extra download URL template. Supported placeholders: {scheme}, {host}, {team_id}, "
            "{space_id}, {page_id}, {ref_uuid}, {name}, {token}. May be passed multiple times."
        ),
    )
    parser.add_argument("--timeout", type=int, default=30, help="HTTP timeout seconds. Default: 30")
    parser.add_argument("--dry-run", action="store_true", help="Only report what would be processed; do not write files")
    parser.add_argument("--report", help="Report JSON path. Default: <markdown>.images.report.json")
    return parser.parse_args()


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def write_text(path: Path, text: str) -> None:
    path.write_text(text, encoding="utf-8", newline="\n")


def parse_meta(markdown_text: str) -> dict[str, str]:
    return {key.lower().replace("-", "_"): value.strip() for key, value in META_RE.findall(markdown_text)}


def parse_wiki_url(wiki_url: str | None) -> dict[str, str]:
    info = {"scheme": "https", "host": "", "team_id": "", "space_id": "", "page_id": "", "ref_uuid": ""}
    if not wiki_url:
        return info
    parsed = urlparse(wiki_url)
    if parsed.scheme:
        info["scheme"] = parsed.scheme
    info["host"] = parsed.netloc
    route = parsed.fragment or parsed.path
    parts = [part for part in route.strip("/").split("/") if part]
    for marker, target in (("team", "team_id"), ("space", "space_id"), ("page", "page_id")):
        if marker in parts:
            index = parts.index(marker)
            if index + 1 < len(parts):
                info[target] = parts[index + 1]
    return info


def is_http_url(value: str) -> bool:
    return value.startswith("http://") or value.startswith("https://")


def is_skippable_ref(ref: str) -> bool:
    lower = ref.lower()
    return lower.startswith(("data:", "mailto:", "#"))


def normalize_filename(ref: str) -> str:
    return Path(urlparse(ref).path if is_http_url(ref) else ref).name


def default_candidates(ref: str, info: dict[str, str], token: str | None, templates: Iterable[str]) -> list[str]:
    if is_http_url(ref):
        return [ref]

    name = normalize_filename(ref)
    encoded_name = quote(name)
    context = {
        "scheme": info.get("scheme") or "https",
        "host": info.get("host") or "",
        "team_id": info.get("team_id") or "",
        "space_id": info.get("space_id") or "",
        "page_id": info.get("page_id") or "",
        "ref_uuid": info.get("ref_uuid") or "",
        "name": encoded_name,
        "token": quote(token or ""),
    }

    candidates: list[str] = []
    for template in templates:
        try:
            candidates.append(template.format(**context))
        except KeyError as exc:
            candidates.append(f"INVALID_TEMPLATE:{template}:{exc}")

    host = context["host"]
    team_id = context["team_id"]
    space_id = context["space_id"]
    page_id = context["page_id"]
    ref_uuid = context["ref_uuid"]
    scheme = context["scheme"]
    if host and team_id:
        base = f"{scheme}://{host}"
        raw_paths = []
        if ref_uuid:
            raw_paths.extend([
                f"/wiki/api/wiki/editor/{team_id}/{ref_uuid}/resources/{encoded_name}",
                f"/wiki/api/wiki/editor/{team_id}/{ref_uuid}/resource/{encoded_name}",
                f"/api/wiki/editor/{team_id}/{ref_uuid}/resources/{encoded_name}",
                f"/api/wiki/editor/{team_id}/{ref_uuid}/resource/{encoded_name}",
            ])
        raw_paths.extend([
            f"/wiki/api/project/team/{team_id}/resource/{encoded_name}",
            f"/wiki/api/project/team/{team_id}/resources/{encoded_name}",
            f"/wiki/api/project/team/{team_id}/res/{encoded_name}",
            f"/api/project/team/{team_id}/resource/{encoded_name}",
            f"/api/project/team/{team_id}/resources/{encoded_name}",
            f"/api/project/team/{team_id}/res/{encoded_name}",
            f"/project/api/project/team/{team_id}/resource/{encoded_name}",
            f"/project/api/project/team/{team_id}/resources/{encoded_name}",
            f"/project/api/project/team/{team_id}/res/{encoded_name}",
        ])
        if page_id:
            raw_paths.extend([
                f"/wiki/api/wiki/team/{team_id}/online_page/{page_id}/resource/{encoded_name}",
                f"/wiki/api/wiki/team/{team_id}/online_page/{page_id}/resources/{encoded_name}",
                f"/api/wiki/team/{team_id}/online_page/{page_id}/resource/{encoded_name}",
                f"/api/wiki/team/{team_id}/online_page/{page_id}/resources/{encoded_name}",
            ])
        if space_id and page_id:
            raw_paths.extend([
                f"/wiki/api/wiki/team/{team_id}/space/{space_id}/page/{page_id}/resource/{encoded_name}",
                f"/wiki/api/wiki/team/{team_id}/space/{space_id}/page/{page_id}/resources/{encoded_name}",
            ])
        candidates.extend(base + path for path in raw_paths)

    if token:
        tokenized = []
        for candidate in candidates:
            if candidate.startswith("INVALID_TEMPLATE:"):
                continue
            sep = "&" if "?" in candidate else "?"
            tokenized.append(candidate + sep + "token=" + quote(token))
        candidates.extend(tokenized)

    seen: set[str] = set()
    unique: list[str] = []
    for candidate in candidates:
        if candidate not in seen:
            seen.add(candidate)
            unique.append(candidate)
    return unique


def copy_local_source(source: str, markdown_dir: Path, target: Path) -> bool:
    if is_http_url(source) or is_skippable_ref(source):
        return False
    source_path = (markdown_dir / source).resolve()
    if not source_path.exists() or not source_path.is_file():
        return False
    if source_path.resolve() == target.resolve():
        return True
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source_path, target)
    return True


def download(candidate: str, target: Path, timeout: int) -> None:
    request = Request(candidate, headers={"User-Agent": "ones-wiki-image-postprocessor/1.0"})
    with urlopen(request, timeout=timeout) as response:
        status = getattr(response, "status", 200)
        if status >= 400:
            raise HTTPError(candidate, status, f"HTTP {status}", response.headers, None)
        data = response.read()
        content_type = response.headers.get("Content-Type", "")
    if not data:
        raise RuntimeError("empty response")
    if content_type and "text/html" in content_type.lower():
        raise RuntimeError(f"unexpected content type: {content_type}")
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(data)


def process(markdown_path: Path, args: argparse.Namespace) -> dict[str, object]:
    markdown_path = markdown_path.resolve()
    markdown_dir = markdown_path.parent
    original = read_text(markdown_path)
    meta = parse_meta(original)
    wiki_url = args.wiki_url or meta.get("wiki_url")
    token = args.token or meta.get("token")
    info = parse_wiki_url(wiki_url)
    if meta.get("ref_uuid"):
        info["ref_uuid"] = meta["ref_uuid"]
    assets_rel = Path(args.assets_dir)
    assets_dir = (markdown_dir / assets_rel).resolve()

    replacements: dict[str, str] = {}
    results: list[ImageResult] = []

    for match in IMAGE_RE.finditer(original):
        alt, ref = match.group(1), match.group(2)
        if is_skippable_ref(ref):
            continue
        filename = normalize_filename(ref)
        if not filename:
            continue
        if not RAW_RESOURCE_RE.match(filename) and not is_http_url(ref):
            continue

        target = assets_dir / filename
        target_ref = (assets_rel / filename).as_posix()
        candidates = default_candidates(ref, info, token, args.resource_url_template)

        if target.exists():
            replacements[match.group(0)] = f"![{alt}]({target_ref})"
            results.append(ImageResult(ref, str(target), "exists", candidates))
            continue

        if args.dry_run:
            results.append(ImageResult(ref, str(target), "dry-run", candidates))
            continue

        try:
            if copy_local_source(ref, markdown_dir, target):
                replacements[match.group(0)] = f"![{alt}]({target_ref})"
                results.append(ImageResult(ref, str(target), "copied", candidates))
                continue
        except OSError as exc:
            results.append(ImageResult(ref, str(target), "failed", candidates, f"local copy failed: {exc}"))
            continue

        last_error = None
        for candidate in candidates:
            if candidate.startswith("INVALID_TEMPLATE:"):
                last_error = candidate
                continue
            try:
                download(candidate, target, args.timeout)
                replacements[match.group(0)] = f"![{alt}]({target_ref})"
                results.append(ImageResult(ref, str(target), "downloaded", candidates))
                break
            except (HTTPError, URLError, TimeoutError, OSError, RuntimeError) as exc:
                last_error = str(exc)
        else:
            results.append(ImageResult(ref, None, "failed", candidates, last_error or "no candidates"))

    updated = original
    for source_text, replacement in replacements.items():
        updated = updated.replace(source_text, replacement)

    changed = updated != original
    if changed and not args.dry_run:
        write_text(markdown_path, updated)

    report = {
        "markdown_path": str(markdown_path),
        "assets_dir": str(assets_dir),
        "wiki_url": wiki_url,
        "generated_at": int(time.time()),
        "changed": changed,
        "results": [asdict(item) for item in results],
        "summary": {
            "total": len(results),
            "downloaded": sum(1 for item in results if item.status == "downloaded"),
            "copied": sum(1 for item in results if item.status == "copied"),
            "exists": sum(1 for item in results if item.status == "exists"),
            "failed": sum(1 for item in results if item.status == "failed"),
        },
    }
    return report


def main() -> int:
    args = parse_args()
    markdown_path = Path(args.markdown)
    if not markdown_path.exists():
        print(f"Markdown file not found: {markdown_path}", file=sys.stderr)
        return 2

    report = process(markdown_path, args)
    report_path = Path(args.report) if args.report else markdown_path.with_suffix(markdown_path.suffix + ".images.report.json")
    if not args.dry_run:
        report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report["summary"], ensure_ascii=False, indent=2))
    if args.dry_run:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    return 1 if report["summary"]["failed"] else 0


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
"""将指定 PDF 物理页面渲染为图片，并管理本 skill 的临时目录。"""

from __future__ import annotations

import argparse
import json
import shutil
import sys
import uuid
from datetime import datetime
from pathlib import Path


class UserError(Exception):
    """面向使用者的可解释错误。"""


def parse_pages(raw_pages: str) -> list[int]:
    if raw_pages is None or raw_pages.strip() == "":
        raise UserError("必须提供页码。页码按 PDF 物理页面序号解释，从 1 开始。")

    pages: list[int] = []
    seen: set[int] = set()

    for raw_part in raw_pages.split(","):
        part = raw_part.strip()
        if not part:
            raise UserError("页码格式错误：逗号前后必须是页码或页码范围。")

        if "-" in part:
            pieces = part.split("-")
            if len(pieces) != 2 or not pieces[0].isdigit() or not pieces[1].isdigit():
                raise UserError(f"页码范围格式错误：{part}")
            start = int(pieces[0])
            end = int(pieces[1])
            if start <= 0 or end <= 0:
                raise UserError("页码必须是正整数。")
            if start > end:
                raise UserError(f"页码范围起点不能大于终点：{part}")
            expanded = range(start, end + 1)
        else:
            if not part.isdigit():
                raise UserError(f"页码格式错误：{part}")
            page = int(part)
            if page <= 0:
                raise UserError("页码必须是正整数。")
            expanded = [page]

        for page in expanded:
            if page in seen:
                raise UserError(f"页码重复：{page}")
            seen.add(page)
            pages.append(page)

    return pages


def import_fitz():
    try:
        import fitz  # type: ignore
    except ModuleNotFoundError as exc:
        raise UserError("缺少 PyMuPDF。请先安装：python -m pip install pymupdf") from exc
    return fitz


def skill_dir() -> Path:
    return Path(__file__).resolve().parents[1]


def make_run_dir(base_dir: Path) -> Path:
    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    run_dir = base_dir / ".tmp" / f"run-{timestamp}-{uuid.uuid4().hex[:8]}"
    run_dir.mkdir(parents=True, exist_ok=False)
    return run_dir


def open_document(fitz, pdf_path: Path, password: str | None):
    try:
        document = fitz.open(str(pdf_path))
    except Exception as exc:
        raise UserError(f"无法打开 PDF：{exc}") from exc

    if document.needs_pass:
        if not password:
            document.close()
            raise UserError("PDF 需要密码；请提供 --password。")
        if not document.authenticate(password):
            document.close()
            raise UserError("PDF 密码不正确。")

    return document


def render_pages(args: argparse.Namespace) -> dict:
    pages = parse_pages(args.pages)
    if not args.pdf or args.pdf.strip() == "":
        raise UserError("必须提供 PDF 路径。")

    pdf_path = Path(args.pdf).expanduser().resolve()
    if not pdf_path.is_file():
        raise UserError(f"PDF 路径不存在或不是文件：{pdf_path}")

    if args.dpi <= 0:
        raise UserError("DPI 必须是正整数。")

    fitz = import_fitz()
    document = open_document(fitz, pdf_path, args.password)
    try:
        page_count = document.page_count
        for page in pages:
            if page > page_count:
                raise UserError(f"页码 {page} 超出 PDF 页数 {page_count}。")

        run_dir = make_run_dir(skill_dir())
        matrix = fitz.Matrix(args.dpi / 72, args.dpi / 72)
        rendered_pages = []

        for page in pages:
            physical_page_index = page - 1
            pdf_page = document.load_page(physical_page_index)
            pixmap = pdf_page.get_pixmap(matrix=matrix, alpha=False)
            image_path = run_dir / f"page-{page:04d}.png"
            pixmap.save(str(image_path))
            rendered_pages.append(
                {
                    "page": page,
                    "physical_page_index": physical_page_index,
                    "image_path": str(image_path.resolve()),
                }
            )

        script_path = Path(__file__).resolve()
        manifest = {
            "pdf_path": str(pdf_path),
            "page_count": page_count,
            "dpi": args.dpi,
            "output_dir": str(run_dir.resolve()),
            "pages": rendered_pages,
            "cleanup_command": f'"{sys.executable}" "{script_path}" cleanup --dir "{run_dir.resolve()}"',
        }
        manifest_path = run_dir / "manifest.json"
        manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
        return manifest
    finally:
        document.close()


def ensure_inside_tmp(target_dir: Path) -> Path:
    tmp_root = (skill_dir() / ".tmp").resolve()
    target = target_dir.expanduser().resolve()
    try:
        target.relative_to(tmp_root)
    except ValueError as exc:
        raise UserError(f"只能清理本 skill 的临时目录：{tmp_root}") from exc
    if target == tmp_root:
        raise UserError("不能直接删除 .tmp 根目录。")
    return target


def cleanup(args: argparse.Namespace) -> dict:
    target = ensure_inside_tmp(Path(args.dir))
    if not target.is_dir():
        raise UserError(f"临时目录不存在：{target}")
    shutil.rmtree(target)
    return {"removed": str(target)}


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="渲染 PDF 物理页面为图片。")
    subparsers = parser.add_subparsers(dest="command", required=True)

    render_parser = subparsers.add_parser("render", help="渲染指定 PDF 物理页面")
    render_parser.add_argument("--pdf", help="PDF 文件路径")
    render_parser.add_argument("--pages", help="物理页码，例如 1、2,5、3-6")
    render_parser.add_argument("--dpi", type=int, default=300, help="渲染 DPI，默认 300")
    render_parser.add_argument("--password", help="PDF 密码，仅在用户提供密码时使用")
    render_parser.set_defaults(func=render_pages)

    cleanup_parser = subparsers.add_parser("cleanup", help="删除本次渲染临时目录")
    cleanup_parser.add_argument("--dir", required=True, help="render 输出的 output_dir")
    cleanup_parser.set_defaults(func=cleanup)

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        result = args.func(args)
    except UserError as exc:
        print(f"错误：{exc}", file=sys.stderr)
        return 2

    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

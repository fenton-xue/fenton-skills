#!/usr/bin/env python3
"""第一段：采集小红书数据，输出 JSON 数组（字段契约见 references/schema.md）。

当前是占位实现：
  --mock   输出 3 条模拟数据，用来联调第二段（写飞书）
  不带 --mock  调用 fetch_real()，需要用户把真实接口逻辑补进来

替换 fetch_real() 时只需保证返回 list[dict]，键为 FIELDS 中的 14 个字段名。
"""
import argparse
import json
import sys

FIELDS = [
    "小红书昵称", "ID", "粉丝量（W）", "类型", "主页链接", "发布链接", "发布时间",
    "曝光量", "阅读量", "点赞", "收藏", "评论", "转发", "总互动",
]


def fetch_mock():
    base = [
        ("示例博主A", "100000001", 12.3, "腰部", "aaaa", "note0001", "2026-11-10 20:15",
         52000, 31000, 1800, 900, 120, 60),
        ("示例博主B", "100000002", 3.8, "素人", "bbbb", "note0002", "2026-11-12 09:30",
         8800, 5200, 210, 95, 18, 7),
        ("示例博主C", "100000003", 56.0, "头部", "cccc", "note0003", "2026-11-14 18:00",
         410000, 260000, 15400, 7300, 880, 1320),
    ]
    items = []
    for nick, uid, fans, kind, prof, note, ts, exp, read, like, fav, com, fwd in base:
        items.append({
            "小红书昵称": nick,
            "ID": uid,
            "粉丝量（W）": fans,
            "类型": kind,
            "主页链接": f"https://www.xiaohongshu.com/user/profile/{prof}",
            "发布链接": f"https://www.xiaohongshu.com/explore/{note}",
            "发布时间": ts,
            "曝光量": exp,
            "阅读量": read,
            "点赞": like,
            "收藏": fav,
            "评论": com,
            "转发": fwd,
            "总互动": like + fav + com + fwd,
        })
    return items


def fetch_real(args):
    # TODO(用户补充): 调用已实现的小红书接口，返回 list[dict]，键见 FIELDS。
    raise NotImplementedError("fetch_real 尚未实现：请补充真实采集逻辑，或先用 --mock 联调")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--mock", action="store_true", help="输出模拟数据")
    ap.add_argument("--output", "-o", help="输出文件路径，缺省写 stdout")
    args = ap.parse_args()

    try:
        items = fetch_mock() if args.mock else fetch_real(args)
    except NotImplementedError as e:
        print(f"[fetch_xhs] {e}", file=sys.stderr)
        return 2

    text = json.dumps(items, ensure_ascii=False, indent=2)
    if args.output:
        with open(args.output, "w", encoding="utf-8") as f:
            f.write(text + "\n")
        print(f"[fetch_xhs] 已写入 {len(items)} 条 -> {args.output}", file=sys.stderr)
    else:
        print(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())

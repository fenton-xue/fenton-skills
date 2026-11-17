#!/usr/bin/env python3
"""采集单篇笔记的一级评论（Rnote 爬虫接口 /crawler/note/comments），输出 JSON。仅依赖标准库。

两步用法：
  1. --info：只取第 1 页，告诉你这篇笔记一共有多少条评论（约 1 次请求）
  2. 用户决定条数和排序后，--count N --sort hot|latest 正式抓取

抓取规则：一页一页翻，累计条数达到 --count 就停。条数不严格：每页条数由上游决定（实测 10~15 条不等），
整页已经付过费，所以最后一页一定整页保留，实际条数可能略多于 --count。评论不足时抓到没有为止。
只取一级评论，不取二级评论（回复）。

API Key 走环境变量 RNOTE_API_KEY（或 --api-key）。每次请求单独计费。
"""
import argparse
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

BASE = os.environ.get("RNOTE_CRAWLER_URL", "https://rnote.dev/api/v2/crawler")
SORTS = {"hot": "like_count", "latest": "latest_v2"}
MAX_PAGES = 60


class Fail(Exception):
    pass


def parse_note(text):
    """笔记链接或 24 位笔记 ID -> (note_id, 链接)。"""
    text = text.strip()
    m = (re.search(r"/(?:explore|discovery/item)/([0-9a-f]{24})", text)
         or re.fullmatch(r"([0-9a-f]{24})", text))
    if not m:
        raise Fail(f"认不出笔记: {text!r}。请给笔记链接（.../explore/<24位ID>）或 24 位笔记 ID")
    nid = m.group(1)
    link = text if text.startswith("http") else f"https://www.xiaohongshu.com/explore/{nid}"
    return nid, link


def get_page(key, params):
    url = BASE + "/note/comments?" + urllib.parse.urlencode(params)
    for i in range(3):
        req = urllib.request.Request(url, headers={
            "X-API-Key": key, "Accept": "application/json",
            # Rnote 前面有 Cloudflare，Python 默认 User-Agent 会被 403（error code 1010）
            "User-Agent": "curl/8.7.1"})
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                resp = json.loads(r.read().decode())
            break
        except urllib.error.HTTPError as e:
            text = e.read().decode(errors="replace")
            if e.code in (429, 502, 503, 504) and i < 2:
                time.sleep(2 * (i + 1))
                continue
            hint = {401: "API Key 无效", 402: "余额不足", 403: "被拦截或无权限"}.get(e.code, "")
            raise Fail(f"HTTP {e.code} {hint} {text[:200]}")
        except (urllib.error.URLError, TimeoutError) as e:
            if i < 2:
                time.sleep(2 * (i + 1))
                continue
            raise Fail(f"网络错误: {e}")
    if not resp.get("success"):
        raise Fail(f"接口返回失败: {json.dumps(resp, ensure_ascii=False)[:300]}")
    d = resp.get("data") or {}
    return d.get("data", d) if isinstance(d, dict) else {}


def norm_comment(c):
    u = c.get("user") or {}
    return {"id": c.get("id"), "content": (c.get("content") or "").strip(),
            "like_count": c.get("like_count"), "time": c.get("time"),
            "ip_location": c.get("ip_location"), "nickname": u.get("nickname"),
            "sub_comment_count": c.get("sub_comment_count")}


def run(a):
    key = a.api_key or os.environ.get("RNOTE_API_KEY")
    if not key:
        raise Fail("缺少 API Key：设置环境变量 RNOTE_API_KEY 或传 --api-key")
    nid, link = parse_note(a.note)

    if a.info:
        d = get_page(key, {"note_id": nid})
        return {"note_id": nid, "note_link": link,
                "total_level1": d.get("comment_count_l1"), "total_all": d.get("comment_count"),
                "sort_options": {"hot": "最热（按点赞）", "latest": "最新"},
                "next": "把总数告诉用户，问清要抓多少条、按最热还是最新排序，再用 --count 和 --sort 正式抓取"}

    if a.count is None or a.sort is None:
        raise Fail("必须同时指定 --count（要抓多少条）和 --sort（hot=最热 / latest=最新）。"
                   "用户没说清时，先用 --info 查总数，再问用户")
    if a.count < 1:
        raise Fail("--count 必须是正整数")

    sort = SORTS[a.sort]
    pages, seen, comments, skipped = [], set(), [], 0
    cursor, total1, total_all = "", None, None
    while len(comments) < a.count and len(pages) < MAX_PAGES:
        params = {"note_id": nid, "sort_strategy": sort}
        if cursor:
            params["cursor"] = cursor
        d = get_page(key, params)
        total1 = d.get("comment_count_l1") if total1 is None else total1
        total_all = d.get("comment_count") if total_all is None else total_all
        got = d.get("comments") or []
        pages.append(len(got))
        for c in got:
            n = norm_comment(c)
            if n["id"] in seen:
                continue
            seen.add(n["id"])
            if not n["content"]:
                skipped += 1
                continue
            comments.append(n)
        cursor = d.get("cursor") or ""
        if not d.get("has_more") or not cursor or not got:
            break
    return {"note_id": nid, "note_link": link, "sort": a.sort, "requested": a.count,
            "total_level1": total1, "total_all": total_all,
            "pages": pages, "api_calls": len(pages), "fetched": len(comments),
            "skipped_empty": skipped, "comments": comments}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--note", required=True, help="笔记链接或 24 位笔记 ID")
    ap.add_argument("--info", action="store_true", help="只查这篇笔记一共多少条评论（约 1 次请求）")
    ap.add_argument("--count", type=int, help="要抓多少条（不严格：整页保留，可能略多）")
    ap.add_argument("--sort", choices=sorted(SORTS), help="hot=最热（按点赞）/ latest=最新")
    ap.add_argument("--api-key", help="默认读环境变量 RNOTE_API_KEY")
    ap.add_argument("--output", "-o", help="输出 JSON 文件；缺省打印到 stdout")
    a = ap.parse_args()
    for stream in (sys.stdout, sys.stderr):
        stream.reconfigure(encoding="utf-8", errors="replace")
    try:
        res = run(a)
    except Fail as e:
        print(f"[xhs_comments] {e}", file=sys.stderr)
        return 1
    text = json.dumps(res, ensure_ascii=False, indent=2)
    if a.output and not a.info:
        with open(a.output, "w", encoding="utf-8") as f:
            f.write(text)
        meta = {k: v for k, v in res.items() if k != "comments"}
        print(json.dumps(meta, ensure_ascii=False))
    else:
        print(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())

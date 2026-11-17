#!/usr/bin/env python3
"""采集：给一个小红书博主标识，经 Rnote 蒲公英接口取回指定字段，输出 JSON 数组。

标识（--who）可以是：博主昵称、小红书号、24 位 userId、博主主页链接。
字段（--fields）用规范名或常见别名，逗号分隔；默认是 13 个投放字段。只取需要的字段对应的接口，
每次接口调用都按 Rnote 计费，所以只取需要的字段。含笔记层字段时必须用 --notes 指定取哪篇笔记。

只依赖标准库。API Key 走环境变量 RNOTE_API_KEY（或 --api-key）。
"""
import argparse
import json
import math
import os
import re
import sys
import time
import urllib.error
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from xhs_fields import (DEFAULT_FIELDS, DETAIL_FIELDS, NAMES, NOTE, PROFILE, RATE,  # noqa: E402
                        SUMMARY, level_of, resolve_field)

BASE = os.environ.get("RNOTE_BASE_URL", "https://rnote.dev/api/v2/pgy")
HEX24 = r"[0-9a-f]{24}"


class Fail(Exception):
    pass


class Api:
    def __init__(self, key):
        self.key = key
        self.paths = []

    def post(self, path, body):
        data = json.dumps(body, ensure_ascii=False).encode()
        resp = None
        for i in range(3):
            req = urllib.request.Request(
                BASE + path, data=data, method="POST",
                # Rnote 前面有 Cloudflare，Python 默认 UA 会被 403（error code 1010）
                headers={"X-API-Key": self.key, "Content-Type": "application/json",
                         "User-Agent": "curl/8.7.1", "Accept": "application/json"})
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
                raise Fail(f"{path} HTTP {e.code} {hint} {text[:200]}")
            except (urllib.error.URLError, TimeoutError) as e:
                if i < 2:
                    time.sleep(2 * (i + 1))
                    continue
                raise Fail(f"{path} 网络错误: {e}")
        if not resp or not resp.get("success"):
            raise Fail(f"{path} 返回失败: {json.dumps(resp, ensure_ascii=False)[:300]}")
        self.paths.append(path)
        d = resp.get("data") or {}
        return d.get("data", d) if isinstance(d, dict) else d


def num(v):
    if v in (None, "", "-"):
        return None
    try:
        f = float(str(v).replace(",", ""))
    except ValueError:
        return None
    return int(f) if f == int(f) else round(f, 2)


# ---------- 博主 ----------

def find_profile(api, who):
    who = who.strip()
    m = re.search(r"/user/profile/(" + HEX24 + ")", who) or re.fullmatch("(" + HEX24 + ")", who)
    if m:
        uid = m.group(1)
        return uid, None  # 先不调接口，需要博主层字段时再取
    r = api.post("/blogger/list", {"keyword": who, "search_type": 0, "page_num": 1, "page_size": 20})
    kols = r.get("kols") or []
    exact = [k for k in kols if who in (k.get("name"), k.get("redId"))]
    if len(exact) == 1:
        return exact[0]["userId"], exact[0]
    if not exact:
        cand = [f"{k.get('name')}({k.get('redId')})" for k in kols[:8]]
        raise Fail(f"没有精确匹配 {who!r} 的博主，候选: {cand or '无'}。可改用主页链接或 24 位 userId")
    raise Fail("匹配到多个博主，请改用 userId: " +
               "; ".join(f"{k.get('name')} {k.get('redId')} {k.get('userId')}" for k in exact))


def profile_values(p):
    uid = p.get("userId")
    fans = num(p.get("fansNum")) or num(p.get("fansCount")) or 0
    return {
        "小红书昵称": p.get("name"), "ID": p.get("redId"), "userId": uid,
        "主页链接": f"https://www.xiaohongshu.com/user/profile/{uid}",
        "粉丝量（W）": round(fans / 10000, 2) if fans else None,
        "粉丝数": fans or None,
        "图文报价": num(p.get("picturePrice")), "视频报价": num(p.get("videoPrice")),
    }


# ---------- 笔记 ----------

def list_notes(api, uid, mode):
    """返回 (笔记列表, 总数)。接口按发布时间倒序：第 1 页最新，最后一页末尾最早。"""
    def page(n):
        d = api.post("/blogger/notes", {"user_id": uid, "page_number": n, "page_size": 8,
                                        "note_type": 4, "order_type": 1})
        return d.get("list") or [], d.get("total") or 0

    first, total = page(1)
    if not first:
        return [], 0
    pages = math.ceil(total / 8)
    if mode == "latest":
        return first[:1], total
    if mode == "first":
        if pages == 1:
            return [first[-1]], total
        last, _ = page(pages)
        return [last[-1]], total
    want = total if mode == "all" else int(mode)
    out, p = list(first), 2
    while len(out) < min(want, total) and p <= pages:
        out += page(p)[0]
        p += 1
    seen, uniq = set(), []
    for n in out:
        if n["noteId"] not in seen:
            seen.add(n["noteId"])
            uniq.append(n)
    return uniq[:want], total


def note_values(api, n, want_detail):
    v = {"笔记标题": n.get("title"), "发布时间": n.get("date"), "阅读量": n.get("readNum"),
         "点赞": n.get("likeNum"), "收藏": n.get("collectNum")}
    if want_detail:
        d = api.post("/note/detail", {"note_id": n["noteId"]})
        v.update({
            "发布链接": d.get("noteLink"), "发布时间": d.get("createTime") or v["发布时间"],
            "曝光量": d.get("impNum"), "阅读量": d.get("readNum", v["阅读量"]),
            "点赞": d.get("likeNum", v["点赞"]), "收藏": d.get("favNum", v["收藏"]),
            "评论": d.get("cmtNum"), "转发": d.get("shareNum"), "关注": d.get("followCnt"),
        })
    parts = [v.get(k) for k in ("点赞", "收藏", "评论", "转发")]
    # 总互动 = 点赞 + 收藏 + 评论 + 转发（不含涨粉）；缺任何一项就留空，不猜
    v["总互动"] = sum(parts) if all(isinstance(x, (int, float)) for x in parts) else None
    return v


# ---------- 组装 ----------

RATE_KEYS = {"曝光中位数": "impMedian", "阅读中位数": "readMedian", "互动中位数": "interactionMedian",
             "点赞中位数": "likeMedian", "收藏中位数": "collectMedian", "评论中位数": "commentMedian",
             "转发中位数": "shareMedian"}
SUMMARY_KEYS = {"预估图文CPM": "estimatePictureCpm", "预估视频CPM": "estimateVideoCpm",
                "图文阅读单价": "pictureReadCost", "视频阅读单价": "videoReadCost"}


def parse_fields(text):
    if not text or text.strip() == "default":
        return list(DEFAULT_FIELDS)
    out, bad = [], []
    for t in re.split(r"[,，]", text):
        t = t.strip()
        if not t:
            continue
        f = resolve_field(t)
        if f is None:
            bad.append(t)
        elif f not in out:
            out.append(f)
    if bad:
        raise Fail(f"不认识的字段: {bad}。可用字段: {', '.join(NAMES)}")
    return out


def run(a):
    fields = parse_fields(a.fields)
    mode = a.notes
    if NOTE in {level_of(f) for f in fields} and mode is None:
        raise Fail("字段里有笔记层字段，但没有指定取哪篇笔记。请用 --notes 指定：first=最早一篇 / latest=最新一篇 / all=全部 / 正整数=最新 N 篇；"
                   "用户没说明时先问用户，不要自己选")
    if mode is not None and mode not in ("first", "latest", "all") and not (mode.isdigit() and int(mode) > 0):
        raise Fail("--notes 只能是 first / latest / all / 正整数")
    key = a.api_key or os.environ.get("RNOTE_API_KEY")
    if not key:
        raise Fail("缺少 API Key：设置环境变量 RNOTE_API_KEY 或传 --api-key")
    api = Api(key)
    levels = {level_of(f) for f in fields}

    uid, raw = find_profile(api, a.who)
    base = {}
    if PROFILE in levels:
        if raw is None:
            raw = api.post("/blogger/detail", {"user_id": uid})
            raw.setdefault("userId", uid)
        base.update(profile_values(raw))
    if RATE in levels:
        r = api.post("/blogger/notes-rate", {"user_id": uid, "business": a.business, "note_type": 3,
                                             "date_type": a.date_type, "advertise_switch": 1})
        base.update({k: num(r.get(v)) for k, v in RATE_KEYS.items()})
    if SUMMARY in levels:
        r = api.post("/blogger/data-summary", {"user_id": uid, "business": a.business})
        for k, v in SUMMARY_KEYS.items():
            x = num(r.get(v))
            # data-summary 的阅读单价单位是「分」：109.4 分 = 1.09 元，与 /blogger/list 的 1.10 元对得上
            base[k] = round(x / 100, 2) if k.endswith("阅读单价") and x is not None else x

    rows = [base]
    total = None
    if NOTE in levels:
        notes, total = list_notes(api, uid, mode)
        if not notes:
            print(f"[提示] 该博主没有查到笔记（total={total}），笔记层字段将留空", file=sys.stderr)
        else:
            want_detail = bool(set(fields) & DETAIL_FIELDS) or a.detail
            rows = [{**base, **note_values(api, n, want_detail)} for n in notes]
    records = [{f: row.get(f) for f in fields} for row in rows]
    calls = len(api.paths)
    meta = {"who": a.who, "userId": uid, "records": len(records), "note_total": total,
            "api_calls": calls}
    return records, meta


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--who", required=True, help="昵称 / 小红书号 / userId / 主页链接")
    ap.add_argument("--fields", default="default", help="逗号分隔的字段名或别名；default=13 个投放字段")
    ap.add_argument("--notes",
                    help="取哪些笔记：first=最早一篇 / latest=最新一篇 / all=全部 / 正整数=最新 N 篇。"
                         "字段里含笔记层字段时必须指定，没有默认值")
    ap.add_argument("--business", type=int, choices=[0, 1], default=0, help="中位数、成本口径：0=日常笔记（默认） 1=合作笔记")
    ap.add_argument("--date-type", type=int, choices=[1, 2], default=1, help="中位数时间范围：1=近30日（默认） 2=近90日")
    ap.add_argument("--detail", action="store_true", help="即使字段用不到也调 /note/detail（取分钟级发布时间）")
    ap.add_argument("--api-key", help="默认读环境变量 RNOTE_API_KEY")
    ap.add_argument("--output", "-o", help="输出 JSON 文件；缺省打印到 stdout")
    a = ap.parse_args()
    for stream in (sys.stdout, sys.stderr):
        stream.reconfigure(encoding="utf-8", errors="replace")
    try:
        res = run(a)
    except Fail as e:
        print(f"[xhs_fetch] {e}", file=sys.stderr)
        return 1
    records, meta = res
    text = json.dumps(records, ensure_ascii=False, indent=2)
    if a.output:
        with open(a.output, "w", encoding="utf-8") as f:
            f.write(text)
    else:
        print(text)
    print(json.dumps(meta, ensure_ascii=False), file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())

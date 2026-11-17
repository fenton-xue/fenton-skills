#!/usr/bin/env python3
"""把 xhs_fetch.py 的 JSON 写进飞书电子表格。仅依赖标准库，用自建应用的 tenant_access_token（凭证不过期）。

环境变量：FEISHU_APP_ID、FEISHU_APP_SECRET；可选 FEISHU_SHARE_TO（create 时默认分享给谁）。

子命令：
  check    检查凭证是否可用
  access   查机器人对这张表有没有编辑权限（只读）。没有则退出码 3，要先把机器人加为协作者
  inspect  读已有表格的表头，告诉你哪些表头认得、该取哪些字段（不写任何东西）。
           表头由程序按名称和别名表匹配；认不出的列在 unmatched_headers 里，由 AI 判断意思后用 --map 补上
  fill     按表头把数据追加到已有表格：只写表头里存在的字段，没有表头的字段直接跳过。
           默认只预览不写入，加 --write 才真正写。数据里的帖子（发布链接）在表里已有时停下（退出码 2），
           由用户选 --on-duplicate update（更新原有行）或 append（追加为新行）
  create   新建表格（表头 = 字段），写入数据，并分享给指定的人
  comments 把一篇笔记的评论写进「评论」工作表：左列帖子链接（合并单元格），右列每条评论一个单元格。
           表格里已有「评论」工作表就在末尾追加，没有就新建；--new-title 则连表格一起新建

写入护栏：
  1. 只往整张子表最后一个有内容的行之后的空白区写，不改已有单元格、不插行、不移动已有内容
  2. 写之前再读一遍目标区域，不是全空就中止
  3. fill 默认预览，必须 --write 才写；一次最多 --max-rows 行（默认 100）
  4. 不删除、不清空，脚本里没有这类调用
唯一放行改已有单元格的情况：用户选了 --on-duplicate update。此时只改发布链接重复的那几行、本次有数据的单元格，
改之前重读发布链接列确认还是同一篇帖子，任何一行对不上就整体中止。
"""
import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from xhs_fields import NAMES, NOTE, col_letter, kind_of, level_of, norm, resolve_field  # noqa: E402

APPEND_BATCH = 500
SCAN_CELLS = 4000       # 每次读取的单元格数上限
MAX_SCAN_COLS = 100     # 判断最后一行时最多看多少列
DEFAULT_MAX_ROWS = 100  # 一次最多写多少行


class Fail(Exception):
    pass


class NoAccess(Fail):
    """机器人在这张表上没有「可编辑」权限。退出码 3，表示要先把机器人加为协作者。"""


# ---------- 飞书接口 ----------

COLLAB_HINT = "应用不是该表格的协作者：表格右上角「分享」→ 搜应用名 → 权限选「可编辑」"
HINTS = {
    99991663: "token 无效：检查 FEISHU_APP_ID / FEISHU_APP_SECRET",
    99991661: "token 无效：检查 FEISHU_APP_ID / FEISHU_APP_SECRET",
    91403: COLLAB_HINT,
    403: COLLAB_HINT,
    1310213: "应用没有表格权限：开发者后台开通 sheets:spreadsheet 并发布版本",
    99991672: "应用没有开通该接口需要的权限，开发者后台开通后要发布版本",
}


class Feishu:
    def __init__(self):
        app_id, secret = os.environ.get("FEISHU_APP_ID"), os.environ.get("FEISHU_APP_SECRET")
        if not app_id or not secret:
            raise Fail("缺少环境变量 FEISHU_APP_ID / FEISHU_APP_SECRET；设置后需要新开终端")
        self.base = (os.environ.get("FEISHU_BASE_URL") or "https://open.feishu.cn").rstrip("/")
        p = self._request("POST", "/open-apis/auth/v3/tenant_access_token/internal",
                          {"app_id": app_id, "app_secret": secret}, auth=False)
        if p.get("code") != 0 or not p.get("tenant_access_token"):
            raise Fail(f"获取 tenant_access_token 失败: code={p.get('code')} msg={p.get('msg')}。"
                       "检查 App ID / Secret 是否对应、应用是否已启用")
        self.token = p["tenant_access_token"]

    def _request(self, method, path, body=None, query=None, auth=True):
        url = self.base + path
        if query:
            url += "?" + urllib.parse.urlencode(query)
        data = json.dumps(body, ensure_ascii=False).encode("utf-8") if body is not None else None
        req = urllib.request.Request(url, data=data, method=method)
        req.add_header("Content-Type", "application/json; charset=utf-8")
        if auth:
            req.add_header("Authorization", f"Bearer {self.token}")
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                raw = resp.read()
        except urllib.error.HTTPError as e:
            raw = e.read()  # 飞书出错时 body 里仍有 code/msg
            if not raw:
                raise Fail(f"HTTP {e.code} {method} {path}")
        except urllib.error.URLError as e:
            raise Fail(f"网络错误 {method} {path}: {e}")
        try:
            return json.loads(raw)
        except ValueError:
            raise Fail(f"响应不是 JSON: {raw[:200]!r}")

    def call(self, method, path, body=None, query=None):
        p = self._request(method, path, body, query)
        if p.get("code") != 0:
            code = p.get("code")
            msg = f"{method} {path} -> code={code} msg={p.get('msg')}"
            if code in HINTS:
                msg += f"\n  提示: {HINTS[code]}"
            raise Fail(msg)
        return p.get("data") or {}


# ---------- 表格定位与读取 ----------

NOACCESS_MSG = ("机器人在这张表上没有「可编辑」权限，没有写入任何内容。按 SKILL.md「机器人没有编辑权限时」处理："
                "先自己用浏览器把机器人（名字见 bot_name）加为「可编辑」协作者（步骤见 references/add-bot-to-sheet.md），"
                "加完用 access 子命令确认；加不上再请用户手动加")


def bot_access(fs, ss):
    """用飞书自带的权限检查接口（只读，不改任何东西）查机器人对这张表有没有编辑 / 查看权限。

    读表头走的是「组织内获得链接的人可阅读」，所以没加机器人也读得到；只有 can_edit 才说明能写。
    接口查询失败时返回 None，不当成没权限（让后面真正写入时再按 91403 报错）。
    """
    out = {}
    for action, key in (("edit", "can_edit"), ("view", "can_view")):
        try:
            d = fs.call("GET", f"/open-apis/drive/v1/permissions/{ss}/members/auth",
                        query={"type": "sheet", "action": action})
            out[key] = bool(d.get("auth_result"))
        except Fail:
            out[key] = None
    return out


def bot_name(fs):
    """机器人（飞书应用）的名字，也就是在表格「分享」面板里搜索它时要输入的名字。查不到返回 None。"""
    try:
        return (fs._request("GET", "/open-apis/bot/v3/info").get("bot") or {}).get("app_name")
    except Fail:
        return None


def access_fields(fs, ss):
    a = bot_access(fs, ss)
    res = {"bot_can_edit": a["can_edit"]}
    if a["can_edit"] is False:
        res["needs_access"] = True
        res["bot_name"] = bot_name(fs)
        res["access_message"] = NOACCESS_MSG
    return res


def locate(fs, a):
    src = (a.url or a.token or "").strip()
    if not src:
        raise Fail("需要 --url（表格链接）或 --token（表格 token）")
    m = re.search(r"/(?:sheets|spreadsheets)/([A-Za-z0-9]+)", src)
    if m:
        return m.group(1)
    if "/wiki/" in src:
        tok = re.search(r"/wiki/([A-Za-z0-9]+)", src).group(1)
        node = fs.call("GET", "/open-apis/wiki/v2/spaces/get_node", query={"token": tok}).get("node", {})
        if node.get("obj_type") != "sheet":
            raise Fail(f"该知识库节点不是电子表格 (obj_type={node.get('obj_type')})")
        return node["obj_token"]
    return src


def pick_sheet(fs, ss, want):
    sheets = fs.call("GET", f"/open-apis/sheets/v3/spreadsheets/{ss}/sheets/query").get("sheets", [])
    sheets = [s for s in sheets if not s.get("hidden")]
    if not sheets:
        raise Fail("表格里没有可见子表")
    chosen = sheets[0]
    if want:
        for s in sheets:
            if want in (s["sheet_id"], s["title"]):
                chosen = s
                break
        else:
            raise Fail(f"找不到子表 {want!r}，可选: {[s['title'] for s in sheets]}")
    grid = chosen.get("grid_properties") or {}
    return {"ss": ss, "sid": chosen["sheet_id"], "title": chosen["title"],
            "rows": grid.get("row_count") or 200, "cols": grid.get("column_count") or 26}


def cell_text(v):
    """读回的单元格可能是文本、数字，或超链接片段列表。"""
    if v is None:
        return ""
    if isinstance(v, list):
        return "".join(cell_text(x) for x in v)
    if isinstance(v, dict):
        return str(v.get("link") or v.get("text") or "")
    return str(v).strip()


def read_headers(fs, sh):
    rng = f"{sh['sid']}!A1:{col_letter(min(sh['cols'], 52) - 1)}1"
    d = fs.call("GET", f"/open-apis/sheets/v2/spreadsheets/{sh['ss']}/values/{urllib.parse.quote(rng, safe='')}",
                query={"valueRenderOption": "Formula"})
    rows = (d.get("valueRange") or {}).get("values") or []
    hdr = [cell_text(c) for c in (rows[0] if rows else [])]
    while hdr and not hdr[-1]:
        hdr.pop()
    return hdr


def parse_map(items):
    """--map "表头原文=字段名"（可重复）-> {规范化的表头: 规范字段名}。这是 AI 判断出「意思一样」后告诉程序的对应关系。"""
    out = {}
    for it in items or []:
        if "=" not in it:
            raise Fail(f"--map 的格式是 表头原文=字段名，收到 {it!r}")
        h, f = it.split("=", 1)
        field = resolve_field(f)
        if field is None:
            raise Fail(f"--map 里的字段 {f.strip()!r} 不认识，可用字段: {', '.join(NAMES)}")
        out[norm(h)] = field
    return out


def match_headers(hdr, hmap=None):
    """先看 --map 指定的对应关系，再按名称和别名表自动匹配；都认不出的返回 None。"""
    hmap = hmap or {}
    fields = [(hmap.get(norm(h)) or resolve_field(h)) if h else None for h in hdr]
    colmap = {}
    for i, f in enumerate(fields):
        if f and f not in colmap:
            colmap[f] = i
    return fields, colmap


# ---------- 数据 ----------

def load_records(path):
    with (sys.stdin if path == "-" else open(path, encoding="utf-8")) as f:
        raw = json.load(f)
    if isinstance(raw, dict):
        raw = [raw]
    if not isinstance(raw, list) or not all(isinstance(r, dict) for r in raw):
        raise Fail("输入必须是 JSON 对象数组（xhs_fetch.py 的输出）")
    out, unknown = [], set()
    for r in raw:
        rec = {}
        for k, v in r.items():
            f = resolve_field(k)
            if f is None:
                unknown.add(k)
            else:
                rec[f] = v
        out.append(rec)
    return out, sorted(unknown)


def to_cell(field, v):
    """链接写成可点击超链接；ID 等文本保持字符串；数字保持数字。"""
    if v is None or v == "":
        return ""
    if kind_of(field) == "url":
        return {"type": "url", "text": str(v), "link": str(v)}
    if kind_of(field) == "num":
        return v
    return str(v)


# ---------- 核心：按表头追加 ----------

def is_filled(c):
    """单元格是否有内容。图片、附件等读回来是对象，也算有内容，宁可多算也不能当成空格去覆盖。"""
    if c is None:
        return False
    if isinstance(c, str):
        return c.strip() != ""
    return True


def read_values(fs, sh, rng):
    q = urllib.parse.quote(f"{sh['sid']}!{rng}", safe="")
    d = fs.call("GET", f"/open-apis/sheets/v2/spreadsheets/{sh['ss']}/values/{q}",
                query={"valueRenderOption": "ToString"})
    return (d.get("valueRange") or {}).get("values") or []


def last_used_row(fs, sh, width):
    """整张子表（所有列）里最后一个有内容的行号；全空返回 0。从下往上分块读。"""
    step = max(1, SCAN_CELLS // width)
    end = sh["rows"]
    while end >= 1:
        start = max(1, end - step + 1)
        rows = read_values(fs, sh, f"A{start}:{col_letter(width - 1)}{end}")
        for i in range(len(rows) - 1, -1, -1):
            if any(is_filled(c) for c in (rows[i] or [])):
                return start + i
        end = start - 1
    return 0


def ensure_empty(fs, sh, start, end, width):
    """写入前再读一遍目标区域，只要有一格有内容就中止。"""
    step = max(1, SCAN_CELLS // width)
    r = start
    while r <= end:
        r2 = min(end, r + step - 1)
        for i, row in enumerate(read_values(fs, sh, f"A{r}:{col_letter(width - 1)}{r2}")):
            if any(is_filled(c) for c in (row or [])):
                raise Fail(f"目标区域第 {r + i} 行已有内容，中止写入，没有改动任何单元格（可能有人同时在编辑这张表）")
        r = r2 + 1


def grow_rows(fs, sh, need_last):
    """网格行数不够时，在表格最末尾增加空行（不会移动已有内容）。"""
    missing = need_last - sh["rows"]
    while missing > 0:
        n = min(missing, 1000)
        fs.call("POST", f"/open-apis/sheets/v2/spreadsheets/{sh['ss']}/dimension_range",
                {"dimension": {"sheetId": sh["sid"], "majorDimension": "ROWS", "length": n}})
        sh["rows"] += n
        missing -= n


def sheet_title(fs, ss):
    return fs.call("GET", f"/open-apis/sheets/v3/spreadsheets/{ss}").get("spreadsheet", {}).get("title")


DUP_KEY = "发布链接"  # 判重只看帖子：同一篇笔记的链接里有 24 位笔记 ID，xsec_token 每次都不同，所以只比笔记 ID


def norm_key(field, v):
    t = str(v if v is not None else "").strip()
    m = (re.search(r"/(?:explore|discovery/item)/([0-9a-f]{24})", t)
         or re.search(r"(?<![0-9a-zA-Z])([0-9a-f]{24})(?![0-9a-zA-Z])", t))
    return m.group(1) if m else t


def runs(indices):
    """连续的列号合成一段：[2,3,4,7] -> [(2,4),(7,7)]"""
    out, start, prev = [], None, None
    for i in sorted(indices):
        if start is None:
            start = prev = i
        elif i == prev + 1:
            prev = i
        else:
            out.append((start, prev))
            start = prev = i
    if start is not None:
        out.append((start, prev))
    return out


def find_existing(fs, sh, key, col):
    """读整张子表的「判重列」：{规范化后的值: [行号, ...]}（不含表头行）。"""
    letter = col_letter(col)
    found, r0 = {}, 2
    while r0 <= sh["rows"]:
        r1 = min(sh["rows"], r0 + SCAN_CELLS - 1)
        for i, row in enumerate(read_values(fs, sh, f"{letter}{r0}:{letter}{r1}")):
            k = norm_key(key, cell_text(row[0]) if row else "")
            if k:
                found.setdefault(k, []).append(r0 + i)
        r0 = r1 + 1
    return found


def fill(fs, sh, records, dry, max_rows=DEFAULT_MAX_ROWS, on_dup=None, hmap=None):
    """默认只往「最后一个有内容的行」之后的空白区写，不改已有单元格、不插行、不移动内容。

    判重：只看帖子——本次数据里的「发布链接」（比对链接里的 24 位笔记 ID）已经在表里时，不写任何东西，返回
    needs_decision，由用户选择 on_dup。同一个博主的不同帖子不算重复。表里没有「发布链接」列（或数据里没有）
    就无法判重，一律追加：
      "append"：照常追加，重复的也当新行追加
      "update"：重复的那几行改成新数据（只改这些行、本次有数据的单元格，不清空），其余照常追加。
                这是唯一放行「改已有单元格」的情况，改之前会重读发布链接列确认还是同一篇帖子
    """
    sid, ss = sh["sid"], sh["ss"]
    hdr = read_headers(fs, sh)
    if not hdr:
        raise Fail("表格第一行没有表头")
    fields, colmap = match_headers(hdr, hmap)
    rec_fields = set().union(*[set(r) for r in records]) if records else set()
    use = [f for f in colmap if f in rec_fields]
    if not use:
        raise Fail(f"表头里没有任何字段能对上数据。表头: {hdr}；数据字段: {sorted(rec_fields)}")

    ncols = max(len(hdr), max(colmap[f] for f in use) + 1)
    last = col_letter(ncols - 1)
    if len(records) > max_rows:
        raise Fail(f"本次要写 {len(records)} 行，超过上限 --max-rows {max_rows}。确认数量无误后加大 --max-rows 再运行")

    def build_row(r):
        row = [""] * ncols  # 表头认不出的列留空
        for f in use:
            row[colmap[f]] = to_cell(f, r.get(f))
        return row

    base = {
        "spreadsheet_token": ss, "spreadsheet_title": sheet_title(fs, ss), "sheet": sh["title"],
        "dry_run": dry, "written_fields": use,
        "ignored_fields_no_header": sorted(rec_fields - set(colmap)),
        "blank_columns_no_data": [f for f in colmap if f not in rec_fields],
        "unmatched_headers": [h for h, f in zip(hdr, fields) if h and not f],
        "headers_mapped_by_map": [{"header": h, "field": f} for h, f in zip(hdr, fields)
                                  if h and f and norm(h) in (hmap or {})],
    }

    # ---- 判重 ----
    dup_key = DUP_KEY if DUP_KEY in use else None
    existing = find_existing(fs, sh, dup_key, colmap[dup_key]) if dup_key else {}
    dups = []
    for i, r in enumerate(records):
        k = norm_key(dup_key, r.get(dup_key)) if dup_key else ""
        if k and k in existing:
            dups.append({"record": i, "key_field": dup_key, "value": r.get(dup_key), "existing_rows": existing[k]})
    base["duplicate_check"] = f"按「{dup_key}」判重" if dup_key else "表里没有「发布链接」列或数据里没有发布链接，无法判重，一律追加"
    if dups and on_dup is None:
        return {**base, "status": "发现重复，没有写入任何内容。请问用户：更新原有数据，还是追加为新行？",
                "needs_decision": True,
                "duplicates": [{k: v for k, v in d.items() if k != "record"} for d in dups],
                "options": {"update": "加 --on-duplicate update：重复的行改成新数据，其余照常追加",
                            "append": "加 --on-duplicate append：全部当新行追加，原有行不动"}}

    upd = []  # (行号, 记录序号)
    if dups and on_dup == "update":
        counts = {}
        for r in records:
            k = norm_key(dup_key, r.get(dup_key))
            counts[k] = counts.get(k, 0) + 1
        for d in dups:
            k = norm_key(dup_key, d["value"])
            if len(d["existing_rows"]) != 1 or counts[k] != 1:
                raise Fail(f"「{dup_key}」{d['value']} 没法一对一更新：表里有 {len(d['existing_rows'])} 行"
                           f"（第 {d['existing_rows']} 行），本次数据里有 {counts[k]} 条。请改选追加（--on-duplicate append）")
            upd.append((d["existing_rows"][0], d["record"]))
    upd_idx = {i for _, i in upd}
    app_idx = [i for i in range(len(records)) if i not in upd_idx]
    rows = [build_row(records[i]) for i in app_idx]

    # ---- 追加部分 ----
    width = max(min(sh["cols"], MAX_SCAN_COLS), ncols)  # 判断「最后一行」时看所有列，别的列里的内容也算
    last_row = last_used_row(fs, sh, width) if rows else None
    start = max(last_row, 1) + 1 if rows else None
    end = start + len(rows) - 1 if rows else None

    # ---- 更新部分的写入内容 ----
    ranges, key_col = [], colmap[dup_key] if dup_key else None
    inv = {colmap[f]: f for f in use}
    for rowno, i in upd:
        rec = records[i]
        cols = [colmap[f] for f in use if colmap[f] != key_col and rec.get(f) not in (None, "")]  # 没数据的格不动，不清空
        for a0, b0 in runs(cols):
            ranges.append({"range": f"{sid}!{col_letter(a0)}{rowno}:{col_letter(b0)}{rowno}",
                           "values": [[to_cell(inv[c], rec.get(inv[c])) for c in range(a0, b0 + 1)]]})

    if not dry:
        if upd:  # 先把所有行都核对完再动手，任何一行对不上就整体中止
            for rowno, i in upd:
                got = read_values(fs, sh, f"{col_letter(key_col)}{rowno}:{col_letter(key_col)}{rowno}")
                cur = norm_key(dup_key, cell_text(got[0][0]) if got and got[0] else "")
                if cur != norm_key(dup_key, records[i].get(dup_key)):
                    raise Fail(f"第 {rowno} 行的「{dup_key}」现在是 {cur!r}，和要更新的 {norm_key(dup_key, records[i].get(dup_key))!r} 对不上"
                               "（可能有人同时在编辑），中止，没有改动任何单元格")
        if rows:
            grow_rows(fs, sh, end)
            ensure_empty(fs, sh, start, end, width)
        for i in range(0, len(ranges), 100):
            fs.call("POST", f"/open-apis/sheets/v2/spreadsheets/{ss}/values_batch_update",
                    {"valueRanges": ranges[i:i + 100]})
        for i in range(0, len(rows), APPEND_BATCH):
            chunk = rows[i:i + APPEND_BATCH]
            a0 = start + i
            fs.call("PUT", f"/open-apis/sheets/v2/spreadsheets/{ss}/values",
                    {"valueRange": {"range": f"{sid}!A{a0}:{last}{a0 + len(chunk) - 1}", "values": chunk}})

    first = ({f: records[0].get(f) for f in use} if records else None)
    return {
        **base,
        "status": "未写入（预览）。确认无误后加 --write 才会真正写入" if dry else "已写入",
        "on_duplicate": on_dup if dups else None,
        "duplicates_found": len(dups),
        "existing_last_row": last_row, "rows_to_write": len(rows),
        "write_range": f"{sid}!A{start}:{last}{end}" if rows else None,
        "rows_to_update": len(upd), "update_rows": [r for r, _ in upd],
        "preview_first_record": first,
    }


# ---------- 分享 ----------

def member_of(who):
    """按前缀判断身份类型：on_=union_id，ou_=open_id（随应用而变，不建议用），含 @=邮箱，其余当 user_id。"""
    who = who.strip()
    if who.startswith("on_"):
        return "unionid"
    if who.startswith("ou_"):
        return "openid"
    if "@" in who:
        return "email"
    return "userid"


def share(fs, ss, who):
    fs.call("POST", f"/open-apis/drive/v1/permissions/{ss}/members", {
        "member_type": member_of(who), "member_id": who.strip(), "perm": "full_access"},
        query={"type": "sheet", "need_notification": "false"})


# ---------- 子命令 ----------

def cmd_check(a):
    Feishu()  # 缺变量或凭证不对会在这里抛 Fail
    return {"ok": True, "message": "已换到 tenant_access_token，凭证有效",
            "FEISHU_SHARE_TO": "已设置" if os.environ.get("FEISHU_SHARE_TO") else "未设置（create 时需要 --share-to）"}


def cmd_inspect(a):
    fs = Feishu()
    sh = pick_sheet(fs, locate(fs, a), a.sheet)
    hdr = read_headers(fs, sh)
    hmap = parse_map(a.map)
    fields, colmap = match_headers(hdr, hmap)
    unmatched = [h for h, f in zip(hdr, fields) if h and not f]
    return {
        "spreadsheet_token": sh["ss"], "sheet": sh["title"], "headers": hdr,
        **access_fields(fs, sh["ss"]),
        "matched": [{"col": col_letter(i), "header": h, "field": f} for i, (h, f) in enumerate(zip(hdr, fields)) if f],
        "unmatched_headers": unmatched,
        "mapped_by_map": [{"header": h, "field": f} for h, f in zip(hdr, fields) if h and f and norm(h) in hmap],
        "available_fields": NAMES if unmatched else None,
        "fields_csv": ",".join(colmap),
        "note_level": any(level_of(f) == NOTE for f in colmap),
        "next": ("unmatched_headers 里有程序认不出的表头：请你（AI）对照 available_fields 判断，意思明确相同的用 --map 补上"
                 "再重新 inspect，拿不准的问用户；把 fields_csv 传给 xhs_fetch.py --fields。" if unmatched else
                 "把 fields_csv 传给 xhs_fetch.py --fields；note_level 为 true 时要先问用户取哪篇笔记，为 false 时每个博主一行"),
    }


def cmd_access(a):
    fs = Feishu()
    ss = locate(fs, a)
    acc = bot_access(fs, ss)
    res = {"spreadsheet_token": ss, "bot_can_edit": acc["can_edit"], "bot_can_view": acc["can_view"]}
    if acc["can_edit"] is False:
        res.update(needs_access=True, bot_name=bot_name(fs), status="机器人没有编辑权限，写入会失败",
                   access_message=NOACCESS_MSG)
    elif acc["can_edit"]:
        res["status"] = "机器人有编辑权限，可以写入"
    else:
        res["status"] = "权限检查接口没有返回结果，无法确定；可以直接尝试写入，失败再按 91403 处理"
    return res


def cmd_fill(a):
    records, unknown = load_records(a.input)
    fs = Feishu()
    ss = locate(fs, a)
    acc = access_fields(fs, ss)
    if a.write and acc["bot_can_edit"] is False:
        raise NoAccess(NOACCESS_MSG)
    sh = pick_sheet(fs, ss, a.sheet)
    res = {**acc, **fill(fs, sh, records, not a.write, a.max_rows, a.on_duplicate, parse_map(a.map))}
    if unknown:
        res["unknown_record_keys"] = unknown
    return res


def cmd_create(a):
    records, unknown = load_records(a.input)
    share_to = a.share_to or os.environ.get("FEISHU_SHARE_TO")
    if not share_to:
        raise Fail("新建的表格归应用所有，必须指定分享给谁：--share-to <union_id(on_...)/邮箱/user_id>，"
                   "或设环境变量 FEISHU_SHARE_TO。否则没有人能打开它")
    if a.fields:
        fields = []
        for t in re.split(r"[,，]", a.fields):
            f = resolve_field(t.strip())
            if f is None:
                raise Fail(f"不认识的字段 {t!r}，可用: {', '.join(NAMES)}")
            if f not in fields:
                fields.append(f)
    else:
        fields = list(records[0]) if records else []
    if not fields:
        raise Fail("没有字段可建表头")
    if a.dry_run:
        return {"dry_run": True, "would_create": a.title, "headers": fields, "rows": len(records),
                "share_to": f"{member_of(share_to)}:{share_to[:6]}…"}
    fs = Feishu()
    body = {"title": a.title}
    if a.folder_token:
        body["folder_token"] = a.folder_token
    ss = fs.call("POST", "/open-apis/sheets/v3/spreadsheets", body)["spreadsheet"]
    sh = pick_sheet(fs, ss["spreadsheet_token"], None)
    fs.call("PUT", f"/open-apis/sheets/v2/spreadsheets/{ss['spreadsheet_token']}/values",
            {"valueRange": {"range": f"{sh['sid']}!A1:{col_letter(len(fields) - 1)}1", "values": [fields]}})
    try:
        share(fs, ss["spreadsheet_token"], share_to)
    except Fail as e:
        raise Fail(f"表格已创建但分享失败（{ss['url']}，现在只有应用能打开）: {e}")
    res = fill(fs, sh, records, False, a.max_rows)
    res["url"] = ss["url"]
    res["shared_to"] = f"{member_of(share_to)}:{share_to[:6]}…"
    if unknown:
        res["unknown_record_keys"] = unknown
    return res


# ---------- 评论工作表 ----------

COMMENT_SHEET = "评论"
COMMENT_HEADER = ["帖子链接", "评论"]
LINK_HEADERS = {"帖子链接", "发布链接", "笔记链接", "帖子地址", "笔记地址"}
COMMENT_HEADERS = {"评论", "评论内容"}
COMMENT_COL_WIDTHS = [(1, 300), (2, 600)]  # (列号, 像素)：A 放链接，B 放评论
COMMENT_MAX_ROWS = 200


def load_comment_file(path):
    with (sys.stdin if path == "-" else open(path, encoding="utf-8")) as f:
        d = json.load(f)
    if not isinstance(d, dict) or "comments" not in d or not d.get("note_link"):
        raise Fail("输入必须是 xhs_comments.py 的输出（含 note_link 和 comments）")
    texts = [str(c.get("content") if isinstance(c, dict) else c).strip() for c in d["comments"]]
    texts = [t for t in texts if t and t != "None"]
    if not texts:
        raise Fail("没有可写的评论")
    return d["note_link"], texts


def list_sheets(fs, ss):
    return fs.call("GET", f"/open-apis/sheets/v3/spreadsheets/{ss}/sheets/query").get("sheets", [])


def sheet_of(entry, ss):
    grid = entry.get("grid_properties") or {}
    return {"ss": ss, "sid": entry["sheet_id"], "title": entry["title"],
            "rows": grid.get("row_count") or 200, "cols": grid.get("column_count") or 20}


def set_col_width(fs, ss, sid, col, px):
    fs.call("PUT", f"/open-apis/sheets/v2/spreadsheets/{ss}/dimension_range",
            {"dimension": {"sheetId": sid, "majorDimension": "COLUMNS", "startIndex": col, "endIndex": col},
             "dimensionProperties": {"visible": True, "fixedSize": px}})


def cmd_comments(a):
    link, texts = load_comment_file(a.input)
    if len(texts) > a.max_rows:
        raise Fail(f"本次要写 {len(texts)} 行，超过上限 --max-rows {a.max_rows}。确认数量无误后加大 --max-rows 再运行")
    name = a.sheet or COMMENT_SHEET
    dry = not a.write
    warnings = []
    share_to = None
    if a.new_title:
        share_to = a.share_to or os.environ.get("FEISHU_SHARE_TO")
        if not share_to:
            raise Fail("新建的表格归应用所有，必须指定分享给谁：--share-to <union_id(on_...)>，或设环境变量 FEISHU_SHARE_TO")
    plan = {"note_link": link, "comments": len(texts), "sheet": name}
    if dry and a.new_title:
        return {**plan, "dry_run": True, "status": "未写入（预览）。会新建表格并写入，加 --write 才执行",
                "would_create": a.new_title, "rows_to_write": len(texts)}

    fs = Feishu()
    created_doc = None
    if a.new_title:
        body = {"title": a.new_title}
        if a.folder_token:
            body["folder_token"] = a.folder_token
        created_doc = fs.call("POST", "/open-apis/sheets/v3/spreadsheets", body)["spreadsheet"]
        ss = created_doc["spreadsheet_token"]
        try:
            share(fs, ss, share_to)
        except Fail as e:
            raise Fail(f"表格已创建但分享失败（{created_doc['url']}，现在只有应用能打开）: {e}")
    else:
        ss = locate(fs, a)
        acc = access_fields(fs, ss)
        if not dry and acc["bot_can_edit"] is False:
            raise NoAccess(NOACCESS_MSG)
        plan.update(acc)
    entries = list_sheets(fs, ss)
    if not entries:
        raise Fail("表格里没有子表")

    target = next((e for e in entries if name in (e["title"], e["sheet_id"])), None)
    fresh = False
    if created_doc:  # 新建的表格里只有一个默认子表，改名成「评论」，不留空的 Sheet1
        fs.call("POST", f"/open-apis/sheets/v2/spreadsheets/{ss}/sheets_batch_update",
                {"requests": [{"updateSheet": {"properties": {"sheetId": entries[0]["sheet_id"], "title": name}}}]})
        entries[0]["title"] = name
        target, fresh = entries[0], True
    elif target is None:
        if dry:
            return {**plan, "dry_run": True, "spreadsheet_title": sheet_title(fs, ss),
                    "status": f"未写入（预览）。表格里没有「{name}」工作表，加 --write 会新建",
                    "sheet_exists": False, "rows_to_write": len(texts)}
        r = fs.call("POST", f"/open-apis/sheets/v2/spreadsheets/{ss}/sheets_batch_update",
                    {"requests": [{"addSheet": {"properties": {"title": name, "index": len(entries)}}}]})
        sid = r["replies"][0]["addSheet"]["properties"]["sheetId"]
        target = next(e for e in list_sheets(fs, ss) if e["sheet_id"] == sid)
        fresh = True
    sh = sheet_of(target, ss)
    scan_w = min(sh["cols"], 30)

    last_row = last_used_row(fs, sh, scan_w)
    header_written = False
    if last_row == 0:
        fresh = True
    if not fresh:
        hdr = [cell_text(c) for c in (read_values(fs, sh, "A1:B1") or [[]])[0]]
        hdr += [""] * (2 - len(hdr))
        if hdr[0].strip() not in LINK_HEADERS or hdr[1].strip() not in COMMENT_HEADERS:
            raise Fail(f"工作表「{sh['title']}」第一行不是「帖子链接 | 评论」（现在是 {hdr[:2]}），"
                       "没有写入任何内容。请换一个工作表名（--sheet）或让它保持为空")
    if dry:
        start = max(last_row, 1) + 1
        return {**plan, "dry_run": True, "spreadsheet_title": sheet_title(fs, ss), "sheet": sh["title"],
                "status": "未写入（预览）。确认无误后加 --write 才会真正写入",
                "sheet_exists": True, "existing_last_row": last_row, "rows_to_write": len(texts),
                "write_range": f"A{start}:B{start + len(texts) - 1}"}

    if fresh:
        fs.call("PUT", f"/open-apis/sheets/v2/spreadsheets/{ss}/values",
                {"valueRange": {"range": f"{sh['sid']}!A1:B1", "values": [COMMENT_HEADER]}})
        header_written = True
        last_row = 1
        for col, px in COMMENT_COL_WIDTHS:
            try:
                set_col_width(fs, ss, sh["sid"], col, px)
            except Fail as e:
                warnings.append(f"列宽没设成功: {e}")

    start = last_row + 1
    end = start + len(texts) - 1
    grow_rows(fs, sh, end)
    ensure_empty(fs, sh, start, end, scan_w)
    rows = [[{"type": "url", "text": link, "link": link} if i == 0 else "", t] for i, t in enumerate(texts)]
    for i in range(0, len(rows), APPEND_BATCH):
        chunk = rows[i:i + APPEND_BATCH]
        a0 = start + i
        if i:  # 超过一批时，后面的批次左列留空（已经属于同一个合并区域）
            chunk = [["", r[1]] for r in chunk]
        fs.call("PUT", f"/open-apis/sheets/v2/spreadsheets/{ss}/values",
                {"valueRange": {"range": f"{sh['sid']}!A{a0}:B{a0 + len(chunk) - 1}", "values": chunk}})
    merged = None
    if end > start:
        try:
            fs.call("POST", f"/open-apis/sheets/v2/spreadsheets/{ss}/merge_cells",
                    {"range": f"{sh['sid']}!A{start}:A{end}", "mergeType": "MERGE_ALL"})
            merged = f"A{start}:A{end}"
            fs.call("PUT", f"/open-apis/sheets/v2/spreadsheets/{ss}/style",
                    {"appendStyle": {"range": f"{sh['sid']}!A{start}:A{end}", "style": {"vAlign": 1, "hAlign": 0}}})
        except Fail as e:
            warnings.append(f"合并或对齐没完全成功（评论已写入）: {e}")
    res = {**plan, "dry_run": False, "status": "已写入",
           "spreadsheet_title": sheet_title(fs, ss), "sheet": sh["title"],
           "sheet_created_or_empty": fresh, "header_written": header_written,
           "existing_last_row": last_row, "rows_written": len(texts),
           "write_range": f"A{start}:B{end}", "merged_range": merged}
    if created_doc:
        res["url"] = created_doc["url"]
        res["shared_to"] = f"{member_of(share_to)}:{share_to[:6]}…"
    if warnings:
        res["warnings"] = warnings
    return res


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)

    def target(p):
        p.add_argument("--url", help="表格链接（/sheets/ 或 /wiki/）")
        p.add_argument("--token", help="表格 token")
        p.add_argument("--sheet", help="子表名称或 sheet_id，缺省为第一个可见子表")

    sub.add_parser("check", help="检查飞书凭证能否换到 token（不读写任何表格）")
    p = sub.add_parser("access", help="检查机器人对这张表有没有编辑权限（只读，不改任何东西）；没有则退出码 3")
    target(p)
    map_help = ("表头对应关系：表头原文=字段名，可重复。程序认不出的表头，由 AI 判断意思相同后用它补上，"
                "例如 --map \"曝光数据=曝光量\"。只对这次运行有效，不会改表头")
    p = sub.add_parser("inspect", help="读表头并匹配字段")
    target(p)
    p.add_argument("--map", action="append", help=map_help)
    p = sub.add_parser("fill", help="按表头追加到已有表格")
    target(p)
    p.add_argument("--input", "-i", required=True, help="xhs_fetch.py 输出的 JSON，- 表示 stdin")
    p.add_argument("--write", action="store_true", help="真正写入；不加则只预览，不改动表格")
    p.add_argument("--max-rows", type=int, default=DEFAULT_MAX_ROWS, help=f"一次最多写多少行，默认 {DEFAULT_MAX_ROWS}")
    p.add_argument("--map", action="append", help=map_help)
    p.add_argument("--on-duplicate", choices=["update", "append"],
                   help="数据里的帖子（发布链接）在表里已经有时怎么处理：update=更新原有行，append=追加为新行。"
                        "不指定则发现重复就停下不写（退出码 2），要先问用户")
    p = sub.add_parser("create", help="新建表格并写入")
    p.add_argument("--title", required=True)
    p.add_argument("--input", "-i", required=True)
    p.add_argument("--share-to", help="分享给谁（full_access）：union_id(on_...) / 邮箱 / user_id；默认读 FEISHU_SHARE_TO")
    p.add_argument("--fields", help="表头字段（逗号分隔，决定列顺序）；缺省用数据里的字段顺序")
    p.add_argument("--folder-token", help="放进指定云空间文件夹，缺省在应用的根目录")
    p.add_argument("--max-rows", type=int, default=DEFAULT_MAX_ROWS, help=f"一次最多写多少行，默认 {DEFAULT_MAX_ROWS}")
    p.add_argument("--dry-run", action="store_true", help="只打印将要创建的内容，不创建")
    p = sub.add_parser("comments", help="把一篇笔记的评论写进「评论」工作表")
    target(p)
    p.add_argument("--input", "-i", required=True, help="xhs_comments.py 输出的 JSON，- 表示 stdin")
    p.add_argument("--new-title", help="连表格一起新建（标题）；不给则写进 --url 指定的已有表格")
    p.add_argument("--share-to", help="仅 --new-title 用：分享给谁；默认读 FEISHU_SHARE_TO")
    p.add_argument("--folder-token", help="仅 --new-title 用：放进指定云空间文件夹")
    p.add_argument("--write", action="store_true", help="真正写入；不加则只预览，不改动表格")
    p.add_argument("--max-rows", type=int, default=COMMENT_MAX_ROWS, help=f"一次最多写多少条评论，默认 {COMMENT_MAX_ROWS}")
    a = ap.parse_args()
    for stream in (sys.stdout, sys.stderr, sys.stdin):
        stream.reconfigure(encoding="utf-8", errors="replace")
    try:
        res = {"check": cmd_check, "access": cmd_access, "inspect": cmd_inspect, "fill": cmd_fill, "create": cmd_create,
               "comments": cmd_comments}[a.cmd](a)
    except NoAccess as e:
        print(f"[feishu_sheet] {e}", file=sys.stderr)
        return 3
    except Fail as e:
        print(f"[feishu_sheet] {e}", file=sys.stderr)
        return 1
    print(json.dumps(res, ensure_ascii=False, indent=2))
    if res.get("needs_access"):
        return 3
    return 2 if res.get("needs_decision") else 0


if __name__ == "__main__":
    sys.exit(main())

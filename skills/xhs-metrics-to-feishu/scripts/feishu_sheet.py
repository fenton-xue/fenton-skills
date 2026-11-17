#!/usr/bin/env python3
"""第二段：把小红书 JSON 写入飞书表格（仅依赖标准库）。

按「发布链接」去重：不存在则追加，已存在则只更新这 14 个字段所在的单元格。
环境变量：FEISHU_APP_ID、FEISHU_APP_SECRET；可选 FEISHU_BASE_URL（测试用）。
"""
import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request

HEADERS = [
    "小红书昵称", "ID", "粉丝量（W）", "类型", "主页链接", "发布链接", "发布时间",
    "曝光量", "阅读量", "点赞", "收藏", "评论", "转发", "总互动",
]
URL_FIELDS = {"主页链接", "发布链接"}
FLOAT_FIELDS = {"粉丝量（W）"}
INT_FIELDS = {"曝光量", "阅读量", "点赞", "收藏", "评论", "转发", "总互动"}
STR_FIELDS = {"小红书昵称", "ID", "类型", "发布时间"} | URL_FIELDS
APPEND_BATCH = 500
HEADER_SCAN = "A1:AZ1"


class FeishuError(RuntimeError):
    pass


def load_env_file(path):
    """仅在显式传 --env-file 时使用：从 `export KEY=VALUE` 格式文件补齐环境变量；已有环境变量优先。"""
    if not path:
        return
    if not os.path.isfile(path):
        raise FeishuError(f"--env-file 指向的文件不存在: {path}")
    with open(path, encoding="utf-8") as f:
        for line in f:
            m = re.match(r"\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)=(.*)\s*$", line)
            if m and m.group(1) not in os.environ:
                os.environ[m.group(1)] = m.group(2).strip().strip("'\"")


def norm(name):
    """表头比较：去空白，半角括号统一成全角。"""
    return str(name).strip().replace("(", "（").replace(")", "）")


def col_letter(i):
    """0 基列号 -> A, B, ..., AA"""
    s, i = "", i + 1
    while i:
        i, r = divmod(i - 1, 26)
        s = chr(65 + r) + s
    return s


# ---------- 输入校验 ----------

def to_number(v, kind):
    if v is None or v == "":
        return None
    if isinstance(v, bool):
        raise ValueError("布尔值不是数字")
    if isinstance(v, str):
        v = v.replace(",", "").strip()
        if v in ("", "-", "—"):
            return None
    n = float(v)
    return int(n) if kind == "int" else n


def validate(records):
    if not isinstance(records, list):
        raise ValueError("输入必须是 JSON 数组")
    out, errors = [], []
    for i, rec in enumerate(records, 1):
        if not isinstance(rec, dict):
            errors.append(f"第 {i} 条不是对象")
            continue
        lookup = {norm(k): v for k, v in rec.items()}
        missing = [h for h in HEADERS if norm(h) not in lookup]
        if missing:
            errors.append(f"第 {i} 条缺少字段: {', '.join(missing)}")
            continue
        row = {}
        for h in HEADERS:
            v = lookup[norm(h)]
            try:
                if h in FLOAT_FIELDS:
                    row[h] = to_number(v, "float")
                elif h in INT_FIELDS:
                    row[h] = to_number(v, "int")
                else:
                    row[h] = "" if v is None else str(v).strip()
            except (ValueError, TypeError) as e:
                errors.append(f"第 {i} 条字段 {h} 无法解析为数字: {v!r} ({e})")
        if not row.get("发布链接"):
            errors.append(f"第 {i} 条发布链接为空，无法去重")
        out.append(row)
    if errors:
        raise ValueError("输入校验失败:\n  " + "\n  ".join(errors))
    return out


def to_cell(field, v):
    if v is None or v == "":
        return ""
    if field in URL_FIELDS:
        return {"type": "url", "text": str(v), "link": str(v)}
    return v  # ID 等已在 validate 中保持为 str，数字字段为 int/float


# ---------- 飞书 API ----------

class Feishu:
    def __init__(self, app_id, app_secret, base=None):
        self.base = (base or os.environ.get("FEISHU_BASE_URL") or "https://open.feishu.cn").rstrip("/")
        self.token = self._tenant_token(app_id, app_secret)

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
            raw = e.read()  # 飞书错误时 body 里仍有 code/msg
            if not raw:
                raise FeishuError(f"HTTP {e.code} {method} {path}") from e
        try:
            return json.loads(raw)
        except ValueError as e:
            raise FeishuError(f"响应不是 JSON: {raw[:200]!r}") from e

    def _call(self, method, path, body=None, query=None):
        payload = self._request(method, path, body, query)
        if payload.get("code") != 0:
            raise FeishuError(f"{method} {path} -> code={payload.get('code')} msg={payload.get('msg')}")
        return payload.get("data") or {}

    def _tenant_token(self, app_id, app_secret):
        payload = self._request(
            "POST", "/open-apis/auth/v3/tenant_access_token/internal",
            {"app_id": app_id, "app_secret": app_secret}, auth=False)
        if payload.get("code") != 0 or not payload.get("tenant_access_token"):
            raise FeishuError(f"获取 tenant_access_token 失败: code={payload.get('code')} msg={payload.get('msg')}")
        return payload["tenant_access_token"]

    # 表格定位
    def resolve_spreadsheet(self, value):
        m = re.search(r"/(sheets|wiki)/([A-Za-z0-9]+)", value)
        kind, tok = (m.group(1), m.group(2)) if m else ("sheets", value.strip())
        if kind == "wiki":
            node = self._call("GET", "/open-apis/wiki/v2/spaces/get_node", query={"token": tok}).get("node", {})
            if node.get("obj_type") != "sheet":
                raise FeishuError(f"该知识库节点不是电子表格 (obj_type={node.get('obj_type')})")
            return node["obj_token"]
        return tok

    def resolve_sheet(self, ss, sheet):
        sheets = self._call("GET", f"/open-apis/sheets/v3/spreadsheets/{ss}/sheets/query").get("sheets", [])
        if not sheets:
            raise FeishuError("表格里没有子表")
        if not sheet:
            return sheets[0]["sheet_id"], sheets[0]["title"]
        for s in sheets:
            if sheet in (s["sheet_id"], s["title"]):
                return s["sheet_id"], s["title"]
        names = ", ".join(f"{s['title']}({s['sheet_id']})" for s in sheets)
        raise FeishuError(f"找不到子表 {sheet!r}，可选: {names}")

    # 读写
    def read(self, ss, rng):
        q = urllib.parse.quote(rng, safe="")
        data = self._call("GET", f"/open-apis/sheets/v2/spreadsheets/{ss}/values/{q}",
                          query={"valueRenderOption": "ToString"})
        return (data.get("valueRange") or {}).get("values") or []

    def write(self, ss, rng, values):
        self._call("PUT", f"/open-apis/sheets/v2/spreadsheets/{ss}/values",
                   {"valueRange": {"range": rng, "values": values}})

    def append(self, ss, rng, values):
        self._call("POST", f"/open-apis/sheets/v2/spreadsheets/{ss}/values_append",
                   {"valueRange": {"range": rng, "values": values}},
                   query={"insertDataOption": "INSERT_ROWS"})

    def batch_update(self, ss, ranges):
        self._call("POST", f"/open-apis/sheets/v2/spreadsheets/{ss}/values_batch_update",
                   {"valueRanges": [{"range": r, "values": v} for r, v in ranges]})


def cell_text(v):
    """读回的单元格可能是文本、数字，或超链接片段列表。"""
    if v is None:
        return ""
    if isinstance(v, list):
        return "".join(cell_text(x) for x in v)
    if isinstance(v, dict):
        return str(v.get("link") or v.get("text") or "")
    return str(v).strip()


def contiguous_runs(indices):
    runs, start, prev = [], None, None
    for i in sorted(indices):
        if start is None:
            start = prev = i
        elif i == prev + 1:
            prev = i
        else:
            runs.append((start, prev))
            start = prev = i
    if start is not None:
        runs.append((start, prev))
    return runs


# ---------- 主流程 ----------

def run(args):
    with (sys.stdin if args.input == "-" else open(args.input, encoding="utf-8")) as f:
        records = validate(json.load(f))

    # 同一批内按去重键去重，后者覆盖前者
    by_key = {}
    for r in records:
        by_key[r["发布链接"]] = r
    batch = list(by_key.values())
    summary = {"input": len(records), "unique": len(batch)}

    if args.validate_only:
        summary["validate_only"] = True
        return summary

    load_env_file(args.env_file)
    app_id, secret = os.environ.get("FEISHU_APP_ID"), os.environ.get("FEISHU_APP_SECRET")
    if not app_id or not secret:
        raise FeishuError("缺少环境变量 FEISHU_APP_ID / FEISHU_APP_SECRET（也可用 --env-file 指定 export 格式文件）")
    if not args.spreadsheet:
        raise FeishuError("缺少 --spreadsheet")

    fs = Feishu(app_id, secret)
    ss = fs.resolve_spreadsheet(args.spreadsheet)
    sid, title = fs.resolve_sheet(ss, args.sheet)
    summary.update(sheet=title, dry_run=args.dry_run)

    # 表头：为空则初始化，否则按表头名定位列
    header_rows = fs.read(ss, f"{sid}!{HEADER_SCAN}")
    header = [cell_text(x) for x in (header_rows[0] if header_rows else [])]
    if not any(header):
        if not args.dry_run:
            fs.write(ss, f"{sid}!A1:{col_letter(len(HEADERS) - 1)}1", [HEADERS])
        header = list(HEADERS)
        summary["header_initialized"] = True
    colmap = {norm(h): i for i, h in enumerate(header) if h}
    missing = [h for h in HEADERS if norm(h) not in colmap]
    if missing:
        raise FeishuError(f"表头缺少: {', '.join(missing)}（第一行表头需与 references/schema.md 一致）")
    ncols = len(header)
    key_col = colmap[norm(args.key_field)]

    # 读去重键列 -> {key: 行号(1 基)}
    existing = {}
    if not summary.get("header_initialized"):
        kl = col_letter(key_col)
        for idx, row in enumerate(fs.read(ss, f"{sid}!{kl}:{kl}")):
            if idx == 0:
                continue  # 表头行
            k = cell_text(row[0] if row else None)
            if k and k not in existing:
                existing[k] = idx + 1

    to_append, to_update = [], []
    skipped = 0
    for r in batch:
        key = r[args.key_field]
        if key in existing:
            if args.on_duplicate == "skip":
                skipped += 1
            else:
                to_update.append((existing[key], r))
        else:
            to_append.append(r)

    summary.update(appended=len(to_append), updated=len(to_update), skipped=skipped)
    if args.dry_run:
        return summary

    # 追加：按表头顺序组行，表里额外的列留空
    if to_append:
        rows = []
        for r in to_append:
            row = [""] * ncols
            for h in HEADERS:
                row[colmap[norm(h)]] = to_cell(h, r[h])
            rows.append(row)
        last = col_letter(ncols - 1)
        for i in range(0, len(rows), APPEND_BATCH):
            chunk = rows[i:i + APPEND_BATCH]
            # 真实接口要求 range 行数 >= 待写入行数（否则 90202），追加位置仍是表尾
            fs.append(ss, f"{sid}!A1:{last}{len(chunk)}", chunk)

    # 更新：只写本脚本管理的列，成片连续的列合成一个范围，避免覆盖用户手加的列
    if to_update:
        runs = contiguous_runs(colmap[norm(h)] for h in HEADERS)
        inv = {colmap[norm(h)]: h for h in HEADERS}
        ranges = []
        for rowno, r in to_update:
            for a, b in runs:
                ranges.append((f"{sid}!{col_letter(a)}{rowno}:{col_letter(b)}{rowno}",
                               [[to_cell(inv[c], r[inv[c]]) for c in range(a, b + 1)]]))
        for i in range(0, len(ranges), 100):
            fs.batch_update(ss, ranges[i:i + 100])
    return summary


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--input", "-i", required=True, help="第一段输出的 JSON 文件，- 表示 stdin")
    ap.add_argument("--spreadsheet", help="飞书表格链接或 token（/sheets/ 或 /wiki/ 链接均可）")
    ap.add_argument("--sheet", help="子表名称或 sheet_id，缺省为第一个子表")
    ap.add_argument("--key-field", default="发布链接", choices=HEADERS, help="去重键，默认发布链接")
    ap.add_argument("--on-duplicate", choices=["update", "skip"], default="update")
    ap.add_argument("--dry-run", action="store_true", help="读取飞书但不写入，只打印计划")
    ap.add_argument("--validate-only", action="store_true", help="只做本地校验，不访问网络")
    ap.add_argument("--env-file", help="可选：export 格式的凭证文件；默认只读环境变量")
    args = ap.parse_args()
    try:
        summary = run(args)
    except (ValueError, FeishuError, OSError) as e:
        print(f"[feishu_sheet] {e}", file=sys.stderr)
        return 1
    print(json.dumps(summary, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())

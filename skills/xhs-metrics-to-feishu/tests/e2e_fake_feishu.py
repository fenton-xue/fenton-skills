#!/usr/bin/env python3
"""用本地假飞书服务端到端验证 feishu_sheet.py 的写入逻辑（不访问真实飞书）。

假服务只模拟本 skill 用到的接口，用来验证：请求流程、表头初始化、追加、
按发布链接更新、不动用户手加的列。它不能证明真实飞书一定接受这些请求。
"""
import copy
import json
import os
import re
import subprocess
import sys
import tempfile
import threading
import urllib.parse
from http.server import BaseHTTPRequestHandler, HTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
SKILL = os.path.dirname(HERE)
SCRIPT = os.path.join(SKILL, "scripts", "feishu_sheet.py")
FETCH = os.path.join(SKILL, "scripts", "fetch_xhs.py")

GRID = {}  # (row, col) 1 基 -> value
CALLS = []


def col_to_n(s):
    n = 0
    for ch in s:
        n = n * 26 + ord(ch) - 64
    return n


def parse_range(rng):
    _, ref = rng.split("!")
    m = re.fullmatch(r"([A-Z]+)(\d*)(?::([A-Z]+)(\d*))?", ref)
    c1, r1, c2, r2 = m.groups()
    c2 = c2 or c1
    r1 = int(r1) if r1 else 1
    r2 = int(r2) if r2 else max([r for r, _ in GRID] + [r1])
    return r1, col_to_n(c1), r2, col_to_n(c2)


def cell_value(v):
    if isinstance(v, dict) and v.get("type") == "url":
        return v["text"]  # ToString 渲染
    return v


def put(rng, values):
    r1, c1, _, _ = parse_range(rng)
    for i, row in enumerate(values):
        for j, v in enumerate(row):
            GRID[(r1 + i, c1 + j)] = cell_value(v)


def max_row():
    return max([r for r, _ in GRID] + [0])


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _send(self, obj, status=200):
        raw = json.dumps(obj).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def _body(self):
        n = int(self.headers.get("Content-Length") or 0)
        return json.loads(self.rfile.read(n)) if n else {}

    def _authed(self):
        return self.headers.get("Authorization") == "Bearer fake-token"

    def do_POST(self):
        path = urllib.parse.urlparse(self.path).path
        body = self._body()
        CALLS.append(("POST", path))
        if path.endswith("/tenant_access_token/internal"):
            ok = body.get("app_id") == "cli_test" and body.get("app_secret") == "secret"
            return self._send({"code": 0, "tenant_access_token": "fake-token"} if ok
                              else {"code": 10003, "msg": "invalid param"})
        if not self._authed():
            return self._send({"code": 99991661, "msg": "no token"}, 400)
        if path.endswith("/values_append"):
            vr = body["valueRange"]
            r1, _, r2, _ = parse_range(vr["range"])
            if len(vr["values"]) > r2 - r1 + 1:  # 与真实飞书一致：range 行数必须 >= 写入行数
                return self._send({"code": 90202, "msg": "range in request is wrong, rows of value:%d > range" % len(vr["values"])})
            put(f"{vr['range'].split('!')[0]}!A{max_row() + 1}", vr["values"])
            return self._send({"code": 0, "data": {}})
        if path.endswith("/values_batch_update"):
            for vr in body["valueRanges"]:
                put(vr["range"], vr["values"])
            return self._send({"code": 0, "data": {}})
        self._send({"code": 404, "msg": "unknown"}, 404)

    def do_PUT(self):
        path = urllib.parse.urlparse(self.path).path
        body = self._body()
        CALLS.append(("PUT", path))
        if not self._authed():
            return self._send({"code": 99991661, "msg": "no token"}, 400)
        vr = body["valueRange"]
        put(vr["range"], vr["values"])
        self._send({"code": 0, "data": {}})

    def do_GET(self):
        u = urllib.parse.urlparse(self.path)
        CALLS.append(("GET", u.path))
        if not self._authed():
            return self._send({"code": 99991661, "msg": "no token"}, 400)
        if u.path.endswith("/sheets/query"):
            return self._send({"code": 0, "data": {"sheets": [{"sheet_id": "sh1", "title": "小红书数据"}]}})
        m = re.search(r"/values/(.+)$", u.path)
        if m:
            rng = urllib.parse.unquote(m.group(1))
            r1, c1, r2, c2 = parse_range(rng)
            rows = [[GRID.get((r, c)) for c in range(c1, c2 + 1)] for r in range(r1, r2 + 1)]
            return self._send({"code": 0, "data": {"valueRange": {"range": rng, "values": rows}}})
        self._send({"code": 404, "msg": "unknown"}, 404)


def run_script(port, input_path, *extra):
    env = dict(os.environ, FEISHU_APP_ID="cli_test", FEISHU_APP_SECRET="secret",
               FEISHU_BASE_URL=f"http://127.0.0.1:{port}")
    p = subprocess.run([sys.executable, "-I", SCRIPT, "--input", input_path,
                        "--spreadsheet", "https://x.feishu.cn/sheets/shtTEST", "--sheet", "小红书数据", *extra],
                       env=env, capture_output=True, text=True)
    return p.returncode, p.stdout.strip(), p.stderr.strip()


def check(name, cond, detail=""):
    print(("PASS " if cond else "FAIL ") + name + (f"  {detail}" if detail and not cond else ""))
    if not cond:
        check.failed += 1


check.failed = 0


def main():
    srv = HTTPServer(("127.0.0.1", 0), H)
    port = srv.server_address[1]
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    tmp = tempfile.mkdtemp(prefix="xhs_e2e_")

    data_path = os.path.join(tmp, "xhs.json")
    subprocess.run([sys.executable, "-I", FETCH, "--mock", "-o", data_path], check=True, capture_output=True)
    data = json.load(open(data_path, encoding="utf-8"))

    # 1. 本地校验
    rc, out, err = run_script(port, data_path, "--validate-only")
    check("validate-only 通过", rc == 0 and '"validate_only": true' in out, err)

    # 2. 字段缺失被拒绝
    bad = copy.deepcopy(data)
    del bad[0]["曝光量"]
    bad_path = os.path.join(tmp, "bad.json")
    json.dump(bad, open(bad_path, "w", encoding="utf-8"), ensure_ascii=False)
    rc, out, err = run_script(port, bad_path, "--validate-only")
    check("缺字段报错", rc == 1 and "曝光量" in err, err)

    # 3. 空表 dry-run 不写入
    rc, out, err = run_script(port, data_path, "--dry-run")
    check("dry-run 不写入", rc == 0 and not GRID and json.loads(out)["appended"] == 3, out + err)

    # 4. 空表首次写入：写表头 + 3 行
    rc, out, err = run_script(port, data_path)
    s = json.loads(out) if rc == 0 else {}
    check("首次写入 appended=3", s.get("appended") == 3 and s.get("header_initialized"), out + err)
    check("表头在第 1 行", [GRID.get((1, c)) for c in range(1, 15)][:3] == ["小红书昵称", "ID", "粉丝量（W）"])
    check("共 4 行", max_row() == 4, str(max_row()))
    check("ID 保持字符串", GRID.get((2, 2)) == "100000001", repr(GRID.get((2, 2))))
    check("发布链接写入", GRID.get((2, 6)) == "https://www.xiaohongshu.com/explore/note0001")

    # 5. 用户在 O 列手加备注，再次同步指标变化 + 1 条新数据
    GRID[(2, 15)] = "手写备注"
    data2 = copy.deepcopy(data)
    data2[0]["点赞"] = 9999
    data2[0]["总互动"] = 9999 + 900 + 120 + 60
    data2.append(dict(data[1], **{"发布链接": "https://www.xiaohongshu.com/explore/note0004", "ID": "100000009"}))
    d2 = os.path.join(tmp, "xhs2.json")
    json.dump(data2, open(d2, "w", encoding="utf-8"), ensure_ascii=False)
    rc, out, err = run_script(port, d2)
    s = json.loads(out) if rc == 0 else {}
    check("再次同步 updated=3 appended=1", s.get("updated") == 3 and s.get("appended") == 1, out + err)
    check("已有行指标被更新", GRID.get((2, 10)) == 9999, repr(GRID.get((2, 10))))
    check("手加的 O 列未被覆盖", GRID.get((2, 15)) == "手写备注", repr(GRID.get((2, 15))))
    check("新行追加到末尾", GRID.get((5, 6)) == "https://www.xiaohongshu.com/explore/note0004" and max_row() == 5)

    # 6. skip 模式
    rc, out, err = run_script(port, d2, "--on-duplicate", "skip")
    s = json.loads(out) if rc == 0 else {}
    check("skip 模式全部跳过", s.get("skipped") == 4 and s.get("appended") == 0 and s.get("updated") == 0, out + err)

    # 7. 表头被用户改坏时拒绝写入
    GRID[(1, 7)] = "发布日期"
    n = max_row()
    rc, out, err = run_script(port, data_path)
    check("表头缺失拒绝写入", rc == 1 and "发布时间" in err and max_row() == n, err)

    # 8. 凭证错误
    env = dict(os.environ, FEISHU_APP_ID="cli_test", FEISHU_APP_SECRET="wrong",
               FEISHU_BASE_URL=f"http://127.0.0.1:{port}")
    p = subprocess.run([sys.executable, "-I", SCRIPT, "-i", data_path, "--spreadsheet", "shtTEST"],
                       env=env, capture_output=True, text=True)
    check("错误凭证报错", p.returncode == 1 and "tenant_access_token" in p.stderr, p.stderr)

    print(f"\n{'全部通过' if not check.failed else str(check.failed) + ' 项失败'}")
    return 1 if check.failed else 0


if __name__ == "__main__":
    sys.exit(main())

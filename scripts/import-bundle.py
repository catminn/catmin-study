#!/usr/bin/env python3
"""把私有内容包导入网站（管理员通道）。内容只经 HTTPS 发给你自己的网站，不打印任何内容。
用法（PowerShell）：
  $env:SITE="https://study.catmin.io"; $env:PASS="你的口令"
  python scripts/import-bundle.py 内容包.json            # 导入
  python scripts/import-bundle.py 内容包.json --dry-run  # 只检查不发送
"""
import json, os, sys, requests
if len(sys.argv) < 2: sys.exit("用法：python scripts/import-bundle.py <bundle.json> [--dry-run]")
b = json.load(open(sys.argv[1], encoding="utf-8")); recs = b["records"]; dry = "--dry-run" in sys.argv
kinds = {}
for r in recs: kinds[r["kind"]] = kinds.get(r["kind"], 0) + 1
print("内容包：", len(recs), "条", kinds)
if dry: sys.exit(0)
SITE = os.environ.get("SITE", "https://study.catmin.io"); PW = os.environ["PASS"]
s = requests.Session(); s.trust_env = False
r = s.post(SITE + "/api/login", json={"password": PW}); r.raise_for_status()
h = {"Cookie": r.headers["Set-Cookie"].split(";")[0], "X-Owner-Password": PW}
ok = bad = same = 0
for r in recs:
    x = requests.put(SITE + "/api/adventure/content", json={"kind": r["kind"], "id": r["id"], "content": r["content"]}, headers=h, timeout=60)
    if x.status_code == 200:
        if x.json().get("unchanged"): same += 1
        else: ok += 1
    else:
        bad += 1; print("失败：", r["kind"], x.status_code, x.json().get("error"))
print(f"完成：新写入/更新 {ok}，未变 {same}，失败 {bad}")
sys.exit(1 if bad else 0)

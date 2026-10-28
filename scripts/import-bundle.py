#!/usr/bin/env python3
"""把私有内容包导入网站（管理员通道）。内容只经 HTTPS 发给你自己的网站，不打印任何内容。
用法（PowerShell）：
  $env:SITE="https://study.catmin.io"; $env:PASS="你的口令"
  python scripts/import-bundle.py 内容包.json            # 导入
  python scripts/import-bundle.py 内容包.json --dry-run  # 只检查不发送
  python scripts/import-bundle.py 内容包.json --compare  # 只读：与线上逐条比对，只输出计数，不写入
  python scripts/import-bundle.py --pin-legacy           # 预演：旧存档有几条需要固定到旧版世界（只看计数）
  python scripts/import-bundle.py --pin-legacy --confirm # 执行固定（幂等）
  python scripts/import-bundle.py --world-status         # 只读：世界列表与默认世界
  python scripts/import-bundle.py --set-default world01  # 设新游戏的默认世界（--set-default none 清除）
命名空间包（scripts/namespace-bundle.mjs 的输出）会在导入前用 world-manifest 校验器做结构预检，
导入后按服务器返回的确切修订生成世界清单 <内容包>.manifest.json（只含 id/修订，不含正文）并再校验一次。
"""
import json, os, sys, subprocess, requests
def check_manifest(m, available):
    p = subprocess.run(["node", os.path.join(os.path.dirname(__file__), "check-manifest.mjs")], input=json.dumps({"manifest": m, "available": available}), capture_output=True, text=True)
    try: return json.loads(p.stdout)
    except Exception: return {"ok": False, "errors": ["validator_unavailable"]}
if len(sys.argv) < 2: sys.exit("用法：python scripts/import-bundle.py <bundle.json> [--dry-run|--compare] 或 --pin-legacy [--confirm] / --world-status / --set-default <worldId|none>")
ADMIN_OPS = {"--pin-legacy", "--world-status", "--set-default"}
if sys.argv[1] in ADMIN_OPS:
    SITE = os.environ.get("SITE", "https://study.catmin.io"); PW = os.environ["PASS"]
    s0 = requests.Session(); s0.trust_env = False
    r = s0.post(SITE + "/api/login", json={"password": PW}); r.raise_for_status()
    h = {"Cookie": r.headers["Set-Cookie"].split(";")[0], "X-Owner-Password": PW}
    if sys.argv[1] == "--pin-legacy":
        x = requests.post(SITE + "/api/adventure/admin/pin-legacy", json={"confirm": True} if "--confirm" in sys.argv else {}, headers=h, timeout=60)
    elif sys.argv[1] == "--world-status":
        x = requests.get(SITE + "/api/adventure/admin/default-world", headers=h, timeout=60)
    else:
        w = sys.argv[2] if len(sys.argv) > 2 else ""
        x = requests.put(SITE + "/api/adventure/admin/default-world", json={"worldId": None if w == "none" else w}, headers=h, timeout=60)
    print(x.status_code, {k: v for k, v in x.json().items() if k != "ok"})
    sys.exit(0 if x.status_code == 200 else 1)
b = json.load(open(sys.argv[1], encoding="utf-8")); recs = b["records"]; dry = "--dry-run" in sys.argv
kinds = {}
for r in recs: kinds[r["kind"]] = kinds.get(r["kind"], 0) + 1
print("内容包：", len(recs), "条", kinds)
W = b.get("worldId") if b.get("namespaced") else None
def manifest(revs):
    w = next((r for r in recs if r["kind"] == "world"), None)
    start = (w or {}).get("content", {}).get("startSceneRef") or (w or {}).get("content", {}).get("startSceneId")
    start = start if (start or "").startswith(W + ":") else f"{W}:{start}"
    return {"worldId": W, "manifestRevision": b.get("manifestRevision", 1), "globalRulesVersion": b.get("globalRulesVersion"),
            "startSceneRef": start, "startSceneId": start.split(":", 1)[1],
            "contentRefs": [{"kind": r["kind"], "ref": r["id"], "rev": revs.get((r["kind"], r["id"]), 1)} for r in recs]}
if W:
    pre = check_manifest(manifest({}), None)
    print("清单结构预检：", "通过" if pre["ok"] else pre["errors"])
    if not pre["ok"]: sys.exit("清单结构预检未通过，未导入任何内容")
if dry: sys.exit(0)
SITE = os.environ.get("SITE", "https://study.catmin.io"); PW = os.environ["PASS"]
s = requests.Session(); s.trust_env = False
r = s.post(SITE + "/api/login", json={"password": PW}); r.raise_for_status()
h = {"Cookie": r.headers["Set-Cookie"].split(";")[0], "X-Owner-Password": PW}
if "--compare" in sys.argv:
    x = requests.post(SITE + "/api/adventure/admin/compare", json={"records": recs}, headers=h, timeout=120)
    print("与线上比对（只读）：", x.status_code, {k: v for k, v in x.json().items() if k != "ok"})
    sys.exit(0 if x.status_code == 200 else 1)
ok = bad = same = 0
revs = {}
for r in recs:
    x = requests.put(SITE + "/api/adventure/content", json={"kind": r["kind"], "id": r["id"], "content": r["content"]}, headers=h, timeout=60)
    if x.status_code == 200:
        revs[(r["kind"], r["id"])] = x.json().get("rev")
        if x.json().get("unchanged"): same += 1
        else: ok += 1
    else:
        bad += 1; print("失败：", r["kind"], x.status_code, x.json().get("error"))
print(f"完成：新写入/更新 {ok}，未变 {same}，失败 {bad}")
if W and not bad:
    m = manifest(revs)
    avail = [{"kind": k, "ref": i, "rev": v} for (k, i), v in revs.items()]
    post = check_manifest(m, avail)
    out = sys.argv[1] + ".manifest.json"
    json.dump(m, open(out, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print("世界清单：", "已校验通过" if post["ok"] else post["errors"], "（已保存到", out, "，只含 id 与修订）")
sys.exit(1 if bad else 0)

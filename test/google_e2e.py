import json, re, urllib.parse, requests
B = "http://localhost:8800"
s = requests.Session(); s.trust_env = False
ok = True
def check(name, cond, extra=""):
    global ok
    print(("PASS " if cond else "FAIL ") + name, extra if not cond else "")
    ok = ok and bool(cond)
def mcp(server, tool, inp):
    r = s.post(B + "/api/mcp", json={"server": server, "tool": tool, "input": inp})
    return r.status_code, r.json()

# 未登录：授权入口只给登录页，不跳转到 Google
r = s.get(B + "/auth/google/start", allow_redirects=False)
check("未登录不能发起授权", r.status_code == 200 and "accounts.google.com" not in r.headers.get("Location", ""))
check("未登录读 Google 被拒", s.post(B + "/api/mcp", json={"server": "Google Calendar", "tool": "list_events", "input": {}}).status_code == 401)

r = s.post(B + "/api/login", json={"password": "test-pass-123"})
# cookie 带 Secure，requests 在 http 下不会回传，手动带上
s.headers["Cookie"] = r.headers["Set-Cookie"].split(";")[0]
st = s.get(B + "/api/google/status").json()
check("已配置、未连接", st == {"configured": True, "connected": False, "email": ""}, st)
code, o = mcp("Google Calendar", "list_events", {"calendarId": "primary"})
check("未连接时返回 server_not_connected", code == 400 and o["code"] == "server_not_connected", o)

# 发起授权
r = s.get(B + "/auth/google/start", allow_redirects=False)
loc = r.headers["Location"]; q = urllib.parse.parse_qs(urllib.parse.urlparse(loc).query)
check("跳转到 Google 授权页", loc.startswith("https://accounts.google.com/o/oauth2/v2/auth?"))
check("参数正确", q["redirect_uri"] == [B + "/auth/google/callback"] and q["access_type"] == ["offline"] and q["prompt"] == ["consent"]
      and "calendar.readonly" in q["scope"][0] and "drive.readonly" in q["scope"][0] and "drive.file" not in q["scope"][0], q)
state = q["state"][0]

# 回调：错误 state、Google 报错、缺权限、成功
check("错误 state 被拒", s.get(B + "/auth/google/callback", params={"code": "c", "state": "0" * 48}).status_code == 400)
check("Google 返回 error 被拒", s.get(B + "/auth/google/callback", params={"error": "access_denied"}).status_code == 400)
r = s.get(B + "/auth/google/callback", params={"code": "nocal", "state": state})
check("缺日历权限被拒", r.status_code == 400 and "权限" in r.text)
check("缺权限时不保存令牌", not s.get(B + "/api/google/status").json()["connected"])
check("state 只能用一次", s.get(B + "/auth/google/callback", params={"code": "ok", "state": state}).status_code == 400)
state = urllib.parse.parse_qs(urllib.parse.urlparse(s.get(B + "/auth/google/start", allow_redirects=False).headers["Location"]).query)["state"][0]
r = s.get(B + "/auth/google/callback", params={"code": "ok", "state": state})
check("授权成功", r.status_code == 200 and "cat@gmail.com" in r.text, r.text[:200])
st = s.get(B + "/api/google/status").json()
check("状态变成已连接", st == {"configured": True, "connected": True, "email": "cat@gmail.com"}, st)

# 日历：美东时间转换（2026-10-26 00:00 EDT = 04:00Z；11 月 1 日之后是 EST = +5）
s.get(B + "/__gcalls")
code, o = mcp("Google Calendar", "list_events", {"calendarId": "a@group.calendar.google.com", "startTime": "2026-10-26T00:00:00", "endTime": "2026-11-02T00:00:00", "orderBy": "startTime", "pageSize": 250})
ev = o["payload"]["events"][0] if code == 200 else {}
check("日历返回 events", code == 200 and ev.get("summary") == "MATH 1920 lecture", o)
check("EDT 转换正确", ev["start"]["dateTime"] == "2026-10-26T04:00:00.000Z", ev)
check("EST 转换正确", ev["end"]["dateTime"] == "2026-11-02T05:00:00.000Z", ev)
calls = s.get(B + "/__gcalls").json()
check("请求带 singleEvents，用 Bearer", any("singleEvents=true" in c and c.startswith("Bearer at") for c in calls), calls)
check("带时区的时间原样透传", mcp("Google Calendar", "list_events", {"calendarId": "primary", "startTime": "2026-10-26T00:00:00-04:00", "endTime": "2026-10-27T00:00:00Z"})[1]["payload"]["events"][0]["start"]["dateTime"] == "2026-10-26T00:00:00-04:00")
code, o = mcp("Google Calendar", "list_events", {"calendarId": "missing", "startTime": "2026-10-26T00:00:00"})
check("日历不存在时报错而不是崩", code == 404 and o["code"] == "upstream_error", o)
check("没有的工具", mcp("Google Calendar", "delete_event", {})[0] == 400)

# Drive
code, o = mcp("Google Drive", "search_files", {"query": "title contains 'it\\'s'", "pageSize": 25, "excludeContentSnippets": True})
t = o["payload"]["files"][0]["title"]
check("title contains → name contains，加 trashed=false", code == 200 and t.startswith("q=(name contains 'it\\'s') and trashed=false"), t)
t = mcp("Google Drive", "search_files", {"query": "parentId = 'abc123'"})[1]["payload"]["files"][0]["title"]
check("parentId → in parents", "('abc123' in parents)" in t, t)
r = mcp("Google Drive", "list_recent_files", {"pageSize": 20})[1]["payload"]["files"]
check("最近文件含文件夹，字段名是 title/mimeType", r[1]["title"] == "ENGRI" and r[0]["mimeType"] == "application/pdf", r)
def rd(i): return mcp("Google Drive", "read_file_content", {"fileId": i})
check("Google 文档导出文本", rd("doc00")[1]["payload"]["fileContent"] == "导出文本 text/plain", rd("doc00"))
check("Google 表格导出 CSV", rd("sht00")[1]["payload"]["fileContent"] == "导出文本 text/csv")
check("纯文本直接读", rd("txt00")[1]["payload"]["fileContent"] == "纯文本内容")
check("PDF 走文档转换", rd("pdf00")[1]["payload"]["fileContent"].startswith("# 转换结果 file-pdf00 application/pdf"), rd("pdf00"))
c, o = rd("big00"); check("超过 15MB 拒绝", c == 413 and o["code"] == "too_large", o)
c, o = rd("fld00"); check("不支持的 Google 类型报 unsupported", c == 400 and o["code"] == "unsupported", o)
c, o = rd("../etc"); check("fileId 校验", c == 400 and o["code"] == "bad_request", o)

# 访问令牌过期：旧的 at1 被拒 → 自动刷新成 at2 重试
s.get(B + "/__expire401?on=1"); s.get(B + "/__gcalls")
code, o = mcp("Google Calendar", "list_events", {"calendarId": "primary", "startTime": "2026-10-26T00:00:00"})
calls = s.get(B + "/__gcalls").json()
check("401 后自动刷新并重试", code == 200 and "token:refresh_token" in calls and any(c.startswith("Bearer at2") for c in calls), calls)
s.get(B + "/__expire401?on=0")

# 断开
s.get(B + "/__gcalls")
check("断开成功", s.post(B + "/api/google/disconnect").json() == {"ok": True})
check("断开时向 Google 撤销", "revoke" in s.get(B + "/__gcalls").json())
check("断开后状态", s.get(B + "/api/google/status").json()["connected"] is False)
check("断开后读取被拒", mcp("Google Drive", "list_recent_files", {})[1]["code"] == "server_not_connected")
# 跨站写操作
r = s.post(B + "/api/google/disconnect", headers={"Origin": "https://evil.example"})
check("跨站断开被拒", r.status_code == 403)
print("\nALL PASS" if ok else "\nSOME FAILED")
raise SystemExit(0 if ok else 1)

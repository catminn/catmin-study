# 共享记忆 · 云端版

替代原来在 Windows 电脑上运行的 mcp-memory-service。电脑关机也能用。

- 运行在 Cloudflare Workers（免费额度内）
- 数据：D1 数据库 `catmin-study`（以后网站和主神空间进度也存这里）
- 检索：Vectorize + Workers AI 的 bge-m3 多语言向量（中文检索效果好）
- 安全：OAuth 授权，连接时要输入你自己设的口令
- 工具名和参数与原服务相同：memory_search / memory_store / memory_list / memory_update / memory_delete / memory_health / mistake_note_add / mistake_note_search / mistake_note_update / mistake_note_delete

## 第 1 步：部署（测试域名 memory-new.catmin.io）

需要：电脑上装有 Node.js（`node -v` 能看到版本号）。

1. 解压到任意文件夹，例如 `桌面\catmin-memory`
2. 在这个文件夹里右键 →「在终端中打开」
3. 运行：
   ```
   powershell -ExecutionPolicy Bypass -File scripts\setup.ps1
   ```
4. 浏览器弹出 Cloudflare 登录 → 点 Allow
5. 提示时输入一个**授权口令**（自己记住，连接 Claude / ChatGPT 时要用）

脚本会自动：建数据库、建索引、部署、导入现有的 61 条记忆。中途出错可以直接重新运行。

## 第 2 步：在 claude.ai 里测试（不影响现在的「共享记忆」）

设置 → Connectors → 添加自定义连接器：
- 名称：`共享记忆测试`
- 地址：`https://memory-new.catmin.io/mcp`

连接时会打开一个授权页，输入口令 → 允许。然后在对话里试一下搜索。

## 第 3 步：正式切换（测试没问题之后，Claude 会带你做）

1. 重新导出一次电脑上的记忆（期间新增的），导入云端（自动跳过已有的）
2. Cloudflare 后台 → Zero Trust → Networks → Tunnels，删掉 `memory.catmin.io` 这个公共主机名
3. 把 `wrangler.jsonc` 里两处 `memory-new` 改成 `memory`，运行 `npx wrangler deploy`
4. claude.ai 和 ChatGPT 里的「共享记忆」连接器重新连接一次（会出现授权页）
5. 关掉电脑上的 mcp-memory-service 和隧道开机启动

## 管理

- 管理口令在 `.admin-token`（不要外传）
- 补生成缺失的向量：`POST /admin/reindex`，带 `Authorization: Bearer <管理口令>`
- 改授权口令：`npx wrangler secret put OWNER_PASSWORD`

## 和原服务相比少了什么

原服务的高级工具（记忆合并 consolidate、知识图谱 graph/explore、质量评分 quality、信念 beliefs 等）没有搬过来。日常的存、搜、改、删和错题都在。需要哪个以后再加。

## 主神空间：artifact 和网站如何保持同步

- **唯一源头**：`page/zhushen.html`。网站版由 `scripts/build-site.py` 从它生成；artifact 版发布的是同一份（唯一差别是 `cloudOn` 那一行，网站版多一个 `!window.__SITE`）。
- **改页面的流程**：改 `page/zhushen.html` → 本地测试 → 推送 GitHub（网站自动部署）→ 用同一份内容发布 artifact（artifact 版把 `cloudOn` 那行换成不带 `__SITE` 的写法）。
- **漏网检查**：如果有人在别的对话里直接改了线上 artifact，把它用 Artifact 的 read 保存下来，运行
  `python3 scripts/check-drift.py <保存的html>`，一致返回 0，有差异返回 1 并打印差异。有差异就把改动合并回 `page/zhushen.html`，再走上面的流程。
- 存档（进度、聊天记录）两边本来就共用云端的 `study_state`，不需要同步代码。

## 网站版连接 Google 日历 / Drive（只读）

- 需要两个 Cloudflare Secret：`GOOGLE_CLIENT_ID`、`GOOGLE_CLIENT_SECRET`（Google Cloud 里建的 Web 应用，重定向地址 `https://study.catmin.io/auth/google/callback`，权限只要 `calendar.readonly` 和 `drive.readonly`，应用要发布为 In production）。
- 设好后网站顶部会出现「连接 Google」，点一下授权一次；刷新令牌用 AES-GCM 加密后存在 KV，点已连接的按钮可以断开并向 Google 撤销。
- 代码在 `src/google.ts`，工具名和 claude.ai 连接器一致（Google Calendar.list_events；Google Drive.search_files / list_recent_files / read_file_content），页面不用改。
- PDF / Word / 图片通过 Workers AI 的 `toMarkdown` 转成文字（线上行为未在本地验证，本地测试用的是假实现）。
- 测试：`npx wrangler dev -c test/wrangler.site.jsonc --port 8800`，另开终端运行 `python3 test/google_e2e.py`。

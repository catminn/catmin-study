/* 主神空间网站版：替代 claude.ai 提供的 window.claude 能力
 * db     → /api/db（存在云端 study_state，和 artifact 的云端存档是同一份）
 * user   → 固定为 Catherine
 * sample → /api/ai（Anthropic / OpenAI API，按量计费，有每日上限）
 * mcp    → /api/mcp（共享记忆直连；日历/Drive 经 Google 授权后只读）
 * 页面本身不用改：它照常调用 claude.use(...)。 */
(function () {
  "use strict";
  window.__SITE = true;
  var LS_MODEL = "cm-model";

  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

  async function api(path, opts) {
    var r;
    try { r = await fetch(path, opts); } catch (e) {
      if (e && e.name === "AbortError") throw { code: "cancelled", message: "已取消" };
      throw { code: "server_unavailable", message: "网络连不上" };
    }
    if (r.status === 401) { setTimeout(function () { location.reload(); }, 1500); throw { code: "session_expired", message: "登录过期了" }; }
    var o = await r.json().catch(function () { return {}; });
    if (!r.ok) throw { code: o.code || "upstream_error", message: o.message || ("HTTP " + r.status) };
    return o;
  }

  // ---------- db ----------
  function keyOf(path) { var m = /^data\/users\/[^/]+\/(.+)$/.exec(path); return m ? m[1] : null; }
  var db = Object.freeze({
    doc: function (path) {
      var key = keyOf(path);
      return {
        get: async function () {
          if (!key) return { exists: false, data: function () { return undefined; } };
          var o = await api("/api/db?key=" + encodeURIComponent(key));
          return { exists: !!o.exists, data: function () { return o.value; } };
        },
        set: async function (v) {
          if (!key) throw { code: "bad_path", message: path };
          return await api("/api/db?key=" + encodeURIComponent(key), {
            method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(v)
          });
        }
      };
    },
    collection: function () { throw { code: "unsupported", message: "网站版不支持 collection" }; },
    // 只取版本号（各端互通：变了再拉整份）
    meta: async function (keys) { var o = await api("/api/db?meta=" + encodeURIComponent((keys || []).join(","))); return o.meta || {}; }
  });

  // ---------- user ----------
  var user = Object.freeze({
    id: async function () { return "catherine"; },
    me: async function () { return { id: "catherine", name: "Catherine" }; },
    isOwner: function () { return true; }, canEdit: function () { return true; }, can: function () { return true; }
  });

  // ---------- 模型选择与花费 ----------
  var STATUS = null;
  async function loadStatus() {
    try { STATUS = await api("/api/ai/status"); } catch (e) { STATUS = null; }
    renderPicker();
    return STATUS;
  }
  function availableModels() { return STATUS ? STATUS.models.filter(function (m) { return m.available; }) : []; }
  function currentModel() {
    var saved = lsGet(LS_MODEL), av = availableModels();
    if (saved && av.some(function (m) { return m.id === saved; })) return saved;
    var pref = ["claude-haiku-5-5", "gpt-6-luna"];
    for (var i = 0; i < pref.length; i++) if (av.some(function (m) { return m.id === pref[i]; })) return pref[i];
    return av.length ? av[0].id : "claude-haiku-5-5";
  }
  function money(x) { return "$" + (x < 0.01 ? x.toFixed(3) : x.toFixed(2)); }
  function renderPicker() {
    var host = document.querySelector(".hud .res");
    if (!host) return;
    var box = document.getElementById("cmModelBox");
    if (!box) {
      box = document.createElement("span");
      box.id = "cmModelBox";
      box.className = "pill";
      box.style.cssText = "gap:6px;font-family:var(--body);font-weight:500;font-size:13px;padding:2px 8px";
      host.appendChild(box);
    }
    box.replaceChildren();
    var av = availableModels();
    if (!av.length) { box.textContent = STATUS ? "还没设置 API Key" : "AI 未连接"; box.title = "在 Cloudflare 的 catmin-memory 里添加 ANTHROPIC_API_KEY 或 OPENAI_API_KEY"; return; }
    var sel = document.createElement("select");
    sel.id = "cmModel";
    sel.setAttribute("aria-label", "模型");
    sel.style.cssText = "border:0;background:transparent;font:inherit;color:inherit;padding:0;max-width:150px";
    av.forEach(function (m) {
      var o = document.createElement("option");
      o.value = m.id; o.textContent = String(m.label).replace(/^Claude\s+/, "");
      o.title = "每百万 token：输入 $" + m.in + " / 输出 $" + m.out;
      sel.appendChild(o);
    });
    sel.value = currentModel();
    sel.onchange = function () { lsSet(LS_MODEL, sel.value); };
    var cost = document.createElement("span");
    cost.className = "num";
    cost.style.cssText = "font-size:12px;color:var(--dim)";
    cost.textContent = money(STATUS.spent.today);
    box.title = "今天 " + money(STATUS.spent.today) + " / " + money(STATUS.limits.daily) + "，本月 " + money(STATUS.spent.month) + " / " + money(STATUS.limits.monthly);
    /* 顶栏只放模型名；花费快到上限（80%）时才显示出来 */
    if (STATUS.spent.today >= 0.8 * STATUS.limits.daily) box.append(sel, cost); else box.append(sel);
  }

  // ---------- Google 连接（日历 / Drive，只读） ----------
  async function renderGoogle() {
    var host = document.querySelector(".hud .res");
    if (!host) return;
    var st;
    try { st = await api("/api/google/status"); } catch (e) { return; }
    var el = document.getElementById("cmGoogle");
    if (!st.configured) { if (el) el.remove(); return; }
    if (!el) {
      el = document.createElement("button");
      el.id = "cmGoogle";
      el.className = "pill";
      el.style.cssText = "font-family:var(--body);font-weight:500;font-size:13px;padding:2px 10px";
      host.appendChild(el);
    }
    var cu = document.getElementById("cmCornell");
    if (st.connected && !cu) {
      cu = document.createElement("button"); cu.id = "cmCornell"; cu.className = "pill";
      cu.style.cssText = el.style.cssText; host.appendChild(cu);
    }
    if (cu) {
      cu.hidden = !!(st.cornell && st.cornellRead); /* 连好了就不占顶栏，只有需要操作时才出现 */
      if (st.cornell && st.cornellRead) { cu.textContent = "Cornell Drive ✓"; cu.title = (st.cornellEmail || "") + "：AI 能读这里的作业，交给零的文件也存在这里"; cu.onclick = null; }
      else if (st.cornell) { cu.textContent = "Cornell Drive 加读权限"; cu.title = "让 AI 能读学校 Drive 里的作业：点一下重新授权，勾选查看文件的权限"; cu.onclick = function () { location.href = "/auth/google/start?acct=cornell"; }; }
      else { cu.textContent = "连 Cornell Drive"; cu.title = "把文件存到 Cornell 账号的 Drive（学校可能不允许，不行就存个人 Drive）"; cu.onclick = function () { location.href = "/auth/google/start?acct=cornell"; }; }
    }
    if (st.connected && st.needsUpgrade) {
      el.hidden = false;
      el.textContent = "Google 需更新授权";
      el.title = "加了读邮件等新权限，点一下重新授权";
      el.onclick = function () { location.href = "/auth/google/start"; };
    } else if (st.connected) {
      el.hidden = true;
      el.textContent = "Google ✓";
      el.title = (st.email || "已连接") + "（只读）。点一下可以断开。";
      el.onclick = async function () {
        if (!confirm("断开 Google？之后日历和 Drive 在网站上会读不到，可以随时重新连接。")) return;
        try { await api("/api/google/disconnect", { method: "POST" }); } catch (e) {}
        renderGoogle();
      };
    } else {
      el.hidden = false;
      el.textContent = "连接 Google";
      el.title = "授权网站只读你的 Google 日历和 Drive";
      el.onclick = function () { location.href = "/auth/google/start"; };
    }
  }

  // ---------- sample ----------
  function toMessages(input) {
    if (typeof input === "string") return [{ role: "user", content: input }];
    return (input || []).map(function (m) { return { role: m.role, content: String(m.content == null ? "" : m.content) }; });
  }
  async function blobToImage(b) {
    var u = new Uint8Array(await b.arrayBuffer()), s = "";
    for (var i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
    return { media_type: b.type || "image/png", data: btoa(s) };
  }
  var JSON_HINT = "\n\n只输出一个合法的 JSON 值：不要用代码块包起来，前后不要有任何其他文字。";

  async function run(input, opts, jsonMode) {
    opts = opts || {};
    if (!STATUS) await loadStatus();
    var messages = toMessages(input);
    if (!messages.length || messages[messages.length - 1].role !== "user") throw { code: "bad_request", message: "最后一条必须是 user" };
    if (jsonMode) messages[messages.length - 1].content += JSON_HINT;
    var body = { messages: messages, model: opts.siteModel || currentModel() };
    if (opts.serverTools) body.serverTools = opts.serverTools; // 服务器端工具（Google Drive） // 零在网站上固定用 opts.siteModel
    if (opts.images && opts.images.length) body.images = await Promise.all([].slice.call(opts.images, 0, 5).map(blobToImage));
    if (opts.signal && opts.signal.aborted) throw { code: "cancelled", message: "已取消" };
    var r;
    try {
      r = await fetch("/api/ai", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: opts.signal });
    } catch (e) {
      if (e && e.name === "AbortError") throw { code: "cancelled", message: "已取消" };
      throw { code: "server_unavailable", message: "网络连不上" };
    }
    if (!r.ok) {
      var o = await r.json().catch(function () { return {}; });
      if (r.status === 401) setTimeout(function () { location.reload(); }, 1500);
      throw { code: o.code || "upstream_error", message: o.message || ("HTTP " + r.status) };
    }
    var reader = r.body.pipeThrough(new TextDecoderStream()).getReader();
    var buf = "", text = "", truncated = false, fail = null;
    try {
      for (;;) {
        var step = await reader.read();
        if (step.done) break;
        buf += step.value;
        var i;
        while ((i = buf.indexOf("\n\n")) >= 0) {
          var line = buf.slice(0, i).replace(/^data:\s?/, ""); buf = buf.slice(i + 2);
          if (!line) continue;
          var ev; try { ev = JSON.parse(line); } catch (e) { continue; }
          if (ev.d) { text += ev.d; if (opts.onText) try { opts.onText({ text: text, delta: ev.d }); } catch (e) {} }
          else if (ev.files) { if (opts.onFiles) try { opts.onFiles(ev.files); } catch (e) {} }
          else if (ev.error) fail = ev.error;
          else if (ev.done) { truncated = !!ev.truncated; if (STATUS) { STATUS.spent.today += ev.cost || 0; STATUS.spent.month += ev.cost || 0; renderPicker(); } }
        }
      }
    } catch (e) {
      if (opts.signal && opts.signal.aborted) throw { code: "cancelled", message: "已取消", text: text };
      throw { code: "upstream_error", message: String(e && e.message || e), text: text };
    }
    if (fail) throw { code: fail.code || "upstream_error", message: fail.message, text: text };
    return { text: text, truncated: truncated };
  }
  function parseJSON(t) {
    var s = String(t || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    try { return JSON.parse(s); } catch (e) {}
    var a = s.search(/[\[{]/), b = Math.max(s.lastIndexOf("}"), s.lastIndexOf("]"));
    if (a >= 0 && b > a) { try { return JSON.parse(s.slice(a, b + 1)); } catch (e) {} }
    throw { code: "invalid_json", message: "模型没有按 JSON 格式回答", text: t };
  }
  var sample = function (input, opts) { return run(input, opts, false); };
  sample.json = async function (input, opts) { var r = await run(input, opts, true); return parseJSON(r.text); };
  sample.limits = async function () { return { maxInputBytes: 400000, images: { maxCount: 5, maxBytes: 5000000 } }; };
  Object.freeze(sample);

  // ---------- mcp ----------
  var mcp = Object.freeze({
    callTool: async function (server, tool, input) {
      var o = await api("/api/mcp", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ server: server, tool: tool, input: input || {} }) });
      return { payload: o.payload, cache: { storedAt: Date.now() } };
    },
    watchTool: function (server, tool, input, handler, opts) {
      var stopped = false, timer = null;
      async function tick() {
        if (stopped) return;
        try {
          var r = await mcp.callTool(server, tool, input);
          if (!stopped) handler({ type: "data", result: r });
        } catch (e) { if (!stopped) handler({ type: "error", error: e }); }
        var every = opts && opts.refetchInterval;
        if (!stopped && every) timer = setTimeout(tick, Math.max(30000, every));
      }
      tick();
      return function () { stopped = true; clearTimeout(timer); };
    }
  });

  var CAPS = { db: db, user: user, sample: sample, mcp: mcp };
  window.claude = Object.freeze({
    use: function (name) {
      return new Promise(function (res) { setTimeout(function () { res(CAPS[name] || null); }, 0); });
    }
  });

  document.addEventListener("DOMContentLoaded", function () { loadStatus(); renderGoogle(); });
  document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible") { loadStatus(); renderGoogle(); } });
})();

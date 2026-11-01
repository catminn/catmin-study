// 学习空间桌面版
// - 右下角零的小圆（可拖动）；点开是零的聊天框（study.catmin.io/?embed=zero）
// - 置顶待办小窗（?embed=todo），半透明
// - 文件交给零：右键「发送到 → 学习空间」、选中文件按 Ctrl+Alt+Z、拖到小圆上
// - 托盘菜单；开机自启
const { app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain, screen, nativeImage, session, shell, nativeTheme, Notification } = require("electron");
const path = require("path");
const fs = require("fs");
const { execFile } = require("child_process");
const os = require("os");
const { applyGlass } = require("./glass");

const SITE = process.env.ZS_SITE || "https://study.catmin.io/";
const PART = "persist:xuexi";
const HOTKEYS = ["F2", "Control+Alt+Z", "Control+Alt+Q", "Alt+Shift+Z"];
const keyName = (k) => k.replace("Control", "Ctrl").replace(/\+/g, " + ");
let hotkey = "";
const MAX_FILE = 25 * 1024 * 1024;

if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }
app.setAppUserModelId("io.catmin.study");

// ---------- 设置（窗口位置、开关） ----------
const CONF = path.join(app.getPath("userData"), "desktop.json");
let conf = {};
try { conf = JSON.parse(fs.readFileSync(CONF, "utf8")); } catch (e) { conf = {}; }
let confTimer = null;
function saveConf() { clearTimeout(confTimer); confTimer = setTimeout(() => { try { fs.writeFileSync(CONF, JSON.stringify(conf)); } catch (e) {} }, 300); }

let bubble = null, zero = null, todo = null, main = null, tray = null;
const readyWins = new Set();
const queued = new Map(); // webContents.id -> [[channel, ...args]]

function send(win, channel, ...args) {
  if (!win || win.isDestroyed()) return;
  const id = win.webContents.id;
  if (readyWins.has(id)) win.webContents.send(channel, ...args);
  else { if (!queued.has(id)) queued.set(id, []); queued.get(id).push([channel, ...args]); }
}

function workArea() { return screen.getPrimaryDisplay().workArea; }
function onScreen(b) {
  return screen.getAllDisplays().some((d) => { const a = d.workArea; return b.x + 20 > a.x && b.y + 20 > a.y && b.x < a.x + a.width - 20 && b.y < a.y + a.height - 20; });
}

const ICON = path.join(__dirname, "assets", "icon.png");
const TRAY_ICON = path.join(__dirname, "assets", "tray.png");

function pageWin(opts, url) {
  const w = new BrowserWindow(Object.assign({
    show: false, frame: false, skipTaskbar: true, icon: ICON,
    webPreferences: { partition: PART, preload: path.join(__dirname, "preload.js"), contextIsolation: true, sandbox: false, spellcheck: false },
  }, opts));
  w.webContents.on("did-start-loading", () => readyWins.delete(w.webContents.id));
  w.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: "deny" }; });
  w.webContents.on("will-navigate", (e, url) => { if (!url.startsWith(SITE) && !url.startsWith("https://accounts.google.com")) { e.preventDefault(); shell.openExternal(url); } });
  w.loadURL(url);
  return w;
}

// ---------- 零的小圆 ----------
const BUB = 84;
function createBubble() {
  const a = workArea();
  const pos = conf.bubble && onScreen({ x: conf.bubble.x, y: conf.bubble.y }) ? conf.bubble : { x: a.x + a.width - BUB - 2, y: a.y + a.height - BUB - 2 };
  bubble = new BrowserWindow({
    x: pos.x, y: pos.y, width: BUB, height: BUB, frame: false, transparent: true, resizable: false, maximizable: false, minimizable: false,
    skipTaskbar: true, alwaysOnTop: true, hasShadow: false, focusable: true, show: false, icon: ICON,
    webPreferences: { preload: path.join(__dirname, "bubble-preload.js"), contextIsolation: true, sandbox: false },
  });
  bubble.setAlwaysOnTop(true, "screen-saver");
  bubble.loadFile(path.join(__dirname, "bubble.html"));
  bubble.once("ready-to-show", () => { if (conf.bubbleHidden !== true) bubble.showInactive(); });
}
// 小圆：拖动时限制在屏幕内；松手时离左右边很近就贴过去（整颗球留在屏幕里）
function clampToScreen(x, y, w, h) {
  const d = screen.getDisplayNearestPoint({ x: Math.round(x + w / 2), y: Math.round(y + h / 2) }).workArea, pad = 16; // 小圆窗口四周有 16px 透明边
  return { x: Math.min(Math.max(x, d.x - pad), d.x + d.width - w + pad), y: Math.min(Math.max(y, d.y - pad), d.y + d.height - h + pad), d };
}
ipcMain.on("bubble-move", (e, dx, dy) => {
  if (!bubble) return;
  const [x, y] = bubble.getPosition();
  const c = clampToScreen(x + dx, y + dy, BUB, BUB);
  bubble.setBounds({ x: Math.round(c.x), y: Math.round(c.y), width: BUB, height: BUB });
  if (zero && zero.isVisible()) placeZero();
});
ipcMain.on("bubble-moved", () => {
  if (!bubble) return;
  const b = bubble.getBounds(), c = clampToScreen(b.x, b.y, BUB, BUB), d = c.d, pad = 16;
  let x = c.x;
  if (x - (d.x - pad) < 40) x = d.x - pad + 4; else if (d.x + d.width - BUB + pad - x < 40) x = d.x + d.width - BUB + pad - 4;
  animateBounds(bubble, { x: Math.round(x), y: Math.round(c.y), width: BUB, height: BUB }, 120);
  conf.bubble = { x: Math.round(x), y: Math.round(c.y) }; conf.bubbleDock = null; saveConf();
});
ipcMain.on("bubble-click", () => toggleZero());
ipcMain.on("bubble-menu", () => { menu().popup({ window: bubble }); });
ipcMain.on("bubble-drop", (e, paths) => deliverPaths(paths));

// 平滑改变窗口位置大小（像拉出展板）
const anims = new WeakMap();
function animateBounds(win, to, ms) {
  if (!win || win.isDestroyed()) return;
  clearInterval(anims.get(win));
  const from = win.getBounds(), t0 = Date.now(), ease = (k) => 1 - Math.pow(1 - k, 3);
  if (!ms) { win.setBounds(to); return; }
  const id = setInterval(() => {
    if (win.isDestroyed()) { clearInterval(id); return; }
    const k = Math.min(1, (Date.now() - t0) / ms), e = ease(k), r = (a, b) => Math.round(a + (b - a) * e);
    win.setBounds({ x: r(from.x, to.x), y: r(from.y, to.y), width: Math.max(1, r(from.width, to.width)), height: Math.max(1, r(from.height, to.height)) });
    if (k >= 1) { clearInterval(id); anims.delete(win); }
  }, 12);
  anims.set(win, id);
}

// ---------- 零的聊天框 ----------
const ZW = 380, ZH = 560;
function placeZero() {
  if (!zero || !bubble) return;
  const [bx, by] = bubble.getPosition();
  const d = screen.getDisplayNearestPoint({ x: bx, y: by }).workArea;
  let x = bx + BUB - 16 - ZW, y = by + 16 - ZH - 6;
  if (y < d.y) y = by + BUB - 10;
  if (y + ZH > d.y + d.height) y = d.y + d.height - ZH;
  x = Math.min(Math.max(x, d.x), d.x + d.width - ZW);
  zero.setBounds({ x, y, width: ZW, height: ZH });
}
function ensureZero() {
  if (zero && !zero.isDestroyed()) return zero;
  zero = pageWin({ width: ZW, height: ZH, alwaysOnTop: true, resizable: true, minWidth: 320, minHeight: 360 }, SITE + "?embed=zero");
  zero.setAlwaysOnTop(true, "floating");
  zero.on("closed", () => { zero = null; });
  return zero;
}
function showZero(cmd) {
  const w = ensureZero();
  placeZero();
  const go = () => { w.show(); w.focus(); if (cmd) send(w, "cmd", cmd); };
  if (w.webContents.isLoading()) w.once("ready-to-show", go); else go();
}
function toggleZero() { if (zero && zero.isVisible()) zero.hide(); else showZero(); }

// ---------- 待办小窗 ----------
function createTodo(show) {
  if (todo && !todo.isDestroyed()) { if (show) todo.showInactive(); return todo; }
  const a = workArea();
  const b = conf.todo && onScreen(conf.todo) ? conf.todo : { x: a.x + a.width - 280 - 24, y: a.y + 40, width: 280, height: 320 };
  // 毛玻璃用 glass.js（失去焦点也保持）；不支持的系统退回页面自己的半透明底色
  const opts = { x: b.x, y: b.y, width: b.width, height: b.height, minWidth: 10, minHeight: 10, resizable: true, transparent: true, alwaysOnTop: conf.todoPinned !== false, backgroundColor: "#00000000" };
  todo = pageWin(opts, SITE + "?embed=todo");
  todo.on("will-move", () => { todoDragging = true; clearTimeout(todoDragT); todoDragT = setTimeout(() => { todoDragging = false; }, 1500); });
  todo.on("moved", todoMoved);
  todo.on("resized", () => { if (todo && !todo.isDestroyed() && todoState === "full") { conf.todo = todo.getBounds(); saveConf(); } });
  todo.on("closed", () => { todo = null; todoState = "full"; });
  todo._glass = applyGlass(todo, nativeTheme.shouldUseDarkColors);
  nativeTheme.on("updated", () => { if (todo && !todo.isDestroyed()) applyGlass(todo, nativeTheme.shouldUseDarkColors); });
  todo.once("ready-to-show", () => { if (show) todo.showInactive(); });
  return todo;
}
function toggleTodo() {
  if (todo && !todo.isDestroyed() && todo.isVisible()) { todo.hide(); conf.todoShown = false; }
  else { createTodo(true); if (todo.isVisible()) todo.showInactive(); conf.todoShown = true; }
  saveConf(); refreshMenu();
}

// ---------- 完整网站 ----------
function openMain(hash) {
  if (!main || main.isDestroyed()) {
    main = pageWin({ width: 1200, height: 820, frame: true, skipTaskbar: false, autoHideMenuBar: true, title: "学习空间" }, SITE + (hash || ""));
    main.on("closed", () => { main = null; });
    main.once("ready-to-show", () => main.show());
  } else {
    if (hash) send(main, "cmd", hash);
    if (main.isMinimized()) main.restore();
    main.show(); main.focus();
  }
  return main;
}

// ---------- 页面发来的指令 ----------
const winOf = (e) => BrowserWindow.fromWebContents(e.sender);
ipcMain.on("ready", (e) => {
  const id = e.sender.id; readyWins.add(id);
  const q = queued.get(id); if (q) { queued.delete(id); for (const [ch, ...args] of q) e.sender.send(ch, ...args); }
});
ipcMain.on("hide", (e) => { const w = winOf(e); if (w) w.hide(); if (w === todo) { conf.todoShown = false; saveConf(); refreshMenu(); } });
ipcMain.on("open-main", (e, hash) => openMain(typeof hash === "string" ? hash : ""));
ipcMain.on("open-zero", (e, cmd) => showZero(typeof cmd === "string" ? cmd : ""));
ipcMain.on("to-main", (e, subj, list) => { const w = openMain("#dungeon"); send(w, "files", String(subj), list); });
// 待办三种状态：full 展开的列表；mini 小标签；dock 吸在屏幕边上的书签（像 360 加速球那样藏进屏幕边）
// 拖到离屏幕上边、左边或右边 24px 以内就吸住；鼠标移上去从边上滑出列表，移开缩回去
const MINI = { width: 108, height: 32 }, DOCK = 14, DOCK_LEN = 64, SNAP = 24;
let todoState = "full";
const fullSize = () => (conf.todo && conf.todo.width > MINI.width + 20 ? conf.todo : { width: 280, height: 320 });
function edgeOf(b) {
  const d = screen.getDisplayMatching(b).workArea;
  if (b.x <= d.x + SNAP) return "left";
  if (b.x + b.width >= d.x + d.width - SNAP) return "right";
  if (b.y <= d.y + SNAP) return "top";
  return null;
}
function tellTodo() { if (todo && !todo.isDestroyed()) send(todo, "todo-state", { mode: todoState, edge: conf.todoDock ? conf.todoDock.edge : "" }); }
function dockRect(d) {
  const k = conf.todoDock, clampY = (y) => Math.min(Math.max(y, d.y), d.y + d.height - DOCK_LEN), clampX = (x) => Math.min(Math.max(x, d.x), d.x + d.width - DOCK_LEN);
  if (k.edge === "left") return { x: d.x, y: clampY(k.along), width: DOCK, height: DOCK_LEN };
  if (k.edge === "right") return { x: d.x + d.width - DOCK, y: clampY(k.along), width: DOCK, height: DOCK_LEN };
  return { x: clampX(k.along), y: d.y, width: DOCK_LEN, height: DOCK };
}
function todoTarget(mode) {
  const b = todo.getBounds(), d = screen.getDisplayMatching(b).workArea, f = fullSize();
  if (mode === "dock") return dockRect(d);
  if (mode === "mini") {
    const right = b.x + b.width / 2 > d.x + d.width / 2, bottom = b.y + b.height / 2 > d.y + d.height / 2;
    return { x: right ? b.x + b.width - MINI.width : b.x, y: bottom ? b.y + b.height - MINI.height : b.y, width: MINI.width, height: MINI.height };
  }
  let x, y;
  if (todoState === "dock" && conf.todoDock) {
    const k = conf.todoDock, r = dockRect(d);
    x = k.edge === "left" ? d.x : k.edge === "right" ? d.x + d.width - f.width : r.x + r.width / 2 - f.width / 2;
    y = k.edge === "top" ? d.y : r.y + r.height / 2 - 40;
  } else {
    const right = b.x + b.width / 2 > d.x + d.width / 2, bottom = b.y + b.height / 2 > d.y + d.height / 2;
    x = right ? b.x + b.width - f.width : b.x; y = bottom ? b.y + b.height - f.height : b.y;
  }
  return { x: Math.round(Math.min(Math.max(x, d.x), d.x + d.width - f.width)), y: Math.round(Math.min(Math.max(y, d.y), d.y + d.height - f.height)), width: f.width, height: f.height };
}
function setTodoMode(mode) {
  if (!todo || todo.isDestroyed()) return;
  if (mode === "mini" && conf.todoDock) mode = "dock";
  const cur = todoState === "dock" ? "dock" : todoState;
  if (mode === cur) return;
  if (cur === "full") { conf.todo = Object.assign({}, todo.getBounds()); saveConf(); }
  const to = todoTarget(mode);
  if (mode === "full" && cur === "dock" && conf.todoDock) {
    // 从书签处展开：先把窗口放到展开位置但只露出书签那么大，再往外拉开
    const k = conf.todoDock, r = todo.getBounds();
    const start = k.edge === "top" ? { x: to.x, y: to.y, width: to.width, height: DOCK } : k.edge === "left" ? { x: to.x, y: to.y, width: DOCK, height: to.height } : { x: to.x + to.width - DOCK, y: to.y, width: DOCK, height: to.height };
    todoState = "full"; tellTodo(); todo.setBounds(start); animateBounds(todo, to, 180);
    return;
  }
  todoState = mode; tellTodo();
  animateBounds(todo, to, mode === "full" ? 140 : 160);
}
ipcMain.on("todo-mode", (e, mode) => setTodoMode(mode));
// 鼠标位置由主进程盯着：移进来就展开，移出去 0.6 秒后收起（页面里正在输入时不收）
let todoBusy = false, todoAway = 0;
ipcMain.on("todo-busy", (e, v) => { todoBusy = !!v; });
setInterval(() => {
  if (!todo || todo.isDestroyed() || !todo.isVisible() || todoDragging) return;
  const p = screen.getCursorScreenPoint(), b = todo.getBounds(), m = todoState === "full" ? 6 : 2;
  const inside = p.x >= b.x - m && p.x < b.x + b.width + m && p.y >= b.y - m && p.y < b.y + b.height + m;
  if (inside) { todoAway = 0; if (todoState !== "full") setTodoMode("full"); }
  else if (todoState === "full" && !todoBusy) { if (++todoAway >= 5) { todoAway = 0; setTodoMode("mini"); } }
}, 120);
// 拖动结束：限制在屏幕内；贴近上、左、右边就吸成书签，离开就松开
let todoDragging = false, todoDragT = null;
function todoMoved() {
  if (!todo || todo.isDestroyed()) return;
  todoDragging = false;
  let b = todo.getBounds();
  const d = screen.getDisplayMatching(b).workArea;
  const cx = Math.min(Math.max(b.x, d.x), d.x + d.width - b.width), cy = Math.min(Math.max(b.y, d.y), d.y + d.height - b.height);
  const edge = edgeOf(b);
  if (cx !== b.x || cy !== b.y) { todo.setBounds({ x: cx, y: cy, width: b.width, height: b.height }); b = todo.getBounds(); }
  if (edge) conf.todoDock = { edge, along: edge === "top" ? Math.round(b.x + b.width / 2 - DOCK_LEN / 2) : Math.round(b.y + 20) };
  else { conf.todoDock = null; if (todoState === "full") conf.todo = b; }
  saveConf(); tellTodo();
}
ipcMain.handle("is-glass", (e) => !!(todo && !todo.isDestroyed() && e.sender.id === todo.webContents.id && todo._glass));
ipcMain.on("todo-resize", (e, dw, dh) => { if (!todo || todo.isDestroyed() || todoState !== "full") return; const b = todo.getBounds(); todo.setBounds({ x: b.x, y: b.y, width: Math.max(180, Math.round(b.width + dw)), height: Math.max(120, Math.round(b.height + dh)) }); conf.todo = todo.getBounds(); saveConf(); });
ipcMain.handle("get-pin", () => conf.todoPinned !== false);
ipcMain.on("set-pin", (e, v) => { conf.todoPinned = !!v; saveConf(); if (todo && !todo.isDestroyed()) todo.setAlwaysOnTop(!!v); refreshMenu(); });
ipcMain.on("badge", (e, n) => { if (bubble && !bubble.isDestroyed()) bubble.webContents.send("badge", n); });
ipcMain.on("saved", (e) => {
  for (const w of [zero, todo, main]) if (w && !w.isDestroyed() && w.webContents.id !== e.sender.id) send(w, "pull");
});

// ---------- 文件 ----------
const MIME = { pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", bmp: "image/bmp", heic: "image/heic",
  txt: "text/plain", md: "text/markdown", csv: "text/csv", json: "application/json", tex: "text/plain", py: "text/plain", js: "text/plain", ts: "text/plain", c: "text/plain", cpp: "text/plain", java: "text/plain", m: "text/plain",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" };
function readFiles(paths) {
  const out = [];
  for (const p of paths.slice(0, 6)) {
    try {
      const st = fs.statSync(p);
      if (!st.isFile()) continue;
      if (st.size > MAX_FILE) continue;
      const buf = fs.readFileSync(p);
      const ext = path.extname(p).slice(1).toLowerCase();
      out.push({ name: path.basename(p), type: MIME[ext] || "", data: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) });
    } catch (e) {}
  }
  return out;
}
function deliverPaths(paths) {
  const list = readFiles((paths || []).filter((p) => typeof p === "string"));
  if (!list.length) { showZero(); return; }
  const w = ensureZero();
  showZero();
  send(w, "files", "ask", list);
}
function filesFromArgv(argv) {
  return argv.slice(1).filter((a) => a && !a.startsWith("-") && !/\.exe$/i.test(a) && fs.existsSync(a));
}

// Ctrl+Alt+Z：读资源管理器当前选中的文件
function explorerSelection() {
  return new Promise((resolve) => {
    let script = path.join(__dirname, "selected.ps1");
    if (script.includes("app.asar")) script = script.replace("app.asar", "app.asar.unpacked");
    execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script], { windowsHide: true, timeout: 6000, encoding: "utf8" }, (err, stdout) => {
      if (err) return resolve([]);
      resolve(String(stdout || "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean));
    });
  });
}
async function onHotkey() {
  const paths = process.platform === "win32" ? await explorerSelection() : [];
  if (paths.length) deliverPaths(paths); else toggleZero();
}

// ---------- 存到 桌面\Cornell\<课程> ----------
function courseDir(course) {
  const safe = String(course).replace(/[\\/:*?"<>|]/g, " ").trim() || "其他";
  const dir = path.join(app.getPath("desktop"), "Cornell", safe);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
function freeName(dir, name, size) {
  const base = String(name).replace(/[\\/:*?"<>|]/g, "_");
  let p = path.join(dir, base);
  if (!fs.existsSync(p)) return p;
  if (size != null && fs.statSync(p).size === size) return null; // 已经有同一个文件
  const ext = path.extname(base), stem = base.slice(0, base.length - ext.length);
  for (let i = 2; i < 100; i++) { p = path.join(dir, `${stem} (${i})${ext}`); if (!fs.existsSync(p)) return p; }
  return null;
}
ipcMain.handle("save-local", (e, course, list) => {
  const dir = courseDir(course); let n = 0;
  for (const f of (list || []).slice(0, 6)) {
    try { const buf = Buffer.from(f.data); const p = freeName(dir, f.name, buf.length); if (p) fs.writeFileSync(p, buf); n++; } catch (err) {}
  }
  return n;
});
ipcMain.handle("save-pdf", async (e, course, name, html) => {
  const w = new BrowserWindow({ show: false, webPreferences: { sandbox: true, javascript: true } });
  try {
    await w.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html));
    await w.webContents.executeJavaScript("(window.MathJax&&MathJax.startup&&MathJax.startup.promise)?MathJax.startup.promise.then(()=>1):new Promise(r=>setTimeout(()=>r(1),1500))");
    const pdf = await w.webContents.printToPDF({ pageSize: "Letter", printBackground: true });
    const dir = courseDir(course);
    let p = path.join(dir, String(name).replace(/[\\/:*?"<>|]/g, "_"));
    if (fs.existsSync(p)) p = freeName(dir, path.basename(p), -1) || p;
    fs.writeFileSync(p, pdf);
    return { path: p, data: pdf.toString("base64") };
  } finally { w.destroy(); }
});

// 快捷键：首选被别的软件（比如 QQ 的 Ctrl+Alt+Z）占了就换下一个
// 自己设快捷键：托盘 →「设置快捷键…」，按下组合键保存
let hkWin = null;
function openHotkeyWin() {
  if (hkWin && !hkWin.isDestroyed()) { hkWin.focus(); return; }
  hkWin = new BrowserWindow({ width: 320, height: 200, resizable: false, minimizable: false, maximizable: false, frame: false, alwaysOnTop: true, skipTaskbar: true, show: false, icon: ICON,
    webPreferences: { preload: path.join(__dirname, "hotkey-preload.js"), contextIsolation: true, sandbox: false } });
  globalShortcut.unregisterAll(); // 录入时先松开当前快捷键，免得按下去就触发
  hkWin.loadFile(path.join(__dirname, "hotkey.html"));
  hkWin.once("ready-to-show", () => { hkWin.center(); hkWin.show(); hkWin.focus(); });
  hkWin.on("closed", () => { hkWin = null; registerHotkey(conf.hotkey); });
}
ipcMain.handle("hk-current", () => conf.hotkey || hotkey);
ipcMain.handle("hk-save", (e, acc) => {
  let ok = false;
  try { ok = globalShortcut.register(acc, () => {}); if (ok) globalShortcut.unregister(acc); } catch (err) { ok = false; }
  if (!ok) return false;
  conf.hotkey = acc; saveConf(); return true;
});
ipcMain.on("hk-close", () => { if (hkWin && !hkWin.isDestroyed()) hkWin.close(); });

function registerHotkey(pref) {
  hotkey = "";
  globalShortcut.unregisterAll();
  const list = pref ? [pref, ...HOTKEYS.filter((k) => k !== pref)] : HOTKEYS;
  for (const k of list) { try { if (globalShortcut.register(k, onHotkey)) { hotkey = k; break; } } catch (e) {} }
  refreshMenu();
}

// ---------- 学习转盘：按住 Ctrl 拖文件，鼠标处弹出转盘，拖到哪一格就交给谁 ----------
let ring = null, hook = null, ringDown = null, ringShown = false, ringHideT = null;
const RING = 300;
function createRing() {
  ring = new BrowserWindow({ width: RING, height: RING, frame: false, transparent: true, resizable: false, movable: false, focusable: false,
    skipTaskbar: true, alwaysOnTop: true, hasShadow: false, show: false,
    webPreferences: { preload: path.join(__dirname, "ring-preload.js"), contextIsolation: true, sandbox: false } });
  ring.setAlwaysOnTop(true, "screen-saver");
  ring.loadFile(path.join(__dirname, "ring.html"));
}
function toDip(x, y) { return process.platform === "win32" ? screen.screenToDipPoint({ x, y }) : { x, y }; }
function showRing(x, y) {
  if (!ring || ring.isDestroyed() || conf.ringOff) return;
  const p = toDip(x, y);
  ring.setBounds({ x: Math.round(p.x - RING / 2), y: Math.round(p.y - RING / 2), width: RING, height: RING });
  ring.webContents.send("ring-show"); ring.showInactive(); ringShown = true;
}
function hideRing(delay) { clearTimeout(ringHideT); ringHideT = setTimeout(() => { if (ring && !ring.isDestroyed()) ring.hide(); ringShown = false; }, delay || 0); }
// 转盘按键：默认 Shift（Ctrl 留给 Filee）。按住它拖文件就出转盘
const RING_MODS = { shift: "Shift", alt: "Alt", ctrlshift: "Ctrl + Shift", ctrl: "Ctrl" };
function ringMod(e) {
  const m = conf.ringMod || "shift";
  if (m === "shift") return e.shiftKey && !e.ctrlKey && !e.altKey;
  if (m === "alt") return e.altKey && !e.ctrlKey && !e.shiftKey;
  if (m === "ctrlshift") return e.ctrlKey && e.shiftKey && !e.altKey;
  return e.ctrlKey && !e.shiftKey && !e.altKey;
}
function startRingHook() {
  try { ({ uIOhook: hook } = require("uiohook-napi")); } catch (e) { hook = null; return; }
  hook.on("mousedown", (e) => { ringDown = (e.button === 1 && ringMod(e)) ? { x: e.x, y: e.y } : null; });
  hook.on("mousemove", (e) => {
    if (!ringDown || ringShown) return;
    if (Math.hypot(e.x - ringDown.x, e.y - ringDown.y) > 14) showRing(ringDown.x, ringDown.y);
  });
  hook.on("mouseup", () => { ringDown = null; if (ringShown) hideRing(350); });
  try { hook.start(); } catch (e) { hook = null; }
}
ipcMain.on("ring-drop", (e, target, paths) => {
  hideRing(0);
  if (!target || !paths || !paths.length) return;
  const list = readFiles(paths);
  if (!list.length) return;
  if (target === "archive") {
    showZero(); send(ensureZero(), "files", "archive", list); // 零的窗口里选一科，只存档不聊天
    return;
  }
  showZero();
  send(ensureZero(), "files", target === "zero" ? "zero" : "zero:" + target, list);
});

// ---------- 下载自动收纳：盯着“下载”文件夹，课程文件交给零判断是哪门课，再移到 桌面\Cornell\<课程> ----------
const INBOX_EXT = /\.(pdf|docx?|pptx?|xlsx?|txt|md|png|jpe?g|heic|zip)$/i;
let inboxWatcher = null, lastInbox = null;
const inboxTimers = new Map();
function startInbox() {
  if (inboxWatcher || conf.inboxOff) return;
  const dir = app.getPath("downloads");
  try {
    inboxWatcher = fs.watch(dir, (ev, name) => {
      if (!name || !INBOX_EXT.test(name) || /\.(crdownload|part|tmp|download)$/i.test(name)) return;
      const p = path.join(dir, name);
      clearTimeout(inboxTimers.get(p));
      inboxTimers.set(p, setTimeout(() => settleInbox(p, -1), 2500));
    });
  } catch (e) { inboxWatcher = null; }
}
function stopInbox() { if (inboxWatcher) { try { inboxWatcher.close(); } catch (e) {} inboxWatcher = null; } }
function settleInbox(p, lastSize) {
  inboxTimers.delete(p);
  let st; try { st = fs.statSync(p); } catch (e) { return; }
  if (!st.isFile() || st.size === 0 || st.size > MAX_FILE) return;
  if (Date.now() - st.birthtimeMs > 10 * 60 * 1000 && Date.now() - st.mtimeMs > 10 * 60 * 1000) return; // 只管新下载的
  if (st.size !== lastSize) { inboxTimers.set(p, setTimeout(() => settleInbox(p, st.size), 1500)); return; } // 还在写
  const list = readFiles([p]); if (!list.length) return;
  list[0].src = p;
  send(ensureZero(), "files", "inbox", list);
}
ipcMain.handle("inbox-place", (e, src, course, name) => {
  try {
    if (!src || !fs.existsSync(src)) return "";
    const dir = courseDir(course), size = fs.statSync(src).size;
    let dest = freeName(dir, name || path.basename(src), size);
    if (!dest) { fs.unlinkSync(src); dest = path.join(dir, name || path.basename(src)); } // 课程文件夹里已经有同一个文件
    else { try { fs.renameSync(src, dest); } catch (err) { fs.copyFileSync(src, dest); fs.unlinkSync(src); } }
    lastInbox = { from: src, to: dest };
    try { new Notification({ title: "已收纳到 " + course, body: path.basename(dest), icon: ICON, silent: true }).show(); } catch (err) {}
    refreshMenu();
    return dest;
  } catch (err) { return ""; }
});
function undoInbox() {
  if (!lastInbox) return;
  try { if (fs.existsSync(lastInbox.to) && !fs.existsSync(lastInbox.from)) fs.renameSync(lastInbox.to, lastInbox.from); } catch (e) {}
  lastInbox = null; refreshMenu();
}

// ---------- 托盘 ----------
function menu() {
  return Menu.buildFromTemplate([
    { label: "问零", click: () => showZero() },
    { label: "签到", click: () => showZero("daily") },
    { label: "待办", type: "checkbox", checked: !!(todo && !todo.isDestroyed() && todo.isVisible()), click: toggleTodo },
    { label: "待办置顶", type: "checkbox", checked: conf.todoPinned !== false, click: (i) => { conf.todoPinned = i.checked; saveConf(); if (todo && !todo.isDestroyed()) todo.setAlwaysOnTop(i.checked); } },
    { label: "打开学习空间", click: () => openMain() },
    { type: "separator" },
    { label: "显示零的小圆", type: "checkbox", checked: conf.bubbleHidden !== true, click: (i) => { conf.bubbleHidden = !i.checked; saveConf(); if (bubble) { if (i.checked) bubble.showInactive(); else bubble.hide(); } } },
    { label: "学习转盘：按住 " + RING_MODS[conf.ringMod || "shift"] + " 拖文件", submenu: [
      { label: "开启", type: "checkbox", checked: !conf.ringOff, click: (i) => { conf.ringOff = !i.checked; saveConf(); refreshMenu(); } },
      { type: "separator" },
      ...Object.entries(RING_MODS).map(([k, t]) => ({ label: "按住 " + t, type: "radio", checked: (conf.ringMod || "shift") === k, click: () => { conf.ringMod = k; saveConf(); refreshMenu(); } })),
    ] },
    { label: "自动收纳下载的课程文件", type: "checkbox", checked: !conf.inboxOff, click: (i) => { conf.inboxOff = !i.checked; saveConf(); if (i.checked) startInbox(); else stopInbox(); } },
    { label: lastInbox ? "撤销上次收纳（" + path.basename(lastInbox.to).slice(0, 24) + "）" : "撤销上次收纳", enabled: !!lastInbox, click: undoInbox },
    { label: "开机启动", type: "checkbox", checked: app.getLoginItemSettings().openAtLogin, click: (i) => app.setLoginItemSettings({ openAtLogin: i.checked }) },
    { label: hotkey ? "设置快捷键…（现在是 " + keyName(hotkey) + "）" : "设置快捷键…（现在没有）", click: openHotkeyWin },
    { type: "separator" },
    { label: "退出", click: () => { app.isQuitting = true; app.quit(); } },
  ]);
}
function refreshMenu() { if (tray) tray.setContextMenu(menu()); }

// ---------- 登录后刷新其他窗口 ----------
function watchLogin() {
  let t = null;
  session.fromPartition(PART).cookies.on("changed", (e, cookie, cause, removed) => {
    if (removed || !/catmin\.io$/.test(cookie.domain.replace(/^\./, ""))) return;
    clearTimeout(t);
    t = setTimeout(() => { for (const w of [zero, todo]) if (w && !w.isDestroyed()) w.webContents.reload(); }, 1500);
  });
}

app.on("second-instance", (e, argv) => {
  const files = filesFromArgv(argv);
  if (files.length) deliverPaths(files); else showZero();
});

app.whenReady().then(() => {
  if (!conf.setupDone) { app.setLoginItemSettings({ openAtLogin: true }); conf.setupDone = true; conf.todoShown = true; saveConf(); }
  tray = new Tray(nativeImage.createFromPath(TRAY_ICON));
  tray.setToolTip("学习空间");
  tray.on("click", () => toggleZero());
  refreshMenu();
  createBubble();
  watchLogin();
  ensureZero(); // 先在后台加载，点开就是现成的
  createTodo(conf.todoShown !== false);
  registerHotkey(conf.hotkey);
  createRing();
  startRingHook();
  startInbox();
  const files = filesFromArgv(process.argv);
  if (files.length) deliverPaths(files);
  screen.on("display-metrics-changed", () => { if (bubble && !onScreen({ x: bubble.getPosition()[0], y: bubble.getPosition()[1] })) { const a = workArea(); bubble.setPosition(a.x + a.width - BUB - 2, a.y + a.height - BUB - 2); } });
});

app.on("window-all-closed", (e) => { /* 常驻托盘，不退出 */ });
app.on("will-quit", () => { globalShortcut.unregisterAll(); try { if (hook) hook.stop(); } catch (e) {} });

// 本地冒烟测试（不打包进安装包）：ZS_TEST=1 electron .
if (process.env.ZS_TEST) app.whenReady().then(() => require("./smoke.js")({ deliverPaths, get zero() { return zero; }, get todo() { return todo; }, get bubble() { return bubble; }, showZero, toggleTodo, openHotkeyWin }));

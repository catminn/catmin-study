// 学习空间桌面版
// - 右下角零的小圆（可拖动）；点开是零的聊天框（study.catmin.io/?embed=zero）
// - 置顶待办小窗（?embed=todo），半透明
// - 文件交给零：右键「发送到 → 学习空间」、选中文件按 Ctrl+Alt+Z、拖到小圆上
// - 托盘菜单；开机自启
const { app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain, screen, nativeImage, session, shell, nativeTheme } = require("electron");
const path = require("path");
const fs = require("fs");
const { execFile } = require("child_process");
const os = require("os");

const SITE = process.env.ZS_SITE || "https://study.catmin.io/";
const PART = "persist:xuexi";
const HOTKEYS = ["Control+Alt+Z", "Control+Alt+Q", "Alt+Shift+Z", "Control+Shift+Space"];
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
ipcMain.on("bubble-move", (e, dx, dy) => {
  if (!bubble) return;
  const [x, y] = bubble.getPosition();
  bubble.setBounds({ x: Math.round(x + dx), y: Math.round(y + dy), width: BUB, height: BUB });
  if (zero && zero.isVisible()) placeZero();
});
ipcMain.on("bubble-moved", () => { if (!bubble) return; const [x, y] = bubble.getPosition(); conf.bubble = { x, y }; saveConf(); });
ipcMain.on("bubble-click", () => toggleZero());
ipcMain.on("bubble-menu", () => { menu().popup({ window: bubble }); });
ipcMain.on("bubble-drop", (e, paths) => deliverPaths(paths));

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
  const glass = process.platform === "win32" && Number((os.release().split(".")[2]) || 0) >= 22000; // Windows 11：系统毛玻璃 + 圆角
  const opts = { x: b.x, y: b.y, width: b.width, height: b.height, minWidth: 200, minHeight: 140, resizable: true, alwaysOnTop: conf.todoPinned !== false, backgroundColor: "#00000000" };
  if (glass) { opts.transparent = false; opts.backgroundMaterial = "acrylic"; opts.roundedCorners = true; }
  else opts.transparent = true;
  todo = pageWin(opts, SITE + "?embed=todo" + (glass ? "&glass=1" : ""));
  const remember = () => { if (todo && !todo.isDestroyed()) { conf.todo = todo.getBounds(); saveConf(); } };
  todo.on("moved", remember); todo.on("resized", remember);
  todo.on("closed", () => { todo = null; });
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
  const files = filesFromArgv(process.argv);
  if (files.length) deliverPaths(files);
  screen.on("display-metrics-changed", () => { if (bubble && !onScreen({ x: bubble.getPosition()[0], y: bubble.getPosition()[1] })) { const a = workArea(); bubble.setPosition(a.x + a.width - BUB - 2, a.y + a.height - BUB - 2); } });
});

app.on("window-all-closed", (e) => { /* 常驻托盘，不退出 */ });
app.on("will-quit", () => globalShortcut.unregisterAll());

// 本地冒烟测试（不打包进安装包）：ZS_TEST=1 electron .
if (process.env.ZS_TEST) app.whenReady().then(() => require("./smoke.js")({ deliverPaths, get zero() { return zero; }, get todo() { return todo; }, get bubble() { return bubble; }, showZero, toggleTodo, openHotkeyWin }));

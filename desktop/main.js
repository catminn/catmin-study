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
const { applyGlass, clearGlass, keepActive, accentRaw, dwmAttr, extendFrame, powerSaver, shapeWin, circleRects, ribbonRects, rgnShape } = require("./glass");
// 小圆、书签、转盘也用 Windows 11 材质：窗口不透明 + 系统亚克力，再用 setShape 裁成自己的形状
const MAT = () => false; // 试过：在这台电脑上材质窗口裁不成圆形/书签形状（整块方形灰底），小东西先用半透明
function smallOpts() {
  if (smallLab && smallLab.transparent === false) return { transparent: false, backgroundColor: smallLab.bg || "#00000000", backgroundMaterial: smallLab.material || "acrylic" };
  return MAT() ? { transparent: false, backgroundColor: "#00000000", backgroundMaterial: "acrylic" } : { transparent: true };
}
// 小圆、书签的远程实验（glass-lab.json 里的 small 字段），排查磨砂和形状
let smallLab = null, smallLog = [];
function smallShape(w) {
  if (w === bubble) return { kind: "circle", data: [BUB / 2, BUB / 2, 26], rects: circleRects(BUB / 2, BUB / 2, 26, 0) };
  const edge = conf.todoDock ? conf.todoDock.edge : "top", side = edge === "left" || edge === "right", W = side ? DOCK : DOCK_LEN, H = side ? DOCK_LEN : DOCK, n = 7;
  const pts = edge === "left" ? [[0, 0], [W, 0], [W - n, H / 2], [W, H], [0, H]] : edge === "right" ? [[0, 0], [W, 0], [W, H], [0, H], [n, H / 2]] : [[0, 0], [W, 0], [W, H], [W / 2, H - n], [0, H]];
  return { kind: "poly", data: pts, rects: ribbonRects(W, H, n, edge) };
}
function smallApplyOne(w) {
  const c = smallLab; if (!c || !w || w.isDestroyed()) return;
  const out = [];
  try {
    if (c.material !== undefined && w.setBackgroundMaterial) { w.setBackgroundMaterial(c.material); out.push("mat"); }
    if (c.accent) out.push("acc=" + accentRaw(w, c.accent.state, c.accent.flags, c.accent.color));
    if (c.corner != null) out.push("cor=" + dwmAttr(w, 33, c.corner));
    if (c.backdrop != null) out.push("bd=" + dwmAttr(w, 38, c.backdrop));
    if (c.extend != null) out.push("ext=" + extendFrame(w, c.extend));
    if (c.nca) keepActive(w);
    const sh = smallShape(w);
    if (c.shape === "setShape") { w.setShape(sh.rects); out.push("ss"); }
    else if (c.shape === "rgn") { setTimeout(() => smallLog.push("rgn=" + rgnShape(w, sh.kind, sh.data)), c.rgnDelay || 0); }
    else if (c.shape === "none") { w.setShape([]); rgnShape(w, "none"); }
    if (c.css != null) { const old = w._labCss; w.webContents.insertCSS(String(c.css)).then((k) => { w._labCss = k; if (old) w.webContents.removeInsertedCSS(old).catch(() => {}); }).catch(() => {}); }
  } catch (e) { out.push("err " + e.message); }
  smallLog = out;
}
function smallApply() { for (const w of [bubble, tab]) smallApplyOne(w); dlog("small lab", smallLab, smallLog); }
function matWin(win, rects) {
  if (!win || win.isDestroyed() || !MAT()) return;
  shapeWin(win, rects);
  keepActive(win);
  if (!win._matHooked) { win._matHooked = true; win.on("show", () => setTimeout(() => keepActive(win), 30)); win.on("blur", () => setTimeout(() => keepActive(win), 30)); win.webContents.on("did-finish-load", () => win.webContents.send("glass", "mat")); }
  win.webContents.send("glass", "mat");
}
// 毛玻璃：用 Windows 自己的模糊，底下有什么就透出什么（需要 Windows 设置里“透明效果”开着）。
// 只给方形的待办（展开时）和零的窗口用；小圆、书签、转盘是自己画的半透明形状，不加系统模糊（否则会多出一个方框）。
let transOn = null;
function readTransparency() {
  return new Promise((resolve) => {
    if (process.platform !== "win32") return resolve(false);
    execFile("reg", ["query", "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize", "/v", "EnableTransparency"], { windowsHide: true, timeout: 4000 }, (err, out) => {
      if (err) return resolve(true);
      const m = /EnableTransparency\s+REG_DWORD\s+0x(\d+)/.exec(String(out)); resolve(!m || m[1] !== "0");
    });
  });
}
// 玻璃效果有几种做法，不同电脑上哪种能用不一样，托盘里可以切换：
//   blur     系统模糊（ACCENT_ENABLE_BLURBEHIND），Win10/11 都有，默认
//   acrylic  系统亚克力（ACCENT_ENABLE_ACRYLICBLURBEHIND）
//   material Windows 11 的亚克力材质（backgroundMaterial），窗口不透明，失去焦点时用“保持激活”的办法留住效果
//   clear    不模糊，只是半透明
const GLASS_MODES = { blur: "模糊", acrylic: "亚克力", material: "Windows 11 材质", clear: "只半透明", lab: "实验（排查用）" };
// 默认用 Windows 11 材质（Catherine 电脑上试下来效果最好）；Windows 10 没有这个，退回模糊
const WIN11 = process.platform === "win32" && Number((require("os").release().split(".")[2]) || 0) >= 22000;
const glassMode = () => (GLASS_MODES[conf.glassMode] ? conf.glassMode : WIN11 ? "material" : "blur");
// 材质本身已经有一层淡色，页面上的白色衬底要更淡，不然显得不透明
const MATERIAL_CSS = "html body.embed.glass{--gl-bg:linear-gradient(165deg,rgba(255,255,255,.14),rgba(255,255,255,.04));--gl-card:rgba(255,255,255,.4);--gl-line:rgba(255,255,255,.35)}";
function glassOpts() {
  if (glassMode() === "material" && process.platform === "win32") return { transparent: false, backgroundColor: "#00000000", backgroundMaterial: "acrylic" };
  return { transparent: true, backgroundColor: "#00000000" };
}
function glassFor(win, on) {
  if (!win || win.isDestroyed()) return;
  const m = glassMode();
  if (!on || !transOn || m === "clear") { win._glass = false; return; }
  if (m === "lab") { win._glass = true; setTimeout(labApply, 500); return; }
  if (m === "material") {
    win._glass = true; keepActive(win); dwmAttr(win, 33, 2); // 圆角
    const css = () => { if (!win.isDestroyed()) win.webContents.insertCSS(MATERIAL_CSS).catch(() => {}); };
    // 透明效果开关变了会再调一次：监听只挂一次，免得越挂越多
    if (!win._glassHooked) { win._glassHooked = true; win.on("blur", () => setTimeout(() => keepActive(win), 30)); win.webContents.on("did-finish-load", css); }
    css();
    return;
  }
  win._glass = applyGlass(win, false, 2, m === "acrylic" ? 4 : 3);
}
// 实验模式：每 10 秒读一次网站上的 glass-lab.json，按里面的参数给待办和零的窗口设效果，方便远程排查
let labCfg = null, labTimer = null, labLog = [];
async function labPoll() {
  try {
    // 用待办页面去取（同源，带登录），比主进程直接请求可靠
    const w = [todo, zero].find((x) => x && !x.isDestroyed());
    if (!w) return;
    const txt = await w.webContents.executeJavaScript(`fetch("/glass-lab.json?t=${Date.now()}",{cache:"no-store",credentials:"include"}).then(r=>r.ok?r.text():"").catch(()=>"")`);
    let j; try { j = JSON.parse(txt); } catch (e) { if (!labPoll.warned) { labPoll.warned = true; dlog("lab fetch bad", String(txt).slice(0, 80)); } return; }
    const s = j.small || null;
    if (JSON.stringify(s) !== JSON.stringify(smallLab)) {
      const recreate = ((smallLab && smallLab.transparent) === false) !== ((s && s.transparent) === false);
      smallLab = s;
      if (recreate) { // 透明 / 不透明换了要重建窗口
        const bShown = bubble && !bubble.isDestroyed() && bubble.isVisible();
        if (bubble && !bubble.isDestroyed()) bubble.destroy(); bubble = null; createBubble(); if (bShown) setTimeout(() => bubble && bubble.showInactive(), 800);
        const tShown = tab && !tab.isDestroyed() && tab.isVisible();
        if (tab && !tab.isDestroyed()) tab.destroy(); tab = null; if (tShown) { const t = ensureTab(); t.setBounds(tabRect()); tabSend(); t.once("ready-to-show", () => t.showInactive()); }
      } else smallApply();
    }
    if (j.todoZero === false) return;
    if (JSON.stringify(j) !== JSON.stringify(labCfg)) { labCfg = j; labApply(); }
  } catch (e) {}
}
function labApply() {
  const c = labCfg || {}; const out = [];
  for (const w of [todo, zero]) {
    if (!w || w.isDestroyed()) continue;
    try {
      if (c.accent) out.push("accent=" + accentRaw(w, c.accent.state, c.accent.flags, c.accent.color));
      if (c.backdrop != null) out.push("backdrop=" + dwmAttr(w, 38, c.backdrop));
      if (c.corner != null) out.push("corner=" + dwmAttr(w, 33, c.corner));
      if (c.extend != null) out.push("extend=" + extendFrame(w, c.extend));
      if (c.material !== undefined && w.setBackgroundMaterial) { w.setBackgroundMaterial(c.material); out.push("material=" + c.material); }
      if (c.bg) w.setBackgroundColor(c.bg);
      if (c.nca) keepActive(w);
      if (c.css != null) { const old = w._labCss; w.webContents.insertCSS(String(c.css)).then((k) => { w._labCss = k; if (old) w.webContents.removeInsertedCSS(old).catch(() => {}); }).catch(() => {}); }
    } catch (e) { out.push("err " + e.message); }
  }
  labLog = out; refreshMenu();
}
function setGlassMode(k) {
  clearInterval(labTimer); labTimer = null;
  if (k === "lab") { labCfg = null; labTimer = setInterval(labPoll, 10000); setTimeout(labPoll, 3000); }
  conf.glassMode = k; saveConf(); refreshMenu();
  // 换做法要重建窗口（material 需要不透明窗口）
  const showTodo = conf.todoShown !== false, zeroWasOpen = zero && !zero.isDestroyed() && zero.isVisible();
  if (todo && !todo.isDestroyed()) todo.destroy(); todo = null; todoState = "full";
  if (tab && !tab.isDestroyed()) tab.hide();
  if (zero && !zero.isDestroyed()) zero.destroy(); zero = null;
  createTodo(showTodo); ensureZero(); if (zeroWasOpen) showZero();
}
const sendWall = () => {}, watchWall = () => {}, sendWallAll = () => {};
const dark = () => false; // 桌面上的小东西一律浅色半透明（背景深了它自然变深）

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
// 排查用日志：userData\desktop.log（只记窗口状态和出错，不记内容）
const LOGF = path.join(app.getPath("userData"), "desktop.log");
function dlog(...a) { try { fs.appendFileSync(LOGF, new Date().toISOString() + " " + a.map((x) => typeof x === "string" ? x : JSON.stringify(x)).join(" ") + "\n"); } catch (e) {} }
try { if (fs.existsSync(LOGF) && fs.statSync(LOGF).size > 512 * 1024) fs.writeFileSync(LOGF, ""); } catch (e) {}
process.on("uncaughtException", (e) => dlog("uncaught", e && e.stack || String(e)));
let conf = {};
try { conf = JSON.parse(fs.readFileSync(CONF, "utf8")); } catch (e) { conf = {}; }
if (!conf || typeof conf !== "object" || Array.isArray(conf)) conf = {};
let confTimer = null;
// 先写临时文件再换上，写到一半断电/被杀也不会把设置弄坏（坏了会全部重置，包括开机启动）
function writeConf() { const s = JSON.stringify(conf), tmp = CONF + ".tmp"; try { fs.writeFileSync(tmp, s); fs.renameSync(tmp, CONF); } catch (e) { try { fs.writeFileSync(CONF, s); } catch (x) {} } }
function saveConf() { clearTimeout(confTimer); confTimer = setTimeout(() => { confTimer = null; writeConf(); }, 300); }
function flushConf() { if (confTimer) { clearTimeout(confTimer); confTimer = null; writeConf(); } }

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

// 只允许在窗口里打开学习空间和 Google 登录；别的链接交给浏览器（只放行 http/https/mailto，不让网页打开本地程序或文件）
function navOk(u) { if (String(u).startsWith(SITE)) return true; try { const x = new URL(u); return x.protocol === "https:" && x.hostname === "accounts.google.com"; } catch (e) { return false; } }
function openOut(u) { try { if (/^(https?|mailto):$/.test(new URL(u).protocol)) shell.openExternal(u); } catch (e) {} }
// 只有学习空间自己的页面能让桌面程序动文件
const fromSite = (e) => { try { return e.sender.getURL().startsWith(SITE); } catch (x) { return false; } };
function pageWin(opts, url) {
  const w = new BrowserWindow(Object.assign({
    show: false, frame: false, skipTaskbar: true, icon: ICON,
    // preload.js 只用 contextBridge / ipcRenderer，沙盒里也能用；远程网页放进沙盒更安全
    webPreferences: { partition: PART, preload: path.join(__dirname, "preload.js"), contextIsolation: true, sandbox: true, spellcheck: false },
  }, opts));
  const id = w.webContents.id;
  w.webContents.on("did-start-loading", () => readyWins.delete(id));
  w.once("ready-to-show", () => { w._painted = true; });
  w.on("closed", () => { readyWins.delete(id); queued.delete(id); });
  w.webContents.setWindowOpenHandler(({ url }) => { openOut(url); return { action: "deny" }; });
  w.webContents.on("will-navigate", (e, url) => { if (!navOk(url)) { e.preventDefault(); openOut(url); } });
  w.loadURL(url);
  return w;
}

// ---------- 零的小圆 ----------
const BUB = 84;
function createBubble() {
  const a = workArea();
  const pos = conf.bubble && onScreen({ x: conf.bubble.x, y: conf.bubble.y }) ? conf.bubble : { x: a.x + a.width - BUB - 2, y: a.y + a.height - BUB - 2 };
  bubble = new BrowserWindow({
    x: pos.x, y: pos.y, width: BUB, height: BUB, frame: false, ...smallOpts(), resizable: false, maximizable: false, minimizable: false, thickFrame: false,
    skipTaskbar: true, alwaysOnTop: true, hasShadow: false, focusable: true, show: false, icon: ICON,
    webPreferences: { preload: path.join(__dirname, "bubble-preload.js"), contextIsolation: true, sandbox: false },
  });
  bubble.setAlwaysOnTop(true, "screen-saver");
  bubble.loadFile(path.join(__dirname, "bubble.html"));
  dlog("bubble create", pos, smallOpts());
  bubble.once("ready-to-show", () => { dlog("bubble ready", conf.bubbleHidden, bubble.getBounds()); if (conf.bubbleHidden !== true) bubble.showInactive(); setTimeout(() => dlog("bubble state", bubble && !bubble.isDestroyed() && bubble.isVisible(), bubble && !bubble.isDestroyed() && bubble.getBounds()), 3000); });
  bubble.webContents.on("render-process-gone", (e, d) => dlog("bubble gone", d));
  bubble.webContents.on("console-message", (e, lvl, msg) => { if (lvl >= 2) dlog("bubble console", msg); });
  matWin(bubble, circleRects(BUB / 2, BUB / 2, 26, 0));
  bubble.on("show", () => setTimeout(() => smallApplyOne(bubble), 100)); bubble.on("moved", () => smallApplyOne(bubble));
  bubble.webContents.on("did-finish-load", () => { smallApplyOne(bubble); if (bubbleDotOn) bubble.webContents.send("badge", 1); }); // 重建的小圆也要带上红点
}
// 小圆：窗口裁成直径 52 的圆，圆里是毛玻璃
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
ipcMain.on("bubble-drop", async (e, paths) => {
  dlog("bubble-drop", (paths || []).length);
  if (paths && paths.length) return deliverPaths(paths);
  // 拿不到路径时，用资源管理器里选中的文件
  const ps = process.platform === "win32" ? await explorerSelection() : [];
  dlog("bubble-drop fallback", ps.length);
  if (ps.length) deliverPaths(ps); else showZero();
});

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
// 零的窗口可以拖边框调大小，记住大小（位置还是跟着小圆）
const zSize = () => { const z = conf.zeroSize || {}; return { w: Math.max(300, Math.min(1000, z.w || 380)), h: Math.max(360, Math.min(1200, z.h || 560)) }; };
function placeZero() {
  if (!zero || !bubble) return;
  const { w: ZW, h: ZH } = zSize();
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
  zero = pageWin(Object.assign({ width: zSize().w, height: zSize().h, minWidth: 300, minHeight: 360, alwaysOnTop: true, resizable: true, thickFrame: false }, glassOpts()), SITE + "?embed=zero");
  let rz = null;
  zero.on("resize", () => { clearTimeout(rz); rz = setTimeout(() => { if (!zero || zero.isDestroyed() || !zero.isVisible()) return; const b = zero.getBounds(); conf.zeroSize = { w: b.width, h: b.height }; saveConf(); }, 400); });
  glassFor(zero, true);
  zero.setAlwaysOnTop(true, "floating");
  zero.on("closed", () => { zero = null; });
  return zero;
}
function showZero(cmd) {
  bubbleDot(false);
  const w = ensureZero();
  placeZero();
  const go = () => { if (w.isDestroyed()) return; w.show(); w.focus(); if (cmd) send(w, "cmd", cmd); };
  // ready-to-show 每个窗口只来一次：重新加载（登录后刷新）时 isLoading 也是 true，等它就永远打不开了
  if (!w._painted) w.once("ready-to-show", go); else go();
}
function toggleZero() { if (zero && zero.isVisible()) zero.hide(); else showZero(); }

// ---------- 待办小窗 ----------
function createTodo(show) {
  if (todo && !todo.isDestroyed()) { if (show) todo.showInactive(); return todo; }
  const a = workArea();
  const b = conf.todo && onScreen(conf.todo) ? conf.todo : { x: a.x + a.width - 280 - 24, y: a.y + 40, width: 280, height: 320 };
  // 毛玻璃用 glass.js（失去焦点也保持）；不支持的系统退回页面自己的半透明底色
  const opts = Object.assign({ x: b.x, y: b.y, width: b.width, height: b.height, minWidth: 160, minHeight: 120, resizable: true, thickFrame: false, hasShadow: false, alwaysOnTop: conf.todoPinned !== false }, glassOpts());
  todo = pageWin(opts, SITE + "?embed=todo");
  // 焦点用事件记（毛玻璃会补发“激活”消息，isFocused() 在失焦后也可能还是 true）
  todo.on("focus", () => { todoFocused = true; }); todo.on("blur", () => { todoFocused = false; });
  todo.on("will-move", () => { todoDragging = true; clearTimeout(todoDragT); todoDragT = setTimeout(() => { todoDragging = false; }, 1500); });
  todo.on("moved", todoMoved);
  todo.on("resized", () => { if (todo && !todo.isDestroyed() && todoState === "full") { conf.todo = todo.getBounds(); saveConf(); } });
  todo.on("closed", () => { todo = null; todoState = "full"; });
  glassFor(todo, true);
  todo.once("ready-to-show", () => { if (show) todo.showInactive(); });
  return todo;
}
function toggleTodo() {
  const shown = (todo && !todo.isDestroyed() && todo.isVisible()) || (tab && !tab.isDestroyed() && tab.isVisible());
  if (shown) { if (todo && !todo.isDestroyed()) todo.hide(); if (tab && !tab.isDestroyed()) tab.hide(); conf.todoShown = false; }
  else { todoState = "full"; createTodo(true); todo.setOpacity(1); if (todo.isVisible()) todo.showInactive(); conf.todoShown = true; }
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
ipcMain.on("hide", (e) => { const w = winOf(e); if (w) w.hide(); if (w === todo) { if (tab && !tab.isDestroyed()) tab.hide(); conf.todoShown = false; saveConf(); refreshMenu(); } });
ipcMain.on("open-main", (e, hash) => openMain(typeof hash === "string" ? hash : ""));
ipcMain.on("open-zero", (e, cmd) => showZero(typeof cmd === "string" ? cmd : ""));
// 页面里拖左上角调零的窗口大小：右下角不动
ipcMain.on("zero-size", (e, w, h, done) => {
  if (!zero || zero.isDestroyed() || winOf(e) !== zero) return;
  const b = zero.getBounds(), W = Math.round(Math.max(300, Math.min(1000, w))), H = Math.round(Math.max(360, Math.min(1200, h)));
  zero.setBounds({ x: b.x + b.width - W, y: b.y + b.height - H, width: W, height: H });
  if (done) { conf.zeroSize = { w: W, h: H }; saveConf(); }
});
ipcMain.on("to-main", (e, subj, list) => { const w = openMain("#dungeon"); send(w, "files", String(subj), list); });
// 待办两种样子：full 展开的列表（todo 窗口）；收起来是一枚燕尾书签（单独的 tab 小窗口，不加任何系统效果）。
// 贴着上、左、右边收起就是贴边书签，不贴边就是原地一枚小书签；鼠标移上去展开，移开 0.6 秒收起。
const MINI = { width: 22, height: 34 }, DOCK = 34, DOCK_LEN = 22, SNAP = 24;
let todoState = "full", tab = null, todoHot = 0;
const fullSize = () => (conf.todo && conf.todo.width > 120 ? conf.todo : { width: 280, height: 320 });
function edgeOf(b) {
  const d = screen.getDisplayMatching(b).workArea;
  if (b.x <= d.x + SNAP) return "left";
  if (b.x + b.width >= d.x + d.width - SNAP) return "right";
  if (b.y <= d.y + SNAP) return "top";
  return null;
}
function tellTodo() { if (todo && !todo.isDestroyed()) send(todo, "todo-state", { mode: "full", edge: "" }); }
function dockRect(d) {
  const k = conf.todoDock, clampY = (y) => Math.min(Math.max(y, d.y), d.y + d.height - DOCK_LEN), clampX = (x) => Math.min(Math.max(x, d.x), d.x + d.width - DOCK_LEN);
  if (k.edge === "left") return { x: d.x, y: clampY(k.along), width: DOCK, height: DOCK_LEN };
  if (k.edge === "right") return { x: d.x + d.width - DOCK, y: clampY(k.along), width: DOCK, height: DOCK_LEN };
  return { x: clampX(k.along), y: d.y, width: DOCK_LEN, height: DOCK };
}
function ensureTab() {
  if (tab && !tab.isDestroyed()) return tab;
  tab = new BrowserWindow({ width: MINI.width, height: MINI.height, frame: false, ...smallOpts(), resizable: false, movable: false, focusable: false, thickFrame: false,
    skipTaskbar: true, alwaysOnTop: true, hasShadow: false, show: false, minWidth: 10, minHeight: 10,
    webPreferences: { preload: path.join(__dirname, "tab-preload.js"), contextIsolation: true, sandbox: false } });
  tab.setAlwaysOnTop(!gameHidden && conf.todoPinned !== false, "screen-saver"); // 置顶时书签也一直在最上面（玩游戏时不置顶）
  tab.loadFile(path.join(__dirname, "tab.html"));
  tab.on("show", () => setTimeout(() => smallApplyOne(tab), 100)); tab.on("move", () => setTimeout(() => smallApplyOne(tab), 50));
  // 新建书签时 tabSend 发得比页面加载早，会丢：加载好再发一次（不然贴左右边时画成朝下的形状、没有红点）
  tab.webContents.on("did-finish-load", () => { smallApplyOne(tab); tabSend(); });
  tab.on("closed", () => { tab = null; });
  return tab;
}
function tabRect() {
  const f = conf.todo || fullSize(), d = screen.getDisplayMatching(f).workArea;
  if (conf.todoDock) return dockRect(d);
  const right = f.x + f.width / 2 > d.x + d.width / 2;
  return { x: right ? f.x + f.width - MINI.width - 14 : f.x + 14, y: f.y, width: MINI.width, height: MINI.height };
}
function tabSend() {
  if (!tab || tab.isDestroyed()) return;
  const edge = conf.todoDock ? conf.todoDock.edge : "top", side = edge === "left" || edge === "right";
  tab.webContents.send("tab", { edge, hot: todoHot });
  matWin(tab, ribbonRects(side ? DOCK : DOCK_LEN, side ? DOCK_LEN : DOCK, 7, edge));
}
function fullRect() {
  const f = fullSize(), d = screen.getDisplayMatching(conf.todo || f).workArea;
  let x = f.x, y = f.y;
  if (conf.todoDock) { const k = conf.todoDock, r = dockRect(d); x = k.edge === "left" ? d.x : k.edge === "right" ? d.x + d.width - f.width : r.x + r.width / 2 - f.width / 2; y = k.edge === "top" ? d.y : r.y + r.height / 2 - 40; }
  if (x == null || y == null) { x = d.x + d.width - f.width - 24; y = d.y + 40; }
  return { x: Math.round(Math.min(Math.max(x, d.x), d.x + d.width - f.width)), y: Math.round(Math.min(Math.max(y, d.y), d.y + d.height - f.height)), width: f.width, height: f.height };
}
function fade(win, from, to, ms, done) {
  if (!win || win.isDestroyed()) return;
  clearInterval(win._fade); const t0 = Date.now(); win.setOpacity(from);
  win._fade = setInterval(() => { if (win.isDestroyed()) return clearInterval(win._fade); const k = Math.min(1, (Date.now() - t0) / ms); win.setOpacity(from + (to - from) * k); if (k >= 1) { clearInterval(win._fade); if (done) done(); } }, 15);
}
function setTodoMode(mode) {
  if (!todo || todo.isDestroyed()) return;
  if (mode === "dock") mode = "mini";
  if (mode === todoState) return;
  if (mode === "mini") {
    conf.todo = Object.assign({}, todo.getBounds()); saveConf();
    todoState = "mini";
    const t = ensureTab(); t.setBounds(tabRect()); tabSend();
    fade(todo, 1, 0, 120, () => { if (todoState === "mini" && todo && !todo.isDestroyed()) { todo.hide(); applyOnTop(); } });
    if (t.webContents.isLoading()) t.once("ready-to-show", () => { if (todoState === "mini") t.showInactive(); }); else t.showInactive();
  } else {
    todoState = "full"; tellTodo();
    // 展开时一定放到最上面（就算没置顶 / 在玩游戏，鼠标移上去就是想看）；收起时再恢复
    todo.setAlwaysOnTop(true, "screen-saver");
    todo.setBounds(fullRect()); todo.setOpacity(0); todo.showInactive(); todo.moveTop(); fade(todo, 0, 1, 140);
    dlog("todo expand", todo.getBounds(), todo.isVisible());
    if (tab && !tab.isDestroyed()) tab.hide();
  }
}
ipcMain.on("todo-mode", (e, mode) => { if (winOf(e) === todo) setTodoMode(mode); });
ipcMain.on("tab-click", () => setTodoMode("full"));
// 鼠标位置由主进程盯着：移到书签上就展开，移出列表 0.6 秒后收起（页面里正在输入时不收）
let todoBusy = false, todoAway = 0, todoFocused = false;
ipcMain.on("todo-busy", (e, v) => { if (winOf(e) === todo) todoBusy = !!v; }); // 只认待办窗口自己（零的窗口、完整网站发来的不算）
function inRect(p, b, m) { return p.x >= b.x - m && p.x < b.x + b.width + m && p.y >= b.y - m && p.y < b.y + b.height + m; }
setInterval(() => {
  if (!todo || todo.isDestroyed() || todoDragging || conf.todoShown === false) return;
  const p = screen.getCursorScreenPoint();
  if (todoState === "full") {
    if (!todo.isVisible()) return;
    if (inRect(p, todo.getBounds(), 6)) todoAway = 0;
    // 正在用（输入框里有字、有弹窗）且窗口真有焦点时先不收；但鼠标离开超过 20 秒一律收起，免得卡住
    else if (++todoAway >= 166 || (todoAway >= 5 && !(todoBusy && todoFocused))) { todoAway = 0; todoBusy = false; setTodoMode("mini"); }
  } else if (tab && !tab.isDestroyed() && tab.isVisible() && inRect(p, tab.getBounds(), 3)) { todoAway = 0; setTodoMode("full"); }
}, 120);
// 拖动结束：限制在屏幕内；贴近上、左、右边就记成贴边书签，离开就松开
let todoDragging = false, todoDragT = null;
function todoMoved() {
  if (!todo || todo.isDestroyed()) return;
  todoDragging = false;
  let b = todo.getBounds();
  const d = screen.getDisplayMatching(b).workArea;
  const cx = Math.min(Math.max(b.x, d.x), d.x + d.width - b.width), cy = Math.min(Math.max(b.y, d.y), d.y + d.height - b.height);
  if (cx !== b.x || cy !== b.y) { todo.setBounds({ x: cx, y: cy, width: b.width, height: b.height }); b = todo.getBounds(); }
  const edge = edgeOf(b);
  if (edge) conf.todoDock = { edge, along: edge === "top" ? Math.round(b.x + b.width / 2 - DOCK_LEN / 2) : Math.round(b.y + 20) };
  else conf.todoDock = null;
  conf.todo = b; saveConf();
}
ipcMain.handle("is-glass", (e) => { const w = BrowserWindow.fromWebContents(e.sender); return !!(w && w._glass); });
ipcMain.on("todo-resize", (e, dw, dh) => { if (!todo || todo.isDestroyed() || todoState !== "full" || winOf(e) !== todo) return; const b = todo.getBounds(); todo.setBounds({ x: b.x, y: b.y, width: Math.max(180, Math.round(b.width + dw)), height: Math.max(120, Math.round(b.height + dh)) }); conf.todo = todo.getBounds(); saveConf(); });
ipcMain.handle("get-pin", () => conf.todoPinned !== false);
ipcMain.on("set-pin", (e, v) => { conf.todoPinned = !!v; saveConf(); applyOnTop(); refreshMenu(); });
// 游戏计时开始：把小圆、待办、零藏起来（记住原来哪些开着），计时结束再放回来
let gameHidden = false, gameEndT = null, gameUntil = 0;
function applyOnTop() {
  const pin = !gameHidden && conf.todoPinned !== false;
  if (bubble && !bubble.isDestroyed()) bubble.setAlwaysOnTop(!gameHidden, "screen-saver");
  if (todo && !todo.isDestroyed()) todo.setAlwaysOnTop(pin);
  if (tab && !tab.isDestroyed()) tab.setAlwaysOnTop(pin, "screen-saver");
  if (zero && !zero.isDestroyed()) zero.setAlwaysOnTop(!gameHidden, "floating");
}
ipcMain.on("game-mode", (e, on, end) => {
  // 某个窗口的旧存档说“没在玩”时不算数，只认“点了结束计时”或到点（end = -1）
  if (!on && end !== -1 && gameUntil > Date.now()) return;
  gameUntil = on ? end : 0;
  // 到点自己结束（不等页面里的计时器，隐藏的窗口里计时器会被放慢）
  clearTimeout(gameEndT);
  if (on && end > Date.now()) gameEndT = setTimeout(() => ipcMain.emit("game-mode", null, false, -1), Math.min(end - Date.now() + 500, 2 ** 31 - 1));
  // 玩游戏时不藏起来，只是不置顶（游戏窗口会盖住它们）；转盘照常能用
  if (on && !gameHidden) { gameHidden = true; applyOnTop(); }
  else if (!on && gameHidden) { gameHidden = false; applyOnTop(); note("游戏时间到了", "小圆和待办回到最上面了。"); }
  refreshMenu();
});
// 作业红点只在待办书签上；小圆的红点留给通知（零回复了、新版本、下载收纳了文件），打开零就清掉
ipcMain.on("badge", (e, n) => { const h = Number(n) || 0; if (h !== todoHot) { todoHot = h; tabSend(); } });
let bubbleDotOn = false;
function bubbleDot(on) { bubbleDotOn = !!on; if (bubble && !bubble.isDestroyed()) bubble.webContents.send("badge", on ? 1 : 0); }
ipcMain.on("dlog", (e, ...a) => dlog("page", ...a));
ipcMain.on("notify", () => { if (!(zero && !zero.isDestroyed() && zero.isVisible() && zero.isFocused())) bubbleDot(true); });
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
      out.push({ name: path.basename(p), type: MIME[ext] || "", src: p, data: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) });
    } catch (e) {}
  }
  return out;
}
function deliverPaths(paths) {
  dlog("deliverPaths", (paths || []).length);
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
    execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script], { windowsHide: true, timeout: 6000, encoding: "utf8" }, (err, stdout, stderr) => {
      dlog("explorerSelection", err ? "err " + (err.code || err.message) : "ok", String(stdout || "").split(/\r?\n/).filter(Boolean).length, String(stderr || "").slice(0, 200));
      if (err) return resolve([]);
      resolve(String(stdout || "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean));
    });
  });
}
async function onHotkey() {
  const paths = process.platform === "win32" ? await explorerSelection() : [];
  if (paths.length) deliverPaths(paths); else toggleZero();
}

// ---------- 存到 桌面\Cornell\<学期>\<课程> ----------
// 课程文件夹：先在 桌面\Cornell 下面（最多两层，比如 Cornell\26 Fall\CHEM 2090）找已有的同名文件夹；
// 没有就建在最新的学期文件夹（“26 Fall” 这种）里。Google Drive 桌面版负责把 Cornell 同步上去
function cornellBase() { return path.join(app.getPath("desktop"), "Cornell"); }
function termName(d = new Date()) { const m = d.getMonth() + 1, y = String(d.getFullYear()).slice(2); return y + " " + (m >= 8 ? "Fall" : m <= 5 ? "Spring" : "Summer"); }
const TERM_RE = /^\d\d\s*(fall|spring|summer|winter)$/i;
function findCourseDir(safe) {
  const base = cornellBase(), hits = [], lc = safe.toLowerCase();
  const same = (n) => { n = n.toLowerCase(); return n === lc || n.startsWith(lc + " ") || n.startsWith(lc + "-") || n.startsWith(lc + "_"); }; // “MATH 1920 Multivariable Calculus” 也算
  const kids = (d) => { try { return fs.readdirSync(d, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith(".")); } catch (e) { return []; } };
  for (const a of kids(base)) {
    const pa = path.join(base, a.name);
    if (same(a.name)) hits.push(pa);
    for (const b of kids(pa)) if (same(b.name)) hits.push(path.join(pa, b.name));
  }
  if (!hits.length) return null;
  // 有好几个就要学期文件夹里的，再要最近改过的
  const score = (p) => (TERM_RE.test(path.basename(path.dirname(p))) ? 1e15 : 0) + (() => { try { return fs.statSync(p).mtimeMs; } catch (e) { return 0; } })();
  return hits.sort((x, y) => score(y) - score(x))[0];
}
function courseDir(course) {
  // 去掉首尾的点和空格：“..”这种名字不能跑到 Cornell 外面去
  const safe = String(course).replace(/[\\/:*?"<>|\x00-\x1f]/g, " ").replace(/^[.\s]+|[.\s]+$/g, "") || "其他";
  const dir = findCourseDir(safe) || path.join(cornellBase(), termName(), safe);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
// 文件名只留名字本身：不能带路径、不能是 . / ..、不能是 Windows 保留名，结尾的点和空格去掉
function safeName(name) {
  let s = String(name == null ? "" : name).replace(/[\\/:*?"<>|\x00-\x1f]/g, "_").replace(/[.\s]+$/, "").trim();
  if (!s || /^\.+$/.test(s)) s = "文件";
  if (/^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(s)) s = "_" + s;
  return s;
}
// 内容完全一样才算“同一个文件”（只比大小会把不同的文件当成重复，然后删掉下载里的那份）
function sameFile(p, data) {
  try {
    const n = Buffer.isBuffer(data) ? data.length : fs.statSync(data).size;
    if (fs.statSync(p).size !== n) return false;
    return fs.readFileSync(p).equals(Buffer.isBuffer(data) ? data : fs.readFileSync(data));
  } catch (e) { return false; }
}
// 返回可以写的新路径；data（Buffer 或源文件路径）和已有文件内容一样时返回 null。永远不覆盖已有文件
function freeName(dir, name, data) {
  const base = safeName(name);
  let p = path.join(dir, base);
  if (!fs.existsSync(p)) return p;
  if (data != null && sameFile(p, data)) return null; // 已经有同一个文件
  const ext = path.extname(base), stem = base.slice(0, base.length - ext.length);
  for (let i = 2; i < 100; i++) { p = path.join(dir, `${stem} (${i})${ext}`); if (!fs.existsSync(p)) return p; }
  return path.join(dir, `${stem} (${Date.now()})${ext}`);
}
ipcMain.handle("save-local", (e, course, list) => {
  if (!fromSite(e) || !Array.isArray(list)) return 0;
  const dir = courseDir(course); let n = 0;
  const dl = app.getPath("downloads").toLowerCase() + path.sep, lc = (x) => path.resolve(x).toLowerCase();
  for (const f of (list || []).slice(0, 6)) {
    try {
      const buf = Buffer.from(f.data);
      if (f.src && fs.existsSync(f.src)) {
        // 本来就在 Cornell\<课程> 里：不再复制一份（Drive 照传）
        if (lc(path.dirname(f.src)) === lc(dir)) { n++; continue; }
        // 从“下载”里拖来的：直接搬进课程文件夹（下载里不留）
        if (lc(f.src).startsWith(dl)) {
          const p = freeName(dir, f.name, f.src);
          if (p) { try { fs.renameSync(f.src, p); } catch (err) { fs.copyFileSync(f.src, p); fs.unlinkSync(f.src); } }
          n++; continue;
        }
      }
      const p = freeName(dir, f.name, buf); if (p) fs.writeFileSync(p, buf, { flag: "wx" }); n++;
    } catch (err) {}
  }
  return n;
});
ipcMain.handle("save-pdf", async (e, course, name, html) => {
  if (!fromSite(e)) return null;
  const w = new BrowserWindow({ show: false, webPreferences: { sandbox: true, javascript: true } });
  // 这个隐藏窗口里的页面不能弹新窗口、不能跳走
  w.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  w.webContents.on("will-navigate", (ev) => ev.preventDefault());
  // MathJax 加载不出来时别一直卡着（窗口也一直不关）
  const within = (p, ms) => Promise.race([p, new Promise((r) => setTimeout(r, ms))]);
  try {
    await within(w.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html)), 30000);
    await within(w.webContents.executeJavaScript("(window.MathJax&&MathJax.startup&&MathJax.startup.promise)?MathJax.startup.promise.then(()=>1):new Promise(r=>setTimeout(()=>r(1),1500))"), 15000);
    const pdf = await w.webContents.printToPDF({ pageSize: "Letter", printBackground: true });
    const dir = courseDir(course);
    const p = freeName(dir, name); // 同名的不覆盖，存成 “名字 (2).pdf”
    fs.writeFileSync(p, pdf, { flag: "wx" });
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
  ring = new BrowserWindow({ width: RING, height: RING, frame: false, ...smallOpts(), resizable: false, movable: false, focusable: false, thickFrame: false,
    skipTaskbar: true, alwaysOnTop: true, hasShadow: false, show: false,
    webPreferences: { preload: path.join(__dirname, "ring-preload.js"), contextIsolation: true, sandbox: false } });
  ring.setAlwaysOnTop(true, "screen-saver");
  ring.loadFile(path.join(__dirname, "ring.html"));
  matWin(ring, circleRects(RING / 2, RING / 2, RING * 141 / 300, 0));
}
function toDip(x, y) { return process.platform === "win32" ? screen.screenToDipPoint({ x, y }) : { x, y }; }
function showRing(x, y) {
  ringDown = null; // 只弹一次；转盘关着时也不要每动一下鼠标都来一次（还写日志）
  if (!ring || ring.isDestroyed() || conf.ringOff) return;
  dlog("ring show", x, y);
  const p = toDip(x, y);
  ring.setBounds({ x: Math.round(p.x - RING / 2), y: Math.round(p.y - RING / 2), width: RING, height: RING });

  ringHoverKey = ""; ringCenter = { x: p.x, y: p.y };
  ringSel = process.platform === "win32" ? explorerSelection() : Promise.resolve([]); // 趁资源管理器还在前台，先把选中的文件记下来
  ringSel.then((ps) => { if (!ringShown || !ring || ring.isDestroyed() || !ps.length) return; const ex = [...new Set(ps.map((x) => path.extname(x).slice(1).toUpperCase()))]; ring.webContents.send("ring-files", { n: ps.length, ext: ex.length === 1 && ex[0] ? ex[0] : "" }); });
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
  hook.on("mousedown", (e) => { ringDown = (!conf.ringOff && e.button === 1 && ringMod(e)) ? { x: e.x, y: e.y } : null; });
  hook.on("mousemove", (e) => {
    if (ringShown) { const k = ringSector(e.x, e.y); if (k !== ringHoverKey) { ringHoverKey = k; if (ring && !ring.isDestroyed()) ring.webContents.send("ring-hl", k); } return; }
    if (!ringDown) return;
    if (Math.hypot(e.x - ringDown.x, e.y - ringDown.y) > 14) showRing(ringDown.x, ringDown.y);
  });
  hook.on("mouseup", (e) => {
    ringDown = null;
    if (!ringShown) return;
    // 松手在哪一格由鼠标位置算（不靠 Windows 的拖放，那个在你电脑上收不到）；文件是开始拖时资源管理器里选中的那些
    const k = ringSector(e.x, e.y) || ringHoverKey, t0 = Date.now(), sel = ringSel;
    dlog("ring mouseup", k, e.x, e.y, ringCenter);
    hideRing(120);
    if (!k) return;
    setTimeout(async () => {
      if (ringDropAt >= t0) return; // 页面已经收到真正的拖放
      const paths = sel ? await sel : [];
      if (paths.length && ringDropAt < t0) handleRingDrop(k, paths);
      else if (!paths.length) note("没拿到文件", "转盘目前只支持从文件夹窗口（资源管理器）里拖文件。从桌面拖的话，先打开 桌面 文件夹再拖。");
    }, 250);
  });
  try { hook.start(); } catch (e) { hook = null; }
}
let ringHoverKey = "", ringDropAt = 0, ringSel = null, ringCenter = null;
// 和 ring.html 一样的五格：从正上方顺时针
const RING_KEYS = ["hw", "lab", "review", "material", "notes", "ask"];
function ringSector(px, py) {
  if (!ringCenter) return "";
  const p = toDip(px, py), x = p.x - ringCenter.x, y = p.y - ringCenter.y, d = Math.hypot(x, y), s = RING / 300, N = RING_KEYS.length;
  if (d < 58 * s || d > 152 * s) return "";
  let a = Math.atan2(y, x) + Math.PI / 2 + Math.PI / N; a = ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  return RING_KEYS[Math.floor(a / (2 * Math.PI / N))] || "";
}
ipcMain.on("ring-hover", (e, k) => { ringHoverKey = String(k || ""); });
ipcMain.on("ring-drop", (e, target, paths) => {
  if (winOf(e) !== ring) return;
  if (!Array.isArray(paths)) paths = [];
  dlog("ring-drop", target, paths.length);
  hideRing(0);
  if (paths && paths.length) { ringDropAt = Date.now(); handleRingDrop(target, paths); return; }
  // 拖放到了，但拿不到文件路径（你电脑上就是这样）：用开始拖时记下的资源管理器选中文件
  ringDropAt = Date.now();
  const sel = ringSel;
  if (target && sel) sel.then((ps) => { dlog("ring-drop fallback", ps.length); if (ps.length) handleRingDrop(target, ps); else note("没拿到文件", "转盘目前只支持从文件夹窗口里拖文件。"); });
});
function handleRingDrop(target, paths) {
  dlog("handleRingDrop", target, (paths || []).length);
  if (!target || !paths || !paths.length) return;
  const list = readFiles(paths);
  if (!list.length) return;
  // 存档不打开零的窗口（科目自动判断，存完弹个通知）；其余动作打开零
  // 课程资料、老师笔记只存档，不打开零（存好弹通知）；作业、复习资料、问零打开零
  if (!["archive", "material", "notes"].includes(target)) showZero();
  send(ensureZero(), "files", "act:" + target, list);
}

// ---------- 下载自动收纳：盯着“下载”文件夹，课程文件交给零判断是哪门课，再移到 桌面\Cornell\<课程> ----------
const INBOX_EXT = /\.(pdf|docx?|pptx?|xlsx?|txt|md|png|jpe?g|heic|zip)$/i;
let inboxWatcher = null, lastInbox = null; // lastInbox 也存进 conf，重启后还能撤销
const inboxTimers = new Map();
function startInbox() {
  if (inboxWatcher || conf.inboxOff) return;
  const dir = app.getPath("downloads");
  try {
    inboxWatcher = fs.watch(dir, (ev, name) => {
      if (!name || !INBOX_EXT.test(name) || /\.(crdownload|part|tmp|download)$/i.test(name)) return;
      const p = path.join(dir, name);
      if (!inboxTimers.has(p)) dlog("inbox saw", ev, name);
      clearTimeout(inboxTimers.get(p));
      inboxTimers.set(p, setTimeout(() => settleInbox(p, -1), 2500));
    });
    // Windows 上睡眠唤醒、网盘同步之后 fs.watch 可能悄悄失效：出错就重开
    inboxWatcher.on("error", (e) => { dlog("inbox watch error", e.message); restartInbox(); });
    dlog("inbox watching", dir);
  } catch (e) { inboxWatcher = null; dlog("inbox watch failed", dir, e.message); }
}
function restartInbox() { stopInbox(); setTimeout(startInbox, 1000); }
// 唤醒后、以及每 30 分钟，把监视重开一次（便宜，防止它不声不响地停了）
setInterval(() => { if (!conf.inboxOff) restartInbox(); }, 30 * 60 * 1000);
app.whenReady().then(() => { try { require("electron").powerMonitor.on("resume", () => { dlog("resume: restart inbox"); restartInbox(); }); } catch (e) {} });
function stopInbox() { if (inboxWatcher) { try { inboxWatcher.close(); } catch (e) {} inboxWatcher = null; } }
function settleInbox(p, lastSize) {
  inboxTimers.delete(p);
  let st; try { st = fs.statSync(p); } catch (e) { dlog("inbox gone", path.basename(p)); return; }
  if (!st.isFile() || st.size === 0 || st.size > MAX_FILE) { dlog("inbox skip size", path.basename(p), st.size); return; }
  if (Date.now() - st.birthtimeMs > 10 * 60 * 1000 && Date.now() - st.mtimeMs > 10 * 60 * 1000) { dlog("inbox skip old", path.basename(p)); return; } // 只管新下载的
  if (st.size !== lastSize) { inboxTimers.set(p, setTimeout(() => settleInbox(p, st.size), 1500)); return; } // 还在写
  // 撤销过的文件不再自动收纳
  const key = path.basename(p).toLowerCase() + "|" + st.size;
  if ((conf.inboxIgnore || []).includes(key)) { dlog("inbox skip (undone before)", path.basename(p)); return; }
  const list = readFiles([p]); if (!list.length) { dlog("inbox unreadable", path.basename(p)); return; }
  list[0].src = p;
  const z = ensureZero();
  dlog("inbox send", path.basename(p), readyWins.has(z.webContents.id) ? "ready" : "queued");
  send(z, "files", "inbox", list);
}
ipcMain.handle("inbox-place", (e, src, course, name) => {
  try {
    if (!fromSite(e) || !src) { dlog("inbox-place refused sender", e.sender.getURL()); return ""; }
    // 只收“下载”文件夹里直接放着的文件（就是 settleInbox 交过去的那些），网页不能让这里搬别处的文件
    src = path.resolve(String(src));
    if (path.dirname(src).toLowerCase() !== path.resolve(app.getPath("downloads")).toLowerCase()) { dlog("inbox-place not in downloads", src); return ""; }
    if (!fs.existsSync(src) || !fs.statSync(src).isFile()) return "";
    const dir = courseDir(course);
    let dest = freeName(dir, name || path.basename(src), src), dup = false;
    if (!dest) { dup = true; dest = path.join(dir, safeName(name || path.basename(src))); fs.unlinkSync(src); } // 课程文件夹里已经有内容一样的文件
    else { try { fs.renameSync(src, dest); } catch (err) { fs.copyFileSync(src, dest, fs.constants.COPYFILE_EXCL); fs.unlinkSync(src); } }
    lastInbox = { from: src, to: dest, dup }; conf.lastInbox = lastInbox; saveConf(); bubbleDot(true);
    try { new Notification({ title: "已收纳到 " + course, body: path.basename(dest), icon: ICON, silent: true }).show(); } catch (err) {}
    refreshMenu();
    dlog("inbox-place ok", dest, dup ? "dup" : "");
    return dest;
  } catch (err) { dlog("inbox-place error", err.message); return ""; }
});
function undoInbox() {
  if (!lastInbox) return;
  try {
    if (fs.existsSync(lastInbox.to) && !fs.existsSync(lastInbox.from)) {
      const size = fs.statSync(lastInbox.to).size;
      conf.inboxIgnore = [...(conf.inboxIgnore || []), path.basename(lastInbox.from).toLowerCase() + "|" + size].slice(-50);
      // 课程文件夹里那份本来就有（收纳时只删了下载里的重复）：撤销时复制回去，不把原来的搬走
      if (lastInbox.dup) fs.copyFileSync(lastInbox.to, lastInbox.from);
      else { try { fs.renameSync(lastInbox.to, lastInbox.from); } catch (e) { fs.copyFileSync(lastInbox.to, lastInbox.from); fs.unlinkSync(lastInbox.to); } }
      note("已撤销收纳", path.basename(lastInbox.from) + " 回到了下载文件夹，之后不会再自动收它。");
    }
  } catch (e) { dlog("undo err", e.message); }
  lastInbox = null; delete conf.lastInbox; saveConf(); refreshMenu();
}

// ---------- 自动更新：从 GitHub Releases（catminn/catmin-study）后台下载，退出或点托盘时换上 ----------
let updater = null, updateReady = "";
let updateState = "", manualCheck = false;
function note(title, body) { try { new Notification({ title, body, icon: ICON, silent: true }).show(); } catch (e) {} }
function checkUpdate(manual) {
  if (!updater) { if (manual) note("学习空间", "这个版本不能自动更新，请重新下载安装包"); return; }
  manualCheck = !!manual;
  if (manual) { updateState = "正在检查更新…"; refreshMenu(); }
  try { updater.checkForUpdates().catch((e) => { if (manual) note("没检查成功", String((e && e.message) || e).slice(0, 120)); updateState = ""; refreshMenu(); }); } catch (e) {}
}
function startUpdater() {
  if (!app.isPackaged) return;
  try { ({ autoUpdater: updater } = require("electron-updater")); } catch (e) { updater = null; return; }
  updater.autoDownload = true; updater.autoInstallOnAppQuit = false; // 退出时不偷偷装（被安全软件打断会把程序弄没），只在点「重启并更新」时装
  // 下载好以后每小时还会再检查：同一个版本不要每小时再提醒一遍
  updater.on("update-available", (info) => { const v = (info && info.version) || ""; if (v && v === updateReady) { updateState = ""; refreshMenu(); return; } updateState = "正在下载新版 " + v; refreshMenu(); note("学习空间有新版本", "正在后台下载 " + v + "，好了会再提醒你"); });
  updater.on("update-not-available", () => { if (manualCheck) note("学习空间", "已经是最新版 " + app.getVersion()); updateState = ""; manualCheck = false; refreshMenu(); });
  let lastPct = -1; // 进度一秒来好几次，百分比变了才重建托盘菜单
  updater.on("download-progress", (p) => { const pct = Math.round((p && p.percent) || 0); if (pct === lastPct) return; lastPct = pct; updateState = "正在下载新版 " + pct + "%"; refreshMenu(); });
  updater.on("update-downloaded", (info) => {
    lastPct = -1;
    if (info && info.version && info.version === updateReady) { updateState = ""; if (manualCheck) note("学习空间", updateReady + " 已经下载好了：点托盘里的「重启并更新」换上。"); manualCheck = false; refreshMenu(); return; }
    manualCheck = false;
    bubbleDot(true);
    updateReady = info && info.version || "新版本"; updateState = ""; refreshMenu();
    note("新版本下载好了", updateReady + " 已经准备好：点托盘里的「重启并更新」换上。");
  });
  updater.on("error", (e) => { if (manualCheck) note("更新没成功", String((e && e.message) || e).slice(0, 120)); updateState = ""; manualCheck = false; refreshMenu(); });
  setTimeout(() => checkUpdate(false), 15000); setInterval(() => checkUpdate(false), 3600 * 1000);
  try { require("electron").powerMonitor.on("resume", () => setTimeout(() => checkUpdate(false), 10000)); } catch (e) {}
}

// ---------- 托盘 ----------
function menu() {
  return Menu.buildFromTemplate([
    { label: "问零", click: () => showZero() },
    { label: "签到", click: () => showZero("daily") },
    { label: "待办", type: "checkbox", checked: conf.todoShown !== false, click: toggleTodo },
    { label: "待办置顶", type: "checkbox", checked: conf.todoPinned !== false, click: (i) => { conf.todoPinned = i.checked; saveConf(); applyOnTop(); } },
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
    ...(updateReady ? [{ label: "重启并更新到 " + updateReady, click: () => { app.isQuitting = true; flushConf(); app.releaseSingleInstanceLock(); setImmediate(() => updater.quitAndInstall(true, true)); } }] : []), // 先放开单实例锁，否则装好后新版一启动就以为旧的还在、自己退出
    { label: updateState || "检查更新（现在 " + app.getVersion() + "）", enabled: !updateState, click: () => checkUpdate(true) }, // 下载好了也留着：可能还有更新的版本
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

// 小圆、待办、书签、零这些小窗都不该出现在任务栏。Windows 上隐藏再显示、改置顶、毛玻璃的激活消息之后，
// 「不显示在任务栏」偶尔会失效（任务栏多出「零」「待办」），所以每次显示、置顶变化后都再设一次。只有主窗口（学习空间）留在任务栏。
// 注意：不能挂在 focus / 置顶变化上——setSkipTaskbar 在 Windows 上会引发新的焦点/激活事件，挂上去就成了死循环（0.8.4–0.8.7 窗口卡死变灰）。
// 只在显示时补一次，同一个窗口 1 秒内最多一次。
const noTb = (w) => { try { if (!w || w.isDestroyed() || w === main) return; const now = Date.now(); if (now - (w._noTbAt || 0) < 1000) return; w._noTbAt = now; w.setSkipTaskbar(true); } catch (e) {} };
app.on("browser-window-created", (e, w) => {
  for (const ev of ["show", "ready-to-show"]) w.on(ev, () => noTb(w));
  // 页面崩了或卡死：自动重新加载，不留一块灰窗口
  w.webContents.on("render-process-gone", (ev, d) => { dlog("renderer gone", d && d.reason); if (!w.isDestroyed() && d && d.reason !== "clean-exit") setTimeout(() => { if (!w.isDestroyed()) w.webContents.reload(); }, 1000); });
  w.on("unresponsive", () => { dlog("window unresponsive"); clearTimeout(w._hangT); w._hangT = setTimeout(() => { if (!w.isDestroyed() && w !== main) w.webContents.forcefullyCrashRenderer(); }, 15000); });
  w.on("responsive", () => clearTimeout(w._hangT));
});
app.whenReady().then(async () => {
  transOn = await readTransparency();
  if (!transOn && !conf.transWarned) { conf.transWarned = true; saveConf(); setTimeout(() => note("毛玻璃需要打开 Windows 的“透明效果”", "设置 → 个性化 → 颜色 → 透明效果。打开后退出学习空间再打开。现在先用普通半透明。"), 4000); }
  setInterval(async () => { const t = await readTransparency(); if (t !== transOn) { transOn = t; glassFor(zero, true); glassFor(todo, todoState === "full"); } }, 10 * 60 * 1000);
  if (conf.lastInbox && conf.lastInbox.to && fs.existsSync(conf.lastInbox.to)) lastInbox = conf.lastInbox;
  if (conf.glassMode) { delete conf.glassMode; saveConf(); } // 玻璃效果固定用默认（Windows 11 材质），菜单已去掉
  setInterval(labPoll, 15000); setTimeout(labPoll, 6000); // 远程排查小圆和书签的磨砂（glass-lab.json）
  // 节能模式：系统关掉模糊时，各个窗口改成纯白底
  let saver = null;
  const checkSaver = () => { const v = powerSaver(); if (v === saver) return; saver = v; for (const w of [todo, zero]) if (w && !w.isDestroyed()) send(w, "saver", v); for (const w of [bubble, tab, ring]) if (w && !w.isDestroyed()) w.webContents.send("saver", v); };
  setInterval(checkSaver, 15000); setTimeout(checkSaver, 4000);
  app.on("browser-window-created", (e, w) => w.webContents.on("did-finish-load", () => { if (saver) setTimeout(() => { if (w.isDestroyed()) return; if (w === todo || w === zero) send(w, "saver", true); else w.webContents.send("saver", true); }, 300); }));
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
  startUpdater();
  const files = filesFromArgv(process.argv);
  if (files.length) deliverPaths(files);
  // 拔掉显示器、改分辨率/缩放：小圆、待办、书签留在屏幕外就拉回来
  const fixScreens = () => {
    if (bubble && !bubble.isDestroyed() && !onScreen({ x: bubble.getPosition()[0], y: bubble.getPosition()[1] })) { const a = workArea(); bubble.setPosition(a.x + a.width - BUB - 2, a.y + a.height - BUB - 2); }
    if (conf.todo && conf.todo.width > 120 && !onScreen(conf.todo)) { conf.todo = fullRect(); saveConf(); }
    if (todo && !todo.isDestroyed() && todoState === "full" && todo.isVisible() && !onScreen(todo.getBounds())) todo.setBounds(fullRect());
    if (tab && !tab.isDestroyed() && tab.isVisible()) tab.setBounds(tabRect());
  };
  let fixT = null; const fixSoon = () => { clearTimeout(fixT); fixT = setTimeout(fixScreens, 500); };
  screen.on("display-metrics-changed", fixSoon); screen.on("display-removed", fixSoon);
});

app.on("window-all-closed", (e) => { /* 常驻托盘，不退出 */ });
app.on("will-quit", () => { flushConf(); globalShortcut.unregisterAll(); try { if (hook) hook.stop(); } catch (e) {} });

// 本地冒烟测试（不打包进安装包）：ZS_TEST=1 electron .
if (process.env.ZS_TEST) app.whenReady().then(() => require("./smoke.js")({ deliverPaths, get zero() { return zero; }, get todo() { return todo; }, get bubble() { return bubble; }, showZero, toggleTodo, openHotkeyWin }));

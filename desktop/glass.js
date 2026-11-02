// Windows：给窗口加真正的毛玻璃（失去焦点也保持），Windows 11 上让无边框窗口画圆角，
// 圆形的小圆和转盘用窗口区域裁成圆，毛玻璃只出现在圆里。
// 毛玻璃用 SetWindowCompositionAttribute(ACCENT_ENABLE_ACRYLICBLURBEHIND)，和 TranslucentTB 等小工具同一个办法。
let api;
function load() {
  if (api !== undefined) return api;
  api = null;
  if (process.platform !== "win32") return api;
  try {
    const koffi = require("koffi");
    const user32 = koffi.load("user32.dll"), dwm = koffi.load("dwmapi.dll"), gdi = koffi.load("gdi32.dll");
    const ACCENT = koffi.struct("XK_ACCENT", { AccentState: "int", AccentFlags: "int", GradientColor: "uint32", AnimationId: "int" });
    koffi.struct("XK_MARGINS", { l: "int", r: "int", t: "int", b: "int" });
    koffi.struct("XK_SPS", { ac: "uint8", bflag: "uint8", pct: "uint8", sflag: "uint8", t1: "uint32", t2: "uint32" });
    const WCAD = koffi.struct("XK_WCAD", { Attribute: "int", Data: "void *", SizeOfData: "size_t" });
    api = {
      koffi, ACCENT, WCAD,
      setWCA: user32.func("bool __stdcall SetWindowCompositionAttribute(intptr_t hwnd, XK_WCAD *data)"),
      dwmSet: dwm.func("long __stdcall DwmSetWindowAttribute(intptr_t hwnd, uint32_t attr, _In_ int *val, uint32_t size)"),
      ellipse: gdi.func("intptr_t __stdcall CreateEllipticRgn(int x1, int y1, int x2, int y2)"),
      combine: gdi.func("int __stdcall CombineRgn(intptr_t dst, intptr_t a, intptr_t b, int mode)"),
      del: gdi.func("bool __stdcall DeleteObject(intptr_t obj)"),
      setRgn: user32.func("int __stdcall SetWindowRgn(intptr_t hwnd, intptr_t rgn, bool redraw)"),
      poly: gdi.func("intptr_t __stdcall CreatePolygonRgn(_In_ int *pts, int n, int mode)"),
      extend: dwm.func("long __stdcall DwmExtendFrameIntoClientArea(intptr_t hwnd, _In_ XK_MARGINS *m)"),
      sps: koffi.load("kernel32.dll").func("bool __stdcall GetSystemPowerStatus(_Out_ XK_SPS *s)"),
      post: user32.func("bool __stdcall PostMessageW(intptr_t hwnd, uint32_t msg, uintptr_t w, intptr_t l)"),
    };
  } catch (e) { api = null; }
  return api;
}
function hwndOf(win) {
  const b = win.getNativeWindowHandle();
  return b.length >= 8 ? Number(b.readBigUInt64LE(0)) : b.readUInt32LE(0);
}
// tint 是 0xAABBGGRR。颜色很淡，主要靠模糊，才看得出是玻璃而不是白板
function applyGlass(win, dark, corner, state) {
  const a = load();
  if (!a || !win || win.isDestroyed()) return false;
  try {
    const hwnd = hwndOf(win);
    const tint = dark ? 0x5a261e1e : 0x30f8f8f8;
    const mem = a.koffi.alloc(a.ACCENT, 1);
    a.koffi.encode(mem, a.ACCENT, { AccentState: state || 3, AccentFlags: 2, GradientColor: tint >>> 0, AnimationId: 0 });
    const ok = a.setWCA(hwnd, { Attribute: 19, Data: mem, SizeOfData: a.koffi.sizeof(a.ACCENT) });
    // DWMWA_WINDOW_CORNER_PREFERENCE：2 圆角，3 小圆角，1 不要圆角（圆形窗口用区域裁）
    try { a.dwmSet(hwnd, 33, [corner == null ? 2 : corner], 4); } catch (e) {}
    return !!ok;
  } catch (e) { return false; }
}
// 窗口形状：用 Electron 自带的 setShape（矩形拼起来）。Chromium 每次显示、移动窗口都会重设系统区域，
// 直接调 SetWindowRgn 会被冲掉，setShape 不会。形状外面不画毛玻璃、也点不到。
function rowsToRects(rows) { // rows: [[y, [[x0,x1],...]], ...] 每行 1px；相同的相邻行合并
  const out = []; let prev = null;
  for (const [y, segs] of rows) {
    const key = JSON.stringify(segs);
    if (prev && prev.key === key && prev.y1 === y) { prev.y1 = y + 1; continue; }
    prev = { key, y0: y, y1: y + 1, segs }; out.push(prev);
  }
  const rects = [];
  for (const r of out) for (const [a, b] of r.segs) if (b > a) rects.push({ x: a, y: r.y0, width: b - a, height: r.y1 - r.y0 });
  return rects;
}
function circleRects(cx, cy, r, r0) {
  const rows = [];
  for (let y = Math.floor(cy - r); y < Math.ceil(cy + r); y++) {
    const dy = y + 0.5 - cy; if (Math.abs(dy) >= r) continue;
    const h = Math.sqrt(r * r - dy * dy), a = Math.round(cx - h), b = Math.round(cx + h);
    if (r0 > 0 && Math.abs(dy) < r0) { const h0 = Math.sqrt(r0 * r0 - dy * dy); rows.push([y, [[a, Math.round(cx - h0)], [Math.round(cx + h0), b]]]); }
    else rows.push([y, [[a, b]]]);
  }
  return rowsToRects(rows);
}
// 燕尾书签：W×H，尾巴缺口深 n。edge = top（尾巴朝下）/ left（尾巴朝右）/ right（尾巴朝左）
function ribbonRects(W, H, n, edge) {
  const rows = [];
  if (edge === "left" || edge === "right") {
    for (let y = 0; y < H; y++) {
      const k = Math.round(n * (1 - Math.abs(y + 0.5 - H / 2) / (H / 2))); // 这一行缺口有多深
      rows.push([y, [edge === "left" ? [0, W - k] : [k, W]]]);
    }
  } else {
    for (let y = 0; y < H; y++) {
      if (y < H - n) { rows.push([y, [[0, W]]]); continue; }
      const k = Math.round(((y + 0.5 - (H - n)) / n) * (W / 2));
      rows.push([y, [[0, Math.round(W / 2 - k)], [Math.round(W / 2 + k), W]]]);
    }
  }
  return rowsToRects(rows);
}
function setCorner(win, v) { const a = load(); if (!a || !win || win.isDestroyed()) return; try { a.dwmSet(hwndOf(win), 33, [v], 4); } catch (e) {} }
function shapeWin(win, rects, corner) {
  if (!win || win.isDestroyed() || !win.setShape) return false;
  try { win.setShape(rects || []); setCorner(win, rects && rects.length ? 1 : (corner == null ? 2 : corner)); return true; } catch (e) { return false; }
}
function clearGlass(win) {
  const a = load();
  if (!a || !win || win.isDestroyed()) return;
  try { const mem = a.koffi.alloc(a.ACCENT, 1); a.koffi.encode(mem, a.ACCENT, { AccentState: 0, AccentFlags: 0, GradientColor: 0, AnimationId: 0 }); a.setWCA(hwndOf(win), { Attribute: 19, Data: mem, SizeOfData: a.koffi.sizeof(a.ACCENT) }); } catch (e) {}
}
// Windows 11 材质在窗口失去焦点时会变成纯色；告诉窗口“你还是激活的样子”（WM_NCACTIVATE=TRUE），材质就留着
function keepActive(win) { const a = load(); if (!a || !win || win.isDestroyed()) return; try { a.post(hwndOf(win), 0x86, 1, 0); } catch (e) {} }
// 实验用：直接设参数
function accentRaw(win, state, flags, color) { const a = load(); if (!a || !win || win.isDestroyed()) return false; try { const mem = a.koffi.alloc(a.ACCENT, 1); a.koffi.encode(mem, a.ACCENT, { AccentState: state | 0, AccentFlags: flags | 0, GradientColor: (color >>> 0), AnimationId: 0 }); return !!a.setWCA(hwndOf(win), { Attribute: 19, Data: mem, SizeOfData: a.koffi.sizeof(a.ACCENT) }); } catch (e) { return false; } }
function dwmAttr(win, attr, val) { const a = load(); if (!a || !win || win.isDestroyed()) return -1; try { return a.dwmSet(hwndOf(win), attr, [val | 0], 4); } catch (e) { return -2; } }
function extendFrame(win, v) { const a = load(); if (!a || !win || win.isDestroyed()) return -1; try { return a.extend(hwndOf(win), { l: v, r: v, t: v, b: v }); } catch (e) { return -2; } }
// Windows 节能模式开着吗（开着时系统会关掉所有模糊）
function powerSaver() { const a = load(); if (!a) return false; try { const s = {}; a.sps(s); return (s.sflag & 1) === 1; } catch (e) { return false; } }
module.exports = { powerSaver, accentRaw, dwmAttr, extendFrame, keepActive, applyGlass, clearGlass, shapeWin, circleRects, ribbonRects };

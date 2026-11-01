// Windows：给窗口加真正的毛玻璃（失去焦点也保持），Windows 11 上让无边框窗口画圆角，
// 圆形的小圆和转盘用窗口区域裁成圆，毛玻璃只出现在圆里。
// 毛玻璃用 SetWindowCompositionAttribute(ACCENT_ENABLE_ACRYLICBLURBEHIND)，和 TranslucentTB 等小工具同一个办法。
const { screen } = require("electron");
let api;
function load() {
  if (api !== undefined) return api;
  api = null;
  if (process.platform !== "win32") return api;
  try {
    const koffi = require("koffi");
    const user32 = koffi.load("user32.dll"), dwm = koffi.load("dwmapi.dll"), gdi = koffi.load("gdi32.dll");
    const ACCENT = koffi.struct("XK_ACCENT", { AccentState: "int", AccentFlags: "int", GradientColor: "uint32", AnimationId: "int" });
    const WCAD = koffi.struct("XK_WCAD", { Attribute: "int", Data: "void *", SizeOfData: "size_t" });
    api = {
      koffi, ACCENT, WCAD,
      setWCA: user32.func("bool __stdcall SetWindowCompositionAttribute(intptr_t hwnd, XK_WCAD *data)"),
      dwmSet: dwm.func("long __stdcall DwmSetWindowAttribute(intptr_t hwnd, uint32_t attr, _In_ int *val, uint32_t size)"),
      ellipse: gdi.func("intptr_t __stdcall CreateEllipticRgn(int x1, int y1, int x2, int y2)"),
      combine: gdi.func("int __stdcall CombineRgn(intptr_t dst, intptr_t a, intptr_t b, int mode)"),
      del: gdi.func("bool __stdcall DeleteObject(intptr_t obj)"),
      setRgn: user32.func("int __stdcall SetWindowRgn(intptr_t hwnd, intptr_t rgn, bool redraw)"),
    };
  } catch (e) { api = null; }
  return api;
}
function hwndOf(win) {
  const b = win.getNativeWindowHandle();
  return b.length >= 8 ? Number(b.readBigUInt64LE(0)) : b.readUInt32LE(0);
}
// tint 是 0xAABBGGRR。颜色很淡，主要靠模糊，才看得出是玻璃而不是白板
function applyGlass(win, dark, corner) {
  const a = load();
  if (!a || !win || win.isDestroyed()) return false;
  try {
    const hwnd = hwndOf(win);
    const tint = dark ? 0x46261e1e : 0x1ef8f8f8;
    const mem = a.koffi.alloc(a.ACCENT, 1);
    a.koffi.encode(mem, a.ACCENT, { AccentState: 4, AccentFlags: 2, GradientColor: tint >>> 0, AnimationId: 0 });
    const ok = a.setWCA(hwnd, { Attribute: 19, Data: mem, SizeOfData: a.koffi.sizeof(a.ACCENT) });
    // DWMWA_WINDOW_CORNER_PREFERENCE：2 圆角，3 小圆角，1 不要圆角（圆形窗口用区域裁）
    try { a.dwmSet(hwnd, 33, [corner == null ? 2 : corner], 4); } catch (e) {}
    return !!ok;
  } catch (e) { return false; }
}
// 把窗口裁成圆（或圆环）。参数是窗口里的逻辑坐标：圆心 cx,cy，外半径 r，内半径 r0（0 = 实心圆）
function roundRegion(win, cx, cy, r, r0) {
  const a = load();
  if (!a || !win || win.isDestroyed()) return false;
  try {
    const s = screen.getDisplayMatching(win.getBounds()).scaleFactor || 1, P = (v) => Math.round(v * s);
    const outer = a.ellipse(P(cx - r), P(cy - r), P(cx + r) + 1, P(cy + r) + 1);
    if (r0 > 0) { const inner = a.ellipse(P(cx - r0), P(cy - r0), P(cx + r0) + 1, P(cy + r0) + 1); a.combine(outer, outer, inner, 4); a.del(inner); }
    a.setRgn(hwndOf(win), outer, true); // 区域交给系统，不能再 DeleteObject
    return true;
  } catch (e) { return false; }
}
module.exports = { applyGlass, roundRegion };

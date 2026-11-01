// Windows：给窗口加真正的毛玻璃（失去焦点也保持），并让 Windows 11 给无边框窗口画圆角。
// 用的是 SetWindowCompositionAttribute(ACCENT_ENABLE_ACRYLICBLURBEHIND)，和 TranslucentTB 等小工具同一个办法。
let api;
function load() {
  if (api !== undefined) return api;
  api = null;
  if (process.platform !== "win32") return api;
  try {
    const koffi = require("koffi");
    const user32 = koffi.load("user32.dll"), dwm = koffi.load("dwmapi.dll");
    const ACCENT = koffi.struct("XK_ACCENT", { AccentState: "int", AccentFlags: "int", GradientColor: "uint32", AnimationId: "int" });
    const WCAD = koffi.struct("XK_WCAD", { Attribute: "int", Data: "void *", SizeOfData: "size_t" });
    api = {
      koffi, ACCENT, WCAD,
      setWCA: user32.func("bool __stdcall SetWindowCompositionAttribute(intptr_t hwnd, XK_WCAD *data)"),
      dwmSet: dwm.func("long __stdcall DwmSetWindowAttribute(intptr_t hwnd, uint32_t attr, _In_ int *val, uint32_t size)"),
    };
  } catch (e) { api = null; }
  return api;
}
function hwndOf(win) {
  const b = win.getNativeWindowHandle();
  return b.length >= 8 ? Number(b.readBigUInt64LE(0)) : b.readUInt32LE(0);
}
// tint 是 0xAABBGGRR
function applyGlass(win, dark) {
  const a = load();
  if (!a || !win || win.isDestroyed()) return false;
  try {
    const hwnd = hwndOf(win);
    const tint = dark ? 0x663a2623 : 0x55f7fafb;
    const mem = a.koffi.alloc(a.ACCENT, 1);
    a.koffi.encode(mem, a.ACCENT, { AccentState: 4, AccentFlags: 2, GradientColor: tint >>> 0, AnimationId: 0 });
    const ok = a.setWCA(hwnd, { Attribute: 19, Data: mem, SizeOfData: a.koffi.sizeof(a.ACCENT) });
    try { a.dwmSet(hwnd, 33, [2], 4); } catch (e) {} // DWMWA_WINDOW_CORNER_PREFERENCE = DWMWCP_ROUND
    return !!ok;
  } catch (e) { return false; }
}
module.exports = { applyGlass };

// 毛玻璃：Windows 自带的模糊在透明窗口上不可靠（会画成一整块白色方框），
// 所以改成读桌面壁纸，按窗口在屏幕上的位置把那一块壁纸放到窗口背后、再模糊。看起来就是透出桌面的磨砂玻璃。
const fs = require("fs"), path = require("path"), os = require("os");
const { execFile } = require("child_process");
const { screen } = require("electron");

let wall = null; // { src, style, mtime }
function wallPath() {
  if (process.env.ZS_WALL) return process.env.ZS_WALL; // 测试用
  if (process.platform !== "win32") return null;
  return path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "Microsoft", "Windows", "Themes", "TranscodedWallpaper");
}
function regStyle() {
  return new Promise((resolve) => {
    if (process.platform !== "win32") return resolve("fill");
    execFile("reg", ["query", "HKCU\\Control Panel\\Desktop"], { windowsHide: true, timeout: 4000 }, (err, out) => {
      if (err) return resolve("fill");
      const v = (k) => { const m = new RegExp(k + "\\s+REG_SZ\\s+(\\S+)").exec(String(out)); return m ? m[1] : ""; };
      const st = v("WallpaperStyle"), tile = v("TileWallpaper");
      resolve(tile === "1" ? "tile" : st === "6" ? "fit" : st === "2" ? "stretch" : st === "0" ? "center" : st === "22" ? "span" : "fill");
    });
  });
}
async function loadWall() {
  const p = wallPath();
  try {
    const st = fs.statSync(p);
    if (wall && wall.mtime === st.mtimeMs) return wall;
    const buf = fs.readFileSync(p);
    const mime = buf[0] === 0x89 && buf[1] === 0x50 ? "image/png" : buf[0] === 0x42 && buf[1] === 0x4d ? "image/bmp" : "image/jpeg";
    wall = { src: "data:" + mime + ";base64," + buf.toString("base64"), style: await regStyle(), mtime: st.mtimeMs };
  } catch (e) { wall = null; }
  return wall;
}
// 告诉窗口：壁纸（第一次）、显示器范围、窗口位置
function wallMsg(win, full) {
  if (!wall || !win || win.isDestroyed()) return null;
  const b = win.getBounds(), d = screen.getDisplayMatching(b).bounds;
  const all = screen.getAllDisplays().map((x) => x.bounds);
  const span = { x: Math.min(...all.map((r) => r.x)), y: Math.min(...all.map((r) => r.y)) };
  span.width = Math.max(...all.map((r) => r.x + r.width)) - span.x; span.height = Math.max(...all.map((r) => r.y + r.height)) - span.y;
  const m = { disp: wall.style === "span" ? span : d, win: { x: b.x, y: b.y, width: b.width, height: b.height } };
  if (full) { m.src = wall.src; m.style = wall.style; m.ver = wall.mtime; }
  return m;
}
module.exports = { loadWall, wallMsg, hasWall: () => !!wall, wallVer: () => (wall ? wall.mtime : 0) };

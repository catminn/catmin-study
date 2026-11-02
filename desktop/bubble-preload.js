const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("bubble", {
  move: (dx, dy) => ipcRenderer.send("bubble-move", dx, dy),
  moved: () => ipcRenderer.send("bubble-moved"),
  click: () => ipcRenderer.send("bubble-click"),
  menu: () => ipcRenderer.send("bubble-menu"),
  hover: (on) => ipcRenderer.send("bubble-hover", !!on),
  onGlass: (cb) => ipcRenderer.on("glass", (e, v) => cb(!!v)),
  onWall: (cb) => ipcRenderer.on("wall", (e, m) => cb(m)),
  onBadge: (cb) => ipcRenderer.on("badge", (e, n) => cb(n)),
  drop: (files) => { const list = Array.from(files || []); let paths = []; try { paths = list.map((f) => webUtils.getPathForFile(f)).filter(Boolean); } catch (e) { ipcRenderer.send("dlog", "bubble getPath err " + e.message); } ipcRenderer.send("dlog", "bubble drop files=" + list.length + " paths=" + paths.length); ipcRenderer.send("bubble-drop", paths); },
  err: (m) => ipcRenderer.send("dlog", "bubble err " + m),
  onSaver: (cb) => ipcRenderer.on("saver", (e, v) => cb(!!v)),
});

const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("bubble", {
  move: (dx, dy) => ipcRenderer.send("bubble-move", dx, dy),
  moved: () => ipcRenderer.send("bubble-moved"),
  click: () => ipcRenderer.send("bubble-click"),
  menu: () => ipcRenderer.send("bubble-menu"),
  hover: (on) => ipcRenderer.send("bubble-hover", !!on),
  onGlass: (cb) => ipcRenderer.on("glass", (e, v) => cb(!!v)),
  onBadge: (cb) => ipcRenderer.on("badge", (e, n) => cb(n)),
  drop: (files) => ipcRenderer.send("bubble-drop", Array.from(files).map((f) => webUtils.getPathForFile(f)).filter(Boolean)),
});

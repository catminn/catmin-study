const { contextBridge, ipcRenderer, webUtils } = require("electron");
contextBridge.exposeInMainWorld("ring", {
  drop: (target, files) => ipcRenderer.send("ring-drop", String(target), Array.from(files).map((f) => webUtils.getPathForFile(f)).filter(Boolean)),
  onGlass: (cb) => ipcRenderer.on("glass", (e, v) => cb(!!v)),
  hover: (k) => ipcRenderer.send("ring-hover", String(k || "")),
  onHl: (cb) => ipcRenderer.on("ring-hl", (e, k) => cb(String(k || ""))),
  onShow: (cb) => ipcRenderer.on("ring-show", () => cb()),
});

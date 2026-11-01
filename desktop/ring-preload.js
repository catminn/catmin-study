const { contextBridge, ipcRenderer, webUtils } = require("electron");
contextBridge.exposeInMainWorld("ring", {
  drop: (target, files) => ipcRenderer.send("ring-drop", String(target), Array.from(files).map((f) => webUtils.getPathForFile(f)).filter(Boolean)),
  onGlass: (cb) => ipcRenderer.on("glass", (e, v) => cb(!!v)),
  onShow: (cb) => ipcRenderer.on("ring-show", () => cb()),
});

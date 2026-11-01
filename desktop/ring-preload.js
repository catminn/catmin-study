const { contextBridge, ipcRenderer, webUtils } = require("electron");
contextBridge.exposeInMainWorld("ring", {
  drop: (target, files) => ipcRenderer.send("ring-drop", String(target), Array.from(files).map((f) => webUtils.getPathForFile(f)).filter(Boolean)),
  onShow: (cb) => ipcRenderer.on("ring-show", () => cb()),
});

const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("tab", {
  onState: (cb) => ipcRenderer.on("tab", (e, s) => cb(s || {})),
  click: () => ipcRenderer.send("tab-click"),
});

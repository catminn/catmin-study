const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("tab", {
  onState: (cb) => ipcRenderer.on("tab", (e, s) => cb(s || {})),
  click: () => ipcRenderer.send("tab-click"),
  onSaver: (cb) => ipcRenderer.on("saver", (e, v) => cb(!!v)),
  onGlass: (cb) => ipcRenderer.on("glass", (e, v) => cb(v)),
});

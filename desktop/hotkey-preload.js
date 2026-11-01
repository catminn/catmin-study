const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("hk", {
  current: () => ipcRenderer.invoke("hk-current"),
  save: (acc) => ipcRenderer.invoke("hk-save", String(acc)),
  close: () => ipcRenderer.send("hk-close"),
});

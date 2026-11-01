// 学习空间页面（study.catmin.io）在桌面版里能用的接口：window.zsDesktop
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("zsDesktop", {
  hide: () => ipcRenderer.send("hide"),
  openMain: (hash) => ipcRenderer.send("open-main", String(hash || "")),
  openZero: (cmd) => ipcRenderer.send("open-zero", String(cmd || "")),
  toMain: (subj, list) => ipcRenderer.send("to-main", String(subj), list),
  saved: () => ipcRenderer.send("saved"),
  ready: () => ipcRenderer.send("ready"),
  onPull: (cb) => ipcRenderer.on("pull", () => cb()),
  onFiles: (cb) => ipcRenderer.on("files", (e, target, list) => cb(target, list)),
  onCommand: (cb) => ipcRenderer.on("cmd", (e, c) => cb(c)),
});

// 学习空间页面（study.catmin.io）在桌面版里能用的接口：window.zsDesktop
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("zsDesktop", {
  hide: () => ipcRenderer.send("hide"),
  openMain: (hash) => ipcRenderer.send("open-main", String(hash || "")),
  openZero: (cmd) => ipcRenderer.send("open-zero", String(cmd || "")),
  toMain: (subj, list) => ipcRenderer.send("to-main", String(subj), list),
  saved: () => ipcRenderer.send("saved"),
  ready: () => ipcRenderer.send("ready"),
  onTodoState: (cb) => ipcRenderer.on("todo-state", (e, st) => cb(st)),
  isGlass: () => ipcRenderer.invoke("is-glass"),
  todoBusy: (v) => ipcRenderer.send("todo-busy", !!v),
  todoMode: (m) => ipcRenderer.send("todo-mode", String(m)),
  resizeBy: (dw, dh) => ipcRenderer.send("todo-resize", Number(dw) || 0, Number(dh) || 0),
  setPin: (v) => ipcRenderer.send("set-pin", !!v),
  getPin: () => ipcRenderer.invoke("get-pin"),
  gameMode: (on, end) => ipcRenderer.send("game-mode", !!on, Number(end) || 0),
  onWall: (cb) => ipcRenderer.on("wall", (e, m) => cb(m)),
  badge: (n) => ipcRenderer.send("badge", Number(n) || 0),
  inboxPlace: (src, course, name) => ipcRenderer.invoke("inbox-place", String(src), String(course), String(name || "")),
  saveLocal: (subj, course, list) => ipcRenderer.invoke("save-local", String(course), list),
  savePdf: (subj, course, name, html) => ipcRenderer.invoke("save-pdf", String(course), String(name), String(html)),
  onPull: (cb) => ipcRenderer.on("pull", () => cb()),
  onFiles: (cb) => ipcRenderer.on("files", (e, target, list) => cb(target, list)),
  onCommand: (cb) => ipcRenderer.on("cmd", (e, c) => cb(c)),
});

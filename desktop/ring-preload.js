const { contextBridge, ipcRenderer, webUtils } = require("electron");
contextBridge.exposeInMainWorld("ring", {
  drop: (target, files) => { const list = Array.from(files || []); let paths = []; try { paths = list.map((f) => webUtils.getPathForFile(f)).filter(Boolean); } catch (e) { ipcRenderer.send("dlog", "ring getPath err " + e.message); } ipcRenderer.send("ring-drop", String(target), paths); },
  onGlass: (cb) => ipcRenderer.on("glass", (e, v) => cb(!!v)),
  hover: (k) => ipcRenderer.send("ring-hover", String(k || "")),
  onHl: (cb) => ipcRenderer.on("ring-hl", (e, k) => cb(String(k || ""))),
  onFiles: (cb) => ipcRenderer.on("ring-files", (e, f) => cb(f)),
  onShow: (cb) => ipcRenderer.on("ring-show", () => cb()),
  onSaver: (cb) => ipcRenderer.on("saver", (e, v) => cb(!!v)),
});

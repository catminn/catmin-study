const { app, BrowserWindow } = require("electron");
module.exports = async (h) => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms)), log = (...a) => console.log("[smoke]", ...a);
  const { execSync } = require("child_process"), mv = (x, y) => { try { execSync(`xdotool mousemove ${x} ${y}`); } catch (e) { log("xdotool fail"); } };
  try {
    mv(10, 1000); await wait(5000);
    const tab = () => BrowserWindow.getAllWindows().find((w) => /tab\.html/.test(w.webContents.getURL()));
    log("bubble", h.bubble && h.bubble.isVisible(), h.bubble && JSON.stringify(h.bubble.getBounds())); require("fs").writeFileSync("/tmp/claude-0/-home-claude/1248d994-2609-57fc-924a-dcc3cbf43a86/scratchpad/e-bub.png", (await h.bubble.webContents.capturePage()).toPNG());
    log("start: todo", h.todo.isVisible(), "tab", tab() && tab().isVisible(), tab() && JSON.stringify(tab().getBounds()));
    const tb = tab().getBounds(); mv(tb.x + 5, tb.y + 5); await wait(600);
    log("hover tab: todo", h.todo.isVisible(), JSON.stringify(h.todo.getBounds()), "tab", tab().isVisible());
    mv(10, 1000); await wait(1500);
    log("leave: todo", h.todo.isVisible(), "tab", tab().isVisible());
    // drag full todo near top edge -> docked tab
    h.todo.setBounds({ x: 600, y: 5, width: 280, height: 320 }); h.todo.emit("moved"); await wait(1500);
    log("after top move: tab", tab().isVisible(), JSON.stringify(tab().getBounds()));
    require("fs").writeFileSync("/tmp/claude-0/-home-claude/1248d994-2609-57fc-924a-dcc3cbf43a86/scratchpad/e-tab2.png", (await tab().webContents.capturePage()).toPNG());
  } catch (e) { log("ERROR", e && e.stack || e); }
  app.exit(0);
};

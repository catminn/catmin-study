const { app } = require("electron");
const fs = require("fs"), path = require("path"), os = require("os");
module.exports = async (h) => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const log = (...a) => console.log("[smoke]", ...a);
  try {
    await wait(5000);
    log("bubble", !!h.bubble && h.bubble.isVisible(), h.bubble && h.bubble.getBounds());
    log("todo visible", !!h.todo && h.todo.isVisible());
    log("todo text", (await h.todo.webContents.executeJavaScript('document.querySelector("#todoEmbed")?document.querySelector("#todoEmbed").innerText.slice(0,200):"none"')).replace(/\n/g, " | "));
    const f = path.join(os.tmpdir(), "笔记.txt"); fs.writeFileSync(f, "梯度是函数增长最快的方向。");
    h.deliverPaths([f]); await wait(2500);
    log("zero visible", h.zero.isVisible(), h.zero.getBounds());
    log("picker", await h.zero.webContents.executeJavaScript('document.querySelector(".zw-pick")?document.querySelector(".zw-pick").innerText.replace(/\\n/g," "):"none"'));
    await h.zero.webContents.executeJavaScript('[...document.querySelectorAll(".zw-pick .btn")].find(b=>b.textContent==="零").click()');
    await wait(800);
    log("zero docs", await h.zero.webContents.executeJavaScript("JSON.stringify(ZW.docs.map(d=>[d.name,d.text]))"));
    await wait(800);
    log("desktop files", JSON.stringify(fs.readdirSync(path.join(app.getPath("desktop"), "Cornell"), { recursive: true })));
    await h.zero.webContents.executeJavaScript('hwAdd("math","15.5 #12 || Find $\\nabla f$ for $f=x^2y$.");hwAdd("math","15.5 #20 || Directional derivative of $f$ at $(1,2)$.");1');
    await h.zero.webContents.executeJavaScript('(async()=>{const a={id:"h1",subj:"math",title:"HW 10",items:S.hwDraft.math.slice(),at:Date.now()};await hwExport(a);return a.local||"none"})()').then((r) => log("pdf", r));
    log("desktop files 2", JSON.stringify(fs.readdirSync(path.join(app.getPath("desktop"), "Cornell"), { recursive: true })));
    await h.zero.webContents.executeJavaScript('window.zsDesktop.openZero("daily")'); await wait(1200);
    log("daily open", await h.zero.webContents.executeJavaScript('!!document.querySelector(".qz,.scrim")'));
    const img = await h.zero.webContents.capturePage(); fs.writeFileSync("/tmp/claude-0/-home-claude/1248d994-2609-57fc-924a-dcc3cbf43a86/scratchpad/desk-zero.png", img.toPNG());
    const ti = await h.todo.webContents.capturePage(); fs.writeFileSync("/tmp/claude-0/-home-claude/1248d994-2609-57fc-924a-dcc3cbf43a86/scratchpad/desk-todo.png", ti.toPNG());
    const bi = await h.bubble.webContents.capturePage(); fs.writeFileSync("/tmp/claude-0/-home-claude/1248d994-2609-57fc-924a-dcc3cbf43a86/scratchpad/desk-bubble.png", bi.toPNG());
  } catch (e) { log("ERROR", e && e.stack || e); }
  app.exit(0);
};

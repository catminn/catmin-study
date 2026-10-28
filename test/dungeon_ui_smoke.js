const {chromium}=require('playwright');
(async()=>{const b=await chromium.launch();const c=await b.newContext();const p=await c.newPage();const errs=[];p.on('pageerror',e=>errs.push(String(e)));
const r=await c.request.post('http://localhost:8800/api/login',{data:{password:'test-pass-123'}});
await p.goto('http://localhost:8800/');await p.waitForTimeout(3500);
const info=await p.evaluate(async()=>{const L=SAGA.math;const idx=L.findIndex(w=>w.id==='tidal-archive-1920');const first=sagaChapters('math').find(x=>x.w.id==='tidal-archive-1920');sagaState('math').n=first.g;CUR='math';renderDungeon();return {idx,len:L.length,card:!!document.querySelector('#practiceCard'),txt:(document.querySelector('#practiceCard')||{}).innerText}});
console.log(JSON.stringify(info));
const step=async a=>{await p.evaluate(a=>{const i=document.querySelector('#practiceCard input');i.value=a;document.querySelector('#practiceCard button').click()},a);await p.waitForTimeout(900);return await p.evaluate(()=>document.querySelector('#practiceCard').innerText.replace(/\n/g,' | '))};
for(const a of ['3','6xy','12']) console.log(a,'=>',await step(a));
console.log('errs',errs);await b.close()})();

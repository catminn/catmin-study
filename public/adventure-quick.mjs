// Player-visible suggestions derived from already public scene and DM text.
// These prompts are editable and never commit an action by themselves.
const cues = [
  {pattern:/两张地图|地图|坡向|坡度标注/, label:"对照地图", prompt:"我仔细对照手中的地图，看看两张图上的道路和坡向有什么不同。"},
  {pattern:/积水|水流|石板缝|地势|潮水/, label:"查看水流", prompt:"我蹲下查看地面积水的流向和街道的高低变化。"},
  {pattern:/委托书|信封|信件|收件时间/, label:"检查委托书", prompt:"我拿出委托书，检查上面的时间与其他细节。"},
  {pattern:/钟楼|钟面|钟声/, label:"观察钟楼", prompt:"我抬头观察钟楼和钟面的状态。"},
  {pattern:/路人|摊贩|守卫|居民|有人站|人群/, label:"询问附近的人", prompt:"我想向附近的人打听这里发生了什么。"},
];
export function suggestSceneActions(publicText="", latestNarration="") {
  const text=String(publicText||"")+"\n"+String(latestNarration||"");
  return cues.filter(c=>c.pattern.test(text)).slice(0,4).map(c=>({label:c.label,prompt:c.prompt}));
}

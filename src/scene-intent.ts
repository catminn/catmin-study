export function sceneRequest(input: string, moves: {sceneId:string;label:string}[]) {
  const t=input.trim().replace(/[。！？!?.]+$/g,"");
  const observation=/^(?:仔细|先|再)?(?:看看|观察|环顾|打量|查看)(?:一下)?(?:四周|周围|附近|这里|环境|街道|街上|周遭|景象|情况)?$|^周围(?:有什么|怎么样)$/.test(t);
  const travel=t.match(/^(?:我想|我要|请|现在|直接|先)?\s*(?:前往|去往|走向|走到|前去|去|进入)\s*(.+)$/);
  const dest=travel?.[1]?.trim();
  const matched=dest?moves.filter((m,i)=>dest===m.label||dest===m.sceneId||(dest==="地点"+(i+1)&&/^地点\d+$/.test(m.label))):[];
  return {observation,moveTo:matched.length===1?matched[0].sceneId:null};
}
export function narrationViolatesSceneContract(answer: string) {
  return /(?:没有|尚未|还没)(?:提交|提供)(?:具体的?)?(?:世界)?行动|(?:不能|无法|还不能)(?:描写|描述)(?:四周|周围|环境)|探索意图|具体世界行动|验证数学方法|把.*(?:题目|数学方法).*发给我/.test(answer);
}

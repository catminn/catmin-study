// 仅本地测试用：用假的 AI（字符 n-gram 哈希向量）和内存版 Vectorize 替换云端绑定
import worker from "../src/index";
const DIM = 1024;
function fakeEmbed(t: string): number[] {
  const v = new Array(DIM).fill(0);
  const s = t.toLowerCase();
  for (let i = 0; i < s.length - 1; i++) {
    const g = s.slice(i, i + 2);
    let h = 2166136261;
    for (const c of g) h = Math.imul(h ^ c.codePointAt(0)!, 16777619);
    v[Math.abs(h) % DIM] += 1;
  }
  const n = Math.hypot(...v) || 1;
  return v.map((x) => x / n);
}
const store = new Map<string, { id: string; values: number[]; namespace?: string }>();
const fakeAI = { run: async (_m: string, i: any) => ({ shape: [i.text.length, DIM], data: i.text.map(fakeEmbed) }) };
const fakeVec = {
  upsert: async (vs: any[]) => { for (const v of vs) store.set(v.id, v); return { count: vs.length }; },
  deleteByIds: async (ids: string[]) => { ids.forEach((i) => store.delete(i)); return { count: ids.length }; },
  query: async (q: number[], o: any) => {
    const m = [...store.values()].filter((v) => (v.namespace ?? "") === (o.namespace ?? ""))
      .map((v) => ({ id: v.id, score: v.values.reduce((s, x, i) => s + x * q[i], 0) }))
      .sort((a, b) => b.score - a.score).slice(0, o.topK);
    return { matches: m, count: m.length };
  },
  describe: async () => ({ vectorsCount: store.size, dimensions: DIM }),
};
export default {
  fetch(req: Request, env: any, ctx: ExecutionContext) {
    return (worker as any).fetch(req, { ...env, AI: fakeAI, VEC: fakeVec }, ctx);
  },
};

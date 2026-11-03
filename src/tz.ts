// 「她现在的时区」：跟着她电脑走。网站 / 桌面版每次请求带 X-TZ（浏览器的 IANA 时区），
// 变了就记到 KV；Claude / ChatGPT 通过共享记忆调用时用最后记下的那个。没记过就用美东。
// 只影响以后的计算（今天是哪天、日历里没写时区的时间怎么理解），以前存的东西不转换。
const KEY = "pref:tz";
const DEFAULT = "America/New_York";
let cur = DEFAULT, loadedAt = 0;
type KVEnv = { OAUTH_KV: KVNamespace };

export const tz = () => cur;
export function validTz(s: unknown): s is string {
  if (typeof s !== "string" || !s || s.length > 64 || !/^[A-Za-z_+\-/0-9]+$/.test(s)) return false;
  try { new Intl.DateTimeFormat("en-US", { timeZone: s }); return true; } catch { return false; }
}
export async function loadTz(env: KVEnv) {
  if (Date.now() - loadedAt < 60_000) return cur;
  try { const v = await env.OAUTH_KV.get(KEY); if (validTz(v)) cur = v; loadedAt = Date.now(); } catch {}
  return cur;
}
export async function noteTz(env: KVEnv, s: unknown) {
  if (!validTz(s) || s === cur) return;
  cur = s; loadedAt = Date.now();
  try { await env.OAUTH_KV.put(KEY, s); } catch {}
}
// 某个时刻在当前时区的日期 YYYY-MM-DD
export const tzDay = (ms = Date.now()) => new Date(ms).toLocaleDateString("en-CA", { timeZone: cur });

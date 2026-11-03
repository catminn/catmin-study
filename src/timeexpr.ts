// 把 "yesterday" / "last week" / "3 days ago" / "昨天" / "上周" 之类转换成时间范围（Unix 秒）
// 用她现在的时区（跟着电脑走，见 tz.ts）计算"今天"的边界
import { tz } from "./tz";
const DAY = 86400;

// 某个时刻在 tz 里的墙上时间（年月日时分秒）
function wallParts(ms: number, tz: string) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" }).formatToParts(new Date(ms));
  const g = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return { y: g("year"), mo: g("month"), d: g("day"), h: g("hour") % 24, mi: g("minute"), s: g("second") };
}
// tz 相对 UTC 的偏移（毫秒），EDT 为 -4h，EST 为 -5h
function tzOffset(ms: number, tz: string) {
  const p = wallParts(ms, tz);
  return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - Math.floor(ms / 1000) * 1000;
}
// 当地墙上时间 → UTC 毫秒。偏移要在结果时刻上再核对一次，否则夏令时切换后几个小时会差一小时
export function localToUtcMs(y: number, mo: number, d: number, h = 0, mi = 0, s = 0, zone = tz()): number {
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  const o1 = tzOffset(guess, zone);
  const o2 = tzOffset(guess - o1, zone);
  return guess - o2;
}

// 当地"今天"往前 back 天那一天的 0 点（Unix 秒）
function localMidnight(nowSec: number, back = 0): number {
  const p = wallParts(nowSec * 1000, tz());
  const d = new Date(Date.UTC(p.y, p.mo - 1, p.d - back));
  return localToUtcMs(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()) / 1000;
}

export function parseTimeExpr(expr: string, nowSec = Date.now() / 1000): { after?: number; before?: number } | null {
  const e = expr.trim().toLowerCase();
  const mid = (back: number) => localMidnight(nowSec, back);
  const today = mid(0);
  const num = (s: string) => {
    const zh: Record<string, number> = { 一: 1, 两: 2, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
    return /^\d+$/.test(s) ? Number(s) : zh[s] ?? NaN;
  };
  if (/^(today|今天)$/.test(e)) return { after: today };
  if (/^(yesterday|昨天)$/.test(e)) return { after: mid(1), before: today };
  if (/^(this week|本周|这周)$/.test(e)) return { after: mid(6) };
  if (/^(last week|past week|上周|最近一周)$/.test(e)) return { after: mid(7) };
  if (/^(last month|past month|上个月|最近一个月)$/.test(e)) return { after: mid(30) };
  if (/^(this month|本月|这个月)$/.test(e)) return { after: mid(30) };
  let m = e.match(/^(\d+|[一两二三四五六七八九十])\s*(days?|天)\s*(ago|前)$/);
  if (m) {
    const n = num(m[1]);
    return { after: mid(n), before: mid(n - 1) };
  }
  m = e.match(/^(?:last|past|最近)\s*(\d+|[一两二三四五六七八九十])\s*(days?|天|weeks?|周)$/);
  if (m) {
    const n = num(m[1]);
    const unit = /week|周/.test(m[2]) ? 7 * DAY : DAY;
    return { after: nowSec - n * unit };
  }
  m = e.match(/^(\d+|[一两二三四五六七八九十])\s*(weeks?|周)\s*(ago|前)$/);
  if (m) {
    const n = num(m[1]);
    return { after: mid(n * 7), before: mid((n - 1) * 7) };
  }
  return null;
}

// "YYYY-MM-DD" 按当地当天 0 点算（以前写死 -04:00，冬令时会差一小时）
export function isoToSec(s?: string): number | undefined {
  if (!s) return undefined;
  const dm = /^(\d{4})-(\d\d)-(\d\d)$/.exec(s);
  if (dm) return localToUtcMs(Number(dm[1]), Number(dm[2]), Number(dm[3])) / 1000;
  const t = Date.parse(s);
  return Number.isNaN(t) ? undefined : t / 1000;
}

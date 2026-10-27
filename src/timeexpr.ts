// 把 "yesterday" / "last week" / "3 days ago" / "昨天" / "上周" 之类转换成时间范围（Unix 秒）
// 用美东时间计算"今天"的边界
const TZ = "America/New_York";
const DAY = 86400;

function startOfLocalDay(nowSec: number): number {
  const d = new Date(nowSec * 1000);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(d);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0) % 24;
  const secIntoDay = get("hour") * 3600 + Number(parts.find((p) => p.type === "minute")?.value ?? 0) * 60 +
    Number(parts.find((p) => p.type === "second")?.value ?? 0);
  return Math.floor(nowSec - secIntoDay);
}

export function parseTimeExpr(expr: string, nowSec = Date.now() / 1000): { after?: number; before?: number } | null {
  const e = expr.trim().toLowerCase();
  const today = startOfLocalDay(nowSec);
  const num = (s: string) => {
    const zh: Record<string, number> = { 一: 1, 两: 2, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
    return /^\d+$/.test(s) ? Number(s) : zh[s] ?? NaN;
  };
  if (/^(today|今天)$/.test(e)) return { after: today };
  if (/^(yesterday|昨天)$/.test(e)) return { after: today - DAY, before: today };
  if (/^(this week|本周|这周)$/.test(e)) return { after: today - 6 * DAY };
  if (/^(last week|past week|上周|最近一周)$/.test(e)) return { after: today - 7 * DAY };
  if (/^(last month|past month|上个月|最近一个月)$/.test(e)) return { after: today - 30 * DAY };
  if (/^(this month|本月|这个月)$/.test(e)) return { after: today - 30 * DAY };
  let m = e.match(/^(\d+|[一两二三四五六七八九十])\s*(days?|天)\s*(ago|前)$/);
  if (m) {
    const n = num(m[1]);
    return { after: today - n * DAY, before: today - (n - 1) * DAY };
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
    return { after: today - n * 7 * DAY, before: today - (n - 1) * 7 * DAY };
  }
  return null;
}

export function isoToSec(s?: string): number | undefined {
  if (!s) return undefined;
  const t = Date.parse(s.length === 10 ? s + "T00:00:00-04:00" : s);
  return Number.isNaN(t) ? undefined : t / 1000;
}

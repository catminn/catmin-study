// 练习题答案判定（纯函数，便于测试）
const SUP: Record<string, string> = { "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4", "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9", "⁻": "-", "⁺": "+" };
const norm = (x: string) => x.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁻⁺]+/g, (m) => "^" + [...m].map((c) => SUP[c] ?? c).join("")).normalize("NFKC").toLowerCase().replace(/\s+/g, "").replace(/[，。,.;；]+$/g, "");
// 把常见写法解析成数字：1e-5 / 1×10^-5 / 10^-5 / 1/2 / 带前缀 "ph=" "x=" / 数字后跟单位
function toNum(t: string): number | null {
  let u = t.replace(/^[a-z\[\]+⁺_()]*=/, "").replace(/[×x*·]10\^?(-?\+?\d+)/, "e$1").replace(/^10\^(-?\d+)$/, "1e$1");
  const f = u.match(/^(-?[\d.]+)\/([\d.]+)$/); if (f) { const v = Number(f[1]) / Number(f[2]); return Number.isFinite(v) ? v : null; }
  const m = u.match(/^(-?\d*\.?\d+(?:e[-+]?\d+)?)[a-zμ°·/²³%]*$/);
  if (m) { const v = Number(m[1]); return Number.isFinite(v) ? v : null; }
  return null;
}
export function answerMatches(given: string, key: string | string[]): boolean {
  const keys = Array.isArray(key) ? key : [key]; const g = norm(String(given));
  return keys.some((k) => {
    const n = norm(k); if (n === g) return true;
    const a = toNum(g), b = toNum(n);
    if (a !== null && b !== null) return Math.abs(a - b) <= 1e-9 * Math.max(1e-300, Math.abs(b)) || Math.abs(a - b) <= 1e-12;
    const strip = (z: string) => z.replace(/[()\[\]（）【】]/g, "");
    return strip(g) === strip(n);
  });
}

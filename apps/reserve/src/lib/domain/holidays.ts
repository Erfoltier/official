/**
 * 日本の祝日（内閣府の「国民の祝日」の決まりから計算。2022〜2099年向け）。
 * 振替休日（日曜と重なった祝日の翌平日）と国民の休日（祝日にはさまれた平日）も含む。
 * 春分・秋分の日は天文計算による近似式。正式には前年2月の官報で確定するため、念のため毎年確認する。
 */

const cache = new Map<number, Map<string, string>>();

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
const dow = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d)).getUTCDay();

/** その月の第n月曜日 */
function nthMonday(y: number, m: number, n: number): number {
  const first = dow(y, m, 1);
  return 1 + ((8 - first) % 7) + (n - 1) * 7;
}

function equinox(y: number, base: number): number {
  return Math.floor(base + 0.242194 * (y - 1980) - Math.floor((y - 1980) / 4));
}

export function holidaysOf(year: number): Map<string, string> {
  const hit = cache.get(year);
  if (hit) return hit;
  const y = year;
  const base: [number, number, string][] = [
    [1, 1, "元日"],
    [1, nthMonday(y, 1, 2), "成人の日"],
    [2, 11, "建国記念の日"],
    [2, 23, "天皇誕生日"],
    [3, equinox(y, 20.8431), "春分の日"],
    [4, 29, "昭和の日"],
    [5, 3, "憲法記念日"],
    [5, 4, "みどりの日"],
    [5, 5, "こどもの日"],
    [7, nthMonday(y, 7, 3), "海の日"],
    [8, 11, "山の日"],
    [9, nthMonday(y, 9, 3), "敬老の日"],
    [9, equinox(y, 23.2488), "秋分の日"],
    [10, nthMonday(y, 10, 2), "スポーツの日"],
    [11, 3, "文化の日"],
    [11, 23, "勤労感謝の日"],
  ];
  const out = new Map<string, string>();
  for (const [m, d, name] of base) out.set(ymd(y, m, d), name);

  const sorted = [...out.keys()].sort();
  const next = (date: string) => {
    const t = new Date(`${date}T00:00:00Z`);
    t.setUTCDate(t.getUTCDate() + 1);
    return t.toISOString().slice(0, 10);
  };
  // 国民の休日：前後が祝日の平日
  for (const date of sorted) {
    const mid = next(date);
    const after = next(mid);
    if (!out.has(mid) && out.has(after) && new Date(`${mid}T00:00:00Z`).getUTCDay() !== 0) out.set(mid, "国民の休日");
  }
  // 振替休日：日曜の祝日のあと、最初の祝日でない日
  for (const date of [...out.keys()].sort()) {
    if (new Date(`${date}T00:00:00Z`).getUTCDay() !== 0) continue;
    let d = next(date);
    while (out.has(d)) d = next(d);
    if (d.startsWith(String(y))) out.set(d, "振替休日");
  }
  cache.set(year, out);
  return out;
}

/** 祝日なら名前、そうでなければ undefined */
export function holidayName(date: string): string | undefined {
  return holidaysOf(Number(date.slice(0, 4))).get(date);
}

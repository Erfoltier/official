/**
 * ホームページの料金表（HTML の表）から料金を読み取る。PHP版（php/lib/PriceParse.php）と同じ手順。
 *
 * - 「■シミ取り」のような行は分類、値段のない短い行は小見出し（例：Qスイッチルビーレーザー）
 * - 「部位｜料金｜部位｜料金」の表は2組ずつ、「対象｜20本まで｜21本以上」の表は 行×列 で読む
 * - 表より前に「税抜」と書かれていれば税込（×1.1、1円未満切り捨て）に直す
 */

export interface ParsedPrice {
  category: string;
  name: string;
  /** 税込の値段。「〜」「＋」付きや「ASK」など1つに決まらないものは null */
  priceYen: number | null;
  /** ホームページの表記そのまま（税抜の表は「税抜」を付ける） */
  priceText: string;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', "#039": "'", apos: "'", nbsp: " " };

function decode(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z0-9#]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);
}

/** タグを除いた文字（<br> は区切り記号 \n にする） */
function text(html: string): string {
  return decode(html.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]*>/g, ""))
    .split("\n")
    .map((l) => l.replace(/[\s　]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

const oneLine = (s: string) => s.replace(/\n/g, " ");

/** "11,000円" → 11000。範囲・足し算・割合・ASK などは null */
export function parseYen(t: string): number | null {
  if (/[〜～~＋+％%]/.test(t)) return null;
  const m = /([0-9][0-9,，]*)\s*円/.exec(t);
  if (!m) return null;
  const n = Number(m[1].replace(/[,，]/g, ""));
  return Number.isSafeInteger(n) ? n : null;
}

function cells(rowHtml: string): { html: string; th: boolean }[] {
  const out: { html: string; th: boolean }[] = [];
  const re = /<(t[dh])\b[^>]*>([\s\S]*?)<\/\1>/gi;
  for (let m = re.exec(rowHtml); m; m = re.exec(rowHtml)) out.push({ html: m[2], th: m[1].toLowerCase() === "th" });
  return out;
}

/** 表の直前の見出し（h2〜h4）。なければ空 */
function headingBefore(before: string): string {
  const re = /<h[2-4]\b[^>]*>([\s\S]*?)<\/h[2-4]>/gi;
  let last = "";
  for (let m = re.exec(before); m; m = re.exec(before)) last = oneLine(text(m[1]));
  return last;
}

/** 表より前で最後に出てくる「税抜」「税込」 */
function taxExcludedBefore(before: string): boolean {
  const plain = text(before.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ""));
  return plain.lastIndexOf("税抜") > plain.lastIndexOf("税込");
}

const withTax = (n: number) => Math.floor((n * 11) / 10);

export function parsePriceTables(html: string): ParsedPrice[] {
  const out: ParsedPrice[] = [];
  const tableRe = /<table\b[^>]*>([\s\S]*?)<\/table>/gi;
  for (let tm = tableRe.exec(html); tm; tm = tableRe.exec(html)) {
    const body = tm[1];
    if (!body.includes("円")) continue;
    const before = html.slice(0, tm.index);
    const heading = headingBefore(before);
    const excluded = taxExcludedBefore(before);
    const push = (category: string, name: string, priceRaw: string) => {
      const t = oneLine(text(priceRaw));
      const n = oneLine(name).trim();
      if (!n || !t) return;
      const yenRaw = parseYen(t);
      out.push({
        category: category || heading,
        name: n,
        priceYen: yenRaw === null ? null : excluded ? withTax(yenRaw) : yenRaw,
        priceText: excluded ? `税抜 ${t}` : t,
      });
    };

    const rows: { html: string; th: boolean }[][] = [];
    const rowRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
    for (let rm = rowRe.exec(body); rm; rm = rowRe.exec(body)) rows.push(cells(rm[1]));
    if (rows.length === 0) continue;

    // 見出し行：すべて th か、どのマスにも「円」がない
    const first = rows[0];
    const isHeader = first.length >= 2 && (first.every((c) => c.th) || first.every((c) => !text(c.html).includes("円") && !text(c.html).startsWith("■")));
    if (isHeader && first.length >= 3) {
      const heads = first.map((c) => oneLine(text(c.html)));
      const pairs = heads.length % 2 === 0 && heads.every((h, i) => h === heads[i % 2]);
      for (const row of rows.slice(1)) {
        if (pairs) {
          for (let i = 0; i + 1 < row.length; i += 2) push(heading, text(row[i].html), row[i + 1].html);
        } else {
          const label = oneLine(text(row[0]?.html ?? ""));
          // 列をまとめた行（例：針代｜4,000円／1本）は見出しを付けない
          if (row.length < heads.length) {
            if (row[1]) push(heading, label, row[1].html);
            continue;
          }
          for (let i = 1; i < row.length; i++) push(heading, heads[i] ? `${label} ${heads[i]}` : label, row[i].html);
        }
      }
      continue;
    }

    // 2列の表：分類（■）・小見出し・項目
    let category = "";
    let sub = "";
    for (const row of isHeader ? rows.slice(1) : rows) {
      if (row.length === 0) continue;
      const label = text(row[0].html);
      const price = row[1] ? oneLine(text(row[1].html)) : "";
      const lines = label.split("\n");
      if (lines[0].startsWith("■")) {
        category = lines[0].replace(/^■+/, "").trim();
        sub = oneLine(lines.slice(1).join(" "));
        if (!price) continue;
      }
      if (!price) {
        // 値段のない短い行は小見出し。長い行は説明なので飛ばす
        if (label.length <= 25) sub = oneLine(label);
        continue;
      }
      const name = lines[0].startsWith("■") ? sub || category : sub ? `${sub} ${oneLine(label)}` : oneLine(label);
      push(category, name, row[1].html);
    }
  }
  return out;
}

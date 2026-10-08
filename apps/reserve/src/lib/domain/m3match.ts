/**
 * M3 の患者一覧（CSV）と予約カレンダーの患者を照合する。ブラウザの中だけで動き、CSV はどこへも送らない。
 * フリガナ・生年月日・電話番号・カルテ番号のうち 2 つ以上が合い、候補が 1 人に決まった人だけを採る
 */

export interface M3Columns {
  name: number;
  kana: number;
  birth: number;
  phone: number[];
  chart: number;
}

export interface M3Candidate {
  id: string;
  name: string;
  kana: string;
  birthDate?: string;
  phone?: string;
  chartNo: string;
  m3ChartNo?: string;
}

export interface M3Fill {
  id: string;
  /** いまの（カタカナの）氏名。確認の表示用 */
  before: string;
  name: string;
  kana?: string;
  birthDate?: string;
  phone?: string;
  m3ChartNo?: string;
}

export interface M3MatchResult {
  fills: M3Fill[];
  ambiguous: number;
  notFound: number;
}

/** 文字コードを見分けて読む（UTF-8 でなければ Shift_JIS） */
export function decodeCsv(buf: ArrayBuffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf).replace(/^﻿/, "");
  } catch {
    return new TextDecoder("shift_jis").decode(buf);
  }
}

/** CSV を行ごとの配列に（"…" の中のカンマ・改行・"" に対応） */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some((x) => x !== "")) rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x !== "")) rows.push(row);
  return rows;
}

/** 1 行目の項目名から、どの列が何かを当てる（見つからなければ -1） */
export function guessColumns(header: string[]): M3Columns {
  const h = header.map((x) => x.normalize("NFKC").replace(/\s/g, ""));
  const find = (re: RegExp, not?: RegExp) => h.findIndex((x) => re.test(x) && !(not && not.test(x)));
  const phone = h.map((x, i) => (/電話|TEL|携帯|連絡先/i.test(x) && !/FAX/i.test(x) ? i : -1)).filter((i) => i >= 0);
  return {
    kana: find(/カナ|フリガナ|ふりがな|よみ|ヨミ/),
    name: find(/氏名|患者名|名前|漢字/, /カナ|フリガナ|ふりがな|よみ|ヨミ|英|ローマ/),
    birth: find(/生年月日|誕生日|生年/),
    phone,
    chart: find(/カルテ|患者番号|患者ID|患者コード|^ID$|^番号$/i),
  };
}

const HAS_KANJI = /\p{Script=Han}/u;

/** 氏名の比べ方：全角半角をそろえ、ひらがなをカタカナに、空白・中黒を除く */
export function kanaKey(v?: string): string {
  return (v ?? "")
    .normalize("NFKC")
    .replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60))
    .replace(/[\s　・･.．,，]/g, "");
}

export function digitsKey(v?: string): string {
  return (v ?? "").normalize("NFKC").replace(/\D/g, "");
}

/** 番号の比べ方：数字だけにして先頭の 0 を落とす */
export function chartKey(v?: string): string {
  return digitsKey(v).replace(/^0+/, "");
}

const ERA: Record<string, number> = { M: 1867, 明: 1867, T: 1911, 大: 1911, S: 1925, 昭: 1925, H: 1988, 平: 1988, R: 2018, 令: 2018 };

/** 生年月日を YYYY-MM-DD に（1990/1/2・19900102・平成2年1月2日・H2.1.2 など）。読めなければ空 */
export function birthKey(v?: string): string {
  const s = (v ?? "").normalize("NFKC").trim();
  if (!s) return "";
  const pad = (y: number, m: number, d: number) =>
    y > 1850 && y < 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31 ? `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}` : "";
  let m = s.match(/^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})/);
  if (m) return pad(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return pad(+m[1], +m[2], +m[3]);
  m = s.match(/^(明治|大正|昭和|平成|令和|[MTSHR])\s*(\d{1,2}|元)[-/.年](\d{1,2})[-/.月](\d{1,2})/i);
  if (m) {
    const base = ERA[m[1][0].toUpperCase()] ?? ERA[m[1][0]];
    return base ? pad(base + (m[2] === "元" ? 1 : +m[2]), +m[3], +m[4]) : "";
  }
  return "";
}

/** 照合する。rows は 1 行目（項目名）を除いた CSV の行 */
export function matchM3(candidates: M3Candidate[], rows: string[][], col: M3Columns): M3MatchResult {
  const index = { kana: new Map<string, number[]>(), birth: new Map<string, number[]>(), phone: new Map<string, number[]>(), chart: new Map<string, number[]>() };
  const add = (m: Map<string, number[]>, k: string, i: number) => {
    if (!k) return;
    const a = m.get(k);
    if (a) {
      if (a[a.length - 1] !== i) a.push(i);
    } else m.set(k, [i]);
  };
  const cell = (r: string[], i: number) => (i >= 0 ? (r[i] ?? "").trim() : "");
  rows.forEach((r, i) => {
    add(index.kana, kanaKey(cell(r, col.kana)), i);
    add(index.birth, birthKey(cell(r, col.birth)), i);
    for (const p of col.phone) {
      const d = digitsKey(cell(r, p));
      if (d.length >= 9) add(index.phone, d, i);
    }
    add(index.chart, chartKey(cell(r, col.chart)), i);
  });

  const out: M3MatchResult = { fills: [], ambiguous: 0, notFound: 0 };
  for (const c of candidates) {
    const score = new Map<number, number>();
    const bump = (list: number[] | undefined) => {
      for (const i of new Set(list ?? [])) score.set(i, (score.get(i) ?? 0) + 1);
    };
    const kanaKeys = new Set([kanaKey(c.kana), kanaKey(c.name)].filter(Boolean));
    bump([...kanaKeys].flatMap((k) => index.kana.get(k) ?? []));
    if (c.birthDate) bump(index.birth.get(c.birthDate));
    const ph = digitsKey(c.phone);
    if (ph.length >= 9) bump(index.phone.get(ph));
    bump([...new Set([chartKey(c.chartNo), chartKey(c.m3ChartNo)].filter(Boolean))].flatMap((k) => index.chart.get(k) ?? []));

    let best = 0;
    let bestRows: number[] = [];
    for (const [i, n] of score) {
      if (n > best) {
        best = n;
        bestRows = [i];
      } else if (n === best) bestRows.push(i);
    }
    if (best < 2) {
      out.notFound++;
      continue;
    }
    if (bestRows.length !== 1) {
      out.ambiguous++;
      continue;
    }
    const r = rows[bestRows[0]];
    const name = cell(r, col.name).normalize("NFKC").replace(/[\s　]+/g, " ").trim();
    if (!HAS_KANJI.test(name)) {
      out.notFound++;
      continue;
    }
    const kana = cell(r, col.kana).normalize("NFKC").replace(/[\s　]+/g, " ").trim();
    const birth = birthKey(cell(r, col.birth));
    const phone = col.phone.map((p) => cell(r, p).normalize("NFKC")).find((x) => digitsKey(x).length >= 9);
    const chart = cell(r, col.chart).normalize("NFKC");
    out.fills.push({
      id: c.id,
      before: c.name,
      name,
      ...(kana && { kana }),
      ...(birth && { birthDate: birth }),
      ...(phone && { phone }),
      ...(chart && { m3ChartNo: chart }),
    });
  }
  return out;
}

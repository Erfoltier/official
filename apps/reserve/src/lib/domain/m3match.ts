/**
 * 電子カルテなど（M3 に限らない。他院向けにもそのまま使う）の患者一覧（CSV）と予約カレンダーの患者を照合する。列は 1 行目の項目名から当て、画面で選び直せる。ブラウザの中だけで動き、CSV はどこへも送らない。
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
  /** 別の表記（旧姓・漢字など） */
  nameAlt?: string;
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

/**
 * 姓と名（フリガナの姓と名）が別の列に分かれている CSV なら、つなげた列を末尾に足す（「カナ姓」「カナ名」→「フリガナ（姓名）」など）。
 * 足した列は guessColumns が優先して選ぶ
 */
export function joinSplitNameColumns(header: string[], rows: string[][]): { header: string[]; rows: string[][] } {
  const h = header.map((x) => x.normalize("NFKC").replace(/\s/g, ""));
  const idx = (re: RegExp, not?: RegExp) => h.findIndex((x) => re.test(x) && !(not && not.test(x)));
  const kanaRe = /カナ|フリガナ|ふりがな|よみ|ヨミ/;
  const pairs: [string, number, number][] = [];
  const ks = idx(/セイ|(カナ|フリガナ|ふりがな|よみ|ヨミ).*姓|姓.*(カナ|フリガナ|ふりがな|よみ|ヨミ)/);
  const km = idx(/メイ|(カナ|フリガナ|ふりがな|よみ|ヨミ).*名|名.*(カナ|フリガナ|ふりがな|よみ|ヨミ)/, /氏名|姓名|患者名/);
  if (ks >= 0 && km >= 0 && ks !== km) pairs.push(["フリガナ（姓名）", ks, km]);
  const ns = idx(/^(患者)?(漢字)?姓$|^(患者)?(漢字)?氏$|漢字姓/, kanaRe);
  const nm = idx(/^(患者)?(漢字)?名$|漢字名/, kanaRe);
  if (ns >= 0 && nm >= 0 && ns !== nm) pairs.push(["氏名（姓名）", ns, nm]);
  if (!pairs.length) return { header, rows };
  return {
    header: [...header, ...pairs.map((p) => p[0])],
    rows: rows.map((r) => [...r, ...pairs.map(([, a, b]) => `${(r[a] ?? "").trim()} ${(r[b] ?? "").trim()}`.trim())]),
  };
}

/** 1 行目の項目名から、どの列が何かを当てる（見つからなければ -1）。姓名をつなげて足した列があればそれを選ぶ */
export function guessColumns(header: string[]): M3Columns {
  const h = header.map((x) => x.normalize("NFKC").replace(/\s/g, ""));
  const find = (re: RegExp, not?: RegExp) => h.findIndex((x) => re.test(x) && !(not && not.test(x)));
  const phone = h.map((x, i) => (/電話|TEL|携帯|連絡先/i.test(x) && !/FAX/i.test(x) ? i : -1)).filter((i) => i >= 0);
  const joinedKana = h.indexOf("フリガナ(姓名)");
  const joinedName = h.indexOf("氏名(姓名)");
  return {
    kana: joinedKana >= 0 ? joinedKana : find(/カナ|フリガナ|ふりがな|よみ|ヨミ/),
    name: joinedName >= 0 ? joinedName : find(/氏名|患者名|名前|漢字/, /カナ|フリガナ|ふりがな|よみ|ヨミ|英|ローマ/),
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

const VARIANT: Record<string, string> = {
  髙: "高", 﨑: "崎", 嵜: "崎", 邊: "辺", 邉: "辺", 齋: "斎", 齊: "斉", 澤: "沢", 濱: "浜", 嶋: "島", 嶌: "島", 廣: "広", 國: "国", 櫻: "桜",
  眞: "真", 惠: "恵", 德: "徳", 瀨: "瀬", 冨: "富", 籠: "篭", 槇: "槙", 曻: "昇",
};
const SMALL: Record<string, string> = { ァ: "ア", ィ: "イ", ゥ: "ウ", ェ: "エ", ォ: "オ", ッ: "ツ", ャ: "ヤ", ュ: "ユ", ョ: "ヨ", ヮ: "ワ", ヵ: "カ", ヶ: "ケ" };

/**
 * 表記ゆれを寄せた氏名の比べ方：空白・記号・敬称を除き、ひらがなをカタカナに、小さい字を大きく、濁点・長音を落とし、旧字を新字に。
 * 「ユウコ／ユーコ」「サイトウ／サイトオ」までは寄せない（別人のこともあるため）
 */
export function looseKey(v?: string): string {
  let s = kanaKey(v).replace(/(様|さま|サマ|殿|さん)$/u, "").replace(/[()（）［］\[\]「」"'’`~〜\-－ー‐]/g, "");
  s = [...s].map((c) => VARIANT[c] ?? SMALL[c] ?? c).join("");
  return s.normalize("NFD").replace(/[\u3099\u309A]/g, "").normalize("NFC").replace(/ヲ/g, "オ");
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

// ---- 未確認の問診票を、M3 の患者一覧で照合する ----

export interface M3Questionnaire {
  id: string;
  name: string;
  kana?: string;
  birthDate?: string;
  phone?: string;
}

/** 照合の結果1件。patientId があればいる患者へ、create があれば M3 の行から新しく登録して結びつける */
export interface M3QuestionnaireLink {
  questionnaireId: string;
  /** 問診票の氏名（確認の表示用） */
  label: string;
  /** 照合に使った M3 のフリガナ（確認の表示用） */
  m3Kana?: string;
  m3ChartNo: string;
  patientId?: string;
  create?: { name: string; kana: string; birthDate?: string; phone?: string };
  /** 同じ人と見られる患者が予約カレンダーに複数いた（M3 番号で1人に決めた／番号がなく最も古い患者に決めた） */
  duplicates?: number;
  /** いる患者の見つけ方：number＝M3 番号／nameBirth＝氏名＋生年月日・電話／nameOnly＝氏名だけ（M3 に同姓同名がいないとき）／loose＝表記ゆれを寄せた氏名 */
  via?: "number" | "nameBirth" | "nameOnly" | "loose";
}

export interface M3QuestionnaireResult {
  /** いる患者に結びつく */
  links: M3QuestionnaireLink[];
  /** 予約カレンダーにいないので、M3 の行から新しく登録して結びつく */
  creates: M3QuestionnaireLink[];
  /** M3 で候補が2人以上（決められない） */
  ambiguous: number;
  /** M3 にも見つからない（来院していない・名前や生年月日の書き違いなど） */
  notFound: number;
}

/**
 * 問診票（氏名かフリガナ＋生年月日か電話）で M3 の行を1つに決め、その M3 番号・氏名・フリガナで予約カレンダーの患者を探す。
 * 予約カレンダーの患者が複数（重複）なら、M3 番号を持つ患者、なければ診察券番号の若い患者に結びつける
 */
export function matchQuestionnairesM3(qs: M3Questionnaire[], patients: M3Candidate[], rows: string[][], col: M3Columns): M3QuestionnaireResult {
  const cell = (r: string[], i: number) => (i >= 0 ? (r[i] ?? "").trim() : "");
  const clean = (v: string) => v.normalize("NFKC").replace(/[\s　]+/g, " ").trim();
  const add = (m: Map<string, number[]>, k: string, i: number) => {
    if (!k) return;
    const a = m.get(k);
    if (a) {
      if (a[a.length - 1] !== i) a.push(i);
    } else m.set(k, [i]);
  };
  const byName = new Map<string, number[]>();
  rows.forEach((r, i) => {
    add(byName, kanaKey(cell(r, col.name)), i);
    add(byName, kanaKey(cell(r, col.kana)), i);
  });
  const byLoose = new Map<string, number[]>();
  rows.forEach((r, i) => {
    add(byLoose, looseKey(cell(r, col.name)), i);
    add(byLoose, looseKey(cell(r, col.kana)), i);
  });
  const rowPhones = (r: string[]) => col.phone.map((p) => digitsKey(cell(r, p))).filter((d) => d.length >= 10);

  const pByChart = new Map<string, M3Candidate[]>();
  const pByName = new Map<string, M3Candidate[]>();
  const pByLoose = new Map<string, M3Candidate[]>();
  const push = <T,>(m: Map<string, T[]>, k: string, v: T) => {
    if (!k) return;
    const a = m.get(k);
    if (a) {
      if (!a.includes(v)) a.push(v);
    } else m.set(k, [v]);
  };
  for (const p of patients) {
    push(pByChart, chartKey(p.m3ChartNo), p);
    push(pByName, kanaKey(p.name), p);
    push(pByName, kanaKey(p.kana), p);
    push(pByName, kanaKey(p.nameAlt), p);
    for (const k of [looseKey(p.name), looseKey(p.kana), looseKey(p.nameAlt)]) push(pByLoose, k, p);
  }
  const older = (a: M3Candidate, b: M3Candidate) => (Number(chartKey(a.chartNo) || 1e12) - Number(chartKey(b.chartNo) || 1e12)) || a.id.localeCompare(b.id);

  const out: M3QuestionnaireResult = { links: [], creates: [], ambiguous: 0, notFound: 0 };
  for (const q of qs) {
    const keys = [...new Set([kanaKey(q.name), kanaKey(q.kana)].filter(Boolean))];
    const tel = digitsKey(q.phone);
    const hits = [...new Set(keys.flatMap((k) => byName.get(k) ?? []))].filter((i) => {
      const r = rows[i];
      return (q.birthDate && birthKey(cell(r, col.birth)) === q.birthDate) || (tel.length >= 10 && rowPhones(r).includes(tel));
    });
    if (hits.length === 0) {
      out.notFound++;
      continue;
    }
    if (hits.length > 1) {
      out.ambiguous++;
      continue;
    }
    const r = rows[hits[0]];
    const m3 = cell(r, col.chart).normalize("NFKC");
    const name = clean(cell(r, col.name)) || clean(q.name);
    const kana = clean(cell(r, col.kana));
    const birth = birthKey(cell(r, col.birth)) || q.birthDate;
    const phone = col.phone.map((p) => clean(cell(r, p))).find((x) => digitsKey(x).length >= 10) || q.phone;
    // 予約カレンダーの患者：まず M3 番号、なければ M3 の氏名・フリガナで探す
    let found = m3 ? (pByChart.get(chartKey(m3)) ?? []) : [];
    let via: M3QuestionnaireLink["via"] = "number";
    if (found.length === 0) {
      const nk = [...new Set([kanaKey(name), kanaKey(kana), ...keys].filter(Boolean))];
      const rt = [...new Set([...rowPhones(r), tel].filter((d) => d.length >= 10))];
      // 生年月日がはっきり違う患者は別人として外す
      const sameName = [...new Set(nk.flatMap((k) => pByName.get(k) ?? []))].filter((p) => !(birth && p.birthDate && p.birthDate !== birth));
      const strong = sameName.filter((p) => (birth && p.birthDate === birth) || rt.includes(digitsKey(p.phone)) || (m3 && chartKey(p.chartNo) === chartKey(m3)));
      if (strong.length) {
        found = strong;
        via = "nameBirth";
      } else if (sameName.length) {
        // 予約カレンダーの患者に生年月日・電話がない（Airリザーブから来た患者など）ときは、氏名だけで決める。
        // ただし M3 に同じ氏名・フリガナの人がほかにいない（同姓同名がいない）ときだけ
        const m3Same = new Set(nk.flatMap((k) => byName.get(k) ?? []));
        if (m3Same.size === 1) {
          found = sameName;
          via = "nameOnly";
        } else {
          out.ambiguous++;
          continue;
        }
      } else {
        // 表記ゆれ（空白・小さい字・濁点・長音・旧字など）を寄せて、もう一度探す。M3 に同じく寄せた人がほかにいないときだけ
        const lk = [...new Set([looseKey(name), looseKey(kana), looseKey(q.name), looseKey(q.kana)].filter(Boolean))];
        const loose = [...new Set(lk.flatMap((k) => pByLoose.get(k) ?? []))].filter((p) => !(birth && p.birthDate && p.birthDate !== birth));
        if (loose.length) {
          if (new Set(lk.flatMap((k) => byLoose.get(k) ?? [])).size === 1) {
            found = loose;
            via = "loose";
          } else {
            out.ambiguous++;
            continue;
          }
        }
      }
    }
    const base = { questionnaireId: q.id, label: q.name, m3ChartNo: m3, ...(kana && { m3Kana: kana }) };
    if (found.length === 0) {
      out.creates.push({ ...base, create: { name, kana, ...(birth && { birthDate: birth }), ...(phone && { phone }) } });
      continue;
    }
    const pick = found.find((p) => m3 && chartKey(p.m3ChartNo) === chartKey(m3)) ?? [...found].sort(older)[0];
    out.links.push({ ...base, patientId: pick.id, via, ...(found.length > 1 && { duplicates: found.length }) });
  }
  return out;
}

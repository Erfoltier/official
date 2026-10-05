/**
 * 取り込んだ表（CSV・Excel・Googleスプレッドシート）を、メニュー・料金表の項目に直す。
 * 見出しの言葉で列を見分けるので、列の順番は自由（書式のひな形は MENU_TEMPLATE・PRICE_TEMPLATE）。
 */
import type { Lane, MenuDuration } from "./types";
import { findHeader, parseMinutes, parseYenCell, type Table } from "./importFiles";
import { searchKey } from "./text";

export const MENU_TEMPLATE: string[][] = [
  ["メニュー名", "略称", "時間（分）", "最短（分）", "最長（分）", "レーン", "色", "料金（税込）", "予約の選択肢"],
  ["ボトックス 額", "BTX額", "15", "", "", "メイン", "#8b5cf6", "22000", "出す"],
  ["ハイフ 全顔", "HIFU", "45", "30", "90", "1番・3番", "#ef4444", "", "出す"],
  ["カウンセリング", "相談", "15", "", "", "すべて", "", "0", "出す"],
];

export const PRICE_TEMPLATE: string[][] = [
  ["分類", "項目名", "料金（税込）", "表示（任意）"],
  ["シミ取り", "Qスイッチルビーレーザー 〜10mm", "11000", ""],
  ["シミ取り", "顔まとめ取り", "", "要相談"],
  ["商品（スキンケア）", "日焼け止め SPF50", "3300", ""],
];

const MENU_WORDS = {
  name: /メニュー名|^メニュー$|施術名|^名前$/,
  abbr: /略称/,
  minutes: /^時間|所要|時間（分）|時間\(分\)/,
  min: /最短/,
  max: /最長/,
  lanes: /レーン|担当/,
  color: /^色|カラー/,
  price: /料金|値段|価格/,
  active: /選択肢|表示|出す/,
};

const PALETTE = ["#2563eb", "#ef4444", "#14b8a6", "#8b5cf6", "#f59e0b", "#ec4899", "#10b981", "#0ea5e9", "#a16207", "#64748b"];

export interface MenuImportRow {
  line: number;
  name: string;
  input?: {
    name: string;
    abbr?: string;
    duration: MenuDuration;
    defaultMinutes: number;
    laneIds: string[];
    color: string;
    priceYen: number | null;
    active: boolean;
  };
  error?: string;
}

const cell = (row: string[], i: number) => (i >= 0 ? (row[i] ?? "").trim() : "");

export function menuRowsFromTable(table: Table, lanes: Lane[]): MenuImportRow[] | { error: string } {
  const head = findHeader(table, MENU_WORDS);
  if (!head || head.cols.name < 0) return { error: "見出しの行（メニュー名・時間など）が見つかりません。書式のひな形に合わせてください" };
  const c = head.cols;
  const laneOf = (word: string) => lanes.find((l) => [l.shortName, l.name].some((n) => searchKey(n) === searchKey(word) || searchKey(n).startsWith(searchKey(word))));
  const out: MenuImportRow[] = [];
  for (let r = head.row + 1; r < table.length; r++) {
    const row = table[r];
    const name = cell(row, c.name);
    if (!name) continue;
    const line = r + 1;
    const fail = (error: string) => out.push({ line, name, error });
    const minutes = parseMinutes(cell(row, c.minutes));
    const min = parseMinutes(cell(row, c.min));
    const max = parseMinutes(cell(row, c.max));
    let duration: MenuDuration;
    let defaultMinutes: number;
    if (min !== null && max !== null && min !== max) {
      if (min > max) {
        fail("最短が最長より長くなっています");
        continue;
      }
      duration = { kind: "range", min, max, step: 5 };
      defaultMinutes = minutes !== null && minutes >= min && minutes <= max ? minutes : min;
    } else {
      const m = minutes ?? min ?? max;
      if (m === null) {
        fail("時間（分）がありません");
        continue;
      }
      duration = { kind: "fixed", minutes: m };
      defaultMinutes = m;
    }
    const laneText = cell(row, c.lanes);
    const laneIds: string[] = [];
    if (laneText && !/^(すべて|全部|全て|全レーン)$/.test(laneText)) {
      const missing: string[] = [];
      for (const w of laneText.split(/[・,、/／\s]+/).filter(Boolean)) {
        const l = laneOf(w);
        if (l) laneIds.push(l.id);
        else missing.push(w);
      }
      if (missing.length) {
        fail(`レーン「${missing.join("・")}」が見つかりません`);
        continue;
      }
    }
    const price = parseYenCell(cell(row, c.price));
    if (price === undefined) {
      fail("料金が数字ではありません");
      continue;
    }
    const color = cell(row, c.color).toLowerCase();
    out.push({
      line,
      name,
      input: {
        name,
        ...(cell(row, c.abbr) && { abbr: cell(row, c.abbr) }),
        duration,
        defaultMinutes,
        laneIds: [...new Set(laneIds)],
        color: /^#[0-9a-f]{6}$/.test(color) ? color : PALETTE[out.length % PALETTE.length],
        priceYen: price,
        active: !/出さない|非表示|×|いいえ|^0$|false/i.test(cell(row, c.active)),
      },
    });
  }
  return out;
}

const PRICE_WORDS = {
  category: /分類|カテゴリ|区分/,
  name: /項目|商品名|施術名|メニュー|^名前$/,
  price: /料金|値段|価格/,
  text: /表示|備考/,
};

export interface PriceImportRow {
  line: number;
  item?: { category: string; name: string; priceYen: number | null; priceText?: string };
  name: string;
  error?: string;
}

export function priceRowsFromTable(table: Table): PriceImportRow[] | { error: string } {
  const head = findHeader(table, PRICE_WORDS);
  if (!head || head.cols.name < 0) return { error: "見出しの行（分類・項目名・料金）が見つかりません。書式のひな形に合わせてください" };
  const c = head.cols;
  const out: PriceImportRow[] = [];
  let category = "";
  for (let r = head.row + 1; r < table.length; r++) {
    const row = table[r];
    // 分類は、空なら上の行と同じ
    category = cell(row, c.category) || category;
    const name = cell(row, c.name);
    if (!name) continue;
    const price = parseYenCell(cell(row, c.price));
    const text = cell(row, c.text);
    if (price === undefined) {
      out.push({ line: r + 1, name, error: "料金が数字ではありません（値段がないときは空にして、表示に「要相談」など）" });
      continue;
    }
    out.push({
      line: r + 1,
      name,
      item: { category: (category || "その他").slice(0, 100), name: name.slice(0, 200), priceYen: price, ...(text && { priceText: text.slice(0, 100) }) },
    });
  }
  return out;
}

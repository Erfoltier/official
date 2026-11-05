/**
 * LINE予約フォーム（予約申請）の文面を読み取る。
 * 「項目名：値」の行が並んだ文面から、患者の情報・予約申請ID・希望日などを取り出す。
 * 項目名の揺れ（全角／半角のコロン、空白）に強くし、知らない項目はメモに回す。
 */

export interface BookingRequest {
  requestId?: string;
  name?: string;
  kana?: string;
  /** YYYY-MM-DD */
  birthDate?: string;
  phone?: string;
  gender?: string;
  /** YYYY-MM-DD */
  desiredDate?: string;
  desiredTime?: string;
  visitType?: string;
  /** 予約メモに入れる文（希望メニュー・相談事項など） */
  memo: string;
}

/** 予約申請IDの形（英数字・ハイフン・下線、40文字まで） */
export const REQUEST_ID_RE = /^[A-Za-z0-9_-]{1,40}$/;

const EMPTY = new Set(["", "なし", "無し", "記載なし", "特になし", "ー", "-", "−"]);

function jpDate(s: string): string | undefined {
  const m = s.normalize("NFKC").match(/(\d{4})\s*[年/.-]\s*(\d{1,2})\s*[月/.-]\s*(\d{1,2})/);
  if (!m) return undefined;
  const iso = `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  const d = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso ? iso : undefined;
}

/** メモに残す項目（表示名） */
const MEMO_KEYS: [RegExp, string][] = [
  [/受診区分/, "受診区分"],
  [/保険通院歴|通院歴/, "保険通院歴"],
  [/当日施術/, "当日施術希望"],
  [/希望治療|お悩み|メニュー/, "希望・お悩み"],
  [/部位|個数/, "部位・個数"],
  [/相談/, "相談"],
  [/紹介/, "紹介者"],
  [/性別/, "性別"],
];

/** 予約メモの最大文字数（サーバーの上限 3000 より少し短く。装飾のタグの分を残す） */
export const MEMO_MAX = 2500;

/** フォームの項目名（この形の「項目名：」で始まる行だけを新しい項目とみなす。それ以外の行は直前の項目の続き） */
const KNOWN_KEY = /予約申請ID|申請ID|氏名|お名前|カナ|フリガナ|ふりがな|生年月日|電話|希望予約日|希望日|時間帯|希望時間|受診区分|通院歴|当日施術|希望治療|お悩み|メニュー|部位|個数|相談|紹介|性別|今回の内容/;

/** 「項目名：値」に分ける。値が複数行（相談内容など）のときは、次の項目名の行までを1つの値にまとめる */
function splitItems(text: string): { key: string; value: string }[] {
  const items: { key: string; value: string }[] = [];
  let cur: { key: string; lines: string[] } | null = null;
  const flush = () => {
    if (cur) items.push({ key: cur.key, value: cur.lines.join("\n").replace(/\n+$/, "").trim() });
    cur = null;
  };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const m = line.match(/^([^：:]{1,30})[：:]\s*(.*)$/);
    const key = m ? m[1].replace(/\s/g, "") : "";
    if (m && (KNOWN_KEY.test(key) || !cur)) {
      flush();
      cur = { key, lines: [m[2].trim()] };
    } else if (cur) {
      // 続きの行（空行も、値の途中の改行として残す。末尾の空行は flush で落とす）
      cur.lines.push(line);
    }
  }
  flush();
  return items;
}

export function parseBookingRequest(text: string): BookingRequest {
  const out: BookingRequest = { memo: "" };
  const memo: string[] = [];
  let wish = "";
  for (const { key, value: full } of splitItems(text)) {
    // 項目のあいだの空行は値に入れない（値の途中の空行は1つにまとめる）
    const value = full.replace(/\n{2,}/g, "\n");
    const first = value.split("\n")[0];
    if (/予約申請ID|申請ID/.test(key)) {
      const id = first.normalize("NFKC").replace(/\s/g, "");
      if (REQUEST_ID_RE.test(id)) out.requestId = id;
    } else if (/漢字氏名|^氏名$|^お名前$/.test(key)) {
      if (first) out.name = first;
    } else if (/カナ|フリガナ|ふりがな/.test(key)) {
      if (first) out.kana = first;
    } else if (/生年月日/.test(key)) {
      out.birthDate = jpDate(first);
    } else if (/電話/.test(key)) {
      const digits = first.normalize("NFKC").replace(/[^\d]/g, "");
      if (digits.length >= 10 && digits.length <= 11) out.phone = digits;
    } else if (/希望予約日|希望日/.test(key)) {
      out.desiredDate = jpDate(first);
      wish = first;
    } else if (/時間帯|希望時間/.test(key)) {
      out.desiredTime = first;
    } else {
      if (/性別/.test(key) && first) out.gender = first;
      if (/受診区分/.test(key) && first) out.visitType = first;
      const label = MEMO_KEYS.find(([re]) => re.test(key))?.[1] ?? key;
      if (!EMPTY.has(value)) memo.push(`${label}：${value}`);
    }
  }
  const head = ["LINE予約申請", wish && `希望：${wish}${out.desiredTime ? ` ${out.desiredTime}` : ""}`].filter(Boolean).join("／");
  // 予約メモの上限（サーバー 3000 文字）に収める。フォームの入力欄の合計（最大約2,000文字）は省略せずに入る
  out.memo = [head, ...memo].join("\n").slice(0, MEMO_MAX);
  return out;
}

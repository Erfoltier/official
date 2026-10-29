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

export function parseBookingRequest(text: string): BookingRequest {
  const out: BookingRequest = { memo: "" };
  const memo: string[] = [];
  let wish = "";
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const m = line.match(/^([^：:]{1,30})[：:]\s*(.*)$/);
    if (!m) continue;
    const key = m[1].replace(/\s/g, "");
    const value = m[2].trim();
    if (/予約申請ID|申請ID/.test(key)) {
      const id = value.normalize("NFKC").replace(/\s/g, "");
      if (REQUEST_ID_RE.test(id)) out.requestId = id;
    } else if (/漢字氏名|^氏名$|^お名前$/.test(key)) {
      if (value) out.name = value;
    } else if (/カナ|フリガナ|ふりがな/.test(key)) {
      if (value) out.kana = value;
    } else if (/生年月日/.test(key)) {
      out.birthDate = jpDate(value);
    } else if (/電話/.test(key)) {
      const digits = value.normalize("NFKC").replace(/[^\d]/g, "");
      if (digits.length >= 10 && digits.length <= 11) out.phone = digits;
    } else if (/希望予約日|希望日/.test(key)) {
      out.desiredDate = jpDate(value);
      wish = value;
    } else if (/時間帯|希望時間/.test(key)) {
      out.desiredTime = value;
    } else {
      if (/性別/.test(key) && value) out.gender = value;
      if (/受診区分/.test(key) && value) out.visitType = value;
      const label = MEMO_KEYS.find(([re]) => re.test(key))?.[1] ?? key;
      if (!EMPTY.has(value)) memo.push(`${label}：${value}`);
    }
  }
  const head = ["LINE予約申請", wish && `希望：${wish}${out.desiredTime ? ` ${out.desiredTime}` : ""}`].filter(Boolean).join("／");
  out.memo = [head, ...memo].join("\n").slice(0, 500);
  return out;
}

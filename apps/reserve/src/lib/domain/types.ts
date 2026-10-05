/**
 * 予約管理のドメインモデル。
 *
 * 日時は常に「タイムゾーン付きのISO 8601文字列」（例: 2026-10-07T10:00:00+09:00）で持つ。
 * 外部連携（前日リマインド等）がそのまま読める形にするため、表示用の分単位の値は
 * 画面側で都度計算し、保存はしない。
 */

export type LaneId = string;
export type MenuId = string;
export type PatientId = string;
export type ReservationId = string;

/** 予約カレンダーの列（施術レーン・部屋・機器）。Airリザーブの「リソース」にあたる。 */
export interface Lane {
  id: LaneId;
  name: string;
  /** 狭い画面用の短い名前 */
  shortName: string;
  order: number;
  /** false ならカレンダーに出さない（過去の予約のために削除はしない） */
  active: boolean;
}

/**
 * 所要時間の決め方。Airリザーブの「提供時間」と同じ2種類。
 * - fixed: 固定（例: 20分）
 * - range: 最小〜最大の間で、刻みごとに予約ごとに決める（例: 5〜60分・5分刻み）
 */
export type MenuDuration =
  | { kind: "fixed"; minutes: number }
  | { kind: "range"; min: number; max: number; step: number };

/** 予約メニュー（施術内容）。Airリザーブの「メニュー」にあたる。 */
export interface Menu {
  id: MenuId;
  name: string;
  /** 短い枠に表示する略称（例: ボトックス【再診】 → BTX再） */
  abbr: string;
  duration: MenuDuration;
  /** 予約登録時に最初に入る時間（分）。range のときは min〜max の範囲内 */
  defaultMinutes: number;
  /** 開始時刻の刻み（分）。Airリザーブの「開始時間単位」 */
  startStepMin: number;
  /** 税込料金（円）。設定しない場合は null */
  priceYen: number | null;
  /** 同時に受け付けられる予約数。設定しない場合は null */
  capacity: number | null;
  /** このメニューを行えるレーン。空ならどのレーンでも可 */
  laneIds: LaneId[];
  /** カレンダー上の色（#rrggbb） */
  color: string;
  order: number;
  /** false なら予約登録の選択肢に出さない（過去の予約の表示には使う） */
  active: boolean;
}

/** メニューの所要時間の候補（分） */
export function menuDurationOptions(d: MenuDuration): number[] {
  if (d.kind === "fixed") return [d.minutes];
  const out: number[] = [];
  for (let m = d.min; m <= d.max; m += d.step) out.push(m);
  return out;
}

export interface Patient {
  id: PatientId;
  /** 診察券番号など院内の番号 */
  chartNo: string;
  /**
   * 氏名。漢字・ひらがな・カタカナ・ローマ字を自由に混ぜてよい
   * （例: 「山田 Anna」「さくら 田中」「LEE Min」）。
   */
  name: string;
  /** フリガナ（ひらがな・カタカナどちらでも可） */
  kana: string;
  /** 別の表記（ローマ字、旧姓、通称など）。検索に使う */
  nameAlt?: string;
  phone?: string;
  email?: string;
  /**
   * LINEのユーザーID。患者本人がQRコードで紐付けを完了したときだけ入る。
   * 電話番号や氏名の一致で自動的に入れてはいけない（誤送信防止）。
   */
  lineUserId?: string;
  /** 生年月日（YYYY-MM-DD） */
  birthDate?: string;
  /** 注意事項（アレルギー等）がある患者。予約表に「!」を出す */
  caution?: boolean;
  /** 注意事項の内容 */
  cautionNote?: string;
  /** 院内メモ（施術の好み・対応の注意など） */
  memo?: string;
  /** 楽観的排他制御用。更新のたびに増える */
  version: number;
  updatedAt?: string;
}

/** 患者情報の変更履歴。値そのものは残さず、いつ・どの項目を変えたかだけ記録する */
export interface PatientChange {
  at: string;
  fields: string[];
}

/** 患者の編集画面に渡すデータ */
export interface PatientDetail {
  patient: Patient;
  /** 予約履歴（新しい順、キャンセル含む） */
  reservations: { id: string; startAt: string; endAt: string; status: ReservationStatus; menuNames: string[]; laneName: string }[];
  history: PatientChange[];
}

export const RESERVATION_STATUSES = [
  "booked", // 予約済み
  "arrived", // 来院済み
  "in_treatment", // 施術中
  "checkout", // 会計待ち
  "done", // 完了
  "cancelled", // キャンセル
  "no_show", // 無断キャンセル
] as const;

export type ReservationStatus = (typeof RESERVATION_STATUSES)[number];

export const STATUS_LABEL: Record<ReservationStatus, string> = {
  booked: "予約",
  arrived: "来院",
  in_treatment: "施術中",
  checkout: "会計待ち",
  done: "完了",
  cancelled: "キャンセル",
  no_show: "無断キャンセル",
};

/** カレンダー上に枠を占有しない状態 */
export const INACTIVE_STATUSES: ReadonlySet<ReservationStatus> = new Set([
  "cancelled",
  "no_show",
]);

/** リマインド送信の状態。外部の送信プログラムが更新する。 */
export type ReminderStatus = "pending" | "sent" | "skipped" | "failed";

export interface Reservation {
  id: ReservationId;
  patientId: PatientId;
  laneId: LaneId;
  menuIds: MenuId[];
  /** 開始日時（ISO 8601、オフセット付き） */
  startAt: string;
  /** 終了日時（ISO 8601、オフセット付き） */
  endAt: string;
  status: ReservationStatus;
  memo?: string;
  reminder: {
    status: ReminderStatus;
    /** 送信・スキップした日時 */
    updatedAt?: string;
  };
  /** 楽観的排他制御用。更新のたびに増える */
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface ClinicSettings {
  name: string;
  /** IANAタイムゾーン。現状は Asia/Tokyo のみ対応 */
  timeZone: "Asia/Tokyo";
  /** カレンダーに表示する時間帯（その日の0時からの分） */
  dayStartMin: number;
  dayEndMin: number;
  /** ドラッグ・入力時の刻み（分） */
  slotMin: number;
}

/** 画面に渡す1日分のデータ */
export interface DayBundle {
  date: string;
  clinic: ClinicSettings;
  lanes: Lane[];
  menus: Menu[];
  reservations: Reservation[];
  /** その日の予約に登場する患者だけ */
  patients: Patient[];
}

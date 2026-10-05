/**
 * 予約管理のドメインモデル。
 *
 * 日時は常に「タイムゾーン付きのISO 8601文字列」（例: 2026-10-07T10:00:00+09:00）で持つ。
 * 外部連携（前日リマインド等）がそのまま読める形にするため、表示用の分単位の値は
 * 画面側で都度計算し、保存はしない。
 */

export type LaneId = string;
export type TreatmentId = string;
export type PatientId = string;
export type ReservationId = string;

/** 予約カレンダーの列（施術レーン・部屋・機器）。 */
export interface Lane {
  id: LaneId;
  name: string;
  /** 狭い画面用の短い名前 */
  shortName: string;
  order: number;
}

export interface Treatment {
  id: TreatmentId;
  name: string;
  /** 短い枠に表示する略称（例: ハイフ → HIFU） */
  abbr: string;
  /** 標準の所要時間（分） */
  durationMin: number;
  /** カレンダー上の色（CSSカラー） */
  color: string;
}

export interface Patient {
  id: PatientId;
  /** 診察券番号など院内の番号 */
  chartNo: string;
  name: string;
  kana: string;
  phone?: string;
  email?: string;
  /**
   * LINEのユーザーID。患者本人がQRコードで紐付けを完了したときだけ入る。
   * 電話番号や氏名の一致で自動的に入れてはいけない（誤送信防止）。
   */
  lineUserId?: string;
  /** 注意事項（アレルギー等）がある患者 */
  caution?: boolean;
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
  treatmentIds: TreatmentId[];
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
  treatments: Treatment[];
  reservations: Reservation[];
  /** その日の予約に登場する患者だけ */
  patients: Patient[];
}

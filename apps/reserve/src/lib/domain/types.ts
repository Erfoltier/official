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
  /** 電子カルテ（M3）のカルテ番号。カルテと予約を突き合わせるのに使う */
  m3ChartNo?: string;
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
  /**
   * 削除（論理削除）。診療の記録は保存義務があるため消さずに残し、検索や一覧から外す。
   * 復元できる。統合された側は mergedInto に統合先が入る
   */
  deleted?: { at: string; by?: Actor; reason: string };
  mergedInto?: PatientId;
}

/** 重複の可能性がある患者 */
/** スキンケア・内服のプリセット（設定で登録し、施術歴でタップして追加する） */
export const PRODUCT_CATEGORIES = ["skincare", "oral"] as const;
export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number];
export const PRODUCT_CATEGORY_LABEL: Record<ProductCategory, string> = { skincare: "スキンケア", oral: "内服" };

export interface Product {
  id: string;
  name: string;
  category: ProductCategory;
  /** 税込の価格（円）。未設定は null */
  priceYen: number | null;
  order: number;
  active: boolean;
}

/** 患者のファイル（同意書のスキャン・写真・PDF・Word）。中身は暗号化して別に保存する */
export type FileKind = "image" | "pdf" | "doc";

export interface PatientFile {
  id: string;
  patientId: string;
  /** どの日の記録か（YYYY-MM-DD） */
  date: string;
  reservationId?: string;
  name: string;
  type: string;
  kind: FileKind;
  size: number;
  createdAt: string;
  createdBy?: Actor;
  deleted?: { at: string; by?: Actor };
}

export interface DuplicateCandidate {
  patient: Patient;
  reasons: string[];
  /** 姓名・セイメイ・生年月日がすべて一致し、統合できる */
  identical: boolean;
  /** 一致しない（または未入力の）項目。統合できない理由 */
  mismatch: string[];
}

/** 統合した場合に何が起きるかの事前確認 */
export interface MergePreview {
  keep: Patient;
  dup: Patient;
  reservations: number;
  visitNotes: number;
  /** 両方に記録がある日（メモをつなげ、スキンケアを合わせる） */
  sameDayNotes: string[];
  /** 統合先が空欄で、統合元の値で埋める項目 */
  filledFields: string[];
  /** 両方がLINEと紐付いている（統合先の紐付けを残す） */
  lineConflict: boolean;
  /** 姓名・セイメイ・生年月日がすべて一致し、統合できる */
  identical: boolean;
  /** 一致しない（または未入力の）項目 */
  mismatch: string[];
}

/** 患者情報の変更履歴。値そのものは残さず、いつ・誰が・どの項目を変えたかだけ記録する */
export interface PatientChange {
  at: string;
  fields: string[];
  /** 変更したスタッフ（ログイン導入前の記録・外部連携では空） */
  by?: Actor;
}

export const STAFF_ROLES = ["admin", "doctor", "nurse", "reception"] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export const ROLE_LABEL: Record<StaffRole, string> = {
  admin: "院長・管理者",
  doctor: "医師",
  nurse: "看護師",
  reception: "受付",
};

/** 画面に出してよいスタッフ情報（PINのハッシュ等は含まない） */
export interface StaffPublic {
  id: string;
  name: string;
  role: StaffRole;
  active: boolean;
}

/** 操作したスタッフ。名前は操作時点のものを残す */
export interface Actor {
  id: string;
  name: string;
}

/** 操作ログ（監査用）。患者情報の値そのものは含めない */
export interface AuditEntry {
  at: string;
  actor: Actor;
  action: string;
  /** 対象（患者ID・予約IDなど） */
  target?: string;
}

/**
 * 来院日ごとの記録（簡易カルテ）。1患者・1日につき1件。
 * 予約がない日にも自由に書ける。
 */
export interface VisitNote {
  patientId: PatientId;
  /** YYYY-MM-DD（日本時間） */
  date: string;
  /** 自由記載のメモ（施術の様子・出力・反応・次回の方針など） */
  note: string;
  /** その日の時点で使っているスキンケアアイテム */
  skincare: string[];
  version: number;
  updatedAt: string;
  updatedBy?: Actor;
}

/** 施術歴の1行（1日分） */
export interface VisitRow {
  date: string;
  /** その日の予約（キャンセル含む） */
  reservations: {
    id: string;
    startAt: string;
    endAt: string;
    status: ReservationStatus;
    menuNames: string[];
    laneName: string;
    memo?: string;
    requestId?: string;
    /** メニューの色分け・回数の数え上げに使う */
    menuIds: string[];
  }[];
  note: string;
  skincare: string[];
  /** その日のファイル（同意書・写真など） */
  files: PatientFile[];
  /** 記録がまだない日は 0 */
  noteVersion: number;
  noteUpdatedAt?: string;
  noteUpdatedBy?: Actor;
}

/** 患者の画面に渡すデータ */
export interface PatientDetail {
  patient: Patient;
  /** 今日までの施術歴（新しい順）。予約のある日と、記録だけある日 */
  visits: VisitRow[];
  /** 明日以降の予約（近い順） */
  upcoming: VisitRow["reservations"];
  /** スキンケア入力の候補（この患者が使ったことのあるもの → 院でよく使うもの） */
  skincareSuggestions: string[];
  /** スキンケア・内服のプリセット（有効なもの、並び順） */
  products: Product[];
  /** メニューの名前と色（施術歴の色分け用。非表示のメニューも含む） */
  menuInfo: Record<string, { name: string; color: string }>;
  history: PatientChange[];
  /** 重複の可能性がある患者（削除済みの患者では空） */
  duplicates: DuplicateCandidate[];
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
  /** LINE予約フォームの予約申請ID（例：R2026100506574020A34A8B） */
  requestId?: string;
  /** 登録・最終更新したスタッフ */
  createdBy?: Actor;
  updatedBy?: Actor;
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

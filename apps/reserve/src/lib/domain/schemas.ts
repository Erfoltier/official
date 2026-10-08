import { z } from "zod";
import { RESERVATION_STATUSES, THEME_IDS } from "@/lib/domain/types";
import { isDateString } from "@/lib/domain/time";
import { REQUEST_ID_RE } from "@/lib/domain/bookingRequest";

const requestId = z.string().regex(REQUEST_ID_RE);

const id = z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/);
const isoDateTime = z.iso.datetime({ offset: true });

export const dateParam = z.string().refine(isDateString, "日付の形式が正しくありません");

/** "2026-10" の形の月 */
export const monthParam = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

export const createReservationSchema = z.object({
  patientId: id,
  laneId: id,
  menuIds: z.array(id).min(1).max(5),
  startAt: isoDateTime,
  endAt: isoDateTime,
  memo: z.string().max(3000).optional(),
  requestId: requestId.optional(),
});

export const updateReservationSchema = z
  .object({
    version: z.number().int().positive(),
    laneId: id.optional(),
    startAt: isoDateTime.optional(),
    endAt: isoDateTime.optional(),
    status: z.enum(RESERVATION_STATUSES).optional(),
    menuIds: z.array(id).min(1).max(5).optional(),
    memo: z.string().max(3000).optional(),
    /** 空文字で削除 */
    requestId: z.union([requestId, z.literal("")]).optional(),
    stageId: id.optional(),
    stageText: z.string().max(40).optional(),
    /** 状態を変えた時刻（その日の0時からの分）。省略すると今の時刻 */
    stageMin: z.number().int().min(0).max(1439).optional(),
  })
  .strict();

/** 外部連携：予約申請IDの書き込み */
export const integrationRequestIdSchema = z.object({ requestId }).strict();

/** 外部連携：M3カルテ番号の書き込み（空文字で削除） */
export const integrationM3Schema = z.object({ m3ChartNo: z.string().max(30) }).strict();

export const reminderResultSchema = z
  .object({ status: z.enum(["sent", "skipped", "failed"]) })
  .strict();

export const reservationIdParam = id;

const shortText = (max: number) => z.string().max(max);

const patientFieldsSchema = {
  kana: shortText(120).optional(),
  nameAlt: shortText(120).optional(),
  phone: shortText(30).optional(),
  email: shortText(200).optional(),
  postalCode: shortText(10).optional(),
  address: shortText(200).optional(),
  sex: shortText(10).optional(),
  chartNo: shortText(30).optional(),
  m3ChartNo: shortText(30).optional(),
  birthDate: shortText(10).optional(),
  caution: z.boolean().optional(),
  cautionNote: shortText(1000).optional(),
  memo: shortText(12000).optional(),
  history: shortText(4000).optional(),
  medications: shortText(4000).optional(),
  questionnaireOther: shortText(8000).optional(),
  contactPref: z.enum(["auto", "line", "email", "none"]).optional(),
  reminderOptOut: z.boolean().optional(),
};

export const createPatientSchema = z.object({ name: shortText(120), ...patientFieldsSchema }).strict();

export const updatePatientSchema = z
  .object({ version: z.number().int().positive(), name: shortText(120).optional(), ...patientFieldsSchema })
  .strict();

export const versionOnlySchema = z.object({ version: z.number().int().positive() }).strict();

export const laneSchema = z
  .object({
    name: shortText(80).optional(),
    shortName: shortText(30).optional(),
    active: z.boolean().optional(),
  })
  .strict();

const minutes = z.number().int().min(0).max(1440);

export const menuSchema = z
  .object({
    name: shortText(160).optional(),
    abbr: shortText(30).optional(),
    duration: z
      .discriminatedUnion("kind", [
        z.object({ kind: z.literal("fixed"), minutes }).strict(),
        z.object({ kind: z.literal("range"), min: minutes, max: minutes, step: minutes }).strict(),
      ])
      .optional(),
    defaultMinutes: minutes.optional(),
    startStepMin: minutes.optional(),
    priceYen: z.number().int().nullable().optional(),
    capacity: z.number().int().nullable().optional(),
    laneIds: z.array(id).max(50).optional(),
    color: z.string().max(7).optional(),
    active: z.boolean().optional(),
  })
  .strict();

export const reorderSchema = z.object({ ids: z.array(id).min(1).max(500) }).strict();
export const idParam = id;

export const visitNoteSchema = z
  .object({
    note: z.string().max(16000),
    skincare: z.array(z.string().max(120)).max(30),
    version: z.number().int().min(0),
  })
  .strict();

export const loginSchema = z.object({ staffId: id, pin: z.string().max(16) }).strict();

const role = z.enum(["admin", "doctor", "nurse", "reception"]);

export const createStaffSchema = z.object({ name: z.string().max(60), role, pin: z.string().max(16) }).strict();

export const updateStaffSchema = z
  .object({
    name: z.string().max(60).optional(),
    role: role.optional(),
    active: z.boolean().optional(),
    pin: z.string().max(16).optional(),
    canManage: z.boolean().optional(),
  })
  .strict();

export const deletePatientSchema = z.object({ version: z.number().int().positive(), reason: z.string().max(200) }).strict();

export const mergePatientsSchema = z
  .object({ keepId: id, dupId: id, keepVersion: z.number().int().positive(), dupVersion: z.number().int().positive() })
  .strict();

/** 院の設定（院名・診療時間・刻み） */
export const clinicSchema = z
  .object({
    name: z.string().max(80).optional(),
    dayStartMin: z.number().int().min(0).max(1440).optional(),
    dayEndMin: z.number().int().min(0).max(1440).optional(),
    slotMin: z.union([z.literal(5), z.literal(10), z.literal(15), z.literal(30)]).optional(),
    docName: z.string().max(100).optional(),
    address: z.string().max(200).optional(),
    phone: z.string().max(40).optional(),
    issuer: z.string().max(80).optional(),
    estimateNote: z.string().max(3000).optional(),
    estimateValidDays: z.number().int().min(1).max(365).optional(),
    estimatePaper: z.enum(["A4", "A5"]).optional(),
    theme: z.enum(THEME_IDS).optional(),
  })
  .strict();

export const priceItemSchema = z
  .object({
    category: z.string().max(100).optional(),
    name: z.string().max(200).optional(),
    priceYen: z.number().int().min(-10_000_000).max(10_000_000).nullable().optional(),
  })
  .strict();

/** 外部連携：スプレッドシート（Apps Script）から料金表を送る */
export const integrationPricesSchema = z
  .object({
    sheet: z.string().min(1).max(100),
    items: z
      .array(
        z
          .object({
            category: z.string().max(100),
            name: z.string().max(200),
            priceYen: z.number().int().min(-10_000_000).max(10_000_000).nullable(),
            priceText: z.string().max(100).optional(),
            kind: z.enum(["treatment", "product"]).optional(),
          })
          .strict(),
      )
      .max(1000),
  })
  .strict();

/** 外部連携：同意書フォルダ（Apps Script）からひな形を送る。フォルダの分をまるごと入れ替える */
export const integrationConsentTemplatesSchema = z
  .object({
    templates: z
      .array(
        z
          .object({
            driveId: id,
            title: z.string().min(1).max(200),
            modifiedTime: isoDateTime,
            html: z.string().max(400_000),
          })
          .strict(),
      )
      .max(200),
  })
  .strict();

/** 同意書の読み込み元（同意書フォルダの Apps Script ウェブアプリ）。key を省くと今のまま */
export const consentSourceSchema = z
  .object({
    url: z.string().max(500),
    key: z.string().max(200).optional(),
  })
  .strict();

export const consentTemplateMenusSchema = z.object({ menuIds: z.array(id).max(100) }).strict();

/** 署名画像（PNG の data URL、300KB まで） */
const signature = z
  .string()
  .max(400_000)
  .regex(/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/);

export const createConsentSchema = z
  .object({
    templateId: id,
    reservationId: id.optional(),
    date: dateParam.optional(),
    treatment: z.string().max(200).optional(),
    signature: signature.optional(),
  })
  .strict();

export const priceUrlsSchema = z.object({ urls: z.array(z.string().max(300)).max(10) }).strict();

const estimateLine = z
  .object({
    kind: z.enum(["menu", "product", "custom"]),
    refId: id.optional(),
    name: z.string().max(200),
    unitYen: z.number().int().min(-10_000_000).max(10_000_000),
    qty: z.number().int().min(1).max(99),
  })
  .strict();

export const createEstimateSchema = z
  .object({
    reservationId: id.optional(),
    date: dateParam.optional(),
    validUntil: dateParam.optional(),
    lines: z.array(estimateLine).min(1).max(40),
    note: z.string().max(2000).optional(),
  })
  .strict();

export const updateEstimateSchema = z
  .object({
    version: z.number().int().positive(),
    date: dateParam.optional(),
    validUntil: dateParam.optional(),
    lines: z.array(estimateLine).min(1).max(40).optional(),
    note: z.string().max(2000).optional(),
  })
  .strict();

export const integrationQuestionnairesSchema = z
  .object({
    responses: z
      .array(
        z
          .object({
            key: z.string().min(1).max(200),
            submittedAt: z.string().max(40),
            name: z.string().max(120),
            kana: z.string().max(120).optional(),
            birthDate: z.string().max(10).optional(),
            phone: z.string().max(30).optional(),
            history: z.string().max(4000).optional(),
            medications: z.string().max(4000).optional(),
            allergies: z.string().max(4000).optional(),
            answers: z.array(z.object({ q: z.string().max(300), a: z.string().max(4000) }).strict()).max(80),
          })
          .strict(),
      )
      .max(200),
  })
  .strict();

export const importPricesSchema = z
  .object({
    sheet: z.string().min(1).max(100),
    items: z
      .array(
        z
          .object({
            category: z.string().max(100),
            name: z.string().max(200),
            priceYen: z.number().int().min(-10_000_000).max(10_000_000).nullable(),
            priceText: z.string().max(100).optional(),
            kind: z.enum(["treatment", "product"]).optional(),
          })
          .strict(),
      )
      .max(1000),
  })
  .strict();

export const importConsentTemplatesSchema = z
  .object({ templates: z.array(z.object({ title: z.string().max(200), html: z.string().max(400_000) }).strict()).min(1).max(30) })
  .strict();

export const importFetchSchema = z.object({ url: z.string().max(2000) }).strict();

export const linkQuestionnaireSchema = z.object({ chartNo: z.string().min(1).max(30) }).strict();

const chartDrug = z.object({ name: z.string().max(200), lot: z.string().max(100).optional(), amount: z.string().max(100).optional() }).strict();
const chartFields = {
  treatment: z.string().max(300),
  area: z.string().max(400).optional(),
  settings: z.string().max(2000).optional(),
  drugs: z.array(chartDrug).max(10).optional(),
  anesthesia: z.string().max(200).optional(),
  findings: z.string().max(16000).optional(),
  nextPlan: z.string().max(400).optional(),
  operator: z.string().max(100).optional(),
};

export const createChartSchema = z.object({ date: dateParam, reservationId: id.optional(), ...chartFields }).strict();

export const updateChartSchema = z
  .object({ version: z.number().int().positive(), date: dateParam.optional(), ...chartFields, treatment: chartFields.treatment.optional() })
  .strict();

const productCategory = z.enum(["skincare", "oral"]);

export const productSchema = z
  .object({
    name: z.string().max(120).optional(),
    category: productCategory.optional(),
    priceYen: z.number().int().nullable().optional(),
    active: z.boolean().optional(),
  })
  .strict();

export const stageSchema = z
  .object({
    label: z.string().max(40).optional(),
    color: z.string().max(7).optional(),
    phase: z.enum(["booked", "arrived", "in_treatment", "checkout", "done"]).optional(),
    free: z.boolean().optional(),
    active: z.boolean().optional(),
  })
  .strict();

/** 機器の連携の鍵を発行する */
export const deviceLinkSchema = z.object({ source: z.enum(["neovoir", "google"]), name: z.string().max(60).optional() }).strict();

/** 機器の取り込み方（光源・縮小） */
export const deviceOptionsSchema = z
  .object({
    lights: z.array(z.enum(["NL", "PL", "SL", "UV"])).min(1).max(4),
    maxSide: z.union([z.literal(0), z.number().int().min(800).max(6000)]),
  })
  .strict();

/** 照合待ちの写真を患者に結びつける */
export const photoAssignSchema = z.object({ patientId: idParam }).strict();

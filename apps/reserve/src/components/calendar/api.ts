import type { AuditEntry, ConsentRecord, ConsentTemplate, ConsentTemplateWithHtml, ConsentView, DayBundle, Estimate, EstimateLine, EstimateView, Lane, PriceItem, PriceList, MergePreview, Menu, Patient, PatientDetail, PatientFile, Product, Reservation, Stage, StaffPublic, StaffRole } from "@/lib/domain/types";
import { METHOD_OVERRIDE, apiUrl, withBase } from "@/lib/paths";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const method = (init?.method ?? "GET").toUpperCase();
  const override = METHOD_OVERRIDE && ["PUT", "PATCH", "DELETE"].includes(method);
  const res = await fetch(apiUrl(path), {
    ...init,
    method: override ? "POST" : method,
    cache: "no-store",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      ...(override && { "X-HTTP-Method-Override": method }),
      ...init?.headers,
    },
  });
  const body = res.status === 204 ? {} : await res.json().catch(() => ({}));
  if (res.status === 401 && body.error === "login_required") {
    // ログインが切れていたらログイン画面へ（戻り先を付ける）
    const next = window.location.pathname + window.location.search;
    window.location.replace(withBase(`/login/?next=${encodeURIComponent(next)}`));
    return new Promise<T>(() => {});
  }
  if (!res.ok) {
    throw new ApiError(res.status, body.error ?? "error", body.message ?? "通信に失敗しました");
  }
  return body as T;
}

export function fetchDay(date: string, signal?: AbortSignal): Promise<DayBundle> {
  return call(`/api/v1/day?date=${encodeURIComponent(date)}`, { signal });
}

export function patchReservation(
  id: string,
  body: Partial<Pick<Reservation, "laneId" | "startAt" | "endAt" | "status" | "memo" | "menuIds" | "requestId" | "stageId" | "stageText">> & {
    version: number;
    /** 状態を変えた時刻（その日の0時からの分）。省略すると今の時刻 */
    stageMin?: number;
  },
): Promise<Reservation> {
  return call(`/api/v1/reservations/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export function postReservation(body: {
  patientId: string;
  laneId: string;
  menuIds: string[];
  startAt: string;
  endAt: string;
  memo?: string;
  requestId?: string;
}): Promise<Reservation> {
  return call(`/api/v1/reservations`, { method: "POST", body: JSON.stringify(body) });
}

export async function searchPatients(q: string, signal?: AbortSignal): Promise<Patient[]> {
  const r = await call<{ items: Patient[] }>(`/api/v1/patients?q=${encodeURIComponent(q)}`, { signal });
  return r.items;
}

export function createPatient(body: {
  name: string;
  kana?: string;
  nameAlt?: string;
  phone?: string;
  chartNo?: string;
  m3ChartNo?: string;
  birthDate?: string;
}): Promise<Patient> {
  return call(`/api/v1/patients`, { method: "POST", body: JSON.stringify(body) });
}

export interface SettingsData {
  clinic: DayBundle["clinic"];
  lanes: Lane[];
  menus: Menu[];
  products: Product[];
  stages: Stage[];
}

export function fetchSettings(): Promise<SettingsData> {
  return call(`/api/v1/settings`);
}

export function saveLane(id: string | null, body: Partial<Pick<Lane, "name" | "shortName" | "active">>): Promise<Lane> {
  return id
    ? call(`/api/v1/lanes/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(body) })
    : call(`/api/v1/lanes`, { method: "POST", body: JSON.stringify(body) });
}

export function saveMenu(id: string | null, body: Partial<Omit<Menu, "id" | "order">>): Promise<Menu> {
  return id
    ? call(`/api/v1/menus/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(body) })
    : call(`/api/v1/menus`, { method: "POST", body: JSON.stringify(body) });
}

export async function reorder(kind: "lanes" | "menus" | "products" | "stages", ids: string[]): Promise<void> {
  await call(`/api/v1/${kind}/reorder`, { method: "POST", body: JSON.stringify({ ids }) });
}

export type PatientUpdate = Partial<
  Pick<
    Patient,
    "name" | "kana" | "nameAlt" | "phone" | "email" | "chartNo" | "m3ChartNo" | "birthDate" | "caution" | "cautionNote" | "memo"
  >
>;

export function fetchPatient(id: string): Promise<PatientDetail> {
  return call(`/api/v1/patients/${encodeURIComponent(id)}`);
}

export function updatePatient(id: string, body: PatientUpdate & { version: number }): Promise<PatientDetail> {
  return call(`/api/v1/patients/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(body) });
}

export function unlinkLine(id: string, version: number): Promise<PatientDetail> {
  return call(`/api/v1/patients/${encodeURIComponent(id)}/unlink-line`, {
    method: "POST",
    body: JSON.stringify({ version }),
  });
}

export function saveVisit(
  patientId: string,
  date: string,
  body: { note: string; skincare: string[]; version: number },
): Promise<PatientDetail> {
  return call(`/api/v1/patients/${encodeURIComponent(patientId)}/visits/${encodeURIComponent(date)}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

// ---- ログイン・スタッフ ----

export async function fetchLoginStaff(): Promise<Pick<StaffPublic, "id" | "name" | "role">[]> {
  return (await call<{ items: Pick<StaffPublic, "id" | "name" | "role">[] }>(`/api/v1/auth/staff`)).items;
}

export function login(staffId: string, pin: string): Promise<StaffPublic> {
  return call(`/api/v1/auth/login`, { method: "POST", body: JSON.stringify({ staffId, pin }) });
}

export async function logout(): Promise<void> {
  await call(`/api/v1/auth/logout`, { method: "POST" });
}

export function fetchMe(): Promise<StaffPublic> {
  return call(`/api/v1/auth/me`);
}

export async function fetchStaff(): Promise<StaffPublic[]> {
  return (await call<{ items: StaffPublic[] }>(`/api/v1/staff`)).items;
}

export function saveStaff(
  id: string | null,
  body: { name?: string; role?: StaffRole; active?: boolean; pin?: string },
): Promise<StaffPublic> {
  return id
    ? call(`/api/v1/staff/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(body) })
    : call(`/api/v1/staff`, { method: "POST", body: JSON.stringify(body) });
}

export async function fetchAudit(): Promise<AuditEntry[]> {
  return (await call<{ items: AuditEntry[] }>(`/api/v1/audit`)).items;
}

// ---- 患者の削除・復元・統合 ----

export function deletePatient(id: string, version: number, reason: string): Promise<PatientDetail> {
  return call(`/api/v1/patients/${encodeURIComponent(id)}/delete`, { method: "POST", body: JSON.stringify({ version, reason }) });
}

export function restorePatient(id: string, version: number): Promise<PatientDetail> {
  return call(`/api/v1/patients/${encodeURIComponent(id)}/restore`, { method: "POST", body: JSON.stringify({ version }) });
}

export function previewMerge(keepId: string, dupId: string): Promise<MergePreview> {
  return call(`/api/v1/patients/merge?keep=${encodeURIComponent(keepId)}&dup=${encodeURIComponent(dupId)}`);
}

export function mergePatients(body: { keepId: string; dupId: string; keepVersion: number; dupVersion: number }): Promise<PatientDetail> {
  return call(`/api/v1/patients/merge`, { method: "POST", body: JSON.stringify(body) });
}

export async function deleteLane(id: string): Promise<void> {
  await call(`/api/v1/lanes/${encodeURIComponent(id)}`, { method: "DELETE" });
}

/** 日付ジャンプ用：月の日ごとの予約数（"2026-10-07": 12） */
export async function fetchMonthCounts(month: string, signal?: AbortSignal): Promise<Record<string, number>> {
  const r = await call<{ month: string; days: Record<string, number> }>(`/api/v1/month?month=${encodeURIComponent(month)}`, { signal });
  return r.days;
}

export function saveClinic(
  body: Partial<
    Pick<
      DayBundle["clinic"],
      "name" | "dayStartMin" | "dayEndMin" | "slotMin" | "docName" | "address" | "phone" | "issuer" | "estimateNote" | "estimateValidDays" | "estimatePaper"
    >
  >,
): Promise<DayBundle["clinic"]> {
  return call(`/api/v1/clinic`, { method: "PATCH", body: JSON.stringify(body) });
}

export function saveProduct(
  id: string | null,
  body: Partial<Pick<Product, "name" | "category" | "priceYen" | "active">>,
): Promise<Product> {
  return id
    ? call(`/api/v1/products/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(body) })
    : call(`/api/v1/products`, { method: "POST", body: JSON.stringify(body) });
}

// ---- ファイル（同意書のスキャン・写真・PDF・Word） ----

export async function fetchFiles(patientId: string, date?: string): Promise<PatientFile[]> {
  const q = date ? `?date=${encodeURIComponent(date)}` : "";
  return (await call<{ items: PatientFile[] }>(`/api/v1/patients/${encodeURIComponent(patientId)}/files${q}`)).items;
}

/** ファイルを1つ送る（本文はファイルそのもの） */
export async function uploadFile(
  patientId: string,
  params: { date: string; reservationId?: string },
  file: Blob,
  name: string,
): Promise<PatientFile> {
  const q = new URLSearchParams({ date: params.date, ...(params.reservationId && { reservationId: params.reservationId }) });
  const res = await fetch(apiUrl(`/api/v1/patients/${encodeURIComponent(patientId)}/files?${q}`), {
    method: "POST",
    body: file,
    cache: "no-store",
    credentials: "same-origin",
    headers: { "Content-Type": file.type || "application/octet-stream", "X-File-Name": encodeURIComponent(name) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, body.error ?? "error", body.message ?? "アップロードできませんでした");
  return body as PatientFile;
}

export async function deleteFile(id: string): Promise<void> {
  await call(`/api/v1/files/${encodeURIComponent(id)}/delete`, { method: "POST" });
}

export function fileUrl(id: string): string {
  return apiUrl(`/api/v1/files/${encodeURIComponent(id)}`);
}

export function saveStage(
  id: string | null,
  body: Partial<Pick<Stage, "label" | "color" | "phase" | "free" | "active">>,
): Promise<Stage> {
  return id
    ? call(`/api/v1/stages/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(body) })
    : call(`/api/v1/stages`, { method: "POST", body: JSON.stringify(body) });
}

export async function deleteStage(id: string): Promise<void> {
  await call(`/api/v1/stages/${encodeURIComponent(id)}/delete`, { method: "POST" });
}

export async function deleteProduct(id: string): Promise<void> {
  await call(`/api/v1/products/${encodeURIComponent(id)}/delete`, { method: "POST" });
}

export interface RestoreSummary {
  clinic: string;
  lanes: number;
  menus: number;
  stages: number;
  products: number;
}

export interface RestorePoints {
  current: RestoreSummary;
  points: { key: string; label: string; at: string | null; available: boolean; oldest: boolean; summary: RestoreSummary | null }[];
}

export function fetchRestorePoints(): Promise<RestorePoints> {
  return call(`/api/v1/settings/restore`);
}

export function restoreSettings(key: string): Promise<RestorePoints> {
  return call(`/api/v1/settings/restore`, { method: "POST", body: JSON.stringify({ key }) });
}

// ---- 見積書 ----

export async function fetchEstimates(patientId: string): Promise<Estimate[]> {
  const r = await call<{ items: Estimate[] }>(`/api/v1/patients/${encodeURIComponent(patientId)}/estimates`);
  return r.items;
}

export interface EstimateBody {
  date?: string;
  validUntil?: string;
  lines: EstimateLine[];
  note?: string;
}

export function createEstimate(patientId: string, body: EstimateBody & { reservationId?: string }): Promise<Estimate> {
  return call(`/api/v1/patients/${encodeURIComponent(patientId)}/estimates`, { method: "POST", body: JSON.stringify(body) });
}

export function updateEstimate(id: string, body: Partial<EstimateBody> & { version: number }): Promise<Estimate> {
  return call(`/api/v1/estimates/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(body) });
}

export function fetchEstimate(id: string): Promise<EstimateView> {
  return call(`/api/v1/estimates/${encodeURIComponent(id)}`);
}

export async function deleteEstimate(id: string, version: number): Promise<void> {
  await call(`/api/v1/estimates/${encodeURIComponent(id)}/delete`, { method: "POST", body: JSON.stringify({ version }) });
}

/** 印刷用ページのURL */
export function estimatePrintUrl(id: string, kind: "estimate" | "bill" = "estimate"): string {
  return withBase(`/estimates/print/?id=${encodeURIComponent(id)}${kind === "bill" ? "&type=bill" : ""}`);
}

// ---- 料金表 ----

export function fetchPrices(): Promise<PriceList> {
  return call(`/api/v1/prices`);
}

export function syncPricesNow(): Promise<PriceList> {
  return call(`/api/v1/prices/sync`, { method: "POST" });
}

export function savePriceUrls(urls: string[]): Promise<PriceList> {
  return call(`/api/v1/prices/urls`, { method: "POST", body: JSON.stringify({ urls }) });
}

export function savePriceItem(id: string | null, body: { category?: string; name?: string; priceYen?: number | null }): Promise<PriceItem> {
  return id
    ? call(`/api/v1/prices/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(body) })
    : call(`/api/v1/prices`, { method: "POST", body: JSON.stringify(body) });
}

export async function deletePriceItem(id: string): Promise<void> {
  await call(`/api/v1/prices/${encodeURIComponent(id)}/delete`, { method: "POST" });
}

// ---- 同意書 ----

export function fetchConsentTemplates(): Promise<{ items: ConsentTemplate[]; receivedAt: string | null; live: boolean; source: boolean }> {
  return call(`/api/v1/consent-templates`);
}

export function fetchConsentTemplate(id: string): Promise<ConsentTemplateWithHtml & { stale?: boolean }> {
  return call(`/api/v1/consent-templates/${encodeURIComponent(id)}`);
}

export function saveConsentTemplateMenus(id: string, menuIds: string[]): Promise<ConsentTemplate> {
  return call(`/api/v1/consent-templates/${encodeURIComponent(id)}/menus`, { method: "POST", body: JSON.stringify({ menuIds }) });
}

export async function fetchConsents(patientId: string): Promise<ConsentRecord[]> {
  const r = await call<{ items: ConsentRecord[] }>(`/api/v1/patients/${encodeURIComponent(patientId)}/consents`);
  return r.items;
}

export function createConsent(
  patientId: string,
  body: { templateId: string; reservationId?: string; date?: string; treatment?: string; signature?: string },
): Promise<ConsentRecord> {
  return call(`/api/v1/patients/${encodeURIComponent(patientId)}/consents`, { method: "POST", body: JSON.stringify(body) });
}

export function fetchConsent(id: string): Promise<ConsentView> {
  return call(`/api/v1/consents/${encodeURIComponent(id)}`);
}

export async function deleteConsent(id: string): Promise<void> {
  await call(`/api/v1/consents/${encodeURIComponent(id)}/delete`, { method: "POST" });
}

export function consentPrintUrl(id: string): string {
  return withBase(`/consents/print/?id=${encodeURIComponent(id)}`);
}

export function fetchConsentSource(): Promise<{ url: string; hasKey: boolean }> {
  return call(`/api/v1/consent-source`);
}

export function saveConsentSource(body: { url: string; key?: string }): Promise<{ url: string; hasKey: boolean }> {
  return call(`/api/v1/consent-source`, { method: "POST", body: JSON.stringify(body) });
}

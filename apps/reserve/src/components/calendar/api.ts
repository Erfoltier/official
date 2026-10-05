import type { AuditEntry, DayBundle, Lane, MergePreview, Menu, Patient, PatientDetail, Reservation, StaffPublic, StaffRole } from "@/lib/domain/types";
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
  body: Partial<Pick<Reservation, "laneId" | "startAt" | "endAt" | "status" | "memo" | "menuIds">> & {
    version: number;
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
}): Promise<Patient> {
  return call(`/api/v1/patients`, { method: "POST", body: JSON.stringify(body) });
}

export interface SettingsData {
  clinic: DayBundle["clinic"];
  lanes: Lane[];
  menus: Menu[];
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

export async function reorder(kind: "lanes" | "menus", ids: string[]): Promise<void> {
  await call(`/api/v1/${kind}/reorder`, { method: "POST", body: JSON.stringify({ ids }) });
}

export type PatientUpdate = Partial<
  Pick<
    Patient,
    "name" | "kana" | "nameAlt" | "phone" | "email" | "chartNo" | "birthDate" | "caution" | "cautionNote" | "memo"
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

export function saveClinic(body: Partial<Pick<DayBundle["clinic"], "name" | "dayStartMin" | "dayEndMin" | "slotMin">>): Promise<DayBundle["clinic"]> {
  return call(`/api/v1/clinic`, { method: "PATCH", body: JSON.stringify(body) });
}

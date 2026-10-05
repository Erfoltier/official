import type { DayBundle, Lane, Menu, Patient, Reservation } from "@/lib/domain/types";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    cache: "no-store",
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const body = await res.json().catch(() => ({}));
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

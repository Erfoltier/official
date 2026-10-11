import type { Patient } from "@/lib/domain/types";

/** 「氏名を伏せる」表示：姓の1文字目だけ残す（例：山田 花子 → 山＊＊） */
export function maskName(name: string): string {
  const first = Array.from(name.trim())[0] ?? "";
  return `${first}＊＊`;
}

export function displayName(patient: Patient | undefined, mask: boolean): string {
  if (!patient) return "（不明）";
  return mask ? maskName(patient.name) : patient.name;
}

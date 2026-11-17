import { nowInClinic } from "@/lib/domain/time";
import type { Patient } from "@/lib/domain/types";

/** 満年齢（生年月日が無い・読めないときは null） */
export function ageOf(birthDate?: string): number | null {
  if (!birthDate || !/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) return null;
  const today = nowInClinic().date;
  let age = Number(today.slice(0, 4)) - Number(birthDate.slice(0, 4));
  if (today.slice(5) < birthDate.slice(5)) age--;
  return age >= 0 && age < 150 ? age : null;
}

export const SEX_LABEL: Record<NonNullable<Patient["sex"]>, string> = { female: "女性", male: "男性", other: "その他" };

/** 名前の横に出す「34歳・女性」（どちらも無ければ空） */
export function ageSexText(p?: Pick<Patient, "birthDate" | "sex">): string {
  if (!p) return "";
  const age = ageOf(p.birthDate);
  return [age !== null ? `${age}歳` : "", p.sex ? SEX_LABEL[p.sex] : ""].filter(Boolean).join("・");
}

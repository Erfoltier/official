import "server-only";

import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { Actor, AuditEntry, StaffPublic, StaffRole } from "@/lib/domain/types";
import { cleanName, hasForbiddenChars } from "@/lib/domain/text";

/**
 * スタッフとPINログイン（試作）。
 * - 画面全体は Basic認証（院の入口）で守り、その上でスタッフごとにPINでログインする
 * - PINは scrypt でハッシュ化して保存し、5回続けて間違えると5分間ロックする
 * - PIN変更・利用停止で、そのスタッフの既存のログインはすべて無効になる
 */

interface StaffRecord extends StaffPublic {
  pinSalt: string;
  pinHash: string;
  /** これが変わるとログイン中のセッションが無効になる */
  sessionVersion: number;
  failedCount: number;
  lockedUntil: number;
}

export class AuthError extends Error {
  constructor(
    public code: "login_required" | "forbidden" | "invalid_pin" | "locked" | "invalid",
    message: string,
  ) {
    super(message);
  }
}

const MAX_FAILS = 5;
const LOCK_MS = 5 * 60_000;

/** 試作用の初期スタッフ。PINはすべて 1234（運用前に必ず変更する） */
const DEMO_STAFF: { id: string; name: string; role: StaffRole }[] = [
  { id: "staff-admin", name: "院長（デモ）", role: "admin" },
  { id: "staff-dr", name: "医師（デモ）", role: "doctor" },
  { id: "staff-ns1", name: "看護師A（デモ）", role: "nurse" },
  { id: "staff-ns2", name: "看護師B（デモ）", role: "nurse" },
  { id: "staff-rc1", name: "受付A（デモ）", role: "reception" },
];
export const DEMO_PIN = "1234";

interface StaffState {
  staff: Map<string, StaffRecord>;
  audit: AuditEntry[];
  seq: number;
}

const g = globalThis as unknown as { __reserveStaff?: StaffState };

function st(): StaffState {
  if (!g.__reserveStaff) {
    g.__reserveStaff = {
      staff: new Map(
        DEMO_STAFF.map((s) => [s.id, { ...s, active: true, ...hashPin(DEMO_PIN), sessionVersion: 1, failedCount: 0, lockedUntil: 0 }]),
      ),
      audit: [],
      seq: 0,
    };
  }
  return g.__reserveStaff;
}

function hashPin(pin: string): { pinSalt: string; pinHash: string } {
  const salt = randomBytes(16).toString("hex");
  return { pinSalt: salt, pinHash: scryptSync(pin, salt, 32).toString("hex") };
}

function checkPinFormat(pin: string): void {
  if (!/^\d{4,8}$/.test(pin)) throw new AuthError("invalid", "PINは4〜8桁の数字にしてください");
}

const toPublic = ({ id, name, role, active }: StaffRecord): StaffPublic => ({ id, name, role, active });

export function listStaff(includeInactive = false): StaffPublic[] {
  return [...st().staff.values()].filter((s) => includeInactive || s.active).map(toPublic);
}

export function getStaff(id: string): (StaffPublic & { sessionVersion: number }) | null {
  const s = st().staff.get(id);
  return s ? { ...toPublic(s), sessionVersion: s.sessionVersion } : null;
}

/** PINを確かめる。成功すればセッションに入れる sessionVersion を返す */
export function verifyPin(staffId: string, pin: string, now = Date.now()): { staff: StaffPublic; sessionVersion: number } {
  const s = st().staff.get(staffId);
  // 存在しない・停止中のスタッフも、同じ文言で断る
  if (!s || !s.active) throw new AuthError("invalid_pin", "スタッフまたはPINが違います");
  if (s.lockedUntil > now) {
    throw new AuthError("locked", `PINを続けて間違えたため、${Math.ceil((s.lockedUntil - now) / 60_000)}分ほどログインできません`);
  }
  const given = scryptSync(String(pin), s.pinSalt, 32);
  const ok = timingSafeEqual(given, Buffer.from(s.pinHash, "hex"));
  if (!ok) {
    s.failedCount += 1;
    if (s.failedCount >= MAX_FAILS) {
      s.failedCount = 0;
      s.lockedUntil = now + LOCK_MS;
      audit({ id: s.id, name: s.name }, "PIN入力の失敗が続いたためロック");
      throw new AuthError("locked", "PINを続けて間違えたため、5分間ログインできません");
    }
    throw new AuthError("invalid_pin", "スタッフまたはPINが違います");
  }
  s.failedCount = 0;
  s.lockedUntil = 0;
  return { staff: toPublic(s), sessionVersion: s.sessionVersion };
}

// ---- 管理（院長・管理者のみ） ----

function checkName(name: string): string {
  const v = cleanName(name);
  if (!v || v.length > 30 || hasForbiddenChars(v)) throw new AuthError("invalid", "名前は1〜30文字で入力してください");
  return v;
}

export function createStaff(by: Actor, input: { name: string; role: StaffRole; pin: string }): StaffPublic {
  checkPinFormat(input.pin);
  const s = st();
  const rec: StaffRecord = {
    id: `staff-${Date.now().toString(36)}-${++s.seq}`,
    name: checkName(input.name),
    role: input.role,
    active: true,
    ...hashPin(input.pin),
    sessionVersion: 1,
    failedCount: 0,
    lockedUntil: 0,
  };
  s.staff.set(rec.id, rec);
  audit(by, "スタッフを追加", rec.id);
  return toPublic(rec);
}

export function updateStaff(
  by: Actor,
  id: string,
  input: { name?: string; role?: StaffRole; active?: boolean; pin?: string },
): StaffPublic {
  const s = st();
  const cur = s.staff.get(id);
  if (!cur) throw new AuthError("invalid", "スタッフが見つかりません");
  const next = { ...cur };
  if (input.name !== undefined) next.name = checkName(input.name);
  if (input.role !== undefined) next.role = input.role;
  if (input.active !== undefined) next.active = input.active;
  // 管理者がいなくなる変更は止める
  const admins = [...s.staff.values()].map((x) => (x.id === id ? next : x)).filter((x) => x.active && x.role === "admin");
  if (admins.length === 0) throw new AuthError("invalid", "院長・管理者が1人以上必要です");
  if (input.pin !== undefined) {
    checkPinFormat(input.pin);
    Object.assign(next, hashPin(input.pin), { failedCount: 0, lockedUntil: 0 });
  }
  if (input.pin !== undefined || input.active === false || input.role !== undefined) next.sessionVersion += 1;
  s.staff.set(id, next);
  const what = [
    input.name !== undefined && "名前",
    input.role !== undefined && "役割",
    input.active !== undefined && (input.active ? "利用再開" : "利用停止"),
    input.pin !== undefined && "PIN",
  ].filter(Boolean);
  audit(by, `スタッフ情報を変更（${what.join("・")}）`, id);
  return toPublic(next);
}

// ---- 操作ログ ----

export function audit(actor: Actor, action: string, target?: string): void {
  const s = st();
  s.audit.unshift({ at: new Date().toISOString(), actor, action, ...(target && { target }) });
  if (s.audit.length > 5000) s.audit.length = 5000;
}

export function listAudit(limit = 200): AuditEntry[] {
  return st().audit.slice(0, limit);
}

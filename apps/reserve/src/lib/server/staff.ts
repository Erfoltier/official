import "server-only";

import { pbkdf2Sync, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { Actor, AuditEntry, StaffPublic, StaffRole } from "@/lib/domain/types";
import { cleanName, hasForbiddenChars } from "@/lib/domain/text";
import { PersistentMap, appendAudit, count, loadAudit, put, transaction } from "@/lib/server/db";

/**
 * スタッフとPINログイン（試作）。
 * - 画面全体は Basic認証（院の入口）で守り、その上でスタッフごとにPINでログインする
 * - PINは PBKDF2-SHA256 でハッシュ化して保存し、5回続けて間違えると5分間ロックする
 * - PIN変更・利用停止で、そのスタッフの既存のログインはすべて無効になる
 */

interface StaffRecord extends StaffPublic {
  /**
   * PINのハッシュ方式。"pbkdf2-sha256"（Node・PHP共通）。
   * 未設定の古い記録は scrypt（Node版のみ対応）
   */
  pinAlg?: "pbkdf2-sha256";
  pinIter?: number;
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
  seq: number;
}

const g = globalThis as unknown as { __reserveStaff?: StaffState };

/**
 * 最初のスタッフを用意する（スタッフが1人もいないときだけ）。
 * - デモ時：デモ用の5人（PINはすべて 1234）
 * - 本番：環境変数 INITIAL_ADMIN_PIN があれば「院長」を1人作る。なければ誰も作らない
 */
function bootstrapStaff(): void {
  if (count("staff") > 0) return;
  const demo = process.env.RESERVE_DEMO === "1" || (process.env.RESERVE_DEMO !== "0" && process.env.NODE_ENV !== "production");
  const make = (s: { id: string; name: string; role: StaffRole }, pin: string): StaffRecord => ({
    ...s,
    active: true,
    ...hashPin(pin),
    sessionVersion: 1,
    failedCount: 0,
    lockedUntil: 0,
  });
  if (demo) {
    for (const s of DEMO_STAFF) put("staff", s.id, make(s, DEMO_PIN));
    return;
  }
  const pin = process.env.INITIAL_ADMIN_PIN;
  if (pin && /^\d{4,8}$/.test(pin)) {
    put("staff", "staff-admin", make({ id: "staff-admin", name: "院長", role: "admin" }, pin));
  } else {
    console.warn("スタッフが登録されていません。INITIAL_ADMIN_PIN（4〜8桁）を設定して再起動すると、院長アカウントが作られます");
  }
}

function st(): StaffState {
  if (!g.__reserveStaff) {
    g.__reserveStaff = transaction(() => {
      bootstrapStaff();
      return { staff: new PersistentMap<StaffRecord>("staff"), seq: count("staff") };
    });
  }
  return g.__reserveStaff;
}

/** PINのハッシュ化。PHP版でも確かめられるよう PBKDF2-SHA256 を使う */
export const PIN_ITERATIONS = 210_000;

function hashPin(pin: string): Pick<StaffRecord, "pinAlg" | "pinIter" | "pinSalt" | "pinHash"> {
  const salt = randomBytes(16).toString("hex");
  return {
    pinAlg: "pbkdf2-sha256",
    pinIter: PIN_ITERATIONS,
    pinSalt: salt,
    pinHash: pbkdf2Sync(pin, salt, PIN_ITERATIONS, 32, "sha256").toString("hex"),
  };
}

function pinMatches(rec: StaffRecord, pin: string): boolean {
  const given =
    rec.pinAlg === "pbkdf2-sha256"
      ? pbkdf2Sync(String(pin), rec.pinSalt, rec.pinIter ?? PIN_ITERATIONS, 32, "sha256")
      : scryptSync(String(pin), rec.pinSalt, 32);
  return timingSafeEqual(given, Buffer.from(rec.pinHash, "hex"));
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
  const ok = pinMatches(s, pin);
  const save = (patch: Partial<StaffRecord>) => st().staff.set(s.id, { ...s, ...patch });
  if (!ok) {
    const fails = s.failedCount + 1;
    if (fails >= MAX_FAILS) {
      save({ failedCount: 0, lockedUntil: now + LOCK_MS });
      audit({ id: s.id, name: s.name }, "PIN入力の失敗が続いたためロック");
      throw new AuthError("locked", "PINを続けて間違えたため、5分間ログインできません");
    }
    save({ failedCount: fails });
    throw new AuthError("invalid_pin", "スタッフまたはPINが違います");
  }
  if (s.failedCount !== 0 || s.lockedUntil !== 0) save({ failedCount: 0, lockedUntil: 0 });
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

/** 操作ログはデータベースに追記していく（消さない） */
export function audit(actor: Actor, action: string, target?: string): void {
  appendAudit({ at: new Date().toISOString(), actor, action, ...(target && { target }) });
}

export function listAudit(limit = 200): AuditEntry[] {
  return loadAudit<AuditEntry>(limit);
}

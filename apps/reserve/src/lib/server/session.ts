import "server-only";

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { Actor, StaffPublic, StaffRole } from "@/lib/domain/types";
import { AuthError, getStaff } from "@/lib/server/staff";

/**
 * スタッフのログイン状態（署名付きCookie）。
 * Cookie の中身は「スタッフID・版・期限」だけで、改ざんは HMAC-SHA256 で検出する。
 */
export const SESSION_COOKIE = "rsv_staff";
const SESSION_HOURS = 12;

const g = globalThis as unknown as { __reserveDevSecret?: string };

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (s && s.length >= 32) return s;
  if (process.env.NODE_ENV === "production") {
    throw new Error("SESSION_SECRET（32文字以上）が設定されていません");
  }
  // 開発時のみ：起動ごとに作る（再起動でログアウトされる）
  g.__reserveDevSecret ??= randomBytes(32).toString("hex");
  return g.__reserveDevSecret;
}

const b64 = (s: string) => Buffer.from(s).toString("base64url");
const sign = (data: string) => createHmac("sha256", secret()).update(data).digest("base64url");

export function createSessionToken(staffId: string, sessionVersion: number, now = Date.now()): string {
  const payload = b64(JSON.stringify({ sid: staffId, v: sessionVersion, exp: now + SESSION_HOURS * 3600_000 }));
  return `${payload}.${sign(payload)}`;
}

/** トークンを確かめ、ログイン中のスタッフを返す。無効なら null */
export function readSessionToken(token: string | undefined, now = Date.now()): StaffPublic | null {
  if (!token) return null;
  const [payload, mac] = token.split(".");
  if (!payload || !mac) return null;
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const { sid, v, exp } = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (typeof exp !== "number" || exp < now) return null;
    const staff = getStaff(String(sid));
    if (!staff || !staff.active || staff.sessionVersion !== v) return null;
    return { id: staff.id, name: staff.name, role: staff.role, active: staff.active, canManage: staff.canManage };
  } catch {
    return null;
  }
}

export function sessionCookie(token: string): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_HOURS * 3600}${secure}`;
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`;
}

function cookieValue(request: Request, name: string): string | undefined {
  const header = request.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return undefined;
}

export function currentStaff(request: Request): StaffPublic | null {
  return readSessionToken(cookieValue(request, SESSION_COOKIE));
}

/** ログイン中のスタッフを必須にする。roles を指定するとその役割だけ許可 */
export function requireStaff(request: Request, roles?: StaffRole[]): StaffPublic {
  const s = currentStaff(request);
  if (!s) throw new AuthError("login_required", "ログインしてください");
  if (roles && !roles.includes(s.role)) throw new AuthError("forbidden", "この操作の権限がありません");
  return s;
}

/** 設定の変更・削除などの管理操作（院長・管理者と受付、または院長が許可したスタッフ） */
export function requireManager(request: Request): StaffPublic {
  const s = requireStaff(request);
  if (!s.canManage) throw new AuthError("forbidden", "この操作の権限がありません");
  return s;
}

export const actorOf = (s: StaffPublic): Actor => ({ id: s.id, name: s.name });

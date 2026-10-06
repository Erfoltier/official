import "server-only";

import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { StoreError, acceptIntegrationLink } from "@/lib/server/store";
import { AuthError } from "@/lib/server/staff";

const NO_STORE = { "Cache-Control": "no-store" };

export function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: NO_STORE });
}

export function errorResponse(err: unknown): Response {
  if (err instanceof AuthError) {
    const status =
      err.code === "login_required" ? 401 : err.code === "forbidden" ? 403 : err.code === "locked" ? 429 : err.code === "invalid" ? 400 : 401;
    return json({ error: err.code, message: err.message }, status);
  }
  if (err instanceof StoreError) {
    const status = err.code === "not_found" ? 404 : err.code === "version_conflict" ? 409 : 400;
    return json({ error: err.code, message: err.message }, status);
  }
  if (err instanceof z.ZodError) {
    return json({ error: "invalid", message: "入力内容が正しくありません" }, 400);
  }
  // 詳細（患者情報を含みうる）は応答にもログにも出さない
  console.error("unexpected error", err instanceof Error ? err.name : typeof err);
  return json({ error: "internal", message: "サーバーでエラーが発生しました" }, 500);
}

export async function readJson(request: Request, maxBytes = 16_384): Promise<unknown> {
  const text = await request.text();
  if (text.length > maxBytes) throw new StoreError("invalid", "リクエストが大きすぎます");
  try {
    return JSON.parse(text);
  } catch {
    throw new StoreError("invalid", "JSONの形式が正しくありません");
  }
}

/** ファイル本体を読む（上限を超えたら読み込みをやめる） */
export async function readBytes(request: Request, maxBytes: number): Promise<Uint8Array> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > maxBytes) throw new StoreError("invalid", "ファイルが大きすぎます（10MBまで）");
  const buf = new Uint8Array(await request.arrayBuffer());
  if (buf.length > maxBytes) throw new StoreError("invalid", "ファイルが大きすぎます（10MBまで）");
  return buf;
}

/**
 * 外部連携API（リマインド送信プログラム等）の認証。
 * 環境変数 INTEGRATION_API_TOKEN（32文字以上）を Bearer トークンとして要求する。
 * 未設定なら外部連携APIは停止状態（503）にする。
 */
export function checkIntegrationAuth(request: Request): Response | null {
  // 共用サーバーで Authorization が Basic認証に使われている場合に備え、X-Integration-Token でも受け付ける
  const header = request.headers.get("authorization") ?? "";
  const given = request.headers.get("x-integration-token") ?? (header.startsWith("Bearer ") ? header.slice(7) : "");
  // 設定画面で発行した「Google連携の鍵」（止めたものは使えない）
  if (acceptIntegrationLink(given)) return null;
  const expected = process.env.INTEGRATION_API_TOKEN;
  if (!expected || expected.length < 32) {
    return json({ error: "disabled", message: "外部連携APIは無効です" }, 503);
  }
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return json({ error: "unauthorized" }, 401);
  }
  return null;
}

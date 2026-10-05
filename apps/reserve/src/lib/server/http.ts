import "server-only";

import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { StoreError } from "@/lib/server/store";

const NO_STORE = { "Cache-Control": "no-store" };

export function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: NO_STORE });
}

export function errorResponse(err: unknown): Response {
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

/**
 * 外部連携API（リマインド送信プログラム等）の認証。
 * 環境変数 INTEGRATION_API_TOKEN（32文字以上）を Bearer トークンとして要求する。
 * 未設定なら外部連携APIは停止状態（503）にする。
 */
export function checkIntegrationAuth(request: Request): Response | null {
  const expected = process.env.INTEGRATION_API_TOKEN;
  if (!expected || expected.length < 32) {
    return json({ error: "disabled", message: "外部連携APIは無効です" }, 503);
  }
  const header = request.headers.get("authorization") ?? "";
  const given = header.startsWith("Bearer ") ? header.slice(7) : "";
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return json({ error: "unauthorized" }, 401);
  }
  return null;
}

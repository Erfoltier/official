import { createConsentSchema, idParam } from "@/lib/domain/schemas";
import { errorResponse, json, readJson } from "@/lib/server/http";
import { actorOf, requireStaff } from "@/lib/server/session";
import { createConsent, listConsents } from "@/lib/server/store";

/** 患者の同意書（発行・署名の控え）の一覧 */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    requireStaff(request);
    return json({ items: listConsents(idParam.parse((await ctx.params).id)) });
  } catch (err) {
    return errorResponse(err);
  }
}

/** 同意書を発行する（署名画像があれば署名済みとして保存） */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const staff = requireStaff(request);
    const id = idParam.parse((await ctx.params).id);
    return json(createConsent(id, createConsentSchema.parse(await readJson(request, 500_000)), actorOf(staff)), 201);
  } catch (err) {
    return errorResponse(err);
  }
}

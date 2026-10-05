import { createEstimateSchema, idParam } from "@/lib/domain/schemas";
import { errorResponse, json, readJson } from "@/lib/server/http";
import { actorOf, requireStaff } from "@/lib/server/session";
import { createEstimate, listEstimates } from "@/lib/server/store";

/** 患者の見積書の一覧（新しい順） */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    requireStaff(request);
    return json({ items: listEstimates(idParam.parse((await ctx.params).id)) });
  } catch (err) {
    return errorResponse(err);
  }
}

/** 見積書を作る（見積番号は自動） */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const staff = requireStaff(request);
    const id = idParam.parse((await ctx.params).id);
    return json(createEstimate(id, createEstimateSchema.parse(await readJson(request)), actorOf(staff)), 201);
  } catch (err) {
    return errorResponse(err);
  }
}

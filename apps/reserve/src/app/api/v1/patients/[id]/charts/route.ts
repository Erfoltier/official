import { createChartSchema, idParam } from "@/lib/domain/schemas";
import { errorResponse, json, readJson } from "@/lib/server/http";
import { actorOf, requireStaff } from "@/lib/server/session";
import { createChart, listCharts } from "@/lib/server/store";

/** 患者のカルテ（施術記録）の一覧（新しい日付から） */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    requireStaff(request);
    return json({ items: listCharts(idParam.parse((await ctx.params).id)) });
  } catch (err) {
    return errorResponse(err);
  }
}

/** カルテを書く（スタッフ全員） */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const staff = requireStaff(request);
    const id = idParam.parse((await ctx.params).id);
    return json(createChart(id, createChartSchema.parse(await readJson(request, 65_536)), actorOf(staff)), 201);
  } catch (err) {
    return errorResponse(err);
  }
}

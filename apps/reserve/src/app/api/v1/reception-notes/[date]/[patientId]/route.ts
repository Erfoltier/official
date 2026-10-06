import { z } from "zod";
import { dateParam, idParam } from "@/lib/domain/schemas";
import { errorResponse, json, readJson } from "@/lib/server/http";
import { actorOf, requireStaff } from "@/lib/server/session";
import { setReceptionNote } from "@/lib/server/store";

const bodySchema = z.object({ text: z.string().max(8000) });

/** 受付メモを書き換える（空で消す。スタッフ全員） */
export async function PUT(request: Request, ctx: { params: Promise<{ date: string; patientId: string }> }) {
  try {
    const staff = requireStaff(request);
    const { date, patientId } = await ctx.params;
    const body = bodySchema.parse(await readJson(request, 65_536));
    return json(setReceptionNote(dateParam.parse(date), idParam.parse(patientId), body.text, actorOf(staff)));
  } catch (err) {
    return errorResponse(err);
  }
}

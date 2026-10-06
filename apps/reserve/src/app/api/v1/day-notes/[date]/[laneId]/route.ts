import { z } from "zod";
import { dateParam, idParam } from "@/lib/domain/schemas";
import { errorResponse, json, readJson } from "@/lib/server/http";
import { actorOf, requireStaff } from "@/lib/server/session";
import { setDayNote } from "@/lib/server/store";

const bodySchema = z.object({ text: z.string().max(2000) });

/** Todaysメモを書き換える（空で消す。スタッフ全員） */
export async function PUT(request: Request, ctx: { params: Promise<{ date: string; laneId: string }> }) {
  try {
    const staff = requireStaff(request);
    const { date, laneId } = await ctx.params;
    const body = bodySchema.parse(await readJson(request));
    return json(setDayNote(dateParam.parse(date), idParam.parse(laneId), body.text, actorOf(staff)));
  } catch (err) {
    return errorResponse(err);
  }
}

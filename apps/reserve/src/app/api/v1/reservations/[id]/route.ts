import { reservationIdParam, updateReservationSchema } from "@/lib/domain/schemas";
import { errorResponse, json, readJson } from "@/lib/server/http";
import { actorOf, requireStaff } from "@/lib/server/session";
import { updateReservation } from "@/lib/server/store";

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const staff = requireStaff(request);
    const id = reservationIdParam.parse((await ctx.params).id);
    const input = updateReservationSchema.parse(await readJson(request));
    return json(updateReservation(id, input, actorOf(staff)));
  } catch (err) {
    return errorResponse(err);
  }
}

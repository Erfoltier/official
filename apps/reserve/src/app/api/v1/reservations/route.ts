import { createReservationSchema } from "@/lib/domain/schemas";
import { errorResponse, json, readJson } from "@/lib/server/http";
import { actorOf, requireStaff } from "@/lib/server/session";
import { createReservation } from "@/lib/server/store";

export async function POST(request: Request) {
  try {
    const staff = requireStaff(request);
    const input = createReservationSchema.parse(await readJson(request));
    return json(createReservation(input, actorOf(staff)), 201);
  } catch (err) {
    return errorResponse(err);
  }
}

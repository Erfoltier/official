import { createReservationSchema } from "@/lib/domain/schemas";
import { errorResponse, json, readJson } from "@/lib/server/http";
import { createReservation } from "@/lib/server/store";

export async function POST(request: Request) {
  try {
    const input = createReservationSchema.parse(await readJson(request));
    return json(createReservation(input), 201);
  } catch (err) {
    return errorResponse(err);
  }
}

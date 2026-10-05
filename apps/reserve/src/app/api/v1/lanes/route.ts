import { laneSchema } from "@/lib/domain/schemas";
import { errorResponse, json, readJson } from "@/lib/server/http";
import { actorOf, requireStaff } from "@/lib/server/session";
import { createLane } from "@/lib/server/store";

export async function POST(request: Request) {
  try {
    const staff = requireStaff(request, ["admin", "reception"]);
    return json(createLane(laneSchema.parse(await readJson(request)), actorOf(staff)), 201);
  } catch (err) {
    return errorResponse(err);
  }
}

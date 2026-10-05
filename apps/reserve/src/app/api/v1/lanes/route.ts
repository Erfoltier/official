import { laneSchema } from "@/lib/domain/schemas";
import { errorResponse, json, readJson } from "@/lib/server/http";
import { createLane } from "@/lib/server/store";

export async function POST(request: Request) {
  try {
    return json(createLane(laneSchema.parse(await readJson(request))), 201);
  } catch (err) {
    return errorResponse(err);
  }
}

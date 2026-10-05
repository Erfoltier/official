import { menuSchema } from "@/lib/domain/schemas";
import { errorResponse, json, readJson } from "@/lib/server/http";
import { actorOf , requireManager} from "@/lib/server/session";
import { createMenu } from "@/lib/server/store";

export async function POST(request: Request) {
  try {
    const staff = requireManager(request);
    return json(createMenu(menuSchema.parse(await readJson(request)), actorOf(staff)), 201);
  } catch (err) {
    return errorResponse(err);
  }
}

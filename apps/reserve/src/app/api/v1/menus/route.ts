import { menuSchema } from "@/lib/domain/schemas";
import { errorResponse, json, readJson } from "@/lib/server/http";
import { createMenu } from "@/lib/server/store";

export async function POST(request: Request) {
  try {
    return json(createMenu(menuSchema.parse(await readJson(request))), 201);
  } catch (err) {
    return errorResponse(err);
  }
}

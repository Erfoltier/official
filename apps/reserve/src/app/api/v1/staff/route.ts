import { createStaffSchema } from "@/lib/domain/schemas";
import { errorResponse, json, readJson } from "@/lib/server/http";
import { actorOf, requireStaff } from "@/lib/server/session";
import { createStaff, listStaff } from "@/lib/server/staff";

/** スタッフの管理は院長・管理者のみ */
export async function GET(request: Request) {
  try {
    requireStaff(request, ["admin"]);
    return json({ items: listStaff(true) });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const staff = requireStaff(request, ["admin"]);
    return json(createStaff(actorOf(staff), createStaffSchema.parse(await readJson(request))), 201);
  } catch (err) {
    return errorResponse(err);
  }
}

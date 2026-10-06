import { idParam, photoAssignSchema } from "@/lib/domain/schemas";
import { errorResponse, json, readJson } from "@/lib/server/http";
import { actorOf, requireStaff } from "@/lib/server/session";
import { assignPhotoInbox } from "@/lib/server/store";

/** 照合待ちの写真を患者に結びつける */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const staff = requireStaff(request);
    const { patientId } = photoAssignSchema.parse(await readJson(request));
    return json(assignPhotoInbox(idParam.parse((await ctx.params).id), patientId, actorOf(staff)));
  } catch (err) {
    return errorResponse(err);
  }
}

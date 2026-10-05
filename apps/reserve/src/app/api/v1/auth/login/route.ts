import { loginSchema } from "@/lib/domain/schemas";
import { errorResponse, readJson } from "@/lib/server/http";
import { createSessionToken, sessionCookie } from "@/lib/server/session";
import { audit, verifyPin } from "@/lib/server/staff";

export async function POST(request: Request) {
  try {
    const { staffId, pin } = loginSchema.parse(await readJson(request));
    const { staff, sessionVersion } = verifyPin(staffId, pin);
    audit({ id: staff.id, name: staff.name }, "ログイン");
    return Response.json(staff, {
      headers: { "Set-Cookie": sessionCookie(createSessionToken(staff.id, sessionVersion)), "Cache-Control": "no-store" },
    });
  } catch (err) {
    return errorResponse(err);
  }
}

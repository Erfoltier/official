import { clearSessionCookie, currentStaff, revokeCurrentSession } from "@/lib/server/session";
import { audit } from "@/lib/server/staff";

export async function POST(request: Request) {
  const staff = currentStaff(request);
  if (staff) {
    audit({ id: staff.id, name: staff.name }, "ログアウト");
    revokeCurrentSession(request);
  }
  return new Response(null, { status: 204, headers: { "Set-Cookie": clearSessionCookie(), "Cache-Control": "no-store" } });
}

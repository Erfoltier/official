import { idParam } from "@/lib/domain/schemas";
import { errorResponse } from "@/lib/server/http";
import { requireStaff } from "@/lib/server/session";
import { photoInboxContent } from "@/lib/server/store";

/** 照合待ちの写真の中身（確かめて結びつけるため） */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    requireStaff(request);
    const { item, bytes } = photoInboxContent(idParam.parse((await ctx.params).id));
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": item.type,
        "Content-Length": String(bytes.length),
        "Content-Disposition": `inline; filename="file"; filename*=UTF-8''${encodeURIComponent(item.name)}`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}

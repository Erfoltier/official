import { idParam } from "@/lib/domain/schemas";
import { errorResponse } from "@/lib/server/http";
import { requireStaff } from "@/lib/server/session";
import { noteAccess } from "@/lib/server/staff";
import { getFile } from "@/lib/server/store";

/**
 * ファイルの中身。写真・PDFはその場で表示し、Word はダウンロードさせる。
 * 他のページの部品として読み込まれないよう、表示の制限をかける。
 */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const staff = requireStaff(request);
    const id = idParam.parse((await ctx.params).id);
    const { meta, bytes } = getFile(id);
    noteAccess(staff, "ファイルを表示", `file:${id}`);
    const disposition = meta.kind === "doc" ? "attachment" : "inline";
    const headers: Record<string, string> = {
      "Content-Type": meta.type,
      "Content-Length": String(bytes.length),
      "Content-Disposition": `${disposition}; filename="file"; filename*=UTF-8''${encodeURIComponent(meta.name)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    };
    if (meta.kind !== "pdf") headers["Content-Security-Policy"] = "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox";
    return new Response(new Uint8Array(bytes), { headers });
  } catch (err) {
    return errorResponse(err);
  }
}

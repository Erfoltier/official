import { idParam } from "@/lib/domain/schemas";
import { errorResponse } from "@/lib/server/http";
import { requireStaff } from "@/lib/server/session";
import { getFile } from "@/lib/server/store";

/**
 * ファイルの中身。写真・PDFはその場で表示し、Word はダウンロードさせる。
 * 他のページの部品として読み込まれないよう、表示の制限をかける。
 */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    requireStaff(request);
    const { meta, bytes } = getFile(idParam.parse((await ctx.params).id));
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

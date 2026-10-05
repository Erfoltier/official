import type { NextRequest } from "next/server";
import { dateParam, idParam } from "@/lib/domain/schemas";
import { errorResponse, json, readBytes } from "@/lib/server/http";
import { actorOf, requireStaff } from "@/lib/server/session";
import { MAX_FILE_BYTES, listFiles, saveFile } from "@/lib/server/store";

/** 患者のファイル一覧。?date=YYYY-MM-DD でその日の分だけ */
export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    requireStaff(request);
    const id = idParam.parse((await ctx.params).id);
    const date = request.nextUrl.searchParams.get("date");
    return json({ items: listFiles(id, date === null ? undefined : dateParam.parse(date)) });
  } catch (err) {
    return errorResponse(err);
  }
}

/**
 * ファイルを追加する。本文はファイルそのもの（multipart ではない）。
 *   ?date=YYYY-MM-DD&reservationId=...   X-File-Name: （encodeURIComponent したファイル名）
 */
export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const staff = requireStaff(request);
    const id = idParam.parse((await ctx.params).id);
    const q = request.nextUrl.searchParams;
    const date = dateParam.parse(q.get("date"));
    const rid = q.get("reservationId");
    const reservationId = rid ? idParam.parse(rid) : undefined;
    let name = "";
    try {
      name = decodeURIComponent(request.headers.get("x-file-name") ?? "");
    } catch {
      name = "";
    }
    const bytes = await readBytes(request, MAX_FILE_BYTES);
    return json(saveFile(id, { date, reservationId, name, bytes }, actorOf(staff)), 201);
  } catch (err) {
    return errorResponse(err);
  }
}

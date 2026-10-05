import type { NextRequest } from "next/server";
import { idParam, mergePatientsSchema } from "@/lib/domain/schemas";
import { errorResponse, json, readJson } from "@/lib/server/http";
import { actorOf, requireStaff } from "@/lib/server/session";
import { getPatientDetail, mergePatients, previewMerge } from "@/lib/server/store";

/** 統合の事前確認：GET ?keep=...&dup=... */
export async function GET(request: NextRequest) {
  try {
    requireStaff(request, ["admin", "reception"]);
    const q = request.nextUrl.searchParams;
    return json(previewMerge(idParam.parse(q.get("keep")), idParam.parse(q.get("dup"))));
  } catch (err) {
    return errorResponse(err);
  }
}

/** 重複患者の統合。院長・管理者と受付のみ */
export async function POST(request: Request) {
  try {
    const staff = requireStaff(request, ["admin", "reception"]);
    const keep = mergePatients(mergePatientsSchema.parse(await readJson(request)), actorOf(staff));
    return json(getPatientDetail(keep.id));
  } catch (err) {
    return errorResponse(err);
  }
}

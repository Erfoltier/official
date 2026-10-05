import { idParam, integrationM3Schema } from "@/lib/domain/schemas";
import { checkIntegrationAuth, errorResponse, json, readJson } from "@/lib/server/http";
import { setPatientM3ChartNo } from "@/lib/server/store";

/**
 * 外部連携：患者に電子カルテ（M3）のカルテ番号を書き込む（空文字で削除）。
 *   POST /api/v1/integration/patients/{patientId}/m3-chart-no  {"m3ChartNo":"004567"}
 */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = checkIntegrationAuth(request);
  if (denied) return denied;
  try {
    const id = idParam.parse((await ctx.params).id);
    const { m3ChartNo } = integrationM3Schema.parse(await readJson(request));
    const p = setPatientM3ChartNo(id, m3ChartNo);
    return json({ patientId: p.id, m3ChartNo: p.m3ChartNo ?? null, version: p.version });
  } catch (err) {
    return errorResponse(err);
  }
}

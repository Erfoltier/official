import { describe, expect, it } from "vitest";
import { nowInClinic } from "@/lib/domain/time";
import { withPhp } from "./php/server";

const h = withPhp({ each: true });

describe("閲覧の記録", () => {
  it("患者を開いた記録が、名前つきで院長・管理者にだけ見え、見たことも操作の記録に残る", async () => {
    const c = await h.srv.as("staff-admin");
    const p = await c.post("/patients", { name: "閲覧 太郎", chartNo: "777" });
    await c.get(`/patients/${p.id}`);
    const today = nowInClinic().date;
    const log = await c.get(`/access-log?from=${today}&to=${today}`);
    expect(log.items[0]).toMatchObject({ action: "患者を表示", patientId: p.id, patientName: "閲覧 太郎", chartNo: "777" });
    expect((await c.get("/audit")).items[0].action).toBe("閲覧の記録を確認");
    const ns = await c.post("/staff", { name: "看護（閲覧）", role: "nurse", pin: "246810" });
    const nurse = await h.srv.as(ns.id, "246810");
    expect((await nurse.raw("GET", `/api/v1/access-log?from=${today}&to=${today}`)).status).toBe(403);
  });
});

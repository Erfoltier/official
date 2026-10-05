import { beforeEach, describe, expect, it } from "vitest";

const reset = () => {
  const g = globalThis as { __reserveStore?: unknown; __reserveStaff?: unknown };
  g.__reserveStore = undefined;
  g.__reserveStaff = undefined;
};

describe("スタッフのログイン", () => {
  beforeEach(reset);

  it("正しいPINでログインでき、改ざん・期限切れのトークンは無効", async () => {
    const staff = await import("@/lib/server/staff");
    const session = await import("@/lib/server/session");
    const { staff: s, sessionVersion } = staff.verifyPin("staff-ns1", staff.DEMO_PIN);
    const token = session.createSessionToken(s.id, sessionVersion);
    expect(session.readSessionToken(token)?.name).toBe("看護師A（デモ）");
    // 署名を壊す・中身を書き換える
    expect(session.readSessionToken(token.slice(0, -2) + "xx")).toBeNull();
    const [, mac] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ sid: "staff-admin", v: 1, exp: Date.now() + 1e6 })).toString("base64url");
    expect(session.readSessionToken(`${forged}.${mac}`)).toBeNull();
    // 期限切れ
    expect(session.readSessionToken(token, Date.now() + 13 * 3600_000)).toBeNull();
  });

  it("PIN変更・利用停止で既存のログインが切れる", async () => {
    const staff = await import("@/lib/server/staff");
    const session = await import("@/lib/server/session");
    const admin = { id: "staff-admin", name: "院長（デモ）" };
    const { sessionVersion } = staff.verifyPin("staff-rc1", "1234");
    const token = session.createSessionToken("staff-rc1", sessionVersion);
    staff.updateStaff(admin, "staff-rc1", { pin: "5678" });
    expect(session.readSessionToken(token)).toBeNull();
    expect(() => staff.verifyPin("staff-rc1", "1234")).toThrow(/違います/);
    staff.updateStaff(admin, "staff-rc1", { active: false });
    expect(() => staff.verifyPin("staff-rc1", "5678")).toThrow(/違います/);
  });

  it("PINを5回続けて間違えると5分ロック", async () => {
    const staff = await import("@/lib/server/staff");
    for (let i = 0; i < 4; i++) expect(() => staff.verifyPin("staff-dr", "0000")).toThrow(/違います/);
    expect(() => staff.verifyPin("staff-dr", "0000")).toThrow(/5分間/);
    expect(() => staff.verifyPin("staff-dr", "1234")).toThrow(/ログインできません/);
    expect(staff.verifyPin("staff-dr", "1234", Date.now() + 6 * 60_000).staff.id).toBe("staff-dr");
  });

  it("管理者がいなくなる変更はできない", async () => {
    const staff = await import("@/lib/server/staff");
    expect(() => staff.updateStaff({ id: "x", name: "x" }, "staff-admin", { role: "nurse" })).toThrow(/管理者/);
  });

  it("役割で操作を制限する", async () => {
    const staff = await import("@/lib/server/staff");
    const session = await import("@/lib/server/session");
    const { sessionVersion } = staff.verifyPin("staff-ns1", "1234");
    const req = new Request("http://x/", { headers: { cookie: `rsv_staff=${session.createSessionToken("staff-ns1", sessionVersion)}` } });
    expect(session.requireStaff(req).id).toBe("staff-ns1");
    expect(() => session.requireStaff(req, ["admin"])).toThrow(/権限/);
    expect(() => session.requireStaff(new Request("http://x/"))).toThrow(/ログイン/);
  });
});

describe("誰が変えたかの記録", () => {
  beforeEach(reset);

  it("患者情報・施術メモ・予約の変更に操作者が残り、操作ログにも入る", async () => {
    const s = await import("@/lib/server/store");
    const staff = await import("@/lib/server/staff");
    const ns = { id: "staff-ns1", name: "看護師A（デモ）" };
    const rc = { id: "staff-rc1", name: "受付A（デモ）" };
    const p = s.createPatient({ name: "山田 Anna" }, rc);
    s.updatePatient(p.id, { version: p.version, phone: "090-1111-2222" }, ns);
    const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
    s.saveVisitNote(p.id, today, { note: "HIFU 300ショット", skincare: [], version: 0 }, ns);
    const d = s.getPatientDetail(p.id);
    expect(d.history.map((h) => h.by?.name)).toEqual([ns.name, ns.name, rc.name]);
    expect(d.visits[0].noteUpdatedBy?.name).toBe(ns.name);

    const r = s.getDayBundle(today).reservations[0];
    const moved = s.updateReservation(r.id, { version: r.version, status: "arrived" }, rc);
    expect(moved.updatedBy?.name).toBe(rc.name);

    const log = staff.listAudit();
    expect(log[0]).toMatchObject({ actor: rc, target: r.id });
    expect(log.some((a) => a.action === "患者を登録" && a.actor.id === rc.id)).toBe(true);
    // 操作ログに患者情報の値（電話番号・メモ）は入らない
    expect(JSON.stringify(log)).not.toContain("090-1111-2222");
    expect(JSON.stringify(log)).not.toContain("300ショット");
  });
});

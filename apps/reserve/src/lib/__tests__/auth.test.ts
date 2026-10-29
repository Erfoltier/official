import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { nowInClinic } from "@/lib/domain/time";
import { startPhp, type Client, type PhpServer } from "./php/server";

let srv: PhpServer;
beforeAll(async () => {
  srv = await startPhp({ demo: true });
}, 60_000);
afterAll(() => srv?.close());

const tokenOf = (c: Client) => c.cookie.replace(/^rsv_staff=/, "");

/** Cookie だけを差し替えたブラウザ */
function withToken(token: string): Client {
  const c = srv.client();
  c.cookie = `rsv_staff=${token}`;
  return c;
}

describe("スタッフのログイン", () => {
  it("正しいPINでログインでき、改ざん・期限切れのトークンは無効", async () => {
    const c = await srv.as("staff-ns1");
    expect((await c.get("/auth/me")).name).toBe("看護師A（デモ）");
    const token = tokenOf(c);
    // 署名を壊す・中身を書き換える
    await expect(withToken(token.slice(0, -2) + "xx").get("/auth/me")).rejects.toThrow(/ログイン/);
    const [, mac] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ sid: "staff-admin", v: 1, exp: Date.now() + 1e6 })).toString("base64url");
    await expect(withToken(`${forged}.${mac}`).get("/auth/me")).rejects.toThrow(/ログイン/);
    // 期限切れ（12時間）
    const t = JSON.stringify(token);
    expect(await srv.php(`return Auth::readSessionToken(${t})['id'] ?? null;`)).toBe("staff-ns1");
    expect(await srv.php(`return Auth::readSessionToken(${t}, (int) floor(microtime(true) * 1000) + 13 * 3600_000);`)).toBeNull();
  });

  it("PIN変更・利用停止で既存のログインが切れる", async () => {
    const admin = await srv.as("staff-admin");
    const rc = await srv.as("staff-rc1");
    await admin.patch("/staff/staff-rc1", { pin: "567890" });
    await expect(admin.patch("/staff/staff-rc1", { pin: "5678" })).rejects.toThrow(/6〜8桁/);
    await expect(rc.get("/auth/me")).rejects.toThrow(/ログイン/);
    await expect(srv.client().login("staff-rc1", "1234")).rejects.toThrow(/違います/);
    await admin.patch("/staff/staff-rc1", { active: false });
    await expect(srv.client().login("staff-rc1", "567890")).rejects.toThrow(/違います/);
  });

  it("PINを5回続けて間違えると5分ロック", async () => {
    for (let i = 0; i < 4; i++) await expect(srv.client().login("staff-dr", "0000")).rejects.toThrow(/違います/);
    await expect(srv.client().login("staff-dr", "0000")).rejects.toThrow(/5分間/);
    await expect(srv.client().login("staff-dr", "1234")).rejects.toThrow(/ログインできません/);
    expect(await srv.php(`return Auth::verifyPin('staff-dr', '1234', (int) floor(microtime(true) * 1000) + 6 * 60_000)['staff']['id'];`)).toBe("staff-dr");
  });

  it("ロックが明けても失敗の回数は戻らず、間違えるたびにロックが倍になる（最長1日）", async () => {
    const r = await srv.php<string[]>(`
      $t0 = (int) floor(microtime(true) * 1000);
      $out = [];
      $try = function (string $pin, int $t) use (&$out) {
        try { Auth::verifyPin('staff-ns2', $pin, $t); $out[] = 'ok'; } catch (AuthError $e) { $out[] = $e->getMessage(); }
      };
      for ($i = 0; $i < 5; $i++) { $try('0000', $t0); }
      $try('0000', $t0 + 6 * 60_000);
      $try('1234', $t0 + 12 * 60_000);
      $out[] = Auth::lockMsFor(4);
      $out[] = Auth::lockMsFor(20);
      return $out;
    `);
    expect(r.slice(0, 4).every((m) => /違います/.test(m))).toBe(true);
    expect(r[4]).toMatch(/5分間/);
    expect(r[5]).toMatch(/10分間/);
    expect(r[6]).toMatch(/ログインできません/);
    expect(r[7]).toBe(0);
    expect(r[8]).toBe(24 * 3600_000);
  });

  it("ログアウトした Cookie は、期限内でも使えない", async () => {
    const a = await srv.as("staff-ns1");
    const b = await srv.as("staff-ns1");
    const token = tokenOf(a);
    await a.post("/auth/logout");
    expect(a.cookie).toBe("");
    await expect(withToken(token).get("/auth/me")).rejects.toThrow(/ログイン/);
    // ほかの端末のログインはそのまま
    expect((await b.get("/auth/me")).id).toBe("staff-ns1");
  });

  it("管理者がいなくなる変更はできない", async () => {
    const admin = await srv.as("staff-admin");
    await expect(admin.patch("/staff/staff-admin", { role: "nurse" })).rejects.toThrow(/管理者/);
  });

  it("役割で操作を制限する", async () => {
    const ns = await srv.as("staff-ns1");
    expect((await ns.get("/auth/me")).id).toBe("staff-ns1");
    await expect(ns.get("/staff")).rejects.toThrow(/権限/);
    await expect(srv.client().get("/auth/me")).rejects.toThrow(/ログイン/);
  });

  it("ほかのサイトから送られた変更の操作は断る", async () => {
    const ns = await srv.as("staff-ns1");
    const r = await ns.raw("POST", "/api/v1/patients", { name: "CSRF テスト" }, { Origin: "https://evil.example" });
    expect(r.status).toBe(403);
  });
});

describe("誰が変えたかの記録", () => {
  it("患者情報・施術メモ・予約の変更に操作者が残り、操作ログにも入る", async () => {
    const admin = await srv.as("staff-admin");
    // ほかのテストでロック・停止したスタッフを避けて、新しく2人追加する
    const nsName = "看護師C";
    const rcName = "受付C";
    const nsRec = await admin.post("/staff", { name: nsName, role: "nurse", pin: "246810" });
    const rcRec = await admin.post("/staff", { name: rcName, role: "reception", pin: "135790" });
    const ns = await srv.as(nsRec.id, "246810");
    const rc = await srv.as(rcRec.id, "135790");
    const p = await rc.post("/patients", { name: "山田 Anna" });
    await ns.patch(`/patients/${p.id}`, { version: p.version, phone: "090-1111-2222" });
    const today = nowInClinic().date;
    await ns.put(`/patients/${p.id}/visits/${today}`, { note: "HIFU 300ショット", skincare: [], version: 0 });
    const d = await ns.get(`/patients/${p.id}`);
    expect(d.history.map((h: { by?: { name: string } }) => h.by?.name)).toEqual([nsName, nsName, rcName]);
    expect(d.visits[0].noteUpdatedBy?.name).toBe(nsName);

    const r = (await rc.get(`/day?date=${today}`)).reservations.find((x: { status: string }) => x.status !== "cancelled");
    const moved = await rc.patch(`/reservations/${r.id}`, { version: r.version, status: "arrived" });
    expect(moved.updatedBy?.name).toBe(rcName);

    const log = (await admin.get("/audit")).items;
    expect(log[0]).toMatchObject({ actor: { id: rcRec.id, name: rcName }, target: r.id });
    expect(log.some((a: { action: string; actor: { id: string } }) => a.action === "患者を登録" && a.actor.id === rcRec.id)).toBe(true);
    // 操作ログに患者情報の値（電話番号・メモ）は入らない
    expect(JSON.stringify(log)).not.toContain("090-1111-2222");
    expect(JSON.stringify(log)).not.toContain("300ショット");
  });
});

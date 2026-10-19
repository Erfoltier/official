import { describe, expect, it } from "vitest";
import { withPhp, type Client } from "./php/server";

const h = withPhp({ each: true });

/** 自動予約プログラムと同じ送り方（鍵は 設定 → 外部機器の連携 →「自動予約」で発行） */
async function bot(c: Client, source = "booking") {
  const { token } = await c.post("/device-links", { source, name: "ChatGPT 自動予約" });
  const call = async (method: string, p: string, body?: unknown) => {
    const r = await h.srv.client().raw(method, `/api/v1/integration/booking${p}`, body, { "X-Booking-Token": token });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- 返り値の形は各テストで確かめる
    return r as { status: number; data: any };
  };
  return call;
}

/** 明日の JST の日付と、その日の時刻（ISO） */
function tomorrow(hm: string) {
  const d = new Date(Date.now() + 9 * 3600_000 + 86400_000).toISOString().slice(0, 10);
  return { date: d, at: `${d}T${hm}:00+09:00` };
}

describe("自動予約プログラムの連携", () => {
  it("鍵がない・ほかの連携の鍵では入れない", async () => {
    const c = await h.srv.as("staff-admin");
    const none = await h.srv.client().raw("GET", "/api/v1/integration/booking/ping");
    expect(none.status).toBe(401);
    const google = await bot(c, "google");
    expect((await google("GET", "/ping")).status).toBe(401);
    const ok = await bot(c);
    expect((await ok("GET", "/ping")).data).toMatchObject({ ok: true, name: "ChatGPT 自動予約" });
    // 予約の鍵では、ほかの連携（問診票の受け取りなど）には入れない
    const { token } = await c.post("/device-links", { source: "booking" });
    const other = await h.srv.client().raw("POST", "/api/v1/integration/questionnaires", { responses: [] }, { "X-Integration-Token": token });
    expect([401, 503]).toContain(other.status);
  });

  it("患者を探して（いなければ登録して）予約を入れ、変更し、取り消す", async () => {
    const c = await h.srv.as("staff-admin");
    const call = await bot(c);
    const opt = (await call("GET", "/options")).data;
    expect(opt.lanes.length).toBeGreaterThan(0);
    expect(opt.menus.length).toBeGreaterThan(0);
    const lane = opt.lanes[0].id;
    const menu = opt.menus[0].id;

    const p1 = await call("POST", "/patients", { name: "予約 花子", kana: "ヨヤク ハナコ", birthDate: "1990-04-01", phone: "090-1111-2222" });
    expect(p1.status).toBe(200);
    expect(p1.data.created).toBe(true);
    expect(p1.data.patient).toMatchObject({ name: "予約 花子", phoneLast4: "2222" });
    expect(p1.data.patient.phone).toBeUndefined();
    // 2回目は同じ人
    const p2 = await call("POST", "/patients", { name: "予約 花子", kana: "ヨヤクハナコ", birthDate: "1990-04-01" });
    expect(p2.data).toMatchObject({ created: false, patient: { id: p1.data.patient.id } });
    // 新しく登録した人はスタッフの「要確認」に出る
    expect((await c.get("/admin/air-sync")).review.map((x: { id: string }) => x.id)).toContain(p1.data.patient.id);

    const t = tomorrow("10:00");
    const made = await call("POST", "/reservations", { patientId: p1.data.patient.id, laneId: lane, menuIds: [menu], startAt: t.at, endAt: tomorrow("10:30").at, memo: "ChatGPTから" });
    expect(made.status).toBe(201);
    expect(made.data).toMatchObject({ status: "booked", version: 1, laneId: lane });
    // 同じレーン・重なる時間は断る
    const dup = await call("POST", "/reservations", { patientId: p1.data.patient.id, laneId: lane, menuIds: [menu], startAt: tomorrow("10:15").at, endAt: tomorrow("10:45").at });
    expect(dup.status).toBe(409);

    const day = (await call("GET", `/day?date=${t.date}`)).data;
    expect(day.reservations.map((r: { id: string }) => r.id)).toContain(made.data.id);

    const moved = await call("PATCH", `/reservations/${made.data.id}`, { version: 1, startAt: tomorrow("11:00").at, endAt: tomorrow("11:30").at });
    expect(moved.status).toBe(200);
    expect(moved.data.version).toBe(2);
    // 古い version では変えられない
    expect((await call("PATCH", `/reservations/${made.data.id}`, { version: 1, memo: "x" })).status).toBe(409);
    // 状態など、予約の日時・レーン・メニュー・メモ以外は変えられない
    expect((await call("PATCH", `/reservations/${made.data.id}`, { version: 2, status: "done" })).status).toBe(400);

    const cancelled = await call("POST", `/reservations/${made.data.id}/cancel`, { version: 2 });
    expect(cancelled.data.status).toBe("cancelled");
    expect((await call("PATCH", `/reservations/${made.data.id}`, { version: 3, memo: "x" })).status).toBe(400);

    // 予約に戻す（status: booked）・メモと予約申請IDを直す
    const back = await call("PATCH", `/reservations/${made.data.id}`, { version: 3, status: "booked", memo: "戻した", requestId: "R2026101710000012AB34CD" });
    expect(back.status).toBe(200);
    expect(back.data).toMatchObject({ status: "booked", memo: "戻した", requestId: "R2026101710000012AB34CD" });
    // DELETE でも取り消せる
    expect((await call("DELETE", `/reservations/${made.data.id}`, { version: 4 })).data.status).toBe("cancelled");

    // 付けたいメニューがなければ作れる。作ったメニューを予約に足す
    const menu2 = await call("POST", "/menus", { name: "自動予約テスト施術", duration: { kind: "fixed", minutes: 30 } });
    expect(menu2.status).toBe(201);
    expect((await call("GET", "/options")).data.menus.map((m: { id: string }) => m.id)).toContain(menu2.data.id);
    const two = await call("POST", "/reservations", { patientId: p1.data.patient.id, laneId: lane, menuIds: [menu, menu2.data.id], startAt: tomorrow("15:00").at, endAt: tomorrow("15:30").at });
    expect(two.status).toBe(201);
    expect(two.data.menuIds).toEqual([menu, menu2.data.id]);

    // 変更履歴には自動予約がしたことが残る
    const audit = await c.get("/audit");
    expect(JSON.stringify(audit)).toContain("自動予約（ChatGPT 自動予約）");
  });

  it("Airリザーブで入れた予約は変えられない・過去には入れられない", async () => {
    const c = await h.srv.as("staff-admin");
    const call = await bot(c);
    const opt = (await call("GET", "/options")).data;
    const pt = await c.post("/patients", { name: "エア 太郎", kana: "エア タロウ" });
    const air = await c.post("/reservations", { patientId: pt.id, laneId: opt.lanes[0].id, menuIds: [opt.menus[0].id], startAt: tomorrow("14:00").at, endAt: tomorrow("14:30").at, memo: "Air予約番号：ABC123" });
    const r = await call("POST", `/reservations/${air.id}/cancel`, { version: 1 });
    expect(r.status).toBe(400);
    expect(r.data.message).toContain("Airリザーブ");
    const past = await call("POST", "/reservations", { patientId: pt.id, laneId: opt.lanes[0].id, menuIds: [opt.menus[0].id], startAt: "2020-01-01T10:00:00+09:00", endAt: "2020-01-01T10:30:00+09:00" });
    expect(past.status).toBe(400);
  });
});

describe("自動予約プログラムから、スタッフの画面と同じ API を使う", () => {
  it("患者・カルテ・設定を見て変えられる。スタッフ・鍵・ログインの操作はできない", async () => {
    const c = await h.srv.as("staff-admin");
    const call = await bot(c);
    const api = (method: string, p: string, body?: unknown) => call(method, `/api${p}`, body);
    const pt = await c.post("/patients", { name: "カルテ 花子", kana: "カルテ ハナコ" });
    const got = await api("GET", `/patients/${pt.id}`);
    expect(got.status).toBe(200);
    expect(JSON.stringify(got.data)).toContain("カルテ 花子");
    const edited = await api("PATCH", `/patients/${pt.id}`, { version: pt.version, memo: "自動予約から" });
    expect(edited.status).toBe(200);
    expect((await c.get(`/patients/${pt.id}`)).patient?.memo ?? edited.data.memo).toBe("自動予約から");
    expect((await api("GET", "/settings")).status).toBe(200);
    // 閲覧の記録は「自動予約（キーの名前）」で残る
    const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
    expect(JSON.stringify(await c.get(`/access-log?from=${today}&to=${today}`))).toContain("自動予約（ChatGPT 自動予約）");
    for (const [m, p] of [["GET", "/staff"], ["POST", "/device-links"], ["GET", "/auth/me"], ["GET", "/security"], ["POST", "/settings/restore"], ["GET", ""]]) {
      expect((await api(m, p, m === "POST" ? {} : undefined)).status, `${m} ${p}`).toBe(403);
    }
    // 鍵がなければ入れない
    expect((await h.srv.client().raw("GET", "/api/v1/integration/booking/api/settings")).status).toBe(401);
  });
});

describe("Air 終了（院長の合図）", () => {
  it("確かめの言葉がないと止めない。終了後は Air から取り込んだ予約も自動予約から変えられ、設定は変えられない", async () => {
    const c = await h.srv.as("staff-admin");
    const call = await bot(c);
    const opt = (await call("GET", "/options")).data;
    const pt = await c.post("/patients", { name: "エア 花子", kana: "エア ハナコ" });
    const air = await c.post("/reservations", { patientId: pt.id, laneId: opt.lanes[0].id, menuIds: [opt.menus[0].id], startAt: tomorrow("15:00").at, endAt: tomorrow("15:30").at, memo: "Air予約番号：XYZ789" });
    expect((await call("GET", `/reservations/${air.id}`)).data.fromAir).toBe(true);
    expect((await call("POST", `/reservations/${air.id}/cancel`, { version: 1 })).status).toBe(400);

    const bad = await h.srv.client().raw("POST", "/api/v1/admin/air-sync/retire", { confirm: "x" });
    expect(bad.status).not.toBe(200);
    expect((await c.get("/admin/air-sync")).retired).toBeNull();
    const done = await c.post("/admin/air-sync/retire", { confirm: "Air終了" });
    expect(done.at).toBeTruthy();
    const st = await c.get("/admin/air-sync");
    expect(st.retired.at).toBe(done.at);
    expect(st).toMatchObject({ enabled: false, interval: 0, loginConfigured: false });
    await expect(c.put("/admin/air-sync", { enabled: true })).rejects.toThrow();
    // 2回目は何もしない
    expect((await c.post("/admin/air-sync/retire", { confirm: "Air終了" })).already).toBe(true);

    expect((await call("GET", `/reservations/${air.id}`)).data.fromAir).toBeUndefined();
    const cancelled = await call("POST", `/reservations/${air.id}/cancel`, { version: 1 });
    expect(cancelled.status).toBe(200);
    expect(cancelled.data.status).toBe("cancelled");
  });
});

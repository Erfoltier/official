/* eslint-disable @typescript-eslint/no-explicit-any -- テストでは応答の JSON をそのまま調べる */
import { describe, expect, it } from "vitest";
import { addDays, nowInClinic, toIso } from "@/lib/domain/time";
import { withPhp } from "./php/server";

// オンラインカウンセリングの Web 予約（monshin/cs/）：開けた日時のレーンの空き15分枠だけを選べ、その場で予約が入る
const h = withPhp({ each: true });
const LANE = "lane-main";

async function open(day: string, extra: object = {}) {
  const c = await h.srv.as("staff-admin");
  await c.patch("/clinic", { onlineCsEnabled: true, onlineCsLaneId: LANE, onlineCsSlots: [`${day} 14:00-15:00`], ...extra });
  return c;
}
const slots = async () => (await (await fetch(`${h.srv.base}/monshin/cs/api.php`)).json()) as any;
const book = async (body: object) => {
  const res = await fetch(`${h.srv.base}/monshin/cs/api.php`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { status: res.status, data: (await res.json()) as any };
};
const person = (day: string, time: string, phone = "09011112222") => ({
  name: "相談 花子",
  kana: "ソウダン ハナコ",
  birthDate: "1990-01-01",
  phone,
  email: "hanako@example.jp",
  lineName: "はなこ",
  orderNo: "#1001",
  jointUseConsent: "agreed",
  date: day,
  time,
});

describe("オンラインカウンセリングの Web 予約", () => {
  it("開けた日時の空き枠だけを出し、選ぶとその場でレーンに入る。同じ枠には二重に入らない", async () => {
    const day = addDays(nowInClinic().date, 3);
    const c = await open(day);
    await expect(c.patch("/clinic", { onlineCsSlots: ["2026-11-20 14時から"] })).rejects.toThrow(/受付日時の形/);
    // レーンに入っている 14:15-14:30 の予約と重なる枠は出さない
    const p = await c.post("/patients", { name: "枠 太郎", kana: "ワク タロウ", birthDate: "1980-01-01" });
    await c.post("/reservations", { patientId: p.id, laneId: LANE, menuIds: ["menu-s00009A18E"], startAt: toIso(day, 855), endAt: toIso(day, 870) });
    expect((await slots()).slots).toEqual({ [day]: ["14:00", "14:30", "14:45"] });

    const ok = await book(person(day, "14:00"));
    expect(ok.status).toBe(201);
    expect(ok.data).toMatchObject({ ok: true, date: day, time: "14:00", mailed: false });
    expect((await slots()).slots).toEqual({ [day]: ["14:30", "14:45"] });
    const bundle = await c.get(`/day?date=${day}`);
    const r = bundle.reservations.find((x: any) => x.laneId === LANE && x.startAt === toIso(day, 840));
    expect(r.memo).toContain("注文番号：#1001");
    expect(r.memo).toContain("LINEの表示名：はなこ");
    expect(bundle.patients.find((x: any) => x.id === r.patientId)).toMatchObject({ name: "相談 花子", email: "hanako@example.jp" });

    expect((await book(person(day, "14:00"))).data.error).toBe("slot_taken");
    expect((await book(person(day, "14:15"))).status).toBe(409);
    const bad = await book({ ...person(day, "14:30"), jointUseConsent: "", email: "x" });
    expect(bad.status).toBe(422);
    expect(bad.data.fields).toEqual(expect.arrayContaining(["email", "jointUseConsent"]));
  });

  it("受け付けないときは枠を出さず、送っても断る。同じ電話番号からは1日3件まで", async () => {
    const day = addDays(nowInClinic().date, 4);
    const c = await open(day, { onlineCsEnabled: false });
    expect((await slots()).slots).toEqual({});
    expect((await book(person(day, "14:00"))).status).toBe(403);
    await c.patch("/clinic", { onlineCsEnabled: true });
    for (const t of ["14:00", "14:15", "14:30"]) expect((await book(person(day, t, "09033334444"))).status).toBe(201);
    expect((await book(person(day, "14:45", "09033334444"))).data.error).toBe("rate_limited");
  });

  it("予約ページはシミクレールのサイトにだけ埋め込める。確定のメールの文面に「医師」「診察」「患者」を使わない", async () => {
    const day = addDays(nowInClinic().date, 5);
    await open(day);
    const res = await fetch(`${h.srv.base}/monshin/cs/`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-security-policy")).toContain("frame-ancestors 'self' https://simiclair.myshopify.com");
    expect(res.headers.get("x-frame-options")).toBeNull();
    const html = await res.text();
    expect(html).toContain("オンラインカウンセリングのご予約");
    expect(html).not.toMatch(/医師|診察|患者/);
    const out = await h.srv.php(`
      Db::i()->setMeta('reminderSettings', [...Reminder::defaults(), 'fromEmail' => 'info@example.jp']);
      $sent = [];
      Reminder::$transport = function ($m, $to, $headers, $body) use (&$sent) { $sent[] = [$to, $body]; return [200, '']; };
      $r = OnlineCs::book(['name' => '相談 花子', 'kana' => 'ソウダン ハナコ', 'birthDate' => '1990-01-01', 'phone' => '09055556666', 'email' => 'hanako@example.jp', 'orderNo' => '', 'jointUseConsent' => 'agreed', 'date' => '${day}', 'time' => '14:30'], '127.0.0.9');
      return ['r' => $r, 'sent' => $sent];
    `);
    expect(out.r).toMatchObject({ ok: true, mailed: true });
    expect(out.sent[0][0]).toBe("hanako@example.jp");
    expect(out.sent[0][1]).toContain("14:30〜14:45");
    expect(out.sent[0][1]).toContain("通話リクエスト");
    expect(out.sent[0][1]).not.toMatch(/医師|診察|患者/);
  });
});

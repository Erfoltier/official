/* eslint-disable @typescript-eslint/no-explicit-any -- テストでは応答の JSON をそのまま調べる */
import { describe, expect, it } from "vitest";
import { addDays, nowInClinic, toIso } from "@/lib/domain/time";
import { withPhp } from "./php/server";

// タトゥー・アートメイク除去（日曜）の Web 予約（monshin/tattoo/）：
// 面積で照射の時間が決まり、初診は説明10分。選べる時刻は空きの最初と最後だけ（予約の間に半端な空きを作らない）
const h = withPhp({ each: true });
const MAIN = "lane-main";
const NURSE = "lane-4";
const MENU = "menu-s000099DC1";

async function open(day: string, extra: object = {}) {
  const c = await h.srv.as("staff-admin");
  await c.patch("/clinic", { tattooEnabled: true, tattooLaneId: MAIN, tattooMenuId: MENU, tattooExplainLaneId: "", tattooSlots: [`${day} 10:00-12:00`], ...extra });
  return c;
}
const slots = async (area: number, visit: "first" | "repeat") => (await (await fetch(`${h.srv.base}/monshin/tattoo/api.php?area=${area}&visit=${visit}`)).json()) as any;
const book = async (body: object) => {
  const res = await fetch(`${h.srv.base}/monshin/tattoo/api.php`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { status: res.status, data: (await res.json()) as any };
};
const person = (day: string, time: string, extra: object = {}, phone = "09011112222") => ({
  kind: "tattoo",
  visit: "repeat",
  rects: [[2, 2.5]],
  color: "black",
  part: "左腕",
  anesthesia: "no",
  name: "除去 花子",
  kana: "ジョキョ ハナコ",
  birthDate: "1990-01-01",
  phone,
  email: "hanako@example.jp",
  date: day,
  time,
  ...extra,
});
const mainOn = async (c: any, day: string) =>
  (await c.get(`/day?date=${day}`)).reservations
    .filter((r: any) => r.laneId === MAIN && r.status !== "cancelled")
    .map((r: any) => [r.startAt, r.endAt])
    .sort();

describe("タトゥー除去（日曜）の Web 予約", () => {
  it("照射の時間と料金は面積で決まる", async () => {
    const out = await h.srv.php(`
      return [
        array_map(fn($a) => TattooBooking::treatMinutes($a), [5, 10, 10.1, 30, 50, 150, 300, 301, 310, 400]),
        array_map(fn($a) => TattooBooking::price($a), [5, 10, 30, 50, 60, 76, 100, 150]),
        TattooBooking::areaOf([[1.5, 6], [1.5, 6]]), TattooBooking::areaOf([[0, 6]]), TattooBooking::areaOf([[1, 1], [1, 1], [1, 1]]),
      ];
    `);
    expect(out[0]).toEqual([5, 5, 10, 10, 15, 20, 30, 31, 31, 40]);
    expect(out[1]).toEqual([29700, 38500, 49500, 59400, 70400, 92400, 114400, 169400]);
    expect(out[2]).toBe(18);
    expect(out[3]).toBeNull();
    expect(out[4]).toBeNull();
  });

  it("選べる時刻は空きの最初と最後だけ。予約が前後から隙間なく並ぶ", async () => {
    const day = addDays(nowInClinic().date, 3);
    const c = await open(day);
    await expect(c.patch("/clinic", { tattooSlots: ["2026-12-06 10時から"] })).rejects.toThrow(/受付日時の形/);
    // 再診・〜10cm²（5分）：10:00 と 11:55 だけ
    expect((await slots(5, "repeat")).slots).toEqual({ [day]: ["10:00", "11:55"] });
    expect((await book(person(day, "10:30"))).data.error).toBe("slot_taken");
    expect((await book(person(day, "10:00"))).status).toBe(201);
    // 再診・〜50cm²（15分）：前は 10:05 から、後ろは 11:45 から
    expect((await slots(40, "repeat")).slots).toEqual({ [day]: ["10:05", "11:45"] });
    expect((await book(person(day, "11:45", { rects: [[5, 8]] }, "09022223333"))).status).toBe(201);
    // 初診（説明10分を同じレーンで）・〜30cm²（10分）：20分の枠
    expect((await slots(20, "first")).slots).toEqual({ [day]: ["10:05", "11:25"] });
    expect((await book(person(day, "11:25", { visit: "first", rects: [[4, 5]] }, "09033334444"))).status).toBe(201);
    expect(await mainOn(c, day)).toEqual([
      [toIso(day, 600), toIso(day, 605)],
      [toIso(day, 685), toIso(day, 705)],
      [toIso(day, 705), toIso(day, 720)],
    ]);
    // 大きすぎて入らない面積は出さない（空きは 10:05〜11:25 の80分）
    expect((await slots(1000, "repeat")).slots).toEqual({});
  });

  it("初診の説明は隣のレーンで照射の直前に取る。空いていなければ照射のレーンに続けて取る", async () => {
    const day = addDays(nowInClinic().date, 4);
    const c = await open(day, { tattooExplainLaneId: NURSE });
    // 前の端は説明が受付時間帯の前にはみ出すので照射のレーンで（10:00 来院・10:10 照射）、後ろの端は説明のレーンで（11:45 来院・11:55 照射）
    expect((await slots(5, "first")).slots).toEqual({ [day]: ["10:00", "11:45"] });
    expect((await book(person(day, "11:45", { visit: "first" }))).status).toBe(201);
    const bundle = await c.get(`/day?date=${day}`);
    const nurse = bundle.reservations.find((r: any) => r.laneId === NURSE);
    const main = bundle.reservations.find((r: any) => r.laneId === MAIN);
    expect([nurse.startAt, nurse.endAt]).toEqual([toIso(day, 705), toIso(day, 715)]);
    expect([main.startAt, main.endAt]).toEqual([toIso(day, 715), toIso(day, 720)]);
    expect(main.memo).toContain("初診説明：10分（説明のレーン）");
    expect(main.memo).toContain("面積：5cm²（照射5分）");
    expect(main.memo).toContain("料金の目安：29,700円");
    // 後ろの端は照射が 11:50、説明は 11:40〜。説明のレーンがそこで埋まっていれば、照射のレーンで説明＋照射（11:40〜11:55）をまとめて取る
    expect((await slots(5, "first")).slots).toEqual({ [day]: ["10:00", "11:40"] });
    const p = await c.post("/patients", { name: "看護 太郎", kana: "カンゴ タロウ", birthDate: "1980-01-01" });
    await c.post("/reservations", { patientId: p.id, laneId: NURSE, menuIds: [MENU], startAt: toIso(day, 690), endAt: toIso(day, 705) });
    const got = await slots(5, "first");
    expect(got.slots).toEqual({ [day]: ["10:00", "11:40"] });
    expect((await book(person(day, "11:40", { visit: "first" }, "09077778888"))).status).toBe(201);
    const after = (await c.get(`/day?date=${day}`)).reservations.filter((r: any) => r.laneId === NURSE).length;
    expect(after).toBe(2);
    expect(await mainOn(c, day)).toContainEqual([toIso(day, 700), toIso(day, 715)]);
  });

  it("受け付けないときは時刻を出さず、送っても断る。画面と文面に仕組みの言葉を出さない", async () => {
    const day = addDays(nowInClinic().date, 5);
    const c = await open(day, { tattooEnabled: false });
    expect((await slots(5, "repeat")).slots).toEqual({});
    expect((await book(person(day, "10:00"))).status).toBe(403);
    await c.patch("/clinic", { tattooEnabled: true });
    const html = await (await fetch(`${h.srv.base}/monshin/tattoo/`)).text();
    expect(html).toContain("タトゥー・アートメイク除去のご予約");
    expect(html).not.toMatch(/詰め|空きの最初|最後だけ/);
    const bad = await book({ ...person(day, "10:00"), rects: [[0, 1]], email: "x" });
    expect(bad.status).toBe(422);
    expect(bad.data.fields).toEqual(expect.arrayContaining(["area", "email"]));
    const out = await h.srv.php(`
      Db::i()->setMeta('reminderSettings', [...Reminder::defaults(), 'fromEmail' => 'info@example.jp']);
      $sent = [];
      Reminder::$transport = function ($m, $to, $headers, $body) use (&$sent) { $sent[] = [$to, $body]; return [200, '']; };
      $r = TattooBooking::book(['kind' => 'artmake', 'visit' => 'first', 'rects' => [[1.5, 6], [1.5, 6]], 'anesthesia' => 'yes', 'name' => '眉 花子', 'kana' => 'マユ ハナコ', 'birthDate' => '1990-01-01', 'phone' => '09055556666', 'email' => 'mayu@example.jp', 'date' => '${day}', 'time' => '10:00'], '127.0.0.9');
      return ['r' => $r, 'sent' => $sent];
    `);
    expect(out.r).toMatchObject({ ok: true, mailed: true, time: "10:00", end: "10:20" });
    expect(out.sent[0][1]).toContain("アートメイク除去のご予約を承りました");
    expect(out.sent[0][1]).toContain("希望照射面積：18cm²");
    expect(out.sent[0][1]).toContain("49,500円");
    expect(out.sent[0][1]).toContain("日曜日の診療");
    expect(out.sent[0][1]).not.toMatch(/詰め/);
  });
});

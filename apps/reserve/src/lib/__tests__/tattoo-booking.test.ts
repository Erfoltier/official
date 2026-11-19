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

  it("選べる時刻は空きの最初と、後ろに予約がある空きの最後だけ。空いた日は受付の最初の時刻だけ", async () => {
    const day = addDays(nowInClinic().date, 3);
    const c = await open(day);
    await expect(c.patch("/clinic", { tattooSlots: ["2026-12-06 10時から"] })).rejects.toThrow(/受付日時の形/);
    // 空いた日は 10:00 だけ（受付の終わりから逆算した 11:55 は出さない）
    expect((await slots(5, "repeat")).slots).toEqual({ [day]: ["10:00"] });
    expect((await slots(20, "first")).duration).toBe("約20分（ご説明10分・照射10分）");
    expect((await slots(5, "repeat")).duration).toBe("約5分（照射）");
    expect((await book(person(day, "11:55"))).data.error).toBe("slot_taken");
    expect((await book(person(day, "10:00"))).status).toBe(201);
    // 前の予約のすぐ後ろから（〜50cm²・15分）
    expect((await slots(40, "repeat")).slots).toEqual({ [day]: ["10:05"] });
    expect((await book(person(day, "10:05", { rects: [[5, 8]] }, "09022223333"))).status).toBe(201);
    // スタッフが 11:30〜12:00 に入れた予約があると、その前の空きは最初（10:20）と最後（初診20分なら 11:10）の両方
    const p = await c.post("/patients", { name: "院内 太郎", kana: "インナイ タロウ", birthDate: "1980-01-01" });
    await c.post("/reservations", { patientId: p.id, laneId: MAIN, menuIds: [MENU], startAt: toIso(day, 690), endAt: toIso(day, 720) });
    expect((await slots(20, "first")).slots).toEqual({ [day]: ["10:20", "11:10"] });
    expect((await book(person(day, "11:10", { visit: "first", rects: [[4, 5]] }, "09033334444"))).status).toBe(201);
    expect(await mainOn(c, day)).toEqual([
      [toIso(day, 600), toIso(day, 605)],
      [toIso(day, 605), toIso(day, 620)],
      [toIso(day, 670), toIso(day, 690)],
      [toIso(day, 690), toIso(day, 720)],
    ]);
    // 大きすぎて入らない面積は出さない（空きは 10:20〜11:10 の50分）
    expect((await slots(1000, "repeat")).slots).toEqual({});
  });

  it("初診の説明は隣のレーンで照射の直前に取る。空いていなければ照射のレーンに続けて取る", async () => {
    const day = addDays(nowInClinic().date, 4);
    const c = await open(day, { tattooExplainLaneId: NURSE });
    // 空いた日の最初は、説明が受付時間帯の前にはみ出すので照射のレーンで（10:00 来院・10:10 照射）
    expect((await slots(5, "first")).slots).toEqual({ [day]: ["10:00"] });
    // 10:00〜10:10 に再診が入ると、次の初診は説明を隣のレーンで 10:00〜10:10、照射は 10:10〜
    expect((await book(person(day, "10:00", { rects: [[4, 5]] }))).status).toBe(201);
    expect((await slots(5, "first")).slots).toEqual({ [day]: ["10:00"] });
    expect((await book(person(day, "10:00", { visit: "first" }, "09066667777"))).status).toBe(201);
    const bundle = await c.get(`/day?date=${day}`);
    const nurse = bundle.reservations.find((r: any) => r.laneId === NURSE);
    expect([nurse.startAt, nurse.endAt]).toEqual([toIso(day, 600), toIso(day, 610)]);
    const main = bundle.reservations.find((r: any) => r.laneId === MAIN && r.memo.includes("初診"));
    expect([main.startAt, main.endAt]).toEqual([toIso(day, 610), toIso(day, 615)]);
    expect(main.memo).toContain("初診説明：10分（説明のレーン）");
    expect(main.memo).toContain("面積：5cm²（照射5分）");
    expect(main.memo).toContain("料金の目安：29,700円");
    // 次は照射が 10:15、説明は 10:05〜。説明のレーンが埋まっているので、照射のレーンで説明＋照射（10:15〜10:30）をまとめて取る
    expect((await slots(5, "first")).slots).toEqual({ [day]: ["10:15"] });
    expect((await book(person(day, "10:15", { visit: "first" }, "09077778888"))).status).toBe(201);
    expect((await c.get(`/day?date=${day}`)).reservations.filter((r: any) => r.laneId === NURSE).length).toBe(1);
    expect(await mainOn(c, day)).toContainEqual([toIso(day, 615), toIso(day, 630)]);
  });

  it("初診は2か月先まで。再診は開けた日すべて", async () => {
    const near = addDays(nowInClinic().date, 6);
    const far = addDays(nowInClinic().date, 70);
    await open(near, { tattooSlots: [`${near} 10:00-12:00`, `${far} 10:00-12:00`] });
    expect(Object.keys((await slots(5, "first")).slots)).toEqual([near]);
    expect(Object.keys((await slots(5, "repeat")).slots)).toEqual([near, far]);
    expect((await book(person(far, "10:00", { visit: "first" }))).data.error).toBe("slot_taken");
  });

  it("受け付けないときは時刻を出さず、送っても断る。画面と文面に仕組みの言葉を出さない", async () => {
    const day = addDays(nowInClinic().date, 5);
    const c = await open(day, { tattooEnabled: false, accessUrl: "https://example.jp/clinic/access/" });
    expect((await slots(5, "repeat")).slots).toEqual({});
    expect((await book(person(day, "10:00"))).status).toBe(403);
    await c.patch("/clinic", { tattooEnabled: true });
    const html = await (await fetch(`${h.srv.base}/monshin/tattoo/`)).text();
    expect(html).toContain("タトゥー・アートメイク除去のご予約");
    expect(html).not.toMatch(/詰め|空きの最初|最後だけ/);
    expect(html).toContain("美容皮膚科予約済の方専用入口");
    expect(html).toContain("「到着済」");
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
    expect(out.r).toMatchObject({ ok: true, mailed: true, time: "10:00", end: "10:20", duration: "約20分（ご説明10分・照射10分）" });
    expect(out.sent[0][1]).toContain("10:00〜10:20");
    expect(out.sent[0][1]).toContain("所要時間：約20分（ご説明10分・照射10分）");
    expect(out.sent[0][1]).toContain("アートメイク除去のご予約を承りました");
    expect(out.sent[0][1]).toContain("希望照射面積：18cm²");
    expect(out.sent[0][1]).toContain("49,500円");
    expect(out.sent[0][1]).toContain("日曜日の診療");
    expect(out.sent[0][1]).not.toMatch(/詰め/);
    expect(out.sent[0][1]).toContain("美容皮膚科予約済の方専用入口");
    expect(out.sent[0][1]).toContain("「到着済」");
    expect(out.sent[0][1]).toContain("アクセス：https://example.jp/clinic/access/");
    expect(html).toContain("https://example.jp/clinic/access/");
  });

  it("リマインドは、タトゥー除去のメニューが入った来院にだけ日曜のご来院の案内を足す", async () => {
    const day = addDays(nowInClinic().date, 5);
    await open(day);
    const out = await h.srv.php(`
      $p = ['name' => '除去 花子'];
      $at = '${day}T10:00:00+09:00';
      return [
        Reminder::compose(['patient' => $p, 'arrivalAt' => $at, 'menuNames' => [], 'menuIds' => ['${MENU}']], 'd1', 'line')['text'],
        Reminder::compose(['patient' => $p, 'arrivalAt' => $at, 'menuNames' => [], 'menuIds' => ['menu-other']], 'd1', 'line')['text'],
      ];
    `);
    expect(out[0]).toContain("【日曜日のご来院について】");
    expect(out[0]).toContain("美容皮膚科予約済の方専用入口");
    expect(out[1]).not.toContain("日曜日のご来院");
  });
});

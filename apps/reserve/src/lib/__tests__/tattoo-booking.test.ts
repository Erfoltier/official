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
  agree: true,
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

  it("初診の説明は説明のレーン（1番）で、照射はその後ろのメインレーンで取る。説明のレーンが埋まっていれば照射のレーンに続けて取る", async () => {
    const day = addDays(nowInClinic().date, 4);
    const c = await open(day, { tattooExplainLaneId: NURSE });
    // 空いた日の最初：10:00 来院、説明は説明のレーンで 10:00〜10:10、照射はメインで 10:10〜（メインの最初の10分は空く）
    expect((await slots(5, "first")).slots).toEqual({ [day]: ["10:00"] });
    expect((await book(person(day, "10:00", { visit: "first" }))).status).toBe(201);
    let bundle = await c.get(`/day?date=${day}`);
    const nurse = bundle.reservations.find((r: any) => r.laneId === NURSE);
    expect([nurse.startAt, nurse.endAt]).toEqual([toIso(day, 600), toIso(day, 610)]);
    const main = bundle.reservations.find((r: any) => r.laneId === MAIN);
    expect([main.startAt, main.endAt]).toEqual([toIso(day, 610), toIso(day, 615)]);
    expect(main.memo).toContain("初診説明：10分（説明のレーン）");
    expect(main.memo).toContain("面積：5cm²（照射5分）");
    expect(main.memo).toContain("料金の目安：29,700円");
    // メインの空いた 10:00〜10:10 には再診（〜10分）が入れる（20分未満の空きは5分の照射で埋めてもよい。院長 11/20）
    expect((await slots(5, "repeat")).slots[day]).toContain("10:00");
    // 次の初診は照射 10:15〜。説明は直前 10:05〜が説明のレーンで埋まっているので、説明 10:15〜10:25（説明のレーン）・照射 10:25〜
    expect((await slots(5, "first")).slots[day][0]).toBe("10:15");
    expect((await book(person(day, "10:15", { visit: "first" }, "09066667777"))).status).toBe(201);
    bundle = await c.get(`/day?date=${day}`);
    expect(bundle.reservations.filter((r: any) => r.laneId === NURSE).map((r: any) => [r.startAt, r.endAt])).toContainEqual([toIso(day, 615), toIso(day, 625)]);
    expect(await mainOn(c, day)).toContainEqual([toIso(day, 625), toIso(day, 630)]);
    // 説明のレーンが空いていなければ、照射のレーンに説明＋照射をまとめて取る
    const p = await c.post("/patients", { name: "看護 太郎", kana: "カンゴ タロウ", birthDate: "1980-01-01" });
    await c.post("/reservations", { patientId: p.id, laneId: NURSE, menuIds: [MENU], startAt: toIso(day, 625), endAt: toIso(day, 720) });
    expect((await slots(5, "first")).slots[day][0]).toBe("10:30");
    expect((await book(person(day, "10:30", { visit: "first" }, "09077778888"))).status).toBe(201);
    expect(await mainOn(c, day)).toContainEqual([toIso(day, 630), toIso(day, 645)]);
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
    expect(html).toContain("照射する部分の毛は、ご来院前にご自身で剃ってきてください（眉のアートメイクの方は、照射する部分の眉毛も剃ってください）。");
    expect(html).toContain("診察希望部位・施術希望部位は、ノーメイクでお越しください。");
    expect(html).not.toContain("眉毛そのもの");
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
      $r = TattooBooking::book(['agree' => true, 'kind' => 'artmake', 'visit' => 'first', 'rects' => [[1.5, 6], [1.5, 6]], 'anesthesia' => 'yes', 'name' => '眉 花子', 'kana' => 'マユ ハナコ', 'birthDate' => '1990-01-01', 'phone' => '09055556666', 'email' => 'mayu@example.jp', 'date' => '${day}', 'time' => '10:00'], '127.0.0.9');
      return ['r' => $r, 'sent' => $sent];
    `);
    expect(out.r).toMatchObject({ ok: true, mailed: true, time: "10:00", end: "10:20", duration: "約20分（ご説明10分・照射10分）" });
    expect(out.sent[0][1]).toContain("10:00〜10:20");
    expect(out.sent[0][1]).toContain("所要時間：約20分（ご説明10分・照射10分）");
    expect(out.sent[0][1]).toContain("アートメイク除去のご予約を承りました");
    expect(out.sent[0][1]).toContain("希望照射面積：18cm²");
    expect(out.sent[0][1]).toContain("49,500円");
    expect(out.sent[0][1]).toContain("日曜日の診療");
    expect(out.sent[0][1]).toContain("【ご来院前のお願い】\n診察希望部位・施術希望部位は、ノーメイクでお越しください。\n照射する部分は、眉毛も含めて、ご来院前にご自身で剃ってきてください。");
    expect(out.sent[0][1]).not.toMatch(/詰め/);
    expect(out.sent[0][1]).toContain("美容皮膚科予約済の方専用入口");
    expect(out.sent[0][1]).toContain("「到着済」");
    expect(out.sent[0][1]).toContain("【キャンセル・日程変更にかかる料金規定】");
    expect(out.sent[0][1]).toContain("前々日の14時まで：無料");
    expect(html).toContain("キャンセル・日程変更にかかる料金規定");
    expect(out.sent[0][1]).toContain("アクセス：https://example.jp/clinic/access/");
    expect(html).toContain("https://example.jp/clinic/access/");
  });

  it("LINE の中で開いた予約は、本人の LINE を予約と患者に結びつけ、確定の連絡を LINE に送る（メールアドレスも必須）", async () => {
    const day = addDays(nowInClinic().date, 5);
    const c = await open(day);
    await expect(c.patch("/clinic", { tattooLiffId: "abc" })).rejects.toThrow(/LIFF ID の形/);
    await c.patch("/clinic", { tattooLiffId: "1234567890-TaTtOo01" });
    expect((await c.get("/settings")).tattoo.lineUrl).toBe("https://liff.line.me/1234567890-TaTtOo01");
    const uid = "U" + "a".repeat(32);
    const out = await h.srv.php(`
      $s = Db::i()->meta('reminderSecrets'); Db::i()->setMeta('reminderSecrets', [...(is_array($s) ? $s : []), 'lineToken' => 'x']);
      $sent = [];
      Reminder::$transport = function ($m, $to, $headers, $body) use (&$sent) { $sent[] = [$to, (string) $body]; return [200, '{}']; };
      // LINE の ID トークンの確認：予約ページの LIFF のチャネル（1234567890）で、good だけ通す
      LineLink::$transport = function ($m, $url, $headers, $body) use (&$sent) {
        parse_str((string) $body, $q); $sent[] = [$url, 'client=' . ($q['client_id'] ?? '')];
        return ($q['id_token'] ?? '') === 'good' && ($q['client_id'] ?? '') === '1234567890' ? [200, json_encode(['sub' => '${uid}'])] : [400, '{}'];
      };
      $base = ['agree' => true, 'kind' => 'tattoo', 'visit' => 'repeat', 'rects' => [[2, 2.5]], 'anesthesia' => 'no', 'name' => '線 花子', 'kana' => 'セン ハナコ', 'birthDate' => '1991-02-03', 'phone' => '09012340000', 'email' => '', 'date' => '${day}', 'time' => '10:00'];
      $noLine = TattooBooking::book($base, '127.0.0.21');
      $bad = TattooBooking::book([...$base, 'idToken' => 'bad'], '127.0.0.22');
      $r = TattooBooking::book([...$base, 'idToken' => 'good', 'email' => 'sen@example.jp'], '127.0.0.23');
      $res = array_values(array_filter(Db::i()->all('reservation'), fn($x) => ($x['lineUserId'] ?? '') === '${uid}'));
      $pat = Db::i()->get('patient', $res[0]['patientId'] ?? '') ?? [];
      return ['noLine' => $noLine, 'bad' => $bad, 'r' => $r, 'sent' => $sent, 'resCount' => count($res), 'patLine' => $pat['lineUserId'] ?? null];
    `);
    expect(out.noLine).toMatchObject({ ok: false, fields: ["email"] });
    expect(out.bad).toMatchObject({ ok: false, error: "line_auth" });
    expect(out.r).toMatchObject({ ok: true, lined: true, mailed: false, time: "10:00" });
    expect(out.resCount).toBe(1);
    expect(out.patLine).toBe(uid);
    const push = out.sent.find((x: any) => String(x[0]).includes("/message/push"));
    expect(push[1]).toContain(uid);
    expect(push[1]).toContain("タトゥー除去のご予約を承りました");
    expect(out.sent.some((x: any) => String(x[0]).startsWith("smtp") || String(x[0]).includes("@"))).toBe(false);
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

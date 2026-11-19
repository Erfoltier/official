/* eslint-disable @typescript-eslint/no-explicit-any -- テストでは応答の JSON をそのまま調べる */
import { describe, expect, it } from "vitest";
import { addDays, nowInClinic, toIso } from "@/lib/domain/time";
import { withPhp } from "./php/server";

// 日曜の Web 予約（monshin/tattoo/）で、タトゥー以外に院が日曜の受付を許可したメニュー（日曜メニュー）を選んで予約する。
// 初診・再診それぞれの時間・レーン・予約に付けるメニュー・機器の名前を設定で決める。選べる時刻の決め方はタトゥーと同じ
const h = withPhp({ each: true });
const MAIN = "lane-main";
const L1 = "lane-1";
const L3 = "lane-3";
const TATTOO = "menu-s000099DC1";
const BOTOX_RE = "menu-s00009A18E"; // ボトックス【再診】
const CONSULT = "menu-s0000BB7B7"; // 完全初診
const PEEL = "menu-s00009A18A"; // マッサージピール

/** 今日から3日以上先の日曜 */
function nextSunday(offset = 0): string {
  let d = addDays(nowInClinic().date, 3 + offset * 7);
  while (new Date(`${d}T00:00:00Z`).getUTCDay() !== 0) d = addDays(d, 1);
  return d;
}
const botox = { id: "botox01", name: "ボトックス注射", firstMinutes: 20, firstLaneIds: [MAIN], firstMenuId: CONSULT, repeatMinutes: 10, repeatLaneIds: [MAIN], repeatMenuId: BOTOX_RE, machine: "", note: "" };
const peel = { id: "peel0001", name: "マッサージピール", firstMinutes: 0, firstLaneIds: [], firstMenuId: "", repeatMinutes: 20, repeatLaneIds: [L1, L3], repeatMenuId: PEEL, machine: "", note: "当日はメイクを落としやすい状態でお越しください。" };

async function open(day: string, extra: object = {}) {
  const c = await h.srv.as("staff-admin");
  await c.patch("/clinic", { tattooEnabled: true, tattooLaneId: MAIN, tattooMenuId: TATTOO, tattooExplainLaneId: "", tattooSlots: [`${day} 10:00-12:00`], sundayMenus: [botox, peel], ...extra });
  return c;
}
const slots = async (q: string) => (await (await fetch(`${h.srv.base}/monshin/tattoo/api.php?${q}`)).json()) as any;
const book = async (body: object) => {
  const res = await fetch(`${h.srv.base}/monshin/tattoo/api.php`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { status: res.status, data: (await res.json()) as any };
};
const person = (day: string, time: string, extra: object = {}, phone = "09011112222") => ({
  item: "peel0001",
  visit: "repeat",
  name: "日曜 花子",
  kana: "ニチヨウ ハナコ",
  birthDate: "1990-01-01",
  phone,
  email: "hanako@example.jp",
  date: day,
  time,
  ...extra,
});
const lanesOn = async (c: any, day: string, lane: string) =>
  (await c.get(`/day?date=${day}`)).reservations
    .filter((r: any) => r.laneId === lane && r.status !== "cancelled")
    .map((r: any) => [r.startAt, r.endAt])
    .sort();

describe("日曜メニュー（タトゥー以外の日曜の Web 予約）", () => {
  it("設定：名前・レーン・メニュー・時間を確かめ、id は保存し直しても変わらない", async () => {
    const day = nextSunday();
    const c = await open(day);
    await expect(c.patch("/clinic", { sundayMenus: [{ ...botox, name: " " }] })).rejects.toThrow(/名前を入れて/);
    await expect(c.patch("/clinic", { sundayMenus: [{ ...botox, repeatLaneIds: ["lane-x"] }] })).rejects.toThrow(/レーンが見つかりません/);
    await expect(c.patch("/clinic", { sundayMenus: [{ ...botox, repeatMenuId: "menu-x" }] })).rejects.toThrow(/メニューが見つかりません/);
    await expect(c.patch("/clinic", { sundayMenus: [{ ...botox, repeatMinutes: 12 }] })).rejects.toThrow(/5分刻み/);
    await expect(c.patch("/clinic", { sundayMenus: [{ ...botox, firstMinutes: 0, repeatMinutes: 0 }] })).rejects.toThrow(/初診か再診の時間/);
    await expect(c.patch("/clinic", { sundayMenus: [{ ...botox, repeatMenuId: "" }] })).rejects.toThrow(/レーンと予約に付けるメニュー/);
    const saved = (await c.get("/settings")).clinic.sundayMenus;
    expect(saved.map((x: any) => x.id)).toEqual(["botox01", "peel0001"]);
    // id がない行には作る
    await c.patch("/clinic", { sundayMenus: [{ ...botox, id: "" }] });
    expect((await c.get("/settings")).clinic.sundayMenus[0].id).toMatch(/^[a-z0-9]{10}$/);
  });

  it("まだ保存していなければ、予約枠時間一覧から作ったプリセット（すべてオフ）を出す。オンにしたものだけが予約ページに出る", async () => {
    const day = nextSunday();
    const c = await h.srv.as("staff-admin");
    await c.patch("/clinic", { tattooEnabled: true, tattooLaneId: MAIN, tattooMenuId: TATTOO, tattooSlots: [`${day} 10:00-12:00`] });
    const presets = (await c.get("/settings")).clinic.sundayMenus;
    expect(presets.length).toBeGreaterThan(10);
    expect(presets.every((x: any) => x.enabled === false)).toBe(true);
    expect(presets.find((x: any) => x.id === "botox")).toMatchObject({ name: "ボトックス注射", firstMinutes: 20, firstLaneIds: [MAIN], repeatMinutes: 10, repeatMenuId: BOTOX_RE });
    expect(presets.find((x: any) => x.id === "massagepeel")).toMatchObject({ repeatMinutes: 20, repeatLaneIds: [L1, L3], repeatMenuId: PEEL });
    let html = await (await fetch(`${h.srv.base}/monshin/tattoo/`)).text();
    expect(html).not.toContain('value="m:');
    expect(html).toContain("タトゥー・アートメイク除去のご予約");
    // マッサージピールだけオンにして保存（ほかはオフのまま残る。オフのものはレーン・メニューが空でも保存できる）
    const next = presets.map((x: any) => (x.id === "massagepeel" ? { ...x, enabled: true, repeatMinutes: 25 } : x.id === "botox" ? { ...x, repeatLaneIds: [] } : x));
    await c.patch("/clinic", { sundayMenus: next });
    const saved = (await c.get("/settings")).clinic.sundayMenus;
    expect(saved.length).toBe(presets.length);
    expect(saved.filter((x: any) => x.enabled).map((x: any) => x.id)).toEqual(["massagepeel"]);
    html = await (await fetch(`${h.srv.base}/monshin/tattoo/`)).text();
    expect(html).toContain('value="m:massagepeel"');
    expect(html).not.toContain('value="m:botox"');
    expect(await slots("item=massagepeel&visit=repeat")).toMatchObject({ slots: { [day]: ["10:00"] }, duration: "約25分" });
    expect((await slots("item=botox&visit=repeat")).slots).toEqual({});
    expect((await book(person(day, "10:00", { item: "botox" }))).data.fields).toContain("visit");
    // オンにするなら、レーンとメニューが要る
    await expect(c.patch("/clinic", { sundayMenus: next.map((x: any) => (x.id === "botox" ? { ...x, enabled: true } : x)) })).rejects.toThrow(/レーンと予約に付けるメニュー/);
  });

  it("予約ページに許可したメニューが出て、受け付ける区分だけを選べる。空きはタトゥーと同じ決め方で、レーンは空いているほうへ", async () => {
    const day = nextSunday();
    const c = await open(day);
    const html = await (await fetch(`${h.srv.base}/monshin/tattoo/`)).text();
    expect(html).toContain("日曜日のご予約");
    expect(html).toContain('value="m:botox01"');
    expect(html).toContain('value="m:peel0001" data-first="" data-repeat="1"');
    expect(html).toContain("タトゥー・刺青の除去");
    // マッサージピールは再診だけ（初診は時刻を出さず、送っても断る）
    expect((await slots("item=peel0001&visit=first")).slots).toEqual({});
    expect((await book(person(day, "10:00", { visit: "first" }))).data.fields).toContain("visit");
    expect(await slots("item=peel0001&visit=repeat")).toMatchObject({ slots: { [day]: ["10:00"] }, duration: "約20分" });
    expect((await book(person(day, "10:00"))).status).toBe(201);
    // 1番が 10:00〜10:20 で埋まった：3番の 10:00 と、1番の続き 10:20
    expect((await slots("item=peel0001&visit=repeat")).slots).toEqual({ [day]: ["10:00", "10:20"] });
    expect((await book(person(day, "10:00", {}, "09022223333"))).status).toBe(201);
    expect(await lanesOn(c, day, L1)).toEqual([[toIso(day, 600), toIso(day, 620)]]);
    expect(await lanesOn(c, day, L3)).toEqual([[toIso(day, 600), toIso(day, 620)]]);
    const memo = (await c.get(`/day?date=${day}`)).reservations.find((r: any) => r.laneId === L1).memo;
    expect(memo).toContain("マッサージピール（Web予約・日曜）再診");
    // ボトックスの初診はメインに20分（予約に付けるメニューは初診の分）
    expect((await book(person(day, "10:00", { item: "botox01", visit: "first" }, "09033334444"))).status).toBe(201);
    const main = (await c.get(`/day?date=${day}`)).reservations.find((r: any) => r.laneId === MAIN);
    expect([main.startAt, main.endAt, main.menuIds]).toEqual([toIso(day, 600), toIso(day, 620), [CONSULT]]);
    // タトゥーの照射も同じメインの空きから（ボトックスのすぐ後ろ）
    expect((await slots("area=5&visit=repeat")).slots).toEqual({ [day]: ["10:20"] });
    // 知らないメニュー
    expect((await book(person(day, "10:40", { item: "nothing" }))).data.fields).toContain("kind");
  });

  it("同じ機器の名前のメニュー同士（タトゥーの照射を含む）は、レーンが違っても同じ時刻に入れない", async () => {
    const day = nextSunday();
    await open(day, { tattooMachine: "ピコ", sundayMenus: [botox, { ...peel, machine: "ピコ" }] });
    const tattoo = { kind: "tattoo", visit: "repeat", rects: [[2, 2.5]], anesthesia: "no", name: "除去 花子", kana: "ジョキョ ハナコ", birthDate: "1990-01-01", phone: "09044445555", email: "t@example.jp", date: day, time: "10:00" };
    expect((await book(tattoo)).status).toBe(201); // メイン 10:00〜10:05
    // ピールは 1番・3番とも 10:00 は機器が使用中。空きの最初しか出さないので、この日は時刻なし
    expect((await slots("item=peel0001&visit=repeat")).slots).toEqual({});
    // 機器の名前がなければ入れる
    const c = await h.srv.as("staff-admin");
    await c.patch("/clinic", { tattooMachine: "" });
    expect((await slots("item=peel0001&visit=repeat")).slots).toEqual({ [day]: ["10:00"] });
  });

  it("タトゥーを受け付けない設定でも、日曜メニューだけで予約ページを開ける。確定の連絡にそのメニューの案内と日曜の案内", async () => {
    const day = nextSunday();
    await open(day, { tattooMenuId: "", accessUrl: "https://example.jp/clinic/access/" });
    const html = await (await fetch(`${h.srv.base}/monshin/tattoo/`)).text();
    expect(html).toContain("日曜日のご予約");
    expect(html).not.toContain('value="tattoo"');
    expect(html).not.toContain("照射部位の産毛");
    const tattoo = await book({ kind: "tattoo", visit: "repeat", rects: [[2, 2]], name: "a", kana: "a", birthDate: "1990-01-01", phone: "09011110000", email: "a@example.jp", date: day, time: "10:00" });
    expect(tattoo.data.error).toBe("closed");
    const out = await h.srv.php(`
      Db::i()->setMeta('reminderSettings', [...Reminder::defaults(), 'fromEmail' => 'info@example.jp']);
      $sent = [];
      Reminder::$transport = function ($m, $to, $headers, $body) use (&$sent) { $sent[] = [$to, $body]; return [200, '']; };
      $r = TattooBooking::book(['item' => 'peel0001', 'visit' => 'repeat', 'name' => 'ピール 花子', 'kana' => 'ピール ハナコ', 'birthDate' => '1990-01-01', 'phone' => '09055556666', 'email' => 'peel@example.jp', 'date' => '${day}', 'time' => '10:00'], '127.0.0.9');
      return ['r' => $r, 'sent' => $sent];
    `);
    expect(out.r).toMatchObject({ ok: true, mailed: true, time: "10:00", end: "10:20", duration: "約20分" });
    const body = out.sent[0][1];
    expect(body).toContain("マッサージピール（日曜日）のご予約を承りました");
    expect(body).toContain("所要時間：約20分");
    expect(body).toContain("【ご来院前のお願い】\n当日はメイクを落としやすい状態でお越しください。");
    expect(body).toContain("美容皮膚科予約済の方専用入口");
    expect(body).toContain("【キャンセル・日程変更にかかる料金規定】");
    expect(body).toContain("アクセス：https://example.jp/clinic/access/");
    expect(body).not.toContain("産毛");
    expect(body).not.toContain("照射");
  });

  it("リマインドの日曜の案内は、日曜メニューの予約なら日曜の来院のときだけ足す（同じメニューを平日にも使うため）", async () => {
    const day = nextSunday();
    await open(day);
    const monday = addDays(day, 1);
    const out = await h.srv.php(`
      $p = ['name' => '日曜 花子'];
      return [
        Reminder::compose(['patient' => $p, 'date' => '${day}', 'arrivalAt' => '${day}T10:00:00+09:00', 'menuNames' => [], 'menuIds' => ['${PEEL}']], 'd1', 'line')['text'],
        Reminder::compose(['patient' => $p, 'date' => '${monday}', 'arrivalAt' => '${monday}T10:00:00+09:00', 'menuNames' => [], 'menuIds' => ['${PEEL}']], 'd1', 'line')['text'],
      ];
    `);
    expect(out[0]).toContain("【日曜日のご来院について】");
    expect(out[1]).not.toContain("日曜日のご来院");
  });
});

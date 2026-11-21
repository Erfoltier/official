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
const addMin = (hm: string, m: number) => { const t = Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3)) + m; return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`; };
const slots = async (q: string) => (await (await fetch(`${h.srv.base}/monshin/tattoo/api.php?${q}`)).json()) as any;
const book = async (body: object) => {
  const res = await fetch(`${h.srv.base}/monshin/tattoo/api.php`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { status: res.status, data: (await res.json()) as any };
};
const person = (day: string, time: string, extra: object = {}, phone = "09011112222") => ({
  item: "peel0001",
  agree: true,
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

  it("脱毛：レーザーはホームページの部位分け（女性・男性）で、時間は予約枠時間一覧（スプレッドシートが送ると更新。鼻下＋顎などはまとめの時間）。麻酔クリームの有無を聞く。針は性別・VIO と VIO以外の本数・局所麻酔注射で料金の概算", async () => {
    const day = nextSunday();
    const c = await h.srv.as("staff-admin");
    await c.patch("/clinic", { tattooEnabled: true, tattooLaneId: MAIN, tattooMenuId: TATTOO, tattooSlots: [`${day} 10:00-12:00`] });
    const presets = (await c.get("/settings")).clinic.sundayMenus;
    const laser = presets.find((x: any) => x.id === "laserhair");
    expect(laser.partGroups.map((g: any) => g.name)).toEqual(["女性", "男性"]);
    const women = laser.partGroups[0].parts.map((x: any) => x.name);
    expect(women.slice(0, 5)).toEqual(["眉上・眉間", "鼻下", "顎", "顎下", "両ワキ"]);
    expect(women.at(-1)).toBe("足甲～指先");
    expect(laser.partGroups[1].parts.map((x: any) => x.name)).toContain("両頬");
    expect(women.some((x: string) => x.includes("+顎"))).toBe(false);
    expect(laser).toMatchObject({ neobo: false, creamAsk: true });
    expect(presets.find((x: any) => x.id === "needlehair")).toMatchObject({ name: "針脱毛", countPerMinute: 4, maxMinutes: 90, firstMinutes: 15, firstLaneIds: [L3], firstMenuId: "menu-s0000A43A3", needle: true });
    await c.patch("/clinic", { sundayMenus: presets.map((x: any) => (["laserhair", "needlehair"].includes(x.id) ? { ...x, enabled: true } : x)) });
    // 予約枠時間一覧（スプレッドシート）を Google 連携の鍵で受け取ると、保存済みのレーザー脱毛の時間が入れ替わる
    const rows = [["主に看護師レーン", ""], ["", ""], ["レーザー脱毛", "施術後の掃除とカルテ記載込み"], ["初診説明", "15分"], ["男", ""], ["下肢全部", "90"], ["大腿", "40"], ["下腿～足先", "40"], ["膝", "10"], ["下腿", "30"], ["両頬", "5"], ["鼻下", "10"], ["顎", "10"], ["顎下", "10"], ["鼻下+顎+顎下", "15"], ["鼻下+顎", "10"], ["眉", "10"], ["前腕", "20"], ["前腕～手先", "25"], ["へそ回り", "5"], ["V", "5"], ["IO", "20"], ["VIO", "30"], ["両ワキ", "5"], ["乳輪", "5"], ["肘上10cm", "5"], ["手＋指", "5"], ["足甲～指先", "5"], ["", ""], ["", ""], ["女", ""], ["下肢全部", "60"], ["大腿", "30"], ["下腿～足先", "30"], ["膝", "10"], ["下腿", "20"], ["", ""], ["鼻下", "5"], ["顎", "5"], ["顎下", "5"], ["鼻下+顎+顎下", "10"], ["鼻下+顎", "10"], ["眉", "10"], ["前腕", "20"], ["前腕～手先", "25"], ["へそ回り", "5"], ["V", "5"], ["IO", "15"], ["VIO", "20"], ["両ワキ", "5"], ["乳輪", "5"], ["肘上10cm", "5"], ["手＋指", "5"], ["足甲～指先", "5"]];
    const { token } = await c.post("/device-links", { source: "google" });
    expect((await h.srv.client().raw("POST", "/api/v1/integration/time-sheet", { rows }, {})).status).toBe(401);
    const sent = await h.srv.client().raw("POST", "/api/v1/integration/time-sheet", { rows }, { "X-Integration-Token": token });
    expect(sent.data).toMatchObject({ ok: true, changed: 1 });
    const saved = (await c.get("/settings")).clinic.sundayMenus.find((x: any) => x.id === "laserhair");
    const minOf = (g: number, name: string) => saved.partGroups[g].parts.find((x: any) => x.name === name).minutes;
    expect([minOf(0, "鼻下"), minOf(1, "鼻下"), minOf(1, "両頬"), minOf(0, "太もも"), minOf(1, "太もも")]).toEqual([5, 10, 5, 30, 40]);
    // シートが消された・壊れたときは取り込まず、前の時間のまま（院長 11/20）
    const send = (r: unknown) => h.srv.client().raw("POST", "/api/v1/integration/time-sheet", { rows: r }, { "X-Integration-Token": token });
    const emptied = await send([["主に看護師レーン"], [""], ["レーザー脱毛"]]);
    expect(emptied.status).toBeGreaterThanOrEqual(400);
    const broken = rows.map((r: string[]) => (r[0] === "鼻下" ? ["鼻下", ""] : r));
    expect((await send(broken)).status).toBeGreaterThanOrEqual(400);
    const noCombo = rows.filter((r: string[]) => r[0] !== "鼻下+顎");
    expect((await send(noCombo)).status).toBeGreaterThanOrEqual(400);
    const after = (await c.get("/settings")).clinic.sundayMenus.find((x: any) => x.id === "laserhair");
    expect(after.partGroups).toEqual(saved.partGroups);
    expect(after.firstMinutes).toBe(saved.firstMinutes);
    const st = (await c.get("/settings")).tattoo.sheet;
    expect(st.error).toContain("女の鼻下");
    // 直したシートが届けば取り込み、断った記録は消す
    expect((await send(rows)).status).toBe(200);
    expect((await c.get("/settings")).tattoo.sheet.error).toBe("");
    const idx = (g: number, name: string) => saved.partGroups[g].parts.findIndex((x: any) => x.name === name);
    const q = (g: number, names: string[]) => `item=laserhair&visit=repeat&cream=no&group=${g}&parts=${names.map((n) => idx(g, n)).join(",")}`;
    // 女性 鼻下＋顎＋顎下：ばらなら15分だが、まとめの10分。男性 鼻下＋顎：20分 → まとめの10分。男性 V＋IO：25分 → VIO の30分
    expect((await slots(q(0, ["鼻下", "顎", "顎下"]))).duration).toBe("約10分");
    expect((await slots(q(1, ["鼻下", "顎"]))).duration).toBe("約10分");
    expect((await slots(q(1, ["鼻下", "顎", "両頬"]))).duration).toBe("約15分");
    expect((await slots(q(1, ["Vライン前面", "I+Oライン"]))).duration).toBe("約30分");
    // 初診は説明15分を足す。脱毛は顔以外なので、モニターでもネオボ撮影の枠を取らない
    expect((await slots(q(0, ["Vライン前面", "へそ周り(濃い毛のみ)"]).replace("repeat", "first"))).duration).toBe("約25分");
    expect((await slots(`${q(0, ["Vライン前面"])}&status=monitor`)).duration).toBe("約5分");
    const v = idx(0, "Vライン前面");
    const navel = idx(0, "へそ周り(濃い毛のみ)");
    expect((await book(person(day, "10:00", { item: "laserhair", visit: "first", group: "0", parts: [], cream: "no" }, "09070000001"))).data.fields).toContain("parts");
    expect((await book(person(day, "10:00", { item: "laserhair", visit: "first", group: "0", parts: [v] }, "09070000002"))).data.fields).toContain("cream");
    // 「ご来院前のお願い」〜料金規定の了承がなければ送れない
    expect((await book(person(day, "10:00", { item: "laserhair", visit: "first", group: "0", parts: [v], cream: "no", agree: false }, "09070000003"))).data.fields).toContain("agree");
    expect((await book(person(day, "10:00", { item: "laserhair", visit: "first", group: "0", parts: [v, navel], cream: "yes" }))).status).toBe(201);
    const r = (await c.get(`/day?date=${day}`)).reservations.find((x: any) => x.laneId === L1);
    expect([r.startAt, r.endAt]).toEqual([toIso(day, 600), toIso(day, 625)]);
    expect(r.menuIds).toEqual(["menu-s0000A43A3", "menu-s0000A1344"]);
    expect(r.memo).toContain("部位：女性：Vライン前面・へそ周り(濃い毛のみ)");
    expect(r.memo).toContain("初診の説明：15分");
    expect(r.memo).toContain("麻酔クリーム：希望する");
    // 予約で選んだ「女性」の部位から、患者情報の性別を入れる（問診票で入力済みにする。院長 11/21）
    expect((await c.get(`/patients/${r.patientId}`)).patient.sex).toBe("female");
    // 針の料金（ホームページの料金表から取り込んだもの。税込）
    await h.srv.php(`
      $rows = [['一般部位（男女共通） 20本まで', 12100], ['一般部位（男女共通） 21本以上', 220], ['女性VIO 20本まで', 18150], ['女性VIO 21本以上', 330], ['男性VIO 20本まで', 24200], ['男性VIO 21本以上', 770], ['針代', 4400]];
      foreach ($rows as $i => [$n, $y]) Db::i()->put('price', "hp-needle{$i}", ['id' => "hp-needle{$i}", 'source' => 'homepage', 'category' => '医療ニードル脱毛', 'name' => $n, 'priceYen' => $y, 'priceText' => '', 'order' => $i, 'url' => '']);
      // 送信の回数の制限（1時間に5回）を空にする（この試験は同じところから続けて送るため）
      foreach (Db::i()->all('tattooRate') as $k => $v) Db::i()->delete('tattooRate', (string) $k);
      return true;
    `);
    // 針：VIO 200本＋VIO以外 100本 → 300本で75分。料金は VIO・VIO以外を別々に計算（20本までの料金＋21本目から）
    // 初診も受ける：説明15分＋本数（VIO 20本＋VIO以外 20本 → 10分）で25分
    expect((await slots("item=needlehair&visit=first&countVio=20&countOther=20&sex=female&needleAnes=no")).duration).toBe("約25分");
    const nq = "item=needlehair&visit=repeat&countVio=200&countOther=100&sex=male&needleAnes=yes";
    expect(await slots(nq)).toMatchObject({
      duration: "約75分",
      estimate: "VIO以外（100本） 29,700円＋VIO（200本） 162,800円＋針代（1本） 4,400円＋局所麻酔注射（約両手面積1つ分） 5,500円＝合計 202,400円（税込）（料金は仮の概算です。当日の診察によって異なる場合があります。）",
    });
    expect((await slots("item=needlehair&visit=repeat&countOther=30&sex=female&needleAnes=no")).estimate).toContain("VIO以外（30本） 14,300円＋針代（1本） 4,400円＝合計 18,700円（税込）");
    expect((await slots("item=needlehair&visit=repeat&countVio=300&countOther=100&sex=female&needleAnes=no")).slots).toEqual({});
    const needle = (extra: object) => person(day, "10:00", { item: "needlehair", ...extra }, "09088889999");
    expect((await book(needle({ countVio: 300, countOther: 100, sex: "male", needleAnes: "no" }))).data.fields).toContain("count");
    expect((await book({ ...needle({ countVio: 200, countOther: 100 }), phone: "09070000004" })).data.fields).toContain("needle");
    expect((await book(needle({ countVio: 200, countOther: 100, sex: "male", needleAnes: "yes" }))).status).toBe(201);
    const n = (await c.get(`/day?date=${day}`)).reservations.find((x: any) => x.laneId === L3);
    expect([n.startAt, n.endAt]).toEqual([toIso(day, 600), toIso(day, 675)]);
    expect(n.memo).toContain("本数：300本");
    expect(n.memo).toContain("性別：男性／VIO：200本／VIO以外：100本／局所麻酔注射：希望する");
    expect(n.memo).toContain("料金の概算：");
    expect(n.memo).toContain("当日の診察によって異なる場合があります");
  });

  it("麻酔つきの注入：モニターの有無と麻酔で、4番の麻酔・撮影、40〜60分後の1・3番の施術、医師の診察を分けて取る", async () => {
    const day = nextSunday();
    const c = await h.srv.as("staff-admin");
    await c.patch("/clinic", { tattooEnabled: true, tattooLaneId: MAIN, tattooMenuId: TATTOO, tattooSlots: [`${day} 10:00-13:00`] });
    const presets = (await c.get("/settings")).clinic.sundayMenus;
    expect(presets.find((x: any) => x.id === "fillroad")).toMatchObject({ flow: true, creamMinutes: 20, injectionMinutes: 20, anesLaneIds: ["lane-4"], repeatLaneIds: [L1, L3], machine: "インナーフィル" });
    expect(presets.find((x: any) => x.id === "tranestamp")).toMatchObject({ creamMinutes: 20, injectionMinutes: 20 });
    expect(presets.find((x: any) => x.id === "juveacell")).toMatchObject({ creamMinutes: 30, injectionMinutes: 30 });
    expect(presets.find((x: any) => x.id === "re2o")).toMatchObject({ creamMinutes: 30, injectionMinutes: 30, repeatLaneIds: [MAIN] });
    // 施術の時間が空ならオンにできない
    await expect(c.patch("/clinic", { sundayMenus: presets.map((x: any) => (x.id === "juveacell" ? { ...x, enabled: true, creamMinutes: 0 } : x)) })).rejects.toThrow(/施術の時間/);
    await c.patch("/clinic", { sundayMenus: presets.map((x: any) => (["fillroad", "pinkglow"].includes(x.id) ? { ...x, enabled: true } : x)) });
    const html = await (await fetch(`${h.srv.base}/monshin/tattoo/`)).text();
    expect(html).toContain('value="m:fillroad"');
    expect(html).toContain("モニタープログラム中");
    const q = (st: string, an: string) => `item=fillroad&visit=repeat&status=${st}&anesthesia=${an}`;
    // 院内の麻酔クリーム：施術は 1番の 10:55〜（麻酔 10:00〜10:10 の45分後）。受付の始まりより前に麻酔は取れない
    expect((await slots(q("continue", "cream"))).slots[day]).toEqual(["10:00"]);
    expect((await slots(q("continue", "cream"))).duration).toBe("麻酔クリームのあと約45分お待ちいただき施術（施術は約20分）");
    // 麻酔の注射：待ちなし・注射の時間
    expect(await slots(q("continue", "injection"))).toMatchObject({ slots: { [day]: ["10:00"] }, duration: "約20分" });
    expect((await book(person(day, "10:00", { item: "fillroad", status: "continue", anesthesiaType: "" }))).data.fields).toContain("flow");
    expect((await book(person(day, "10:00", { item: "fillroad", status: "monitor", anesthesiaType: "cream" }))).status).toBe(201);
    const on = async () => (await c.get(`/day?date=${day}`)).reservations.filter((r: any) => r.status !== "cancelled");
    let rs = await on();
    const neobo = rs.find((r: any) => r.laneId === "lane-4");
    const treat = rs.find((r: any) => r.laneId === L1);
    expect([neobo.startAt, neobo.endAt, neobo.menuIds]).toEqual([toIso(day, 600), toIso(day, 615), ["menu-s0000B6B52"]]);
    expect([treat.startAt, treat.endAt, treat.menuIds]).toEqual([toIso(day, 660), toIso(day, 680), ["menu-s0000B6EB7"]]);
    expect(treat.memo).toContain("モニター");
    expect(treat.memo).toContain("麻酔：院内の麻酔クリーム");
    // この治療は初めて・麻酔の注射：待ちなしで施術、最初の10分にメインで医師の診察。インナーフィルは1番と3番で同じ時刻に入れない（1番 11:00〜11:20 と重ならない）
    expect((await book(person(day, "10:00", { item: "pinkglow", status: "new", anesthesiaType: "injection" }, "09012120000"))).status).toBe(201);
    rs = await on();
    const doc = rs.find((r: any) => r.laneId === MAIN);
    const glow = rs.filter((r: any) => r.laneId === L1 || r.laneId === L3).find((r: any) => r.memo.includes("ピンクグロー"));
    expect([glow.startAt, glow.endAt]).toEqual([toIso(day, 600), toIso(day, 620)]);
    expect([doc.startAt, doc.endAt]).toEqual([toIso(day, 600), toIso(day, 610)]);
    // 1番で 11:00〜11:20 にフィルロードがあるので、3番の空きでも 11:00 からの施術は出さない
    const next = (await slots(q("continue", "injection"))).slots[day];
    expect(next).not.toContain("11:00");
  });

  it("タトゥー除去・アートメイク除去も日曜メニューとしてそれぞれオン・オフできる", async () => {
    const day = nextSunday();
    const c = await open(day, { sundayMenus: [] });
    const tattoo = { kind: "tattoo", agree: true, visit: "repeat", rects: [[2, 2]], anesthesia: "no", name: "除去 花子", kana: "ジョキョ ハナコ", birthDate: "1990-01-01", phone: "09031310000", email: "t@example.jp", date: day, time: "10:00" };
    await c.patch("/clinic", { tattooKindOn: false });
    let html = await (await fetch(`${h.srv.base}/monshin/tattoo/`)).text();
    expect(html).not.toContain('value="tattoo"');
    expect(html).toContain('value="artmake"');
    expect((await book(tattoo)).data.error).toBe("closed");
    expect((await book({ ...tattoo, kind: "artmake", rects: [[1, 3]] })).status).toBe(201);
    // 両方オフで日曜メニューもなければ、予約ページは閉じる
    await c.patch("/clinic", { artmakeKindOn: false });
    html = await (await fetch(`${h.srv.base}/monshin/tattoo/`)).text();
    expect(html).toContain("現在、日曜日のご予約は受け付けておりません");
    // 日曜メニューだけでも開く
    await c.patch("/clinic", { sundayMenus: [peel] });
    html = await (await fetch(`${h.srv.base}/monshin/tattoo/`)).text();
    expect(html).toContain('value="m:peel0001"');
    expect(html).not.toContain('value="artmake"');
    expect((await c.get("/settings")).clinic).toMatchObject({ tattooKindOn: false, artmakeKindOn: false });
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
    const tattoo = { kind: "tattoo", agree: true, visit: "repeat", rects: [[2, 2.5]], anesthesia: "no", name: "除去 花子", kana: "ジョキョ ハナコ", birthDate: "1990-01-01", phone: "09044445555", email: "t@example.jp", date: day, time: "10:00" };
    expect((await book(tattoo)).status).toBe(201); // メイン 10:00〜10:05
    // ピールは 1番・3番とも 10:00 は機器が使用中。機器が空いたすぐ後（10:05）からなら入る（院長 11/21）
    expect((await slots("item=peel0001&visit=repeat")).slots).toEqual({ [day]: ["10:05"] });
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
    const tattoo = await book({ kind: "tattoo", agree: true, visit: "repeat", rects: [[2, 2]], name: "a", kana: "a", birthDate: "1990-01-01", phone: "09011110000", email: "a@example.jp", date: day, time: "10:00" });
    expect(tattoo.data.error).toBe("closed");
    const out = await h.srv.php(`
      Db::i()->setMeta('reminderSettings', [...Reminder::defaults(), 'fromEmail' => 'info@example.jp']);
      $sent = [];
      Reminder::$transport = function ($m, $to, $headers, $body) use (&$sent) { $sent[] = [$to, $body]; return [200, '']; };
      $r = TattooBooking::book(['agree' => true, 'item' => 'peel0001', 'visit' => 'repeat', 'name' => 'ピール 花子', 'kana' => 'ピール ハナコ', 'birthDate' => '1990-01-01', 'phone' => '09055556666', 'email' => 'peel@example.jp', 'date' => '${day}', 'time' => '10:00'], '127.0.0.9');
      return ['r' => $r, 'sent' => $sent];
    `);
    expect(out.r).toMatchObject({ ok: true, mailed: true, time: "10:00", end: "10:20", duration: "約20分" });
    const body = out.sent[0][1];
    expect(body).toContain("マッサージピールのご予約を承りました");
    expect(body).not.toContain("（日曜日）");
    expect(body).not.toContain("所要時間：");
    expect(body).not.toContain("までにお願いします");
    expect(body).toContain("【ご来院前のお願い】\nお顔の診察や施術を受ける方は、当日はノーメイクでお越しください。ファンデーションを軽く拭き取っても残りがあると、レーザーの照射に悪影響があります。\n当日はメイクを落としやすい状態でお越しください。");
    expect(body).toContain("美容皮膚科予約済の方専用入口");
    expect(body).toContain("【キャンセル・日程変更にかかる料金規定】");
    expect(body).toContain("アクセス：https://example.jp/clinic/access/");
    expect(body).not.toContain("産毛");
    expect(body).not.toContain("照射する部分");
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
  it("予約ページは設定の並び順。メニューが7つ以上で分類が2つ以上なら、まず分類を選ぶ", async () => {
    const day = nextSunday();
    const c = await open(day);
    // 少ないうち（タトゥー・アートメイク・2つ）は分類を出さない
    let html = await (await fetch(`${h.srv.base}/monshin/tattoo/`)).text();
    expect(html).not.toContain('name="cat"');
    const shots = ["inj01", "inj02", "inj03", "inj04"].map((id, k) => ({ ...botox, id, name: `注射${k + 1}`, category: "注射・注入" }));
    await c.patch("/clinic", {
      sundayMenus: [{ ...botox, category: "注射・注入" }, { ...peel, category: "ピーリング" }, ...shots],
      sundayOrder: ["peel0001", "inj02", "tattoo", "botox01"],
      removalCategory: "タトゥー・アートメイク除去",
    });
    const got = await c.get("/settings");
    expect(got.clinic.sundayOrder).toEqual(["peel0001", "inj02", "tattoo", "botox01"]);
    expect(got.clinic.sundayMenus.find((m: any) => m.id === "inj01").category).toBe("注射・注入");
    html = await (await fetch(`${h.srv.base}/monshin/tattoo/`)).text();
    // 分類は、いちばん上にあるメニューの分類から：ピーリング → 注射・注入 → 除去
    const cats = [...html.matchAll(/name="cat" value="([^"]+)"/g)].map((m) => m[1]);
    expect(cats).toEqual(["ピーリング", "注射・注入", "タトゥー・アートメイク除去"]);
    // 施術は並び順どおり（並び順にないものは後ろに、もとの順で）
    const kinds = [...html.matchAll(/name="kind" value="([^"]+)"/g)].map((m) => m[1]);
    expect(kinds).toEqual(["m:peel0001", "m:inj02", "tattoo", "m:botox01", "artmake", "m:inj01", "m:inj03", "m:inj04"]);
    expect(html).toContain('data-cat="注射・注入"');
  });

  it("分類を入れる前に保存したメニューは、見本の分類を使う", async () => {
    const day = nextSunday();
    await open(day);
    const out = await h.srv.php(`
      $c = Store::clinic();
      $c['sundayMenus'] = array_map(function ($it) { unset($it['category']); $it['id'] = 'botox'; return $it; }, array_slice($c['sundayMenus'], 0, 1));
      Db::i()->setMeta('clinic', $c);
      return TattooBooking::settings()['items'][0]['category'] ?? null;
    `);
    expect(out).toBe("注射・注入");
  });
  it("日曜メニューを全部（見本の全件・説明つき）並べ替えて保存しても、大きすぎると断られない", async () => {
    const day = nextSunday();
    const c = await h.srv.as("staff-admin");
    await c.patch("/clinic", { tattooEnabled: true, tattooLaneId: MAIN, tattooMenuId: TATTOO, tattooSlots: [`${day} 10:00-12:00`] });
    const presets = (await c.get("/settings")).clinic.sundayMenus as any[];
    const all = [...presets].reverse().map((x: any) => ({ ...x, note: "ご来院前のお願い：".padEnd(150, "あ") }));
    expect(JSON.stringify({ sundayMenus: all }).length).toBeGreaterThan(16_384);
    await c.patch("/clinic", { sundayMenus: all });
    expect((await c.get("/settings")).clinic.sundayMenus.map((x: any) => x.id)).toEqual(all.map((x: any) => x.id));
  });
  it("見本（すべてオフ）は、そのまま保存できる。分類も入っている", async () => {
    const day = nextSunday();
    await open(day);
    const out = await h.srv.php(`
      $p = TattooBooking::presets();
      [$lanes, $menus] = Store::laneAndMenuIds();
      $n = TattooBooking::normalizeItems($p, $lanes, $menus);
      return ['count' => count($n), 'on' => count(array_filter($n, fn($x) => $x['enabled'])), 'noCat' => array_values(array_map(fn($x) => $x['id'], array_filter($n, fn($x) => $x['category'] === ''))), 'cats' => array_values(array_unique(array_column($n, 'category'))), 'oral' => in_array('oral', array_column($n, 'id'), true), 'qruby' => in_array('qruby', array_column($n, 'id'), true)];
    `);
    expect(out.count).toBe(39);
    expect(out.on).toBe(0);
    expect(out.noCat).toEqual([]);
    expect(out.oral).toBe(false);
    expect(out.qruby).toBe(false);
    expect(out.cats).toEqual(expect.arrayContaining(["注射・注入", "除去・美白・レーザー", "ピーリング", "ダーマペン", "脱毛", "たるみ", "薄毛", "ゼオスキン", "内服"]));
  });
  it("プレビュー：設定を読めるスタッフに渡す印で、受け付けがオフでも患者の画面を開ける。オフのメニューも出せる。予約は送れない", async () => {
    const day = nextSunday();
    const c = await open(day, { tattooEnabled: false, sundayMenus: [botox, { ...peel, enabled: false }] });
    // 設定の画面には、予約ページのアドレスがあるときだけプレビューのアドレスを渡す（この試験の環境にはない）
    expect((await c.get("/settings")).tattoo.preview).toBe("");
    const page = async (q: string) => (await fetch(`${h.srv.base}/monshin/tattoo/${q}`)).text();
    const token = (await h.srv.php(`return TattooBooking::previewToken();`)) as string;
    expect(token).toMatch(/^\d{10}\.[A-Za-z0-9_-]+$/);
    // 印がないと、受け付けオフの画面
    expect(await page("")).toContain("受け付けておりません");
    expect(await page("?preview=1234567890.abcdefghijklmnopqrstuvwxyz")).toContain("受け付けておりません");
    // 印があれば、オンのメニューで開く
    const on = await page(`?preview=${token}`);
    expect(on).toContain("プレビュー（院のスタッフ用）");
    expect(on).toContain('value="m:botox01"');
    expect(on).not.toContain('value="m:peel0001"');
    expect(on).toContain('data-preview="1"');
    // オフも含めて
    const all = await page(`?preview=${token}&all=1`);
    expect(all).toContain('value="m:peel0001"');
    // 期限切れは開かない
    const out = await h.srv.php(`return [TattooBooking::previewValid(TattooBooking::previewToken(time() - 8000)), TattooBooking::previewValid(TattooBooking::previewToken())];`);
    expect(out).toEqual([false, true]);
  });
  it("当院の美容皮膚科の初診・再診と今回の治療内容から区分を決め、メモに残す。初診の方には確定の連絡で問診票を案内する", async () => {
    const day = nextSunday();
    const c = await open(day);
    // 初診：保険通院歴・当日施術の希望がないと送れない
    const base = { ...person(day, "10:00"), item: "botox01", visit: "", email: "shoshin@example.jp" };
    const bad = await book({ ...base, clinicVisit: "initial" });
    expect(bad.status).toBe(422);
    expect(bad.data.fields).toContain("initialInfo");
    // 再診は今回の治療内容がないと送れない
    expect((await book({ ...base, clinicVisit: "returning" })).data.fields).toContain("status");
    const out = await h.srv.php(`
      Db::i()->setMeta('reminderSettings', [...Reminder::defaults(), 'fromEmail' => 'info@example.jp']);
      Db::i()->setMeta('lineLink', ['liffId' => '1234567890-QuEsTiOn', 'loginChannelId' => '1234567890']);
      $sent = [];
      Reminder::$transport = function ($m, $to, $headers, $body) use (&$sent) { $sent[] = (string) $body; return [200, '']; };
      $r = TattooBooking::book(json_decode('${JSON.stringify({ ...base, clinicVisit: "initial", insuranceHistory: "無", sameDayTreatment: "有", referrer: "山田さん" })}', true), '127.0.0.31');
      $res = array_values(array_filter(Db::i()->all('reservation'), fn($x) => str_contains((string) ($x['memo'] ?? ''), '当院の美容皮膚科')));
      return ['r' => $r, 'memo' => $res[0]['memo'] ?? '', 'mail' => $sent[0] ?? ''];
    `);
    // 初診 → 初めての時間（ボトックスの初診20分）
    expect(out.r).toMatchObject({ ok: true, time: "10:00", end: "10:20" });
    expect(out.memo).toContain("当院の美容皮膚科：初診（保険通院歴：無、当日施術の希望：有）");
    expect(out.memo).toContain("紹介者：山田さん");
    expect(out.mail).toMatch(/のご予約を承りました。\nアレルギーや内服など事前問診票をご回答ください。\nhttps:\/\/liff\.line\.me\/1234567890-QuEsTiOn/);
    expect(out.mail).toContain("https://liff.line.me/1234567890-QuEsTiOn");
    expect(out.r.questionnaire).toBe("https://liff.line.me/1234567890-QuEsTiOn");
    // 再診で継続 → 再診の時間（10分）。問診票の記録がなければ案内する
    const r2 = await h.srv.php(`
      $sent = [];
      Reminder::$transport = function ($m, $to, $headers, $body) use (&$sent) { $sent[] = (string) $body; return [200, '']; };
      Db::i()->setMeta('reminderSettings', [...Reminder::defaults(), 'fromEmail' => 'info@example.jp']);
      $r = TattooBooking::book(json_decode('${JSON.stringify({ ...base, time: "10:20", phone: "09088887777", name: "再診 太郎", kana: "サイシン タロウ", clinicVisit: "returning", status: "continue" })}', true), '127.0.0.32');
      return ['r' => $r, 'mail' => $sent[0] ?? ''];
    `);
    expect(r2.r).toMatchObject({ ok: true, questionnaire: "https://liff.line.me/1234567890-QuEsTiOn" });
    expect(r2.r.end).toBe(addMin(r2.r.time, 10));
    // 問診票の記録がない再診の方には案内する（院長 11/21：最後の問診票から1年たっていれば再診でも）
    expect(r2.mail).toContain("アレルギーや内服など事前問診票をご回答ください。");
    const q = await h.srv.php(`
      $day = '${day}';
      $put = fn($id, $pid, $at) => Db::i()->put('questionnaire', $id, ['id' => $id, 'patientId' => $pid, 'submittedAt' => $at, 'receivedAt' => '2026-10-06T00:00:00Z']);
      $put('q-old', 'pat-old', str_replace('-', '/', add_days($day, -400)) . ' 10:00:00');
      $put('q-new', 'pat-new', str_replace('-', '/', add_days($day, -300)) . ' 10:00:00');
      $ret = ['clinicReturning' => true, 'date' => $day];
      return [
        TattooBooking::askQuestionnaire($ret, 'pat-old'),
        TattooBooking::askQuestionnaire($ret, 'pat-new'),
        TattooBooking::askQuestionnaire($ret, 'pat-none'),
        TattooBooking::askQuestionnaire(['clinicInitial' => true, 'date' => $day], 'pat-new'),
        TattooBooking::askQuestionnaire(['date' => $day], 'pat-none'),
      ];
    `);
    expect(q).toEqual([true, false, true, true, false]);
    void c;
  });
  it("ほくろ除去は個数を1つだけ選ぶ（顔1〜4個 15分・15個まで 20分・20個以上 30分）。色素レーザーは範囲（どれも10分、初診は20分）", async () => {
    const day = nextSunday();
    const out = await h.srv.php(`
      $h = TattooBooking::hokuroParts(['id' => 'hokuro', 'name' => 'ほくろ除去', 'enabled' => true, 'firstMinutes' => 20, 'firstLaneIds' => ['lane-main'], 'firstMenuId' => '', 'repeatMinutes' => 0, 'repeatLaneIds' => [], 'repeatMenuId' => '', 'machine' => '', 'note' => '']);
      return [
        TattooBooking::itemMinutes($h, true, ['group' => 0, 'parts' => [0]]),
        TattooBooking::itemMinutes($h, true, ['group' => 0, 'parts' => [2]]),
        TattooBooking::itemMinutes($h, true, ['group' => 0, 'parts' => [0, 1]]),
        TattooBooking::accepts($h, false),
        TattooBooking::pickText($h, ['group' => 0, 'parts' => [1]]),
        TattooBooking::pickLabel($h),
        TattooBooking::itemMinutes(TattooBooking::dyeParts(['id' => 'dyelaser', 'firstMinutes' => 20, 'repeatMinutes' => 10]), true, ['group' => 0, 'parts' => [0]]),
        TattooBooking::itemMinutes(TattooBooking::dyeParts(['id' => 'dyelaser', 'firstMinutes' => 20, 'repeatMinutes' => 10]), false, ['group' => 0, 'parts' => [3]]),
      ];
    `);
    expect(out).toEqual([15, 30, null, false, "顔15個までまとめ", "個数", 20, 10]);
    void day;
  });
  it("たるみは ハイフ → マリオネットのセット → 首のしわ → その他（自由記載）。口元たるみ・ぽにょりんはセットにまとめる。脂肪溶解注射は注射・注入のまま", async () => {
    const day = nextSunday();
    await open(day);
    const out = await h.srv.php(`
      $p = TattooBooking::presets();
      $sag = array_values(array_filter($p, fn($x) => $x['category'] === 'たるみ'));
      $fat = array_values(array_filter($p, fn($x) => $x['id'] === 'fatx'))[0];
      $ids = array_column($p, 'id');
      return ['sag' => array_column($sag, 'name'), 'fat' => [$fat['name'], $fat['category']], 'gone' => array_values(array_intersect(['mouthsag', 'ponyorin'], $ids))];
    `);
    expect(out.sag).toEqual(["ハイフ", "たるみマリオネットライン集中治療（ハイフ＋ヒアルロン酸＋ぽにょりん割引セット）", "首のしわ治療（ヒアルロン酸・肌育注射など）", "その他（自由記載）"]);
    expect(out.fat).toEqual(["Fat X（脂肪溶解注射）", "注射・注入"]);
    expect(out.gone).toEqual([]);
  });
  it("炭酸ガスは範囲で施術の時間（全顔15分・部分10分、麻酔の種類によらない）。4番で麻酔クリーム10分→40〜60分後にメインで施術。ぴったり入らなければ出さない", async () => {
    const day = nextSunday();
    const c = await h.srv.as("staff-admin");
    await c.patch("/clinic", { tattooEnabled: true, tattooLaneId: MAIN, tattooMenuId: TATTOO, tattooSlots: [`${day} 10:00-12:00`] });
    const presets = (await c.get("/settings")).clinic.sundayMenus;
    const co2 = presets.find((x: any) => x.id === "co2frac");
    expect(co2).toMatchObject({ flow: true, injectionMinutes: 0, pickOne: true, pickLabel: "範囲", repeatLaneIds: [MAIN] });
    const out = await h.srv.php(`
      $co2 = json_decode('${JSON.stringify(co2)}', true);
      $co2 = [...$co2, 'enabled' => true];
      return [
        TattooBooking::accepts($co2, false),
        TattooBooking::itemMinutes($co2, false, ['status' => 'continue', 'anesthesia' => 'cream', 'group' => 0, 'parts' => [0]]),
        TattooBooking::itemMinutes($co2, false, ['status' => 'continue', 'anesthesia' => 'self', 'group' => 0, 'parts' => [1]]),
        TattooBooking::itemMinutes($co2, false, ['status' => 'continue', 'anesthesia' => 'cream']),
        TattooBooking::itemMinutes($co2, false, ['status' => 'continue', 'anesthesia' => 'injection', 'group' => 0, 'parts' => [0]]),
        TattooBooking::pickText($co2, ['status' => 'continue', 'anesthesia' => 'cream', 'group' => 0, 'parts' => [1]]),
      ];
    `);
    expect(out).toEqual([true, 15, 10, null, null, "範囲：部分／今回：継続／コース消化／麻酔：院内の麻酔クリーム"]);
    await c.patch("/clinic", { sundayMenus: presets.map((x: any) => (x.id === "co2frac" ? { ...x, enabled: true } : x)) });
    const q = "item=co2frac&visit=repeat&status=continue&anesthesia=cream&group=0&parts=0";
    expect((await slots(q)).slots[day]).toEqual(["10:00"]);
    expect((await book(person(day, "10:00", { item: "co2frac", status: "continue", anesthesiaType: "cream", group: 0, parts: [0] }))).status).toBe(201);
    expect(await lanesOn(c, day, "lane-4")).toEqual([[toIso(day, 600), toIso(day, 610)]]);
    expect(await lanesOn(c, day, MAIN)).toEqual([[toIso(day, 655), toIso(day, 670)]]);
    // メインが 10:40〜12:00 埋まっていると、麻酔の40〜60分後に施術が入らないので出さない
    const p = await c.post("/patients", { name: "院内 太郎", kana: "インナイ タロウ", birthDate: "1980-01-01" });
    await c.post("/reservations", { patientId: p.id, laneId: MAIN, menuIds: [CONSULT], startAt: toIso(day, 670), endAt: toIso(day, 720) });
    await c.post("/reservations", { patientId: p.id, laneId: MAIN, menuIds: [CONSULT], startAt: toIso(day, 600), endAt: toIso(day, 655) });
    expect((await slots(q)).slots[day] ?? []).toEqual([]);
  });
  it("日曜メニューは、モニターの方はまず4番でネオボ撮影（＋麻酔クリーム）15分、続けて施術。4番が埋まっていれば1番・3番で。タトゥーは撮影なし", async () => {
    const day = nextSunday();
    const c = await open(day);
    const q = "item=botox01&visit=repeat&status=monitor";
    expect(await slots(q)).toMatchObject({ slots: { [day]: ["10:00"] }, duration: "約25分（ネオボ撮影15分・施術10分）" });
    const mon = (time: string, phone: string) => person(day, time, { item: "botox01", visit: "", clinicVisit: "returning", status: "monitor" }, phone);
    expect((await book(mon("10:00", "09040000001"))).status).toBe(201);
    expect(await lanesOn(c, day, "lane-4")).toEqual([[toIso(day, 600), toIso(day, 615)]]);
    expect(await lanesOn(c, day, MAIN)).toEqual([[toIso(day, 615), toIso(day, 625)]]);
    const rs = (await c.get(`/day?date=${day}`)).reservations;
    expect(rs.find((r: any) => r.laneId === "lane-4")).toMatchObject({ menuIds: ["menu-s0000B6B52"] });
    expect(rs.find((r: any) => r.laneId === MAIN).memo).toContain("モニター");
    // 継続の方は撮影なし（メインの空き 10:00〜10:15 は20分未満なので、どこに入れてもよい）
    expect((await slots("item=botox01&visit=repeat&status=continue")).slots[day]).toEqual(["10:00", "10:05", "10:25"]);
    // 4番が予約不可（埋まっている）なら1番で
    const p = await c.post("/patients", { name: "院内 太郎", kana: "インナイ タロウ", birthDate: "1980-01-01" });
    await c.post("/reservations", { patientId: p.id, laneId: "lane-4", menuIds: [CONSULT], startAt: toIso(day, 615), endAt: toIso(day, 720) });
    expect((await slots(q)).slots[day]).toEqual(["10:10"]);
    expect((await book(mon("10:10", "09040000002"))).status).toBe(201);
    expect(await lanesOn(c, day, L1)).toEqual([[toIso(day, 610), toIso(day, 625)]]);
    expect(await lanesOn(c, day, MAIN)).toEqual([[toIso(day, 615), toIso(day, 625)], [toIso(day, 625), toIso(day, 635)]]);
    // タトゥー除去はネオボ（顔だけ）を使わないので、モニターでも撮影の枠は取らない（院長 11/20）
    const t = await slots(`area=5&visit=repeat&status=monitor`);
    expect(t.duration).toBe("約5分（照射）");
    expect(t.slots[day]).toEqual(["10:00", "10:10", "10:35"]);
    expect((await book({ ...person(day, "10:00", { item: "", kind: "tattoo", visit: "", clinicVisit: "returning", status: "monitor", rects: [[1, 5]] }, "09040000003") })).status).toBe(201);
    expect(await lanesOn(c, day, "lane-4")).toEqual([[toIso(day, 600), toIso(day, 615)], [toIso(day, 615), toIso(day, 720)]]);
    expect((await c.get(`/day?date=${day}`)).reservations.find((r: any) => r.memo.startsWith("タトゥー除去")).memo).toContain("モニター");
  });
  it("20分以上の空きを虫食いにして10分未満の半端な隙間を残す時刻は出さない。20分未満の空きは自由に埋めてよい。1つも残らない日は隙間のいちばん小さい時刻を1つ", async () => {
    const day = nextSunday();
    const c = await open(day);
    const p = await c.post("/patients", { name: "院内 太郎", kana: "インナイ タロウ", birthDate: "1980-01-01" });
    const at = (a: number, b: number) => c.post("/reservations", { patientId: p.id, laneId: MAIN, menuIds: [CONSULT], startAt: toIso(day, a), endAt: toIso(day, b) });
    // メインの空き：10:00〜10:15（15分）、10:30〜10:55（25分）、11:10〜12:00
    await at(615, 630);
    await at(655, 670);
    // 再診10分：15分の空きは自由に（10:00・10:05）。25分の空きは前後どちらでも15分残る（10:30・10:45）
    expect((await slots("item=botox01&visit=repeat&status=continue")).slots[day]).toEqual(["10:00", "10:05", "10:30", "10:45", "11:10"]);
    // 初診20分：25分の空きに入れると5分の半端が残る（10:30・10:35 は出さない）
    expect((await slots("item=botox01&visit=first")).slots[day]).toEqual(["11:10"]);
    // 11:10 からも埋まると、隙間がいちばん小さい時刻を1つだけ
    await at(670, 720);
    expect((await slots("item=botox01&visit=first")).slots[day]).toEqual(["10:30"]);
  });
});

describe("体・唇の黒ずみ美白トーニング（院長 11/21）", () => {
  it("部位を複数選べる。初診は1番・3番で説明10分＋照射（1部位10分・追加ごとに5分）、再診は1部位10分・追加ごとに5分。タトゥー・シミ取りと同じ機器なので同じ時刻に重ねない", async () => {
    const day = nextSunday();
    const c = await h.srv.as("staff-admin");
    const menu = await c.post("/menus", { name: "黒ずみトーニング", duration: { kind: "range", min: 5, max: 60, step: 5 }, defaultMinutes: 15, startStepMin: 5, laneIds: [L1, L3] });
    await c.patch("/clinic", { tattooEnabled: true, tattooLaneId: MAIN, tattooMenuId: TATTOO, tattooMachine: "ディスカバリーピコプラス", tattooSlots: [`${day} 10:00-12:00`] });
    const presets = (await c.get("/settings")).clinic.sundayMenus;
    const t = presets.find((x: any) => x.id === "darktoning");
    expect(t).toMatchObject({ name: "体・唇の黒ずみ美白トーニング", category: "除去・美白・レーザー", machine: "ディスカバリーピコプラス", firstMinutes: 10, firstBase: 5, firstLaneIds: [L1, L3], firstMenuId: menu.id, repeatMinutes: 5, repeatLaneIds: [L1, L3], repeatMenuId: menu.id, neobo: false });
    expect(t.partGroups[0].parts.map((p: any) => p.name)).toEqual(["リップ（唇・口角。アートメイク不可）", "両脇", "ニップル（乳首＋乳輪）", "デリケートゾーン（V・I）", "臀部（Oライン不可）"]);
    await c.patch("/clinic", { sundayMenus: presets.map((x: any) => (x.id === "darktoning" ? { ...x, enabled: true } : x)) });
    // 再診：1部位10分、3部位20分
    expect((await slots("item=darktoning&visit=repeat&status=continue&group=0&parts=1")).duration).toBe("約10分");
    expect((await slots("item=darktoning&visit=repeat&status=continue&group=0&parts=1,2,3")).duration).toBe("約20分");
    // 初診：説明10分＋照射（1部位10分）＝20分、3部位なら説明10分＋20分＝30分
    expect((await slots("item=darktoning&visit=first&group=0&parts=1")).duration).toBe("約20分");
    expect((await slots("item=darktoning&visit=first&group=0&parts=1,2,3")).duration).toBe("約30分");
    // タトゥーの照射（メイン 10:00〜10:05、同じ機器）と同じ時刻には入れない
    expect((await book({ kind: "tattoo", agree: true, visit: "repeat", rects: [[2, 2.5]], anesthesia: "no", name: "除去 花子", kana: "ジョキョ ハナコ", birthDate: "1990-01-01", phone: "09061610000", email: "t@example.jp", date: day, time: "10:00" })).status).toBe(201);
    const r = await slots("item=darktoning&visit=repeat&status=continue&group=0&parts=1");
    expect(r.slots[day]).not.toContain("10:00");
    expect(r.slots[day][0]).toBe("10:05");
    // 初診の予約メモには説明10分
    expect((await book(person(day, "10:05", { item: "darktoning", visit: "first", group: "0", parts: [1] }, "09061610001"))).status).toBe(201);
    const memo = (await c.get(`/day?date=${day}`)).reservations.find((x: any) => x.memo.startsWith("体・唇の黒ずみ")).memo;
    expect(memo).toContain("初診の説明：10分");
  });
});

describe("日曜の予約：希望施術を複数・当日施術なし（相談のみ）", () => {
  const PEEL_LASER = "menu-s0000A1344"; // レーザー脱毛（機器を使う施術として）
  const laser = { id: "laser01", name: "顔のレーザー", category: "除去・美白・レーザー", firstMinutes: 20, firstLaneIds: [MAIN], firstMenuId: CONSULT, repeatMinutes: 15, repeatLaneIds: [L1], repeatMenuId: PEEL_LASER, machine: "ジェントルマックスプロ", note: "" };
  const plan = async (body: object) => (await (await fetch(`${h.srv.base}/monshin/tattoo/api.php?plan=${encodeURIComponent(JSON.stringify(body))}`)).json()) as any;
  const multi = (day: string, time: string, entries: object[], extra: object = {}, phone = "09050000001") => ({
    ...person(day, time, {}, phone), item: undefined, visit: "", clinicVisit: "returning", status: "continue", entries, ...extra,
  });
  it("選んだ順に続けて取る（レーンをまたいでよい）。ピーリングは同じ日のレーザーの後", async () => {
    const day = nextSunday();
    const c = await open(day, { sundayMenus: [botox, { ...peel, category: "ピーリング" }, laser] });
    // ピーリング → ボトックス：1番でピーリング 10:00〜10:20、続けてメインでボトックス 10:20〜10:30
    const r1 = await plan({ clinicVisit: "returning", status: "continue", entries: [{ kind: "m:peel0001", sameDay: "有" }, { kind: "m:botox01", sameDay: "有" }] });
    expect(r1.slots[day]).toEqual(["10:00"]);
    expect(r1.duration).toContain("約30分");
    expect((await book(multi(day, "10:00", [{ kind: "m:peel0001", sameDay: "有" }, { kind: "m:botox01", sameDay: "有" }]))).status).toBe(201);
    expect(await lanesOn(c, day, L1)).toEqual([[toIso(day, 600), toIso(day, 620)]]);
    expect(await lanesOn(c, day, MAIN)).toEqual([[toIso(day, 620), toIso(day, 630)]]);
    const rs = (await c.get(`/day?date=${day}`)).reservations;
    expect(rs.find((x: any) => x.laneId === MAIN).memo).toContain("この日のご予約：マッサージピール／ボトックス注射");
    // ピーリングを先に選んでも、顔のレーザーが先（レーザー 15分 → ピーリング 20分）
    const r2 = await plan({ clinicVisit: "returning", status: "continue", entries: [{ kind: "m:peel0001", sameDay: "有" }, { kind: "m:laser01", sameDay: "有" }] });
    expect(r2.duration).toMatch(/^約35分〜（顔のレーザー15分・マッサージピール20分/);
  });
  it("今回の治療内容は施術ごと（この治療は初めて → 初診の時間、継続 → 再診の時間）。再診で当日施術ありなら必須", async () => {
    const day = nextSunday();
    const c = await open(day, { sundayMenus: [botox, laser] });
    const base = { clinicVisit: "returning" };
    // 施術ごとの今回の治療内容がないと選べる時刻を出さない
    expect((await plan({ ...base, entries: [{ kind: "m:botox01", sameDay: "有" }, { kind: "m:laser01", sameDay: "有" }] })).error).toBe("status");
    // ボトックスは継続（再診10分）、顔のレーザーはこの治療は初めて（初診20分・医師レーン）
    const entries = [{ kind: "m:botox01", sameDay: "有", status: "continue" }, { kind: "m:laser01", sameDay: "有", status: "new" }];
    const r = await plan({ ...base, entries });
    expect(r.duration).toMatch(/^約30分〜（ボトックス注射10分・顔のレーザー20分/);
    expect((await book(multi(day, r.slots[day][0], entries, { status: "" }))).status).toBe(201);
    const rs = (await c.get(`/day?date=${day}`)).reservations.filter((x: any) => x.laneId === MAIN).sort((a: any, b: any) => a.startAt.localeCompare(b.startAt));
    expect(rs.map((x: any) => [x.startAt, x.endAt])).toEqual([[toIso(day, 600), toIso(day, 610)], [toIso(day, 610), toIso(day, 630)]]);
    expect(rs[0].memo).toContain("今回の治療内容：継続／コース消化");
    expect(rs[1].memo).toContain("顔のレーザー（Web予約・日曜）初診");
    expect(rs[1].memo).toContain("今回の治療内容：この治療は初めて");
  });
  it("当日施術なしの相談は、いくつあってもまとめて15分（脱毛の相談があれば看護師レーン、なければ医師レーン）", async () => {
    const day = nextSunday();
    const hair = { id: "laserhair", name: "医療レーザー脱毛", category: "脱毛", firstMinutes: 15, firstLaneIds: [L1], firstMenuId: PEEL, repeatMinutes: 0, repeatLaneIds: [L1], repeatMenuId: PEEL, machine: "", note: "", partGroups: [{ name: "女性", parts: [{ name: "両ワキ", minutes: 5 }] }] };
    const c = await open(day, { sundayMenus: [botox, hair] });
    const r = await plan({ clinicVisit: "initial", entries: [{ kind: "m:botox01", sameDay: "無" }] });
    expect(r.slots[day]).toEqual(["10:00"]);
    expect(r.duration).toBe("約15分（ご相談15分）");
    expect((await book(multi(day, "10:00", [{ kind: "m:botox01", sameDay: "無" }], { clinicVisit: "initial", insuranceHistory: "無", sameDayTreatment: "無" }))).status).toBe(201);
    expect(await lanesOn(c, day, MAIN)).toEqual([[toIso(day, 600), toIso(day, 615)]]);
    // 脱毛とボトックスの相談 → 看護師レーンに15分だけ
    expect((await book(multi(day, "10:00", [{ kind: "m:botox01", sameDay: "無" }, { kind: "m:laserhair", sameDay: "無" }], { clinicVisit: "initial", insuranceHistory: "無", sameDayTreatment: "無" }, "09050000002"))).status).toBe(201);
    const n = (await c.get(`/day?date=${day}`)).reservations.filter((x: any) => x.laneId === L1 || x.laneId === L3);
    expect(n.map((x: any) => [x.startAt, x.endAt])).toEqual([[toIso(day, 600), toIso(day, 615)]]);
    expect(n[0].memo).toContain("ご相談のみ（当日施術なし）：ボトックス注射・医療レーザー脱毛");
    // 当日施術の希望が1つでもあれば、相談の枠は別に取らず、施術の予約のメモにだけ書く（患者への連絡には出さない）
    const out = await h.srv.php(`
      Db::i()->setMeta('reminderSettings', [...Reminder::defaults(), 'fromEmail' => 'info@example.jp']);
      $sent = [];
      Reminder::$transport = function ($m, $to, $headers, $body) use (&$sent) { $sent[] = (string) $body; return [200, '']; };
      $r = TattooBooking::book(json_decode('${JSON.stringify(multi(day, "10:15", [{ kind: "m:botox01", sameDay: "有" }, { kind: "m:laserhair", sameDay: "無" }], {}, "09050000003"))}', true), '127.0.0.41');
      return ['r' => $r, 'mail' => $sent[0] ?? ''];
    `);
    expect(out.r).toMatchObject({ ok: true, time: "10:15", end: "10:25" });
    expect(out.mail).not.toContain("相談");
    const b = (await c.get(`/day?date=${day}`)).reservations.filter((x: any) => x.startAt === toIso(day, 615));
    expect(b.length).toBe(1);
    expect(b[0].memo).toContain("ほかにご相談（当日施術なし。施術の間に伺う）：医療レーザー脱毛");
  });
  it("同じ機器は、レーンが違っても同じ時刻に入れない。続けて取れなければ20分までの待ちを入れる", async () => {
    const day = nextSunday();
    const c = await open(day, { sundayMenus: [botox, laser, { ...peel, category: "ピーリング" }] });
    const p = await c.post("/patients", { name: "院内 太郎", kana: "インナイ タロウ", birthDate: "1980-01-01" });
    const entries = [{ kind: "m:botox01", sameDay: "有" }, { kind: "m:laser01", sameDay: "有" }];
    // 3番で 10:15〜10:30 に同じ機器（レーザーの施術）を使う予約
    await c.post("/reservations", { patientId: p.id, laneId: L3, menuIds: [PEEL_LASER], startAt: toIso(day, 615), endAt: toIso(day, 630) });
    // ボトックス 10:00〜10:10 → レーザーは機器が空く 10:30 から（待ち20分まではよい）
    expect((await plan({ clinicVisit: "returning", status: "continue", entries })).slots[day]).toContain("10:00");
    expect((await book(multi(day, "10:00", entries))).status).toBe(201);
    expect(await lanesOn(c, day, L1)).toEqual([[toIso(day, 630), toIso(day, 645)]]);
    // さらに 1番が 10:45〜11:10 埋まると、ボトックスの後の待ちが20分を超えるので、その組み合わせは取らない
    await c.post("/reservations", { patientId: p.id, laneId: MAIN, menuIds: [CONSULT], startAt: toIso(day, 610), endAt: toIso(day, 720) });
    await c.post("/reservations", { patientId: p.id, laneId: L1, menuIds: [PEEL], startAt: toIso(day, 645), endAt: toIso(day, 720) });
    expect((await plan({ clinicVisit: "returning", status: "continue", entries })).slots[day] ?? []).toEqual([]);
  });
});

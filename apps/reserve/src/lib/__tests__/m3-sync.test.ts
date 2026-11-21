/* eslint-disable @typescript-eslint/no-explicit-any -- テストでは API の応答（JSON）の中身をそのまま調べる */
import { describe, expect, it } from "vitest";
import { addDays, nowInClinic, toIso } from "@/lib/domain/time";
import { withPhp } from "./php/server";

// デジカル（M3）の受付画面への予約の写し（docs/M3-SYNC.md、院長 11/21）
const h = withPhp({ each: true });
const MENU = "menu-s00009A18E";
const integration = (method: string, p: string, body?: unknown) =>
  h.srv.client().raw(method, `/api/v1/integration/m3-sync${p}`, body, { Authorization: `Bearer ${h.srv.integrationToken}` });
const queue = async () => (await integration("GET", "")).data as any;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function setup() {
  const c = await h.srv.as("staff-admin");
  const day = addDays(nowInClinic().date, 3);
  const book = async (patientId: string, min: number, memo?: string) =>
    c.post("/reservations", { patientId, laneId: "lane-main", menuIds: [MENU], startAt: toIso(day, min), endAt: toIso(day, min + 30), ...(memo && { memo }) });
  return { c, day, book };
}

describe("デジカルへの予約の写し", () => {
  it("連携トークンがなければ読めない。始める前は何も写さない。始めた時刻は変わらない", async () => {
    expect((await h.srv.client().raw("GET", "/api/v1/integration/m3-sync")).status).toBe(401);
    expect(await queue()).toEqual({ startAt: null, items: [], review: [] });
    const s1 = (await integration("POST", "/start")).data;
    await sleep(5);
    const s2 = (await integration("POST", "/start")).data;
    expect(s2.startAt).toBe(s1.startAt);
  });

  it("写し始めた後に作られた予約だけを写す（今ある予約には触らない）。中身・カルテ番号を渡す", async () => {
    const { c, day, book } = await setup();
    const old = await c.post("/patients", { name: "前から 花子", kana: "マエカラ ハナコ" });
    await book(old.id, 600);
    await sleep(5);
    await integration("POST", "/start");
    await sleep(5);
    const p = await c.post("/patients", { name: "新規 太郎", kana: "シンキ タロウ", sex: "male", birthDate: "1990-04-01", m3ChartNo: "76758" });
    const r = await book(p.id, 630, "同伴で受診します");
    const q = await queue();
    expect(q.items).toHaveLength(1);
    const it0 = q.items[0];
    expect(it0.action).toBe("create");
    expect(it0.reservation).toMatchObject({ id: r.id, date: day, time: "1030", minutes: 30, memo: "同伴で受診します", preexisting: false, status: "booked" });
    expect(it0.reservation.menus[0].id).toBe(MENU);
    expect(it0.reservation.lane.id).toBe("lane-main");
    expect(it0.patient).toMatchObject({ id: p.id, m3ChartNo: "76758", kana: "シンキ タロウ", sex: "male", birthDate: "1990-04-01" });
    expect(it0.previous).toBeNull();
  });

  it("写した結果を記録すると一覧から消え、中身が変わったら写し直す。中身に関係ない更新では写し直さない", async () => {
    const { c, book } = await setup();
    await integration("POST", "/start");
    await sleep(5);
    const p = await c.post("/patients", { name: "写し 一郎", m3ChartNo: "1234" });
    const r = await book(p.id, 600);
    const it0 = (await queue()).items[0];
    // 写している間に変わっていたら断る
    const bad = await integration("POST", `/reservations/${r.id}`, { result: "synced", fingerprint: "0".repeat(20) });
    expect(bad.status).toBe(409);
    const ok = await integration("POST", `/reservations/${r.id}`, {
      result: "synced",
      fingerprint: it0.reservation.fingerprint,
      digikar: { patientNo: "1234", date: it0.reservation.date, time: "1000", memoLine: "1000シミ初診" },
    });
    expect(ok.status).toBe(200);
    expect(ok.data).toMatchObject({ state: "synced", written: "synced", digikar: { patientNo: "1234", time: "1000" } });
    expect((await queue()).items).toEqual([]);
    // 予約申請IDだけを付けても写し直さない
    const r2 = await c.patch(`/reservations/${r.id}`, { version: r.version, requestId: "R20261005ABC" });
    expect((await queue()).items).toEqual([]);
    // メモが変われば写し直す（前に写した内容も渡す）
    const r3 = await c.patch(`/reservations/${r.id}`, { version: r2.version, memo: "局麻で" });
    const up = (await queue()).items;
    expect(up.map((x: any) => x.action)).toEqual(["update"]);
    expect(up[0].previous.digikar.memoLine).toBe("1000シミ初診");
    await integration("POST", `/reservations/${r.id}`, { result: "synced", fingerprint: up[0].reservation.fingerprint });
    expect((await queue()).items).toEqual([]);
    // 取り消したら取消を写す → 予約に戻したら戻す
    const r4 = await c.patch(`/reservations/${r.id}`, { version: r3.version, status: "cancelled" });
    const cx = (await queue()).items;
    expect(cx.map((x: any) => x.action)).toEqual(["cancel"]);
    // 取消でない結果は受け付けない
    expect((await integration("POST", `/reservations/${r.id}`, { result: "synced", fingerprint: cx[0].reservation.fingerprint })).status).toBe(400);
    expect((await integration("POST", `/reservations/${r.id}`, { result: "cancelled", fingerprint: cx[0].reservation.fingerprint })).status).toBe(200);
    expect((await queue()).items).toEqual([]);
    await c.patch(`/reservations/${r.id}`, { version: r4.version, status: "booked" });
    expect((await queue()).items.map((x: any) => x.action)).toEqual(["restore"]);
  });

  it("写し始める前からある予約も、始めた後に取り消されたら取消を写す（院長 11/21）。始める前の取消は写さない", async () => {
    const { c, book } = await setup();
    const p = await c.post("/patients", { name: "手入力 さん", m3ChartNo: "555" });
    const a = await book(p.id, 600);
    const b = await book(p.id, 700);
    await c.patch(`/reservations/${b.id}`, { version: b.version, status: "cancelled" });
    await sleep(5);
    await integration("POST", "/start");
    await sleep(5);
    expect((await queue()).items).toEqual([]);
    await c.patch(`/reservations/${a.id}`, { version: a.version, status: "cancelled" });
    const items = (await queue()).items;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ action: "cancel", reservation: { id: a.id, preexisting: true, time: "1000" }, patient: { m3ChartNo: "555" } });
  });

  it("要確認にすると一覧から外れて要確認に並ぶ。理由は必須。予約が直されたら写し直す", async () => {
    const { c, book } = await setup();
    await integration("POST", "/start");
    await sleep(5);
    const p = await c.post("/patients", { name: "番号 なし" });
    const r = await book(p.id, 600);
    const fp = (await queue()).items[0].reservation.fingerprint;
    expect((await integration("POST", `/reservations/${r.id}`, { result: "review", fingerprint: fp })).status).toBe(400);
    expect((await integration("POST", `/reservations/${r.id}`, { result: "review", fingerprint: fp, reason: "カルテ番号がなく、同じ名前の候補が2人" })).status).toBe(200);
    const q = await queue();
    expect(q.items).toEqual([]);
    expect(q.review).toHaveLength(1);
    expect(q.review[0]).toMatchObject({ action: "review", previous: { reason: "カルテ番号がなく、同じ名前の候補が2人" } });
    await c.patch(`/reservations/${r.id}`, { version: r.version, memo: "直した" });
    const q2 = await queue();
    expect(q2.items.map((x: any) => x.action)).toEqual(["create"]);
    expect(q2.review).toEqual([]);
  });

  it("予約不可の枠は写さない。from より前の日は出さない", async () => {
    const { c, day, book } = await setup();
    await integration("POST", "/start");
    await sleep(5);
    const blk = await c.post("/patients", { name: "予約不可" });
    await book(blk.id, 600);
    const p = await c.post("/patients", { name: "ふつう さん" });
    await book(p.id, 700);
    expect((await queue()).items).toHaveLength(1);
    expect((await integration("GET", `?from=${addDays(day, 1)}`)).data.items).toEqual([]);
  });
});

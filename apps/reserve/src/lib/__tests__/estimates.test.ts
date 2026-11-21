import { describe, expect, it } from "vitest";
import { addDays, nowInClinic } from "@/lib/domain/time";
import { taxIncluded } from "@/lib/domain/types";
import { withPhp } from "./php/server";

// 見積の通し番号は年ごとなので、テストごとにまっさらな DB で確かめる
const h = withPhp({ each: true });
const admin = () => h.srv.as("staff-admin");
const by = { id: "staff-admin", name: "院長" };
const custom = (name: string, unitYen: number, qty = 1) => ({ kind: "custom", name, unitYen, qty });

describe("見積書", () => {
  it("メニュー・スキンケア・自由入力（割引）の行から合計を出し、年ごとの通し番号をつける", async () => {
    const c = await admin();
    const p = await c.post("/patients", { name: "見積 テスト" });
    const menu = (await c.get("/settings")).menus[0];
    const prod = await c.post("/products", { name: "院の美容液", category: "skincare", priceYen: 3300 });
    const e = await c.post(`/patients/${p.id}/estimates`, {
      date: "2026-10-05",
      lines: [
        { kind: "menu", refId: menu.id, name: " ハイフ 全顔 ", unitYen: 55000, qty: 3 },
        { kind: "product", refId: prod.id, name: prod.name, unitYen: 3300, qty: 2 },
        custom("3回セット割引", -15000),
      ],
      note: "初回カウンセリング時",
    });
    expect(e.no).toBe("2026-0001");
    expect(e.totalYen).toBe(55000 * 3 + 3300 * 2 - 15000);
    expect(e.validUntil).toBe("2026-11-04");
    expect(e.lines[0].name).toBe("ハイフ 全顔");
    expect(e.lines[2]).toEqual({ kind: "custom", name: "3回セット割引", unitYen: -15000, qty: 1 });
    expect(e.createdBy).toEqual(by);
    expect(taxIncluded(11000)).toBe(1000);
    const e2 = await c.post(`/patients/${p.id}/estimates`, { date: "2026-12-01", lines: [custom("相談料", 3300)] });
    expect(e2.no).toBe("2026-0002");
    const e3 = await c.post(`/patients/${p.id}/estimates`, { date: "2027-01-04", lines: [custom("相談料", 3300)] });
    expect(e3.no).toBe("2027-0001");
    expect((await c.get(`/patients/${p.id}/estimates`)).items.map((x: { no: string }) => x.no)).toEqual(["2027-0001", "2026-0002", "2026-0001"]);
    const v = await c.get(`/estimates/${e.id}`);
    expect(v.patient).toEqual({ id: p.id, name: "見積 テスト", kana: p.kana, chartNo: p.chartNo });
    expect(v.clinic.name).toBeTruthy();
  });

  it("おかしな入力は断る（マイナス合計・存在しないメニュー・期限が発行日より前）", async () => {
    const c = await admin();
    const p = await c.post("/patients", { name: "見積 エラー" });
    const create = (body: object) => c.post(`/patients/${p.id}/estimates`, body);
    await expect(create({ lines: [custom("割引", -100)] })).rejects.toThrow(/マイナス/);
    await expect(create({ lines: [{ kind: "menu", refId: "menu-none", name: "x", unitYen: 1, qty: 1 }] })).rejects.toThrow(/メニュー/);
    await expect(create({ lines: [custom("  ", 1)] })).rejects.toThrow(/項目名/);
    const today = nowInClinic().date;
    await expect(create({ date: today, validUntil: addDays(today, -1), lines: [custom("x", 1)] })).rejects.toThrow(/有効期限/);
  });

  it("変更・削除は版を確かめる。院の設定の有効期限と注意書きが使われる", async () => {
    const c = await admin();
    await c.patch("/clinic", { estimateValidDays: 14, address: "東京都○○区1-2-3", phone: "03-0000-0000", issuer: "院長 石田", estimateNote: "税込です。\n効果には個人差があります。" });
    expect((await c.get("/settings")).clinic).toMatchObject({ estimateValidDays: 14, issuer: "院長 石田", estimateNote: "税込です。\n効果には個人差があります。" });
    await c.patch("/clinic", { phone: "" });
    expect((await c.get("/settings")).clinic.phone).toBeUndefined();
    const p = await c.post("/patients", { name: "見積 変更" });
    const e = await c.post(`/patients/${p.id}/estimates`, { date: "2026-10-05", lines: [custom("相談料", 3300)] });
    expect(e.validUntil).toBe("2026-10-19");
    const u = await c.patch(`/estimates/${e.id}`, { version: 1, lines: [custom("相談料", 3300, 2)], note: "メモ" });
    expect(u).toMatchObject({ version: 2, totalYen: 6600, note: "メモ", updatedBy: by });
    await expect(c.patch(`/estimates/${e.id}`, { version: 1, note: "" })).rejects.toThrow(/他の端末/);
    await c.post(`/estimates/${e.id}/delete`, { version: 2 });
    expect((await c.get(`/patients/${p.id}/estimates`)).items).toEqual([]);
    await expect(c.get(`/estimates/${e.id}`)).rejects.toThrow(/見つかりません/);
  });

  it("重複患者の統合で、見積書とファイルも統合先へ移る", async () => {
    const c = await admin();
    const a = await c.post("/patients", { name: "統合 見積", kana: "トウゴウ ミツモリ", birthDate: "1990-01-01" });
    const b = await c.post("/patients", { name: "統合 見積", kana: "トウゴウ ミツモリ", birthDate: "1990-01-01" });
    const e = await c.post(`/patients/${b.id}/estimates`, { lines: [custom("相談料", 3300)] });
    const f = await c.upload(b.id, { date: nowInClinic().date, name: "a.pdf", bytes: new TextEncoder().encode("%PDF-1.4\n%%EOF") });
    await c.post("/patients/merge", { keepId: a.id, dupId: b.id, keepVersion: a.version, dupVersion: b.version });
    expect((await c.get(`/patients/${a.id}/estimates`)).items.map((x: { id: string }) => x.id)).toEqual([e.id]);
    expect((await c.get(`/patients/${a.id}/files`)).items.map((x: { id: string }) => x.id)).toEqual([f.id]);
    expect((await c.get(`/patients/${b.id}/estimates`)).items).toEqual([]);
  });
});

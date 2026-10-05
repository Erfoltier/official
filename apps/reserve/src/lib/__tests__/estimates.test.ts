import { describe, expect, it } from "vitest";
import { addDays, nowInClinic } from "@/lib/domain/time";
import { taxIncluded } from "@/lib/domain/types";

async function store() {
  resetStores();
  return import("@/lib/server/store");
}

const by = { id: "staff-x", name: "受付" };

describe("見積書", () => {
  it("メニュー・スキンケア・自由入力（割引）の行から合計を出し、年ごとの通し番号をつける", async () => {
    const s = await store();
    const p = s.createPatient({ name: "見積 テスト" });
    const menu = s.getSettings().menus[0];
    const prod = s.createProduct({ name: "院の美容液", category: "skincare", priceYen: 3300 });
    const e = s.createEstimate(
      p.id,
      {
        date: "2026-10-05",
        lines: [
          { kind: "menu", refId: menu.id, name: " ハイフ 全顔 ", unitYen: 55000, qty: 3 },
          { kind: "product", refId: prod.id, name: prod.name, unitYen: 3300, qty: 2 },
          { kind: "custom", name: "3回セット割引", unitYen: -15000, qty: 1 },
        ],
        note: "初回カウンセリング時",
      },
      by,
    );
    expect(e.no).toBe("2026-0001");
    expect(e.totalYen).toBe(55000 * 3 + 3300 * 2 - 15000);
    expect(e.validUntil).toBe("2026-11-04");
    expect(e.lines[0].name).toBe("ハイフ 全顔");
    expect(e.lines[2]).toEqual({ kind: "custom", name: "3回セット割引", unitYen: -15000, qty: 1 });
    expect(taxIncluded(11000)).toBe(1000);
    const e2 = s.createEstimate(p.id, { date: "2026-12-01", lines: [{ kind: "custom", name: "相談料", unitYen: 3300, qty: 1 }] });
    expect(e2.no).toBe("2026-0002");
    const e3 = s.createEstimate(p.id, { date: "2027-01-04", lines: [{ kind: "custom", name: "相談料", unitYen: 3300, qty: 1 }] });
    expect(e3.no).toBe("2027-0001");
    expect(s.listEstimates(p.id).map((x) => x.no)).toEqual(["2027-0001", "2026-0002", "2026-0001"]);
    const v = s.getEstimateView(e.id);
    expect(v.patient).toEqual({ id: p.id, name: "見積 テスト", kana: p.kana, chartNo: p.chartNo });
    expect(v.clinic.name).toBeTruthy();
  });

  it("おかしな入力は断る（マイナス合計・存在しないメニュー・期限が発行日より前）", async () => {
    const s = await store();
    const p = s.createPatient({ name: "見積 エラー" });
    expect(() => s.createEstimate(p.id, { lines: [{ kind: "custom", name: "割引", unitYen: -100, qty: 1 }] })).toThrow(/マイナス/);
    expect(() => s.createEstimate(p.id, { lines: [{ kind: "menu", refId: "menu-none", name: "x", unitYen: 1, qty: 1 }] })).toThrow(/メニュー/);
    expect(() => s.createEstimate(p.id, { lines: [{ kind: "custom", name: "  ", unitYen: 1, qty: 1 }] })).toThrow(/項目名/);
    const today = nowInClinic().date;
    expect(() =>
      s.createEstimate(p.id, { date: today, validUntil: addDays(today, -1), lines: [{ kind: "custom", name: "x", unitYen: 1, qty: 1 }] }),
    ).toThrow(/有効期限/);
  });

  it("変更・削除は版を確かめる。院の設定の有効期限と注意書きが使われる", async () => {
    const s = await store();
    s.updateClinic({ estimateValidDays: 14, address: "東京都○○区1-2-3", phone: "03-0000-0000", issuer: "院長 石田", estimateNote: "税込です。\n効果には個人差があります。" });
    expect(s.getClinic()).toMatchObject({ estimateValidDays: 14, issuer: "院長 石田", estimateNote: "税込です。\n効果には個人差があります。" });
    s.updateClinic({ phone: "" });
    expect(s.getClinic().phone).toBeUndefined();
    const p = s.createPatient({ name: "見積 変更" });
    const e = s.createEstimate(p.id, { date: "2026-10-05", lines: [{ kind: "custom", name: "相談料", unitYen: 3300, qty: 1 }] });
    expect(e.validUntil).toBe("2026-10-19");
    const u = s.updateEstimate(e.id, { version: 1, lines: [{ kind: "custom", name: "相談料", unitYen: 3300, qty: 2 }], note: "メモ" }, by);
    expect(u).toMatchObject({ version: 2, totalYen: 6600, note: "メモ", updatedBy: by });
    expect(() => s.updateEstimate(e.id, { version: 1, note: "" })).toThrow(/他の端末/);
    s.deleteEstimate(e.id, { version: 2 }, by);
    expect(s.listEstimates(p.id)).toEqual([]);
    expect(() => s.getEstimateView(e.id)).toThrow(/見つかりません/);
  });

  it("重複患者の統合で、見積書とファイルも統合先へ移る", async () => {
    const s = await store();
    const a = s.createPatient({ name: "統合 見積", kana: "トウゴウ ミツモリ", birthDate: "1990-01-01" });
    const b = s.createPatient({ name: "統合 見積", kana: "トウゴウ ミツモリ", birthDate: "1990-01-01" });
    const e = s.createEstimate(b.id, { lines: [{ kind: "custom", name: "相談料", unitYen: 3300, qty: 1 }] });
    const f = s.saveFile(b.id, { date: nowInClinic().date, name: "a.pdf", bytes: new TextEncoder().encode("%PDF-1.4\n%%EOF") });
    s.mergePatients({ keepId: a.id, dupId: b.id, keepVersion: a.version, dupVersion: b.version });
    expect(s.listEstimates(a.id).map((x) => x.id)).toEqual([e.id]);
    expect(s.listFiles(a.id).map((x) => x.id)).toEqual([f.id]);
    expect(s.listEstimates(b.id)).toEqual([]);
  });
});

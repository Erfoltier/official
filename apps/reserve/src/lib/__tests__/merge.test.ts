import { describe, expect, it } from "vitest";
import { addDays, nowInClinic, toIso } from "@/lib/domain/time";
import { withPhp, type Client } from "./php/server";

// 重複の候補を見るので、テストごとにまっさらな DB で確かめる
const h = withPhp({ each: true });
const by = { id: "staff-admin", name: "院長" };
const admin = () => h.srv.as("staff-admin");

type P = { id: string; version: number; [k: string]: unknown };
const detail = (c: Client, id: string) => c.get(`/patients/${id}`);
const book = (c: Client, patientId: string, day: string) =>
  c.post("/reservations", { patientId, laneId: "lane-main", menuIds: ["menu-s00009A18E"], startAt: toIso(day, 600), endAt: toIso(day, 610) });
const merge = (c: Client, keep: P, dup: P) => c.post("/patients/merge", { keepId: keep.id, dupId: dup.id, keepVersion: keep.version, dupVersion: dup.version });
const preview = (c: Client, keep: P, dup: P) => c.get(`/patients/merge?keep=${keep.id}&dup=${dup.id}`);

describe("患者の削除・復元", () => {
  it("削除すると検索に出ず、記録は残り、復元できる", async () => {
    const c = await admin();
    const p = await c.post("/patients", { name: "誤登録 テスト", kana: "ゴトウロク" });
    const today = nowInClinic().date;
    await c.put(`/patients/${p.id}/visits/${today}`, { note: "メモ", skincare: [], version: 0 });
    const d = (await c.post(`/patients/${p.id}/delete`, { version: p.version, reason: "誤って登録した" })).patient;
    expect(d.deleted?.reason).toBe("誤って登録した");
    expect(d.deleted?.by).toEqual(by);
    expect((await c.get("/patients?q=ゴトウロク")).items).toHaveLength(0);
    // 記録は残る
    expect((await detail(c, p.id)).visits[0].note).toBe("メモ");
    // 削除された患者は編集・予約できない
    await expect(c.patch(`/patients/${p.id}`, { version: d.version, name: "x" })).rejects.toThrow(/復元/);
    await expect(book(c, p.id, today)).rejects.toThrow(/患者が見つかりません/);
    const r = (await c.post(`/patients/${p.id}/restore`, { version: d.version })).patient;
    expect(r.deleted).toBeUndefined();
    expect((await c.get("/patients?q=ゴトウロク")).items).toHaveLength(1);
  });

  it("今日以降の予約がある患者は削除できない", async () => {
    const c = await admin();
    const p = await c.post("/patients", { name: "予約あり" });
    await book(c, p.id, addDays(nowInClinic().date, 2));
    await expect(c.post(`/patients/${p.id}/delete`, { version: p.version, reason: "誤って登録した" })).rejects.toThrow(/予約が1件/);
  });

  it("削除・復元は管理操作のできるスタッフだけ", async () => {
    const c = await admin();
    const st = await c.post("/staff", { name: "看護師", role: "nurse", pin: "246810" });
    const ns = await h.srv.as(st.id, "246810");
    const p = await c.post("/patients", { name: "権限 テスト" });
    await expect(ns.post(`/patients/${p.id}/delete`, { version: p.version, reason: "x" })).rejects.toThrow(/権限/);
  });
});

describe("重複患者の統合", () => {
  it("重複の候補を見つける", async () => {
    const c = await admin();
    const a = await c.post("/patients", { name: "山田 Anna", kana: "やまだ あんな", phone: "090-1234-5678" });
    await c.post("/patients", { name: "山田 アンナ", kana: "ヤマダ アンナ" });
    await c.post("/patients", { name: "別人", phone: "09012345678" });
    const reasons = (await detail(c, a.id)).duplicates.map((d: { patient: P; reasons: string[] }) => `${d.patient.name}:${d.reasons.join("/")}`);
    expect(reasons).toContain("山田 アンナ:フリガナが同じ");
    expect(reasons).toContain("別人:電話番号が同じ");
  });

  it("予約・記録を移し、空欄を埋め、統合元は削除扱いで残る", async () => {
    const c = await admin();
    const today = nowInClinic().date;
    const past = addDays(today, -7);
    const keep = await c.post("/patients", { name: "山田 あんな", kana: "ヤマダ アンナ", birthDate: "1990-04-01", memo: "敏感肌" });
    const dup = await c.post("/patients", { name: "山田　あんな", kana: "やまだあんな", phone: "090-1111-2222", email: "a@example.com", birthDate: "1990-04-01", memo: "金属アレルギー" });
    const r = await book(c, dup.id, addDays(today, 3));
    await c.put(`/patients/${keep.id}/visits/${past}`, { note: "keep側の記録", skincare: ["A"], version: 0 });
    await c.put(`/patients/${dup.id}/visits/${past}`, { note: "dup側の記録", skincare: ["B"], version: 0 });
    await c.put(`/patients/${dup.id}/visits/${today}`, { note: "今日の記録", skincare: [], version: 0 });

    const k = (await detail(c, keep.id)).patient;
    const d = (await detail(c, dup.id)).patient;
    expect(await preview(c, k, d)).toMatchObject({ reservations: 1, visitNotes: 2, sameDayNotes: [past], filledFields: ["電話", "メール"], identical: true, mismatch: [] });

    const merged = (await merge(c, k, d)).patient;
    expect(merged.phone).toBe("090-1111-2222");
    expect(merged.email).toBe("a@example.com");
    expect(merged.memo).toContain("敏感肌");
    expect(merged.memo).toContain("金属アレルギー");

    const dt = await detail(c, k.id);
    expect(dt.upcoming.map((x: { id: string }) => x.id)).toContain(r.id);
    const pastRow = dt.visits.find((v: { date: string }) => v.date === past);
    expect(pastRow.note).toContain("keep側の記録");
    expect(pastRow.note).toContain("dup側の記録");
    expect(pastRow.skincare).toEqual(["A", "B"]);
    expect(dt.visits.find((v: { date: string }) => v.date === today)?.note).toBe("今日の記録");
    expect(dt.history[0].by).toEqual(by);

    const dupAfter = (await detail(c, d.id)).patient;
    expect(dupAfter.mergedInto).toBe(k.id);
    expect(dupAfter.deleted).toBeTruthy();
    await expect(c.post(`/patients/${d.id}/restore`, { version: dupAfter.version })).rejects.toThrow(/統合された/);
    // 操作ログに氏名は残らない
    expect(JSON.stringify((await c.get("/audit")).items)).not.toContain("山田");
  });

  it("生年月日が両方とも未入力なら、姓名とセイメイの一致で統合できる（Airリザーブから移した患者）", async () => {
    const c = await admin();
    const a = await c.post("/patients", { name: "鈴木 花", kana: "スズキ ハナ" });
    const b = await c.post("/patients", { name: "鈴木　花", kana: "すずき はな" });
    const x = await c.post("/patients", { name: "鈴木 花" });
    expect(await preview(c, a, b)).toMatchObject({ identical: true, mismatch: [] });
    expect((await preview(c, a, x)).mismatch).toEqual(["セイメイ（未入力）"]);
    expect((await merge(c, a, b)).patient.id).toBe(a.id);
  });

  it("姓名・セイメイ・生年月日のどれかが違う（未入力を含む）と統合できない", async () => {
    const c = await admin();
    const a = await c.post("/patients", { name: "佐藤 花", kana: "サトウ ハナ", birthDate: "1995-05-05", phone: "090-5555-0000" });
    const b = await c.post("/patients", { name: "佐藤 華", kana: "サトウ ハナ", birthDate: "1995-05-05", phone: "090-5555-0000" });
    const x = await c.post("/patients", { name: "佐藤 花", kana: "サトウ ハナ", phone: "090-5555-0000" });
    expect(await preview(c, a, b)).toMatchObject({ identical: false, mismatch: ["姓名"] });
    expect((await preview(c, a, x)).mismatch).toEqual(["生年月日（片方だけ未入力）"]);
    await expect(merge(c, a, b)).rejects.toThrow(/一致しない項目：姓名/);
    // 重複の候補には出るが、統合できないことが分かる
    const cand = (await detail(c, a.id)).duplicates;
    expect(cand.find((d: { patient: P }) => d.patient.id === b.id)).toMatchObject({ identical: false, mismatch: ["姓名"] });
    // 生年月日をそろえれば統合できる
    const x2 = (await c.patch(`/patients/${x.id}`, { version: x.version, birthDate: "1995-05-05" })).patient;
    expect((await detail(c, a.id)).duplicates.find((d: { patient: P }) => d.patient.id === x.id)?.identical).toBe(true);
    expect((await merge(c, a, x2)).patient.id).toBe(a.id);
  });

  it("古い版・同じ患者どうし・削除済みは統合できない", async () => {
    const c = await admin();
    const a = await c.post("/patients", { name: "A", kana: "エー", birthDate: "2000-01-01" });
    const b = await c.post("/patients", { name: "A", kana: "エー", birthDate: "2000-01-01" });
    await expect(merge(c, a, a)).rejects.toThrow(/同じ患者/);
    await c.patch(`/patients/${b.id}`, { version: b.version, phone: "090-0000-0000" });
    await expect(merge(c, a, { id: b.id, version: 1 })).rejects.toThrow(/他の端末/);
  });
});

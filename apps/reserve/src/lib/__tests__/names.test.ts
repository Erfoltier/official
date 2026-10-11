import { describe, expect, it } from "vitest";
import { addDays, nowInClinic, toIso } from "@/lib/domain/time";
import { cleanName, hasForbiddenChars, searchKey } from "@/lib/domain/text";
import { AIR_LANES, AIR_MENUS } from "@/lib/seed/airreserve-import";
import { withPhp } from "./php/server";

describe("氏名の扱い", () => {
  it("漢字・ひらがな・カタカナ・ローマ字の混在をそのまま受け付ける", () => {
    for (const n of ["山田 Anna", "さくら 田中", "LEE Min-ji", "高橋 エマ", "王 美玲", "鈴木 Mari（旧姓 森）"]) {
      expect(hasForbiddenChars(n)).toBe(false);
      expect(cleanName(n)).toBe(n);
    }
  });

  it("空白をそろえ、制御文字は拒否する", () => {
    expect(cleanName("  山田　　Anna ")).toBe("山田 Anna");
    expect(hasForbiddenChars("山田\nAnna")).toBe(true);
    expect(hasForbiddenChars("山田‮Anna")).toBe(true);
  });

  it("検索ではひらがな/カタカナ・全角/半角・大小文字・空白の違いを無視する", () => {
    expect(searchKey("やまだ あんな")).toBe(searchKey("ヤマダアンナ"));
    expect(searchKey("ﾔﾏﾀﾞ")).toBe(searchKey("ヤマダ"));
    expect(searchKey("ＡＮＮＡ")).toBe(searchKey("anna"));
    expect(searchKey("min-ji")).toBe(searchKey("Minji"));
  });
});

describe("Airリザーブから移した設定", () => {
  it("レーン4件・メニュー35件", () => {
    expect(AIR_LANES.map((l) => l.name)).toEqual([
      "メインレーン（医師）",
      "1番レーン(レーザー脱毛など)",
      "3番レーン針脱毛、ハイフ",
      "4番ネオボ撮影・麻酔・ゼオ説明",
    ]);
    expect(AIR_MENUS).toHaveLength(35);
    expect(new Set(AIR_MENUS.map((m) => m.id)).size).toBe(35);
  });

  it("提供時間・料金・レーンを再現している", () => {
    const by = (name: string) => AIR_MENUS.find((m) => m.name === name)!;
    expect(by("シミまとめ標準20分").duration).toEqual({ kind: "fixed", minutes: 20 });
    expect(by("針脱毛").duration).toEqual({ kind: "range", min: 5, max: 600, step: 5 });
    expect(by("全顔炭酸ガスフラクショナル").priceYen).toBe(49500);
    expect(by("予約（メモに自由記載）").capacity).toBe(4);
    expect(by("マッサージピール").laneIds).toEqual(["lane-1", "lane-3"]);
    expect(by("ボトックス初診標準20分").defaultMinutes).toBe(20);
    // 「使用しない」と書かれたメニューは選択肢から外す
    expect(AIR_MENUS.filter((m) => !m.active).map((m) => m.name)).toEqual([
      "色素レーザー5/5使用しない11/3",
      "スネコス【再診】使用しない9/30",
    ]);
  });
});

describe("患者・レーン・メニューの登録", () => {
  const h = withPhp();
  const admin = () => h.srv.as("staff-admin");

  it("混在した氏名で患者を登録し、かな・ローマ字で検索できる", async () => {
    const c = await admin();
    const ids = async (q: string) => (await c.get(`/patients?q=${encodeURIComponent(q)}`)).items.map((x: { id: string }) => x.id);
    const p = await c.post("/patients", { name: "  中村　Sophie ", kana: "なかむら そふぃー", nameAlt: "Nakamura Sophie" });
    expect(p.name).toBe("中村 Sophie");
    // 診察券番号は自動では振らない
    expect(p.chartNo).toBe("");
    expect(await ids("ナカムラソフィー")).toContain(p.id);
    expect(await ids("sophie")).toContain(p.id);
    expect(await ids("ＳＯＰＨＩＥ")).toContain(p.id);
    await expect(c.post("/patients", { name: "  " })).rejects.toThrow(/氏名/);
    await expect(c.post("/patients", { name: "a\u0000b" })).rejects.toThrow(/使えない文字/);
    // 空欄どうしは重なってよいが、入れた番号は重ならないこと
    expect((await c.post("/patients", { name: "空欄 二人目" })).chartNo).toBe("");
    await c.post("/patients", { name: "番号 あり", chartNo: "9001" });
    await expect(c.post("/patients", { name: "x", chartNo: "9001" })).rejects.toThrow(/既に使われて/);
  });

  it("レーンを追加・並べ替えでき、今日以降の予約が残るレーンは非表示にできない", async () => {
    const c = await admin();
    const lanes = async () => (await c.get("/settings")).lanes as { id: string; active: boolean }[];
    const lane = await c.post("/lanes", { name: "5番レーン（ダーマペン）", shortName: "5番" });
    expect((await lanes()).at(-1)!.id).toBe(lane.id);
    const ids = (await lanes()).map((l) => l.id);
    await c.post("/lanes/reorder", { ids: [lane.id, ...ids.filter((id) => id !== lane.id)] });
    expect((await lanes())[0].id).toBe(lane.id);
    // 予約のない新しいレーンは非表示にできる
    expect((await c.patch(`/lanes/${lane.id}`, { active: false })).active).toBe(false);
    // 今日以降の予約があるレーンは非表示にできない
    const p = await c.post("/patients", { name: "レーン 予約" });
    const day = addDays(nowInClinic().date, 1);
    await c.post("/reservations", { patientId: p.id, laneId: "lane-1", menuIds: ["menu-s00009A18A"], startAt: toIso(day, 600), endAt: toIso(day, 630) });
    await expect(c.patch("/lanes/lane-1", { active: false })).rejects.toThrow(/予約が/);
  });

  it("メニューの提供時間を検証する", async () => {
    const c = await admin();
    const m = await c.post("/menus", { name: "テスト", duration: { kind: "range", min: 10, max: 40, step: 5 }, defaultMinutes: 90 });
    expect(m.defaultMinutes).toBe(40); // 範囲内に丸める
    await expect(c.patch(`/menus/${m.id}`, { duration: { kind: "fixed", minutes: 7 } })).rejects.toThrow(/提供時間/);
    await expect(c.patch(`/menus/${m.id}`, { color: "red" })).rejects.toThrow(/色/);
  });
});

describe("レーンの数の制限", () => {
  const h = withPhp({ each: true });

  it("表示できるレーンは最大30。予約の記録がないレーンは削除できる", async () => {
    const c = await h.srv.as("staff-admin");
    const lanes = async () => (await c.get("/settings")).lanes as { id: string; active: boolean }[];
    for (let i = 5; i <= 30; i++) await c.post("/lanes", { name: `${i}番レーン` });
    expect((await lanes()).filter((l) => l.active)).toHaveLength(30);
    await expect(c.post("/lanes", { name: "31番" })).rejects.toThrow(/最大30/);
    const extra = (await lanes()).at(-1)!;
    expect((await c.raw("DELETE", `/api/v1/lanes/${extra.id}`)).status).toBe(204);
    expect(await lanes()).toHaveLength(29);
    // 共用サーバー向けに POST + X-HTTP-Method-Override でも消せる
    const extra2 = (await lanes()).at(-1)!;
    expect((await c.raw("POST", `/api/v1/lanes/${extra2.id}`, undefined, { "X-HTTP-Method-Override": "DELETE" })).status).toBe(204);
    expect(await lanes()).toHaveLength(28);
    // 予約の記録があるレーンは削除できない
    const p = await c.post("/patients", { name: "レーン 記録" });
    const day = addDays(nowInClinic().date, -3);
    await c.post("/reservations", { patientId: p.id, laneId: "lane-main", menuIds: ["menu-s00009A18E"], startAt: toIso(day, 600), endAt: toIso(day, 610) });
    await expect(c.call("DELETE", "/api/v1/lanes/lane-main")).rejects.toThrow(/予約の記録/);
  });

  it("最後の1本は非表示にも削除にもできない", async () => {
    const c = await h.srv.as("staff-admin");
    const lanes = async () => (await c.get("/settings")).lanes as { id: string; active: boolean }[];
    const only = await c.post("/lanes", { name: "単独" });
    for (const l of await lanes()) if (l.id !== only.id) await c.patch(`/lanes/${l.id}`, { active: false });
    expect((await lanes()).filter((l) => l.active).map((l) => l.id)).toEqual([only.id]);
    await expect(c.patch(`/lanes/${only.id}`, { active: false })).rejects.toThrow(/1つ以上/);
    await expect(c.call("DELETE", `/api/v1/lanes/${only.id}`)).rejects.toThrow(/1つ以上/);
  });
});

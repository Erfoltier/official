import { beforeEach, describe, expect, it } from "vitest";
import { cleanName, hasForbiddenChars, searchKey } from "@/lib/domain/text";
import { AIR_LANES, AIR_MENUS } from "@/lib/seed/airreserve-import";

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
  beforeEach(() => {
    resetStores();
  });

  it("混在した氏名で患者を登録し、かな・ローマ字で検索できる", async () => {
    const s = await import("@/lib/server/store");
    const p = s.createPatient({ name: "  中村　Sophie ", kana: "なかむら そふぃー", nameAlt: "Nakamura Sophie" });
    expect(p.name).toBe("中村 Sophie");
    // 診察券番号は自動では振らない
    expect(p.chartNo).toBe("");
    expect(s.searchPatients("ナカムラソフィー").map((x) => x.id)).toContain(p.id);
    expect(s.searchPatients("sophie").map((x) => x.id)).toContain(p.id);
    expect(s.searchPatients("ＳＯＰＨＩＥ").map((x) => x.id)).toContain(p.id);
    expect(() => s.createPatient({ name: "  " })).toThrow(/氏名/);
    expect(() => s.createPatient({ name: "a\u0000b" })).toThrow(/使えない文字/);
    // 空欄どうしは重なってよいが、入れた番号は重ならないこと
    expect(s.createPatient({ name: "空欄 二人目" }).chartNo).toBe("");
    s.createPatient({ name: "番号 あり", chartNo: "9001" });
    expect(() => s.createPatient({ name: "x", chartNo: "9001" })).toThrow(/既に使われて/);
  });

  it("レーンを追加・並べ替えでき、予約が残るレーンは非表示にできない", async () => {
    const s = await import("@/lib/server/store");
    const lane = s.createLane({ name: "5番レーン（ダーマペン）", shortName: "5番" });
    expect(s.getSettings().lanes.at(-1)!.id).toBe(lane.id);
    const ids = s.getSettings().lanes.map((l) => l.id);
    s.reorderLanes([lane.id, ...ids.filter((id) => id !== lane.id)]);
    expect(s.getSettings().lanes[0].id).toBe(lane.id);
    // 予約のない新しいレーンは非表示にできる
    expect(s.updateLane(lane.id, { active: false }).active).toBe(false);
    // 今日以降の予約があるレーンは非表示にできない
    const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
    const r = s.getDayBundle(today).reservations.find((x) => x.status === "booked" || x.status === "arrived");
    if (r) expect(() => s.updateLane(r.laneId, { active: false })).toThrow(/予約が/);
  });

  it("メニューの提供時間を検証する", async () => {
    const s = await import("@/lib/server/store");
    const m = s.createMenu({ name: "テスト", duration: { kind: "range", min: 10, max: 40, step: 5 }, defaultMinutes: 90 });
    expect(m.defaultMinutes).toBe(40); // 範囲内に丸める
    expect(() => s.updateMenu(m.id, { duration: { kind: "fixed", minutes: 7 } })).toThrow(/提供時間/);
    expect(() => s.updateMenu(m.id, { color: "red" })).toThrow(/色/);
  });
});

describe("レーンの数の制限", () => {
  beforeEach(() => {
    resetStores();
  });

  it("表示できるレーンは最大30、最小1。予約の記録がないレーンは削除できる", async () => {
    const s = await import("@/lib/server/store");
    for (let i = 5; i <= 30; i++) s.createLane({ name: `${i}番レーン` });
    expect(s.getSettings().lanes.filter((l) => l.active)).toHaveLength(30);
    expect(() => s.createLane({ name: "31番" })).toThrow(/最大30/);
    const extra = s.getSettings().lanes.at(-1)!;
    s.deleteLane(extra.id);
    expect(s.getSettings().lanes).toHaveLength(29);
    // 予約の記録があるレーンは削除できない
    s.getDayBundle("2026-10-07");
    expect(() => s.deleteLane("lane-main")).toThrow(/予約の記録/);
    // 最後の1本は非表示にも削除にもできない（新しく作ったレーンだけの状態で確かめる）
    resetStores();
    const t = await import("@/lib/server/store");
    const only = t.createLane({ name: "単独" });
    for (const l of t.getSettings().lanes) if (l.id !== only.id) t.updateLane(l.id, { active: false });
    expect(t.getSettings().lanes.filter((l) => l.active).map((l) => l.id)).toEqual([only.id]);
    expect(() => t.updateLane(only.id, { active: false })).toThrow(/1つ以上/);
    expect(() => t.deleteLane(only.id)).toThrow(/1つ以上/);
  });
});

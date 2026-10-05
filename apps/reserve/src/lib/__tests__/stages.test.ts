import { beforeEach, describe, expect, it } from "vitest";
import { addDays, nowInClinic, toIso } from "@/lib/domain/time";

async function store() {
  resetStores();
  return import("@/lib/server/store");
}

describe("状態（院ごとに増減できる）", () => {
  beforeEach(() => {
    resetStores();
  });

  it("初期の状態が入っていて、押すと大まかな段階と時刻が変わる。自由入力は状態と同時に持てる", async () => {
    const s = await store();
    const labels = s.getSettings().stages.map((x) => x.label);
    expect(labels).toEqual(["予約", "来院済", "医師待ち", "看護師待ち", "撮影待ち", "麻酔待ち", "診察中", "処置中", "待機中", "検討中", "会計待ち", "帰宅", "自由入力"]);
    const p = s.createPatient({ name: "状態 テスト" });
    const d = addDays(nowInClinic().date, 1);
    const r = s.createReservation({ patientId: p.id, laneId: "lane-main", menuIds: ["menu-s00009A18E"], startAt: toIso(d, 600), endAt: toIso(d, 610) });
    const r1 = s.updateReservation(r.id, { version: r.version, stageId: "stage-wait-photo" }, { id: "x", name: "受付" });
    expect(r1).toMatchObject({ stageId: "stage-wait-photo", status: "arrived" });
    expect(s.stageLabelOf(r1)).toBe("撮影待ち");
    expect(r1.stageAt).toBeTruthy();
    // 自由入力は状態と同時に持てる
    const r2 = s.updateReservation(r.id, { version: r1.version, stageText: "  15時までに出たい " });
    expect(r2).toMatchObject({ stageId: "stage-wait-photo", stageText: "15時までに出たい", status: "arrived" });
    expect(s.stageLabelOf(r2)).toBe("撮影待ち・15時までに出たい");
    const r3 = s.updateReservation(r.id, { version: r2.version, stageId: "stage-done" });
    expect(r3.stageText).toBe("15時までに出たい");
    expect(r3.status).toBe("done");
    expect(() => s.updateReservation(r.id, { version: r3.version, stageId: "stage-free" })).toThrow(/自由入力/);
    const r3b = s.updateReservation(r.id, { version: r3.version, stageText: "" });
    expect(r3b.stageText).toBeUndefined();
    // キャンセルは状態の選択を残したまま、表示はキャンセル
    const r4 = s.updateReservation(r.id, { version: r3b.version, status: "cancelled" });
    expect(s.stageLabelOf(r4)).toBe("キャンセル");
    expect(() => s.updateReservation(r.id, { version: r4.version, stageId: "stage-none" })).toThrow(/状態が見つかりません/);
  });

  it("状態を追加・名前と色の変更・並べ替え・非表示にできる（最低1つは表示）", async () => {
    const s = await store();
    const a = s.createStage({ label: "パッチ待ち", color: "#123456", phase: "arrived" });
    expect(() => s.createStage({ label: "パッチ待ち" })).toThrow(/同じ名前/);
    expect(() => s.createStage({ label: "x", color: "red" })).toThrow(/色/);
    expect(s.updateStage(a.id, { label: "パッチ中", phase: "in_treatment" })).toMatchObject({ label: "パッチ中", phase: "in_treatment" });
    const ids = s.getSettings().stages.map((x) => x.id).reverse();
    expect(s.reorderStages(ids).map((x) => x.id)).toEqual(ids);
    for (const st of s.getSettings().stages.slice(1)) s.updateStage(st.id, { active: false });
    const last = s.getSettings().stages[0];
    expect(() => s.updateStage(last.id, { active: false })).toThrow(/1つ以上/);
  });
});

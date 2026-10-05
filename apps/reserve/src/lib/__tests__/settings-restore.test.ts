import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

async function store() {
  resetStores();
  return import("@/lib/server/store");
}

describe("設定のバックアップと復元", () => {
  beforeEach(() => {
    resetStores();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("設定を変えるたびに記録し、1日前・1週間前などの状態に戻せる。あとから作ったものは隠すだけ", async () => {
    const s = await store();
    s.getSettings(); // 記録を始めた時点（初期の設定）
    vi.setSystemTime(new Date("2026-01-10T00:00:00Z"));
    s.updateClinic({ dayStartMin: 600 });
    const lane = s.createLane({ name: "5番ダーマペン" });
    vi.setSystemTime(new Date("2026-01-20T00:00:00Z"));
    s.updateClinic({ dayStartMin: 480 });
    s.deleteStage("stage-consider");
    const prod = s.createProduct({ name: "新しい美容液", priceYen: 5000 });
    vi.setSystemTime(new Date("2026-01-22T00:00:00Z"));

    const pts = s.listRestorePoints();
    expect(pts.points.map((p) => p.key)).toEqual(["1d", "1w", "1m", "3m", "6m", "1y"]);
    expect(pts.points[0]).toMatchObject({ label: "1日前", available: true, oldest: false });
    expect(pts.points.find((p) => p.key === "1y")).toMatchObject({ oldest: true });

    // 1週間前（1/15）＝1/10の変更のあと
    s.restoreSettings("1w", { id: "staff-admin", name: "院長" });
    expect(s.getClinic().dayStartMin).toBe(600);
    expect(s.getSettings().stages.map((x) => x.id)).toContain("stage-consider");
    expect(s.getSettings().products.find((x) => x.id === prod.id)).toBeUndefined();
    expect(s.getSettings().lanes.find((x) => x.id === lane.id)?.active).toBe(true);

    // 1か月前＝記録を始めた時点。あとから作ったレーンは消さずに隠す
    s.restoreSettings("1m");
    expect(s.getClinic().dayStartMin).toBe(540);
    expect(s.getSettings().lanes.find((x) => x.id === lane.id)?.active).toBe(false);

    // 戻す前の状態も記録されているので、また戻せる（1分以上あとの「直前」= 1日前より新しい記録）
    vi.setSystemTime(new Date("2026-01-23T00:00:00Z"));
    s.restoreSettings("1d");
    expect(s.getClinic().dayStartMin).toBe(540);
  });
});

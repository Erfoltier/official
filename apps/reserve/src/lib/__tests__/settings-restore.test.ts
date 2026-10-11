import { describe, expect, it } from "vitest";
import { withPhp } from "./php/server";

const h = withPhp();

/**
 * 設定の記録（settingsSnapshot）の時刻を過去へずらす。PHP では時計を進められないので、
 * 「記録を作った後に日数がたった」状態をこうして作る。$which: "baseline"・"recent"（直近1時間）・"all"
 */
function age(which: "baseline" | "recent" | "all", seconds: number) {
  return h.srv.php<number>(`
    $db = Db::i();
    $now = time();
    $n = 0;
    foreach ($db->all('settingsSnapshot') as $id => $s) {
      $t = intdiv(parse_ms($s['at']), 1000);
      $hit = match (${JSON.stringify(which)}) { 'baseline' => !empty($s['baseline']), 'recent' => empty($s['baseline']) && $t > $now - 3600, default => true };
      if ($hit) {
        $s['at'] = gmdate('Y-m-d\\\\TH:i:s', $t - ${seconds}) . '.000Z';
        $db->put('settingsSnapshot', (string) $id, $s);
        $n++;
      }
    }
    return $n;
  `);
}
const DAY = 86_400;

describe("設定のバックアップと復元", () => {
  it("設定を変えるたびに記録し、1日前・1週間前などの状態に戻せる。あとから作ったものは隠すだけ", async () => {
    const c = await h.srv.as("staff-admin");
    const settings = () => c.get("/settings");
    await c.get("/settings/restore"); // 記録を始めた時点（初期の設定）
    expect(await age("baseline", 21 * DAY)).toBe(1);
    // 12日前の変更
    await c.patch("/clinic", { dayStartMin: 600 });
    const lane = await c.post("/lanes", { name: "5番ダーマペン" });
    expect(await age("recent", 12 * DAY)).toBeGreaterThan(0);
    // 2日前の変更
    await c.patch("/clinic", { dayStartMin: 480 });
    await c.post("/stages/stage-consider/delete");
    const prod = await c.post("/products", { name: "新しい美容液", priceYen: 5000 });
    expect(await age("recent", 2 * DAY)).toBeGreaterThan(0);

    const pts = await c.get("/settings/restore");
    expect(pts.points.map((p: { key: string }) => p.key)).toEqual(["1d", "1w", "1m", "3m", "6m", "1y"]);
    expect(pts.points[0]).toMatchObject({ label: "1日前", available: true, oldest: false });
    expect(pts.points.find((p: { key: string }) => p.key === "1y")).toMatchObject({ oldest: true });

    // 1週間前＝12日前の変更のあと
    await c.post("/settings/restore", { key: "1w" });
    let s = await settings();
    expect(s.clinic.dayStartMin).toBe(600);
    expect(s.stages.map((x: { id: string }) => x.id)).toContain("stage-consider");
    expect(s.products.find((x: { id: string }) => x.id === prod.id)).toBeUndefined();
    expect(s.lanes.find((x: { id: string }) => x.id === lane.id)?.active).toBe(true);
    expect((await c.get("/audit")).items[0]).toMatchObject({ action: "設定を1週間前の状態に戻した", actor: { id: "staff-admin" } });

    // 1か月前＝記録を始めた時点。あとから作ったレーンは消さずに隠す
    await c.post("/settings/restore", { key: "1m" });
    s = await settings();
    expect(s.clinic.dayStartMin).toBe(540);
    expect(s.lanes.find((x: { id: string }) => x.id === lane.id)?.active).toBe(false);

    // 戻したあとの状態も記録されているので、また戻せる（1日たってから「1日前」に戻しても同じ）
    await age("all", DAY + 60);
    await c.post("/settings/restore", { key: "1d" });
    expect((await settings()).clinic.dayStartMin).toBe(540);
    // 戻す時点の指定が正しくなければ断る
    await expect(c.post("/settings/restore", { key: "2d" })).rejects.toThrow(/400/);
  });
});

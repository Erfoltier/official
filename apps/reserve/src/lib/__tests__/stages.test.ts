import { describe, expect, it } from "vitest";
import { addDays, nowInClinic, toIso } from "@/lib/domain/time";
import { withPhp, type Client } from "./php/server";

// 状態の一覧を変えるので、テストごとにまっさらな DB で確かめる
const h = withPhp({ each: true });

/** 明日の予約を1件作る */
async function setup() {
  const c = await h.srv.as("staff-admin");
  const p = await c.post("/patients", { name: "状態 テスト" });
  const d = addDays(nowInClinic().date, 1);
  const r = await c.post("/reservations", { patientId: p.id, laneId: "lane-main", menuIds: ["menu-s00009A18E"], startAt: toIso(d, 600), endAt: toIso(d, 610) });
  const upd = (body: object) => c.patch(`/reservations/${r.id}`, body);
  /** 画面（患者の今後の予約）に出る状態の表示 */
  const label = async () => (await c.get(`/patients/${p.id}`)).upcoming.find((x: { id: string }) => x.id === r.id).stageLabel as string;
  return { c, d, r, upd, label };
}
const stagesOf = async (c: Client) => (await c.get("/settings")).stages as { id: string; label: string }[];

describe("状態（院ごとに増減できる）", () => {
  it("初期の状態が入っていて、押すと大まかな段階と時刻が変わる。自由入力は状態と同時に持てる", async () => {
    const { c, r, upd, label } = await setup();
    expect((await stagesOf(c)).map((x) => x.label)).toEqual(["予約", "来院済", "医師待ち", "看護師待ち", "撮影待ち", "麻酔待ち", "診察中", "処置中", "待機中", "検討中", "会計待ち", "帰宅", "自由入力"]);
    const r1 = await upd({ version: r.version, stageId: "stage-wait-photo" });
    expect(r1).toMatchObject({ stageId: "stage-wait-photo", status: "arrived" });
    expect(await label()).toBe("撮影待ち");
    expect(r1.stageAt).toBeTruthy();
    // 自由入力は状態と同時に持てる
    const r2 = await upd({ version: r1.version, stageText: "  15時までに出たい " });
    expect(r2).toMatchObject({ stageId: "stage-wait-photo", stageText: "15時までに出たい", status: "arrived" });
    expect(await label()).toBe("撮影待ち・15時までに出たい");
    const r3 = await upd({ version: r2.version, stageId: "stage-done" });
    expect(r3.stageText).toBe("15時までに出たい");
    expect(r3.status).toBe("done");
    await expect(upd({ version: r3.version, stageId: "stage-free" })).rejects.toThrow(/自由入力/);
    const r3b = await upd({ version: r3.version, stageText: "" });
    expect(r3b.stageText).toBeUndefined();
    // キャンセルは状態の選択を残したまま、表示はキャンセル
    const r4 = await upd({ version: r3b.version, status: "cancelled" });
    expect(r4.stageId).toBe("stage-done");
    expect(await label()).toBe("キャンセル");
    await expect(upd({ version: r4.version, stageId: "stage-none" })).rejects.toThrow(/状態が見つかりません/);
  });

  it("状態を変えた時刻を指定できる（省略すると今の時刻）。時刻だけの修正もできる", async () => {
    const { d, r, upd } = await setup();
    const r1 = await upd({ version: r.version, stageId: "stage-arrived", stageMin: 595 });
    expect(r1.stageAt).toBe(toIso(d, 595));
    expect(r1.status).toBe("arrived");
    const r2 = await upd({ version: r1.version, stageMin: 602 });
    expect(r2).toMatchObject({ stageId: "stage-arrived", stageAt: toIso(d, 602) });
    const r3 = await upd({ version: r2.version, stageId: "stage-treat" });
    expect(r3.stageAt).not.toBe(toIso(d, 602));
  });

  it("状態を追加・名前と色の変更・並べ替え・非表示にできる（最低1つは表示）", async () => {
    const c = await h.srv.as("staff-admin");
    const a = await c.post("/stages", { label: "パッチ待ち", color: "#123456", phase: "arrived" });
    await expect(c.post("/stages", { label: "パッチ待ち" })).rejects.toThrow(/同じ名前/);
    await expect(c.post("/stages", { label: "x", color: "red" })).rejects.toThrow(/色/);
    expect(await c.patch(`/stages/${a.id}`, { label: "パッチ中", phase: "in_treatment" })).toMatchObject({ label: "パッチ中", phase: "in_treatment" });
    const ids = (await stagesOf(c)).map((x) => x.id).reverse();
    expect((await c.post("/stages/reorder", { ids })).items.map((x: { id: string }) => x.id)).toEqual(ids);
    for (const st of (await stagesOf(c)).slice(1)) await c.patch(`/stages/${st.id}`, { active: false });
    const last = (await stagesOf(c))[0];
    await expect(c.patch(`/stages/${last.id}`, { active: false })).rejects.toThrow(/1つ以上/);
  });

  it("状態を削除すると設定と予約詳細から消えるが、その状態を付けた予約の表示は残る。「予約」は削除できない", async () => {
    const { c, d, r, upd, label } = await setup();
    const r1 = await upd({ version: r.version, stageId: "stage-consider" });
    await c.post("/stages/stage-consider/delete");
    expect((await stagesOf(c)).map((x) => x.id)).not.toContain("stage-consider");
    expect((await c.get(`/day?date=${d}`)).stages.find((x: { id: string }) => x.id === "stage-consider")).toMatchObject({ deleted: true, active: false });
    expect(await label()).toBe("検討中");
    await expect(upd({ version: r1.version, stageId: "stage-consider" })).rejects.toThrow(/見つかりません/);
    await expect(c.post("/stages/stage-booked/delete")).rejects.toThrow(/削除できません/);
    await expect(c.post("/stages/stage-consider/delete")).rejects.toThrow(/見つかりません/);
    // 同じ名前でもう一度作れる
    expect((await c.post("/stages", { label: "検討中" })).label).toBe("検討中");
    // 並べ替えは削除したものを除いた一覧で
    const ids = (await stagesOf(c)).map((x) => x.id).reverse();
    expect((await c.post("/stages/reorder", { ids })).items.map((x: { id: string }) => x.id)).toEqual(ids);
  });
});

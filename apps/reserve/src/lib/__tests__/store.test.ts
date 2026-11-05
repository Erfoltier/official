import { describe, expect, it } from "vitest";
import { addDays, nowInClinic, toIso } from "@/lib/domain/time";
import { withPhp } from "./php/server";

// デモデータ（2週間前〜90日先は毎日予約が入っている）で確かめる
const h = withPhp({ demo: true });
const day = addDays(nowInClinic().date, 7);
const at = (min: number) => toIso(day, min);

/** その日の、キャンセルでない予約を1件（テストごとに別の予約を使う） */
let used = 0;
async function pick() {
  const c = await h.srv.as("staff-rc1");
  const list = (await c.get(`/day?date=${day}`)).reservations.filter((r: { status: string }) => r.status === "booked");
  return { c, r: list[used++] };
}

describe("store", () => {
  it("デモデータの日は予約が入っていて、何度読んでも同じ", async () => {
    const c = await h.srv.as("staff-rc1");
    const a = (await c.get(`/day?date=${day}`)).reservations.map((r: { id: string }) => r.id);
    expect(a.length).toBeGreaterThan(20);
    expect((await c.get(`/day?date=${day}`)).reservations.map((r: { id: string }) => r.id)).toEqual(a);
  });

  it("予約の移動で版が上がり、古い版での更新は拒否する", async () => {
    const { c, r } = await pick();
    const moved = await c.patch(`/reservations/${r.id}`, { version: r.version, startAt: at(18 * 60), endAt: at(18 * 60 + 10) });
    expect(moved.version).toBe(r.version + 1);
    expect(moved.reminder.status).toBe("pending");
    await expect(c.patch(`/reservations/${r.id}`, { version: r.version, status: "arrived" })).rejects.toThrow(/他の端末/);
  });

  it("不正な時間を拒否する", async () => {
    const { c, r } = await pick();
    await expect(c.patch(`/reservations/${r.id}`, { version: r.version, startAt: at(18 * 60), endAt: at(17 * 60) })).rejects.toThrow(/400/);
    await expect(c.patch(`/reservations/${r.id}`, { version: r.version, startAt: at(23 * 60), endAt: toIso(addDays(day, 1), 60) })).rejects.toThrow(/日をまたぐ/);
  });

  it("キャンセルの理由を残し、患者画面のキャンセル履歴に出す。予約に戻すと消える", async () => {
    const { c, r } = await pick();
    const done = await c.patch(`/reservations/${r.id}`, { version: r.version, status: "no_show", cancelReason: "連絡がつかない" });
    expect(done).toMatchObject({ status: "no_show", cancelReason: "連絡がつかない" });
    expect(done.cancelledAt).toBeTruthy();
    const d = await c.get(`/patients/${r.patientId}`);
    expect(d.cancellations.find((x: { id: string }) => x.id === r.id)).toMatchObject({ status: "no_show", cancelReason: "連絡がつかない" });
    const back = await c.patch(`/reservations/${r.id}`, { version: done.version, status: "booked" });
    expect(back.cancelReason).toBeUndefined();
    expect((await c.get(`/patients/${r.patientId}`)).cancellations.map((x: { id: string }) => x.id)).not.toContain(r.id);
  });

  it("時刻を変えた予約はリマインドを未送信に戻す", async () => {
    const { c, r } = await pick();
    // 送信済みにする（送信はサーバー内のリマインド機能だけが行う）
    await h.srv.php(`$r = Db::i()->get("reservation", ${JSON.stringify(r.id)}); $r['reminder'] = ['status' => 'sent']; Db::i()->put('reservation', $r['id'], $r); return true;`);
    const sent = (await c.get(`/day?date=${day}`)).reservations.find((x: { id: string }) => x.id === r.id);
    const memoOnly = await c.patch(`/reservations/${r.id}`, { version: sent.version, memo: "x" });
    expect(memoOnly.reminder.status).toBe("sent");
    const moved = await c.patch(`/reservations/${r.id}`, { version: memoOnly.version, startAt: at(18 * 60 + 30), endAt: at(18 * 60 + 40) });
    expect(moved.reminder.status).toBe("pending");
  });
});

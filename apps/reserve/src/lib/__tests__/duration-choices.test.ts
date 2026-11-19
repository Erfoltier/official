import { describe, expect, it } from "vitest";
import { durationChoices } from "@/components/calendar/menuFormat";

// 予約の時間の選択肢：予約不可（5〜720分）などは、そのメニューの最大まで選べる（院長 11/20：9時間止めたい）
describe("予約の時間の選択肢", () => {
  it("ふつうは決めた上限まで。長いメニューを選べばその最大まで（12時間まで）", () => {
    expect(durationChoices(5, 180, 30, []).at(-1)).toBe(180);
    const block = { duration: { kind: "range" as const, min: 5, max: 720, step: 5 } };
    expect(durationChoices(5, 180, 30, [block])).toContain(540);
    expect(durationChoices(5, 180, 30, [block]).at(-1)).toBe(720);
    expect(durationChoices(5, 180, 30, [{ duration: { kind: "range" as const, min: 5, max: 2000, step: 5 } }]).at(-1)).toBe(720);
    // 今の時間が上限より長ければ残す
    expect(durationChoices(5, 180, 200, [])).toContain(200);
  });
});

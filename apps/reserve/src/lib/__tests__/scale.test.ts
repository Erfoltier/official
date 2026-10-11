import { describe, expect, it } from "vitest";
import {
  MAX_PX_PER_MIN,
  MIN_PX_PER_MIN,
  anchoredScrollTop,
  clampScale,
  densityFor,
  fitScale,
  snapMinutes,
} from "@/lib/calendar/scale";

describe("scale", () => {
  it("拡大率を範囲内に収める", () => {
    expect(clampScale(100)).toBe(MAX_PX_PER_MIN);
    expect(clampScale(0)).toBe(MIN_PX_PER_MIN);
    expect(clampScale(Number.NaN)).toBeGreaterThan(0);
  });

  it("指の下の時刻を固定したまま拡大する", () => {
    // 2px/分で scrollTop=200、指が上から100px → 指の下は150分目
    const next = anchoredScrollTop(200, 100, 2, 4);
    expect((next + 100) / 4).toBe(150);
  });

  it("1日全体を画面に収める", () => {
    expect(fitScale(570, 570)).toBe(1);
  });

  it("5分枠でも1日全体表示で名前が出る段階になる", () => {
    // 9:30-19:00（570分）を約700pxに収めると 1.23px/分 → 20分枠は約24px
    const s = fitScale(700, 570);
    expect(densityFor(20 * s)).toBe("line");
    expect(densityFor(10 * s)).toBe("micro");
    expect(densityFor(60 * s)).toBe("full");
  });

  it("5分刻みに丸める", () => {
    expect(snapMinutes(602, 5)).toBe(600);
    expect(snapMinutes(603, 5)).toBe(605);
  });
});

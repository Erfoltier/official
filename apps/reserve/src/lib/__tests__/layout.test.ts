import { describe, expect, it } from "vitest";
import { findConflicts, layoutLane } from "@/lib/calendar/layout";

describe("layoutLane", () => {
  it("重ならない予約はレーン幅いっぱい", () => {
    const m = layoutLane([
      { id: "a", start: 600, end: 610 },
      { id: "b", start: 610, end: 620 },
    ]);
    expect(m.get("a")).toEqual({ id: "a", col: 0, cols: 1 });
    expect(m.get("b")).toEqual({ id: "b", col: 0, cols: 1 });
  });

  it("重なる予約は横に並べ、空いた列を再利用する", () => {
    const m = layoutLane([
      { id: "a", start: 600, end: 660 },
      { id: "b", start: 605, end: 615 },
      { id: "c", start: 620, end: 630 },
      { id: "d", start: 700, end: 710 },
    ]);
    expect(m.get("a")).toMatchObject({ col: 0, cols: 2 });
    expect(m.get("b")).toMatchObject({ col: 1, cols: 2 });
    expect(m.get("c")).toMatchObject({ col: 1, cols: 2 });
    // 別のまとまりは列数がリセットされる
    expect(m.get("d")).toMatchObject({ col: 0, cols: 1 });
  });

  it("3件同時は3列", () => {
    const m = layoutLane([
      { id: "a", start: 600, end: 630 },
      { id: "b", start: 600, end: 630 },
      { id: "c", start: 610, end: 620 },
    ]);
    expect(new Set([...m.values()].map((p) => p.col))).toEqual(new Set([0, 1, 2]));
    expect([...m.values()].every((p) => p.cols === 3)).toBe(true);
  });
});

describe("findConflicts", () => {
  it("接しているだけの予約は重複にしない", () => {
    expect(findConflicts([{ id: "a", start: 600, end: 610 }, { id: "b", start: 610, end: 620 }]).size).toBe(0);
  });
  it("重なっている予約を両方返す", () => {
    const c = findConflicts([
      { id: "a", start: 600, end: 630 },
      { id: "b", start: 620, end: 640 },
      { id: "c", start: 700, end: 710 },
    ]);
    expect([...c].sort()).toEqual(["a", "b"]);
  });
});

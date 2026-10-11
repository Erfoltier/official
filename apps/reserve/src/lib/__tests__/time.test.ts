import { describe, expect, it } from "vitest";
import { addDays, clinicDateOf, formatDateJa, formatHm, isDateString, minutesOfDay, nowInClinic, toIso } from "@/lib/domain/time";

describe("time", () => {
  it("日本時間の日付と分を相互に変換できる", () => {
    expect(toIso("2026-10-07", 10 * 60 + 5)).toBe("2026-10-07T10:05:00+09:00");
    expect(minutesOfDay("2026-10-07T10:05:00+09:00")).toBe(605);
    expect(clinicDateOf("2026-10-07T10:05:00+09:00")).toBe("2026-10-07");
  });

  it("UTC表記の日時も日本時間として解釈する", () => {
    // UTC 15:30 は日本時間の翌日 0:30
    expect(clinicDateOf("2026-10-06T15:30:00Z")).toBe("2026-10-07");
    expect(minutesOfDay("2026-10-06T15:30:00Z")).toBe(30);
  });

  it("端末のタイムゾーンに依存しない", () => {
    const now = nowInClinic(new Date("2026-10-06T23:59:00Z"));
    expect(now).toEqual({ date: "2026-10-07", minutes: 8 * 60 + 59 });
  });

  it("日付の加算と表示", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(formatDateJa("2026-10-07")).toBe("10/7(水)");
    expect(formatHm(9 * 60 + 5)).toBe("9:05");
  });

  it("存在しない日付を拒否する", () => {
    expect(isDateString("2026-02-30")).toBe(false);
    expect(isDateString("2026-2-3")).toBe(false);
    expect(isDateString("2026-10-07")).toBe(true);
  });
});

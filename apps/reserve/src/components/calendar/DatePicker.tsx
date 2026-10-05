"use client";

import { useEffect, useRef, useState } from "react";
import { addDays, formatDateJa, weekdayOf } from "@/lib/domain/time";
import { holidayName } from "@/lib/domain/holidays";
import { fetchMonthCounts } from "./api";
import styles from "./datePicker.module.css";

/**
 * 日付ジャンプ用のカレンダー（Airリザーブの左のミニカレンダーを参考に、月曜始まり・土曜青・日曜祝日赤）。
 * - 月の切り替え、年月を選んで直接移動、「今日」「1週間後」などの早送り
 * - 各日に予約数を表示（キャンセルを除く）
 */
const WEEK = ["月", "火", "水", "木", "金", "土", "日"];
const JUMPS: { label: string; days: number }[] = [
  { label: "1週前", days: -7 },
  { label: "1週後", days: 7 },
  { label: "2週後", days: 14 },
  { label: "4週後", days: 28 },
];

const monthOf = (date: string) => date.slice(0, 7);
function shiftMonth(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}

/** 月曜始まりで6週分の日付 */
function gridOf(month: string): string[] {
  const first = `${month}-01`;
  const lead = (weekdayOf(first) + 6) % 7;
  const start = addDays(first, -lead);
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

export function DatePicker({
  value,
  today,
  onPick,
  onClose,
}: {
  value: string;
  today: string;
  onPick: (date: string) => void;
  onClose: () => void;
}) {
  const [month, setMonth] = useState(monthOf(value));
  const [chooseMonth, setChooseMonth] = useState(false);
  const [year, setYear] = useState(Number(value.slice(0, 4)));
  const [counts, setCounts] = useState<Record<string, Record<string, number>>>({});
  const ref = useRef<HTMLDivElement>(null);

  // 表示中の月の予約数（前後の月の端の日も出すので3か月分）
  useEffect(() => {
    const ac = new AbortController();
    for (const m of [shiftMonth(month, -1), month, shiftMonth(month, 1)]) {
      fetchMonthCounts(m, ac.signal).then(
        (days) => setCounts((c) => ({ ...c, [m]: days })),
        () => {},
      );
    }
    return () => ac.abort();
  }, [month]);

  // 外側を押す・Esc で閉じる
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node) && !(e.target as Element).closest?.("[data-datepicker-toggle]")) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const [y, m] = month.split("-").map(Number);
  const countOf = (d: string) => counts[monthOf(d)]?.[d] ?? 0;

  return (
    <div ref={ref} className={styles.picker} role="dialog" aria-label="日付を選ぶ">
      <div className={styles.head}>
        <button type="button" className={styles.nav} onClick={() => (chooseMonth ? setYear((v) => v - 1) : setMonth(shiftMonth(month, -1)))} aria-label={chooseMonth ? "前の年" : "前の月"}>
          ‹
        </button>
        <button
          type="button"
          className={styles.title}
          onClick={() => {
            setYear(y);
            setChooseMonth((v) => !v);
          }}
          aria-expanded={chooseMonth}
          title="年月を選ぶ"
        >
          {chooseMonth ? `${year}年` : `${y}年${m}月`} <span className={styles.caret}>▾</span>
        </button>
        <button type="button" className={styles.nav} onClick={() => (chooseMonth ? setYear((v) => v + 1) : setMonth(shiftMonth(month, 1)))} aria-label={chooseMonth ? "次の年" : "次の月"}>
          ›
        </button>
        <button type="button" className={styles.today} onClick={() => onPick(today)}>
          今日
        </button>
      </div>

      {chooseMonth ? (
        <div className={styles.months}>
          {Array.from({ length: 12 }, (_, i) => {
            const mm = `${year}-${String(i + 1).padStart(2, "0")}`;
            return (
              <button
                type="button"
                key={mm}
                className={styles.month}
                data-current={mm === month || undefined}
                data-this={mm === monthOf(today) || undefined}
                onClick={() => {
                  setMonth(mm);
                  setChooseMonth(false);
                }}
              >
                {i + 1}月
              </button>
            );
          })}
        </div>
      ) : (
        <>
          <div className={styles.week}>
            {WEEK.map((w, i) => (
              <span key={w} data-sat={i === 5 || undefined} data-sun={i === 6 || undefined}>
                {w}
              </span>
            ))}
          </div>
          <div className={styles.grid}>
            {gridOf(month).map((d) => {
              const wd = weekdayOf(d);
              const hol = holidayName(d);
              const n = countOf(d);
              return (
                <button
                  type="button"
                  key={d}
                  className={styles.day}
                  data-out={!d.startsWith(month) || undefined}
                  data-sat={wd === 6 || undefined}
                  data-sun={wd === 0 || !!hol || undefined}
                  data-today={d === today || undefined}
                  data-selected={d === value || undefined}
                  onClick={() => onPick(d)}
                  title={[formatDateJa(d), hol, n ? `予約${n}件` : null].filter(Boolean).join("　")}
                  aria-label={[formatDateJa(d), hol, n ? `予約${n}件` : "予約なし"].filter(Boolean).join(" ")}
                  aria-current={d === value ? "date" : undefined}
                >
                  <span className={styles.num}>{Number(d.slice(8))}</span>
                  {hol && <span className={styles.hol}>{hol.replace("の日", "")}</span>}
                  {n > 0 && <span className={styles.cnt}>{n}</span>}
                </button>
              );
            })}
          </div>
        </>
      )}

      <div className={styles.jumps}>
        {JUMPS.map((j) => (
          <button type="button" key={j.label} onClick={() => onPick(addDays(value, j.days))} title={formatDateJa(addDays(value, j.days))}>
            {j.label}
          </button>
        ))}
      </div>
    </div>
  );
}

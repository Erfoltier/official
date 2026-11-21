"use client";

import { useEffect, useRef, useState } from "react";
import { addDays, formatDateJa, weekdayOf } from "@/lib/domain/time";
import { holidayName } from "@/lib/domain/holidays";
import { fetchMonthCounts } from "./api";
import { ChevronDown } from "./Chevron";
import styles from "./datePicker.module.css";

/**
 * 日付ジャンプ用のカレンダー（Airリザーブの左のミニカレンダーを参考に、月曜始まり・土曜青・日曜祝日赤）。
 * - 月の切り替え、年月を選んで直接移動、「今日」、前・次の診療日へ移る
 * - 各日に予約数を表示（キャンセルを除く）
 */
const WEEK = ["月", "火", "水", "木", "金", "土", "日"];
/** 前・次の診療日を探す範囲（日） */
const SEARCH_DAYS = 120;

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
  clinicWeekdays,
  specialDates,
  onPick,
  onClose,
}: {
  value: string;
  today: string;
  /** 予約申請フォームで選べる曜日（設定 → 院の情報）。全曜日なら曜日では見ない */
  clinicWeekdays?: number[];
  /** 特別診療日（設定 → 院の情報） */
  specialDates?: string[];
  onPick: (date: string) => void;
  onClose: () => void;
}) {
  const [month, setMonth] = useState(monthOf(value));
  const [chooseMonth, setChooseMonth] = useState(false);
  const [year, setYear] = useState(Number(value.slice(0, 4)));
  const [counts, setCounts] = useState<Record<string, Record<string, number>>>({});
  const ref = useRef<HTMLDivElement>(null);
  // スマホ：日付の面を左右にフリックすると月を移る（左へ払うと次の月）
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    swipe.current = e.touches.length === 1 ? { x: t.clientX, y: t.clientY } : null;
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const s = swipe.current;
    swipe.current = null;
    const t = e.changedTouches[0];
    if (!s || !t) return;
    const dx = t.clientX - s.x;
    const dy = t.clientY - s.y;
    if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    setMonth((cur) => shiftMonth(cur, dx < 0 ? 1 : -1));
  };

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

  /**
   * 前・次の診療日：予約がある日、特別診療日、診療の曜日（祝日で予約がない日は除く）のうち、選んでいる日のいちばん近い日。
   * 予約数は月ごとに読み、まだ読んでいない月はその場で読む
   */
  const [seeking, setSeeking] = useState(false);
  const jumpClinicDay = async (dir: 1 | -1) => {
    if (seeking) return;
    setSeeking(true);
    try {
      const weekdays = clinicWeekdays && clinicWeekdays.length > 0 && clinicWeekdays.length < 7 ? new Set(clinicWeekdays) : null;
      const special = new Set(specialDates ?? []);
      const loaded: Record<string, Record<string, number>> = { ...counts };
      const countAt = async (d: string) => {
        const mm = monthOf(d);
        if (!loaded[mm]) {
          try {
            loaded[mm] = await fetchMonthCounts(mm);
          } catch {
            loaded[mm] = {};
          }
        }
        return loaded[mm][d] ?? 0;
      };
      for (let i = 1; i <= SEARCH_DAYS; i++) {
        const d = addDays(value, dir * i);
        const n = await countAt(d);
        if (n > 0 || special.has(d) || (weekdays?.has(weekdayOf(d)) && !holidayName(d))) {
          setCounts(loaded);
          onPick(d);
          return;
        }
      }
      setCounts(loaded);
    } finally {
      setSeeking(false);
    }
  };

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
          {chooseMonth ? `${year}年` : `${y}年${m}月`}
          <ChevronDown className={styles.caret} />
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
          <div className={styles.grid} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
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
        <button type="button" onClick={() => jumpClinicDay(-1)} disabled={seeking} title="予約のある日・診療日のうち、ひとつ前の日へ">
          ‹ 前の診療日
        </button>
        <button type="button" onClick={() => jumpClinicDay(1)} disabled={seeking} title="予約のある日・診療日のうち、ひとつ後の日へ">
          次の診療日 ›
        </button>
      </div>
    </div>
  );
}

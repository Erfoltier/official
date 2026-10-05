"use client";

import { useEffect, useState } from "react";
import { CalendarApp } from "@/components/calendar/CalendarApp";
import { isDateString, nowInClinic } from "@/lib/domain/time";

/**
 * 表示する日付は URL の ?date= か今日（日本時間）。
 * 静的書き出しでも動くよう、ブラウザ側で決める
 */
export default function Page() {
  const [date, setDate] = useState<string | null>(null);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("date");
    // URL を読めるのは表示後のため、ここで初期化する
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDate(q && isDateString(q) ? q : nowInClinic().date);
  }, []);
  return date ? <CalendarApp initialDate={date} /> : null;
}

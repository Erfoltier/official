"use client";

import Link from "next/link";
import { Fragment, useEffect, useState } from "react";
import type { Questionnaire } from "@/lib/domain/types";
import { fetchQuestionnaire, searchQuestionnaires, type QuestionnaireRow } from "@/components/calendar/api";
import { patientPath } from "@/lib/paths";
import styles from "./list.module.css";

const SOURCE: Record<QuestionnaireRow["source"], string> = { line: "LINE", web: "Web", form: "Google" };

/** 今日（院の時刻）から days 日ずらした日付 YYYY-MM-DD */
function dayOffset(days: number): string {
  const d = new Date(Date.now() + 9 * 3600_000 + days * 86400_000);
  return d.toISOString().slice(0, 10);
}

type Detail = Questionnaire & { patientName?: string; chartNo?: string };

/** 問診票の一覧（スタッフ全員）。期間と氏名・フリガナ・電話・診察券番号で絞り、行を開くと回答の全文 */
export function QuestionnairesApp() {
  const [from, setFrom] = useState(() => dayOffset(-30));
  const [to, setTo] = useState(() => dayOffset(0));
  const [query, setQuery] = useState("");
  const [data, setData] = useState<{ items: QuestionnaireRow[]; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [detail, setDetail] = useState<Record<string, Detail>>({});

  useEffect(() => {
    if (!from || !to) return;
    const ac = new AbortController();
    const t = setTimeout(() => {
      searchQuestionnaires(from, to, query.trim(), ac.signal).then(
        (r) => {
          setData(r);
          setError(null);
        },
        (e: unknown) => {
          if (!ac.signal.aborted) setError(e instanceof Error ? e.message : "読み込めませんでした");
        },
      );
    }, query ? 250 : 0);
    return () => {
      clearTimeout(t);
      ac.abort();
    };
  }, [from, to, query]);

  const toggle = async (id: string) => {
    if (open === id) return setOpen(null);
    setOpen(id);
    if (!detail[id]) {
      try {
        const d = await fetchQuestionnaire(id);
        setDetail((m) => ({ ...m, [id]: d }));
      } catch (e) {
        setError(e instanceof Error ? e.message : "読み込めませんでした");
      }
    }
  };

  return (
    <div className={styles.page} data-ui-zoom>
      <header className={styles.pageHead}>
        <Link href="/" className={styles.back}>
          ← カレンダーへ
        </Link>
        <h1>問診票</h1>
      </header>
      <div className={styles.filters}>
        <label>
          <span>受付日</span>
          <input type="date" className={styles.input} value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <span className={styles.tilde}>〜</span>
        <label>
          <span className={styles.sr}>まで</span>
          <input type="date" className={styles.input} value={to} min={from} onChange={(e) => setTo(e.target.value)} />
        </label>
        <div className={styles.quick}>
          {[
            ["今日", 0],
            ["7日", -7],
            ["30日", -30],
            ["1年", -365],
          ].map(([label, d]) => (
            <button
              key={label}
              type="button"
              className={styles.chip}
              onClick={() => {
                setFrom(dayOffset(d as number));
                setTo(dayOffset(0));
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <input
          className={`${styles.input} ${styles.search}`}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="氏名・フリガナ・電話・診察券番号"
          aria-label="問診票を検索"
        />
      </div>
      {error && <div className={styles.alert}>{error}</div>}
      <p className={styles.muted}>
        {data ? `${data.total}件${data.total > data.items.length ? `（新しい${data.items.length}件を表示）` : ""}` : "読み込み中…"}・行を押すと回答の全文が開きます。見たことは閲覧の記録に残ります。
      </p>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>受付日</th>
            <th>氏名</th>
            <th>フリガナ</th>
            <th>生年月日</th>
            <th>電話</th>
            <th>患者・診察券</th>
            <th>種類</th>
          </tr>
        </thead>
        <tbody>
          {data?.items.map((r) => (
            <Fragment key={r.id}>
              <tr className={styles.row} data-open={open === r.id || undefined} onClick={() => void toggle(r.id)} tabIndex={0} onKeyDown={(e) => e.key === "Enter" && void toggle(r.id)}>
                <td data-label="受付日">{r.day.replace(/-/g, "/")}</td>
                <td data-label="氏名" className={styles.name}>
                  {r.name}
                </td>
                <td data-label="フリガナ">{r.kana}</td>
                <td data-label="生年月日">{r.birthDate?.replace(/-/g, "/")}</td>
                <td data-label="電話">{r.phone}</td>
                <td data-label="患者">{r.patientId ? `${r.patientName ?? ""}（${r.chartNo ?? "—"}）` : <span className={styles.warn}>未確認</span>}</td>
                <td data-label="種類">{SOURCE[r.source]}</td>
              </tr>
              {open === r.id && (
                <tr className={styles.detailRow}>
                  <td colSpan={7}>
                    {!detail[r.id] ? (
                      <span className={styles.muted}>読み込み中…</span>
                    ) : (
                      <div className={styles.detail}>
                        <div className={styles.detailHead}>
                          <span className={styles.muted}>送信 {detail[r.id].submittedAt}</span>
                          {detail[r.id].patientId && (
                            <Link href={patientPath(detail[r.id].patientId!)} className={styles.btn}>
                              患者を開く
                            </Link>
                          )}
                        </div>
                        <dl className={styles.answers}>
                          {detail[r.id].answers.map((a, i) => (
                            <Fragment key={i}>
                              <dt>{a.q}</dt>
                              <dd>{a.a || "—"}</dd>
                            </Fragment>
                          ))}
                        </dl>
                      </div>
                    )}
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
          {data && data.items.length === 0 && (
            <tr>
              <td colSpan={7} className={styles.muted}>
                該当する問診票はありません
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

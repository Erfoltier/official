"use client";

import { useState } from "react";
import { fetchAccessLog, type AccessLogEntry } from "@/components/calendar/api";
import { patientPath, withBase } from "@/lib/paths";
import styles from "./settings.module.css";

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** 設定 → 操作ログ：閲覧の記録（だれが・いつ・どの患者の画面やファイルを見たか）。院長・管理者だけ */
export function AccessLogCard({ fail }: { fail: (e: unknown) => void }) {
  const [from, setFrom] = useState(() => ymd(new Date(Date.now() - 7 * 86400_000)));
  const [to, setTo] = useState(() => ymd(new Date()));
  const [q, setQ] = useState("");
  const [data, setData] = useState<{ items: AccessLogEntry[]; total: number } | null>(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      setData(await fetchAccessLog(from, to));
    } catch (err) {
      fail(err);
    } finally {
      setLoading(false);
    }
  };
  const key = q.trim().normalize("NFKC").toLowerCase();
  const items = (data?.items ?? []).filter((e) => !key || [e.staffName, e.patientName, e.chartNo, e.action].some((v) => v?.normalize("NFKC").toLowerCase().includes(key)));

  return (
    <>
      <h3 className={styles.subhead}>閲覧の記録</h3>
      <p className={styles.muted}>だれが・いつ・どの患者の画面、ファイル、同意書を開いたかを表示します。同じスタッフが同じ対象を開いた記録は、1時間ごとに1件にまとめます。この記録を見たことも、操作の記録に残ります。</p>
      <div className={styles.actions}>
        <input type="date" className={styles.input} value={from} onChange={(e) => setFrom(e.target.value)} aria-label="期間のはじめ" style={{ maxWidth: "11em" }} />
        〜
        <input type="date" className={styles.input} value={to} onChange={(e) => setTo(e.target.value)} aria-label="期間のおわり" style={{ maxWidth: "11em" }} />
        <button className={styles.btn} disabled={loading} onClick={load}>
          {loading ? "読み込み中…" : "表示"}
        </button>
        {data && <input className={styles.input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="スタッフ・患者名・診察券番号で絞り込み" aria-label="絞り込み" style={{ maxWidth: "18em" }} />}
      </div>
      {data && (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>日時</th>
                <th>スタッフ</th>
                <th>操作</th>
                <th>対象</th>
              </tr>
            </thead>
            <tbody>
              {items.map((e, i) => (
                <tr key={i}>
                  <td style={{ whiteSpace: "nowrap" }}>{new Date(e.at).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}</td>
                  <td>{e.staffName}</td>
                  <td>{e.action}</td>
                  <td>
                    {e.patientId ? (
                      <a href={withBase(patientPath(e.patientId))}>
                        {e.patientName ?? "（削除された患者）"}
                        {e.chartNo ? `（${e.chartNo}）` : ""}
                      </a>
                    ) : (
                      e.target
                    )}
                  </td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr>
                  <td colSpan={4}>この期間の記録はありません</td>
                </tr>
              )}
            </tbody>
          </table>
          {data.total > data.items.length && <p className={styles.muted}>新しい順に {data.items.length} 件を表示しています（全 {data.total} 件）。期間を狭めてください。</p>}
        </div>
      )}
    </>
  );
}

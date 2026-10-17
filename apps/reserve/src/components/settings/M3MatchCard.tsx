"use client";

import { useState } from "react";
import { applyM3Fill, fetchM3FillCandidates } from "@/components/calendar/api";
import { decodeCsv, guessColumns, joinSplitNameColumns, matchM3, parseCsv, type M3Columns, type M3MatchResult } from "@/lib/domain/m3match";
import styles from "./settings.module.css";

const BATCH = 200;

const FIELDS: { key: Exclude<keyof M3Columns, "phone">; label: string }[] = [
  { key: "name", label: "氏名（漢字）" },
  { key: "kana", label: "フリガナ" },
  { key: "birth", label: "生年月日" },
  { key: "chart", label: "カルテ番号" },
];

/**
 * 電子カルテなど（M3 に限らない）の患者一覧（CSV）と照合して、カタカナだけの氏名に漢字を補う（院長・管理者）。
 * CSV はこのブラウザの中だけで読み、サーバーへ送るのは照合できた患者の分だけ
 */
export function M3MatchCard(props: { notify: (m: string) => void; fail: (e: unknown) => void }) {
  const [file, setFile] = useState<{ name: string; header: string[]; rows: string[][] } | null>(null);
  const [col, setCol] = useState<M3Columns | null>(null);
  const [result, setResult] = useState<(M3MatchResult & { total: number }) | null>(null);
  const [busy, setBusy] = useState(false);
  /** 反映の進み具合（done / total）と、終わったときの結果 */
  const [progress, setProgress] = useState<{ done: number; total: number; updated: number; skipped: number; finished: boolean; error?: string } | null>(null);

  const pick = async (f: File | undefined) => {
    setResult(null);
    setProgress(null);
    if (!f) return;
    setBusy(true);
    try {
      const [header0, ...rows0] = parseCsv(decodeCsv(await f.arrayBuffer()));
      if (!header0 || rows0.length === 0) throw new Error("CSV の内容を読み込めませんでした");
      const { header, rows } = joinSplitNameColumns(header0, rows0);
      setFile({ name: f.name, header, rows });
      setCol(guessColumns(header));
    } catch (e) {
      props.fail(e);
    } finally {
      setBusy(false);
    }
  };

  const run = async () => {
    if (!file || !col) return;
    setBusy(true);
    try {
      const candidates = await fetchM3FillCandidates();
      setResult({ ...matchM3(candidates, file.rows, col), total: candidates.length });
    } catch (e) {
      props.fail(e);
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    if (!result?.fills.length) return;
    if (!window.confirm(`${result.fills.length}名の氏名に漢字を反映します。書き換えの前に、サーバーで控え（バックアップ）を作成します。よろしいですか？`)) return;
    const items = result.fills.map(({ before: _before, ...x }) => x);
    const p = { done: 0, total: items.length, updated: 0, skipped: 0, finished: false };
    setBusy(true);
    setProgress(p);
    try {
      // 1回で全部送ると共用サーバーの時間切れで止まることがあるため、200名ずつ送る（控えは最初の1回だけ）
      for (let i = 0; i < items.length; i += BATCH) {
        const r = await applyM3Fill(items.slice(i, i + BATCH), i === 0);
        p.done = Math.min(i + BATCH, items.length);
        p.updated += r.updated;
        p.skipped += r.skipped;
        setProgress({ ...p });
      }
      setProgress({ ...p, finished: true });
      props.notify(`${p.updated}名の氏名に漢字を反映しました（未反映 ${p.skipped}名）`);
      setResult(null);
      setFile(null);
    } catch (e) {
      setProgress({ ...p, finished: true, error: e instanceof Error ? e.message : "通信に失敗しました" });
      props.fail(e);
    } finally {
      setBusy(false);
    }
  };

  const select = (value: number, onChange: (v: number) => void) => (
    <select className={styles.input} value={value} onChange={(e) => onChange(Number(e.target.value))}>
      <option value={-1}>（使用しない）</option>
      {file!.header.map((h, i) => (
        <option key={i} value={i}>
          {h || `${i + 1}列目`}
        </option>
      ))}
    </select>
  );

  return (
    <div className={styles.importBox}>
      <h3>電子カルテの患者一覧（CSV）で氏名の漢字を補完</h3>
      <p className={styles.hint}>
        予約システムなどからカタカナのみで登録された患者に、電子カルテ（M3 など）から書き出した患者一覧の漢字の氏名を反映します。CSV はこのブラウザ内でのみ読み込み、ファイル自体は送信しません。
        サーバーに送るのは、照合できた患者の情報（漢字の氏名など）のみです。
      </p>
      <p className={styles.hint}>
        照合条件：フリガナ・生年月日・電話番号・カルテ番号のうち2つ以上が一致し、候補が1人に絞れた患者のみ反映します。書き換えるのはカタカナのみの氏名と空欄だけで、元のカタカナはフリガナに残します。反映の前にサーバーで控えを作成します。
      </p>
      <div className={styles.actions}>
        <label className={styles.btn}>
          {file ? `選び直す（${file.name}・${file.rows.length.toLocaleString()}件）` : "患者一覧の CSV を選択"}
          <input type="file" accept=".csv,text/csv" hidden disabled={busy} onChange={(e) => pick(e.target.files?.[0])} />
        </label>
      </div>

      {file && col && (
        <>
          <p className={styles.hint}>列の対応（違う場合は選び直してください）</p>
          <div className={styles.m3Cols}>
            {FIELDS.map((f) => (
              <label key={f.key}>
                <span>{f.label}</span>
                {select(col[f.key], (v) => {
                  setCol({ ...col, [f.key]: v });
                  setResult(null);
                })}
              </label>
            ))}
            <label>
              <span>電話番号</span>
              {select(col.phone[0] ?? -1, (v) => {
                setCol({ ...col, phone: v < 0 ? [] : [v, ...col.phone.slice(1).filter((x) => x !== v)] });
                setResult(null);
              })}
            </label>
          </div>
          <div className={styles.actions}>
            <button className={styles.btn} disabled={busy || col.name < 0} onClick={run}>
              照合（まだ書き換えません）
            </button>
          </div>
        </>
      )}

      {progress && (
        <div className={styles.priceStatus} role="status">
          {progress.error ? (
            <span>
              途中で中断しました（{progress.done.toLocaleString()} / {progress.total.toLocaleString()}名まで送信、反映済 {progress.updated.toLocaleString()}名）：{progress.error}
              。もう一度 CSV を選んで照合すると、残りの患者だけが表示されます。
            </span>
          ) : progress.finished ? (
            <span>
              反映が完了しました：反映済 <b>{progress.updated.toLocaleString()}名</b>／未反映 {progress.skipped.toLocaleString()}名
            </span>
          ) : (
            <span>
              {progress.done === 0 ? "サーバーで控え（バックアップ）を作成中…" : "反映中…"} {progress.done.toLocaleString()} / {progress.total.toLocaleString()}名
              <progress max={progress.total} value={progress.done} />
            </span>
          )}
        </div>
      )}

      {result && (
        <>
          <div className={styles.priceStatus}>
            氏名がカタカナのみの患者 {result.total.toLocaleString()}名 → 反映できる <b>{result.fills.length.toLocaleString()}名</b>／候補が2人以上 {result.ambiguous.toLocaleString()}名／該当なし{" "}
            {result.notFound.toLocaleString()}名
          </div>
          {result.fills.length > 0 && (
            <>
              <details className={styles.priceUrls}>
                <summary>反映内容の確認（最初の50名）</summary>
                <ul className={styles.m3Preview}>
                  {result.fills.slice(0, 50).map((f) => (
                    <li key={f.id}>
                      {f.before} → <b>{f.name}</b>
                    </li>
                  ))}
                </ul>
              </details>
              <div className={styles.actions}>
                <button className={styles.primary} disabled={busy} onClick={apply}>
                  {busy && progress ? "反映中…" : `${result.fills.length.toLocaleString()}名に反映`}
                </button>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

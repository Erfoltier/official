"use client";

import { useState } from "react";
import { applyM3Fill, fetchM3FillCandidates } from "@/components/calendar/api";
import { decodeCsv, guessColumns, matchM3, parseCsv, type M3Columns, type M3MatchResult } from "@/lib/domain/m3match";
import styles from "./settings.module.css";

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

  const pick = async (f: File | undefined) => {
    setResult(null);
    if (!f) return;
    setBusy(true);
    try {
      const all = parseCsv(decodeCsv(await f.arrayBuffer()));
      const [header, ...rows] = all;
      if (!header || rows.length === 0) throw new Error("CSV の中身が読めませんでした");
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
    if (!window.confirm(`${result.fills.length}名の氏名に漢字を入れます。先にサーバーで控え（バックアップ）を取ってから書き換えます。よろしいですか？`)) return;
    setBusy(true);
    try {
      const r = await applyM3Fill(result.fills.map(({ before: _before, ...x }) => x));
      props.notify(`${r.updated}名の氏名に漢字を入れました（入れなかった ${r.skipped}名）`);
      setResult(null);
      setFile(null);
    } catch (e) {
      props.fail(e);
    } finally {
      setBusy(false);
    }
  };

  const select = (value: number, onChange: (v: number) => void) => (
    <select className={styles.input} value={value} onChange={(e) => onChange(Number(e.target.value))}>
      <option value={-1}>（使わない）</option>
      {file!.header.map((h, i) => (
        <option key={i} value={i}>
          {h || `${i + 1}列目`}
        </option>
      ))}
    </select>
  );

  return (
    <div className={styles.importBox}>
      <h3>電子カルテなどの患者一覧（CSV）と照合し不足情報を補う</h3>
      <p className={styles.hint}>
        予約システムなどからカタカナだけで入った患者に、電子カルテ（M3 など、ソフトは問いません）から書き出した患者一覧の漢字の氏名を入れます。選んだ CSV はこのパソコンのブラウザの中だけで読み、ファイルそのものはどこにも送りません。
        サーバーへ送るのは、照合できた患者の分（漢字の氏名など）だけです。
      </p>
      <p className={styles.hint}>
        決まり：フリガナ・生年月日・電話番号・カルテ番号のうち 2 つ以上が合い、候補が 1 人に決まった人だけ。書き換えるのはカタカナだけの氏名と、空いている欄だけです（もとのカタカナはフリガナに残します）。反映の前にサーバーで控えを取ります。
      </p>
      <div className={styles.actions}>
        <label className={styles.btn}>
          {file ? `選び直す（${file.name}・${file.rows.length.toLocaleString()}件）` : "患者一覧の CSV を選ぶ"}
          <input type="file" accept=".csv,text/csv" hidden disabled={busy} onChange={(e) => pick(e.target.files?.[0])} />
        </label>
      </div>

      {file && col && (
        <>
          <p className={styles.hint}>列の当てはめ（違っていれば選び直してください）</p>
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
              照合する（まだ書き換えません）
            </button>
          </div>
        </>
      )}

      {result && (
        <>
          <div className={styles.priceStatus}>
            氏名がカタカナだけの患者 {result.total.toLocaleString()}名 → 漢字を入れられる <b>{result.fills.length.toLocaleString()}名</b>／候補が2人以上 {result.ambiguous.toLocaleString()}名／見つからない{" "}
            {result.notFound.toLocaleString()}名
          </div>
          {result.fills.length > 0 && (
            <>
              <details className={styles.priceUrls}>
                <summary>入れる内容を確かめる（最初の50名）</summary>
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
                  {result.fills.length.toLocaleString()}名に反映する
                </button>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

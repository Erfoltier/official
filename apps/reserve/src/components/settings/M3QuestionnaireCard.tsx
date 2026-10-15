"use client";

import { useState } from "react";
import { applyM3Questionnaires, fetchM3QuestionnaireCandidates } from "@/components/calendar/api";
import { decodeCsv, guessColumns, matchQuestionnairesM3, parseCsv, type M3Columns, type M3QuestionnaireResult } from "@/lib/domain/m3match";
import styles from "./settings.module.css";

const BATCH = 100;

/**
 * 未確認の問診票を、電子カルテ（M3 など）の患者一覧（CSV）で照合して結びつける（院長・管理者）。
 * CSV はこのブラウザの中だけで読み、サーバーへ送るのは特定できた問診票と M3 番号（新しく登録する人は氏名など）だけ
 */
export function M3QuestionnaireCard(props: { notify: (m: string) => void; fail: (e: unknown) => void; onDone?: () => void }) {
  const [file, setFile] = useState<{ name: string; header: string[]; rows: string[][] } | null>(null);
  const [col, setCol] = useState<M3Columns | null>(null);
  const [result, setResult] = useState<(M3QuestionnaireResult & { total: number }) | null>(null);
  const [withCreate, setWithCreate] = useState(true);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);

  const pick = async (f: File | undefined) => {
    setResult(null);
    setProgress(null);
    if (!f) return;
    setBusy(true);
    try {
      const [header, ...rows] = parseCsv(decodeCsv(await f.arrayBuffer()));
      if (!header || rows.length === 0) throw new Error("CSV の内容を読み込めませんでした");
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
      const c = await fetchM3QuestionnaireCandidates();
      setResult({ ...matchQuestionnairesM3(c.questionnaires, c.patients, file.rows, col), total: c.questionnaires.length });
    } catch (e) {
      props.fail(e);
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    if (!result) return;
    const list = [...result.links, ...(withCreate ? result.creates : [])];
    if (!list.length) return;
    const msg = `${result.links.length}件をいる患者に結びつけ${withCreate && result.creates.length ? `、${result.creates.length}件は M3 の情報で患者を新しく登録して結びつけ` : ""}ます。書き換えの前にサーバーで控えを作成します。よろしいですか？`;
    if (!window.confirm(msg)) return;
    const items = list.map(({ label: _l, duplicates: _d, via: _v, ...x }) => x);
    const sum = { linked: 0, created: 0, skipped: 0 };
    setBusy(true);
    try {
      for (let i = 0; i < items.length; i += BATCH) {
        setProgress(`${i === 0 ? "控えを作成して" : ""}反映中… ${i} / ${items.length}件`);
        const r = await applyM3Questionnaires(items.slice(i, i + BATCH), i === 0);
        sum.linked += r.linked;
        sum.created += r.created;
        sum.skipped += r.skipped;
      }
      setProgress(`完了：結びつけ ${sum.linked}件（うち新規登録 ${sum.created}名）／対象外 ${sum.skipped}件`);
      props.notify(`問診票を${sum.linked}件結びつけました（新規登録 ${sum.created}名）`);
      setResult(null);
      props.onDone?.();
    } catch (e) {
      setProgress(`途中で中断しました（結びつけ ${sum.linked}件まで）。もう一度照合すると残りだけが出ます`);
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
  const dup = result?.links.filter((l) => l.duplicates).length ?? 0;
  const nameOnly = result?.links.filter((l) => l.via === "nameOnly").length ?? 0;

  return (
    <div className={styles.importBox}>
      <h3>電子カルテの患者一覧（CSV）で未確認の問診票を照合</h3>
      <p className={styles.hint}>
        問診票の氏名（またはフリガナ）と、生年月日か電話番号で、M3 などの患者一覧から1人に絞れた方だけを結びつけます。その方の M3 番号・氏名・フリガナで予約カレンダーの患者を探し、
        同じ方が複数登録されている（重複）ときは M3 番号を持つ患者、なければ診察券番号の若い患者に結びつけます。予約カレンダーにいない方は、M3 の情報で患者を新しく登録できます。
        CSV はこのブラウザ内でのみ読み込み、ファイル自体は送信しません。
      </p>
      <div className={styles.actions}>
        <label className={styles.btn}>
          {file ? `選び直す（${file.name}・${file.rows.length.toLocaleString()}件）` : "患者一覧の CSV を選択"}
          <input type="file" accept=".csv,text/csv" hidden disabled={busy} onChange={(e) => pick(e.target.files?.[0])} />
        </label>
      </div>
      {file && col && (
        <>
          <div className={styles.m3Cols}>
            {(
              [
                ["name", "氏名（漢字）"],
                ["kana", "フリガナ"],
                ["birth", "生年月日"],
                ["chart", "カルテ番号"],
              ] as const
            ).map(([k, label]) => (
              <label key={k}>
                <span>{label}</span>
                {select(col[k], (v) => {
                  setCol({ ...col, [k]: v });
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
            <button className={styles.btn} disabled={busy || col.name < 0 || col.chart < 0} onClick={run}>
              照合（まだ書き換えません）
            </button>
          </div>
        </>
      )}
      {progress && (
        <div className={styles.priceStatus} role="status">
          {progress}
        </div>
      )}
      {result && (
        <>
          <div className={styles.priceStatus}>
            未確認の問診票 {result.total.toLocaleString()}件 → いる患者に結びつく <b>{result.links.length.toLocaleString()}件</b>（うち氏名だけで一致 {nameOnly}件・重複患者から選んだ {dup}件）／新しく登録して結びつく{" "}
            <b>{result.creates.length.toLocaleString()}件</b>／M3 で候補が2人以上 {result.ambiguous.toLocaleString()}件／M3 にも見つからない {result.notFound.toLocaleString()}件
          </div>
          <details className={styles.priceUrls}>
            <summary>内容の確認</summary>
            <ul className={styles.m3Preview}>
              {result.links.slice(0, 100).map((l) => (
                <li key={l.questionnaireId}>
                  {l.label} → いる患者（M3 {l.m3ChartNo || "番号なし"}）{l.via === "nameOnly" ? "・氏名だけで一致" : ""}{l.duplicates ? `・重複${l.duplicates}名から選択` : ""}
                </li>
              ))}
              {result.creates.slice(0, 100).map((l) => (
                <li key={l.questionnaireId}>
                  {l.label} → <b>新規登録</b> {l.create?.name}（M3 {l.m3ChartNo || "番号なし"}）
                </li>
              ))}
            </ul>
          </details>
          <div className={styles.actions}>
            <label>
              <input type="checkbox" checked={withCreate} onChange={(e) => setWithCreate(e.target.checked)} /> 予約カレンダーにいない方は、M3 の情報で患者を新しく登録する
            </label>
            <button className={styles.primary} disabled={busy || !(result.links.length || (withCreate && result.creates.length))} onClick={apply}>
              反映する
            </button>
          </div>
        </>
      )}
    </div>
  );
}

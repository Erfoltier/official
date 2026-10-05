"use client";

import { useEffect, useState } from "react";
import type { ConsentView } from "@/lib/domain/types";
import { ApiError, fetchConsent } from "@/components/calendar/api";
import { ConsentDocument } from "./ConsentDocument";
import { docPageMargins } from "@/lib/domain/docHtml";
import styles from "./consents.module.css";

/** 同意書（A4）。画面の上のボタンは印刷されない */
export function ConsentPrint({ id }: { id: string }) {
  const [view, setView] = useState<ConsentView | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    fetchConsent(id).then(
      (v) => {
        setView(v);
        document.title = `${v.record.title}｜${v.patient.name} 様`;
      },
      (err) => setError(err instanceof ApiError ? err.message : "同意書を読み込めませんでした"),
    );
  }, [id]);
  if (error) return <p className={styles.message}>{error}</p>;
  if (!view) return <p className={styles.message}>読み込み中…</p>;
  const r = view.record;
  // ページの余白は Googleドキュメントの余白のまま（わからない文書は 20mm）。改行の位置を元の文書とそろえるため
  const m = docPageMargins(view.html);
  const margin = m ? m.map((x) => `${x}pt`).join(" ") : "20mm";
  return (
    <div className={styles.printWrap}>
      <style>{`@page { size: A4 portrait; margin: ${margin}; }`}</style>
      <div className={styles.printBar}>
        <button type="button" className={styles.primaryBtn} onClick={() => window.print()}>
          🖨 印刷する
        </button>
        <button type="button" className={styles.btn} onClick={() => window.close()}>
          閉じる
        </button>
        <span>
          {r.signed ? "署名済みの控えです。" : "紙に署名してもらう用です。"}印刷画面で「PDFに保存」を選ぶと PDF にもできます
        </span>
      </div>
      <article className={styles.sheet} aria-label={r.title} style={{ padding: margin }}>
        <ConsentDocument html={view.html} patient={view.patient} clinic={view.clinic} date={r.date} treatment={r.treatment} signature={r.signature} />
        <p className={styles.meta}>
          {r.title}（ひな形の更新 {r.templateModifiedTime.slice(0, 10)}）・発行 {new Date(r.createdAt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}
          {r.createdBy && ` ${r.createdBy.name}`}
        </p>
      </article>
    </div>
  );
}

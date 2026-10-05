"use client";

import { useEffect, useState } from "react";
import type { EstimateView, PaperSize } from "@/lib/domain/types";
import { DEFAULT_ESTIMATE_NOTE, taxIncluded } from "@/lib/domain/types";
import { formatDateJa } from "@/lib/domain/time";
import { ApiError, fetchEstimate } from "@/components/calendar/api";
import { yen } from "./EstimateDialog";
import styles from "./print.module.css";

/** "2026-10-05" → "2026年10月5日" */
function dateLong(d: string): string {
  const [y, m, day] = d.split("-").map(Number);
  return `${y}年${m}月${day}日`;
}

/** A4 1枚の見積書。画面の上のボタンは印刷されない */
export function EstimatePrint({ id }: { id: string }) {
  const [view, setView] = useState<EstimateView | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** 用紙。最初は院の既定、印刷画面で切り替えられる */
  const [paper, setPaper] = useState<PaperSize | null>(null);

  useEffect(() => {
    fetchEstimate(id).then(
      (v) => {
        setView(v);
        document.title = `見積書 No.${v.estimate.no}｜${v.patient.name} 様`;
      },
      (err) => setError(err instanceof ApiError ? err.message : "見積書を読み込めませんでした"),
    );
  }, [id]);

  if (error) return <p className={styles.message}>{error}</p>;
  if (!view) return <p className={styles.message}>読み込み中…</p>;
  const { estimate: e, patient: p, clinic: c } = view;
  const note = c.estimateNote ?? DEFAULT_ESTIMATE_NOTE;
  const size = paper ?? c.estimatePaper ?? "A4";

  return (
    <div className={styles.wrap} data-paper={size}>
      {/* 印刷する用紙の大きさ（A5 は A4 の版面をそのまま縮める） */}
      <style>{`@page { size: ${size} portrait; margin: 0; }`}</style>
      <div className={styles.bar}>
        <span className={styles.paper} role="group" aria-label="用紙">
          {(["A4", "A5"] as const).map((p) => (
            <button key={p} type="button" data-active={size === p || undefined} aria-pressed={size === p} onClick={() => setPaper(p)}>
              {p}
            </button>
          ))}
        </span>
        <button type="button" className={styles.printBtn} onClick={() => window.print()}>
          🖨 印刷する
        </button>
        <button type="button" className={styles.closeBtn} onClick={() => window.close()}>
          閉じる
        </button>
        <span>印刷画面で「PDFに保存」を選ぶとPDFにもできます</span>
      </div>

      <article className={styles.sheet} aria-label="見積書">
        <header className={styles.top}>
          <h1>御 見 積 書</h1>
          <dl className={styles.meta}>
            <div>
              <dt>見積番号</dt>
              <dd>No.{e.no}</dd>
            </div>
            <div>
              <dt>発行日</dt>
              <dd>{dateLong(e.date)}</dd>
            </div>
            <div>
              <dt>有効期限</dt>
              <dd>{dateLong(e.validUntil)}</dd>
            </div>
          </dl>
        </header>

        <section className={styles.parties}>
          <div className={styles.to}>
            <p className={styles.toName}>
              {p.name}
              <span>様</span>
            </p>
            {p.chartNo && <p className={styles.small}>診察券番号 {p.chartNo}</p>}
            <p className={styles.lead}>下記のとおりお見積り申し上げます。</p>
            <div className={styles.amount}>
              <span>御見積金額</span>
              <b>{yen(e.totalYen)}</b>
              <small>（税込）</small>
            </div>
          </div>
          <div className={styles.from}>
            <p className={styles.clinicName}>{c.name}</p>
            {c.address && <p>{c.address}</p>}
            {c.phone && <p>TEL {c.phone}</p>}
            {c.issuer && <p className={styles.issuer}>{c.issuer}</p>}
          </div>
        </section>

        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.no}>#</th>
              <th>内容</th>
              <th className={styles.num}>単価（税込）</th>
              <th className={styles.qty}>数量</th>
              <th className={styles.num}>金額（税込）</th>
            </tr>
          </thead>
          <tbody>
            {e.lines.map((l, i) => (
              <tr key={i}>
                <td className={styles.no}>{i + 1}</td>
                <td>{l.name}</td>
                <td className={styles.num}>{yen(l.unitYen)}</td>
                <td className={styles.qty}>{l.qty}</td>
                <td className={styles.num}>{yen(l.unitYen * l.qty)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={4}>合計（税込）</td>
              <td className={styles.num}>
                <b>{yen(e.totalYen)}</b>
              </td>
            </tr>
            <tr className={styles.tax}>
              <td colSpan={4}>うち消費税（10%）</td>
              <td className={styles.num}>{yen(taxIncluded(e.totalYen))}</td>
            </tr>
          </tfoot>
        </table>

        {e.note && (
          <section className={styles.box}>
            <h2>備考</h2>
            <p>{e.note}</p>
          </section>
        )}
        {note && (
          <section className={styles.notice}>
            <h2>ご確認ください</h2>
            <p>{note}</p>
          </section>
        )}
        <footer className={styles.foot}>
          {formatDateJa(e.date)} 発行
          {e.createdBy && <span>担当：{e.createdBy.name}</span>}
        </footer>
      </article>
    </div>
  );
}

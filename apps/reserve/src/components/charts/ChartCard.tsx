"use client";

import type { ReactNode } from "react";
import type { ChartEntry } from "@/lib/domain/types";
import { RichText } from "@/components/richtext/RichText";
import styles from "./charts.module.css";

const stamp = (iso: string) =>
  new Date(iso).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });

/** カルテ1件の表示 */
export function ChartCard({ entry: c, actions, compact }: { entry: ChartEntry; actions?: ReactNode; compact?: boolean }) {
  // 施術歴の表の中では要点だけ（施術名・部位・薬剤とロット）。押すと全部見られる
  if (compact) {
    const drugs = c.drugs.map((d) => `${d.name}${d.amount ? ` ${d.amount}` : ""}${d.lot ? `（Lot ${d.lot}）` : ""}`).join("、");
    return (
      <article className={styles.card} data-compact>
        <strong>🩺 {c.treatment}</strong>
        {c.area && <span className={styles.muted}>　{c.area}</span>}
        {drugs && <div className={styles.compactLine}>{drugs}</div>}
        {c.settings && <div className={styles.compactLine}>{c.settings.split("\n")[0]}</div>}
      </article>
    );
  }
  const rows: [string, ReactNode][] = [];
  if (c.area) rows.push(["部位", c.area]);
  if (c.settings) rows.push(["条件", <span key="s" className={styles.pre}>{c.settings}</span>]);
  if (c.drugs.length > 0)
    rows.push([
      "薬剤",
      <ul key="d" className={styles.drugs}>
        {c.drugs.map((d, i) => (
          <li key={i}>
            {d.name}
            {d.amount && <span>　{d.amount}</span>}
            {d.lot && <span className={styles.lot}>　Lot {d.lot}</span>}
          </li>
        ))}
      </ul>,
    ]);
  if (c.anesthesia) rows.push(["麻酔", c.anesthesia]);
  if (c.findings) rows.push(["所見・経過", <RichText key="f" value={c.findings} />]);
  if (c.nextPlan) rows.push(["次回", c.nextPlan]);
  return (
    <article className={styles.card} data-compact={compact || undefined}>
      <div className={styles.cardHead}>
        <strong>{c.treatment}</strong>
        {c.operator && <span className={styles.muted}>施術：{c.operator}</span>}
        {actions && <span className={styles.cardActions}>{actions}</span>}
      </div>
      {rows.length > 0 && (
        <dl className={styles.facts}>
          {rows.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      )}
      {!compact && (
        <p className={styles.byline}>
          記入：{c.createdBy?.name ?? "—"}（{stamp(c.createdAt)}）
          {c.updatedAt && `　変更：${c.updatedBy?.name ?? "—"}（${stamp(c.updatedAt)}）`}
        </p>
      )}
    </article>
  );
}

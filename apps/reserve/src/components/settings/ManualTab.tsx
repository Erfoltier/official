"use client";

import { withBase } from "@/lib/paths";
import styles from "./settings.module.css";

/** 操作マニュアル（public/manual/ に置いた1ページ。取り込み直しは scripts/update-manual.sh） */
export function ManualTab() {
  const src = withBase("/manual/index.html");
  return (
    <section className={styles.manual}>
      <p className={styles.lead}>
        LANE RESERVE の使い方です。上の検索欄で語句を探せます。
        <a href={src} target="_blank" rel="noopener" style={{ marginLeft: 8 }}>
          新しいタブで開く ↗
        </a>
      </p>
      <iframe className={styles.manualFrame} src={src} title="操作マニュアル" />
    </section>
  );
}

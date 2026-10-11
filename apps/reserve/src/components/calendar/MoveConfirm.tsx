"use client";

import { useEffect, useRef } from "react";
import styles from "./calendar.module.css";

/** ドラッグで予約を動かしたときの確認（誤操作防止） */
export function MoveConfirm({ detail, onYes, onCancel }: { detail: string[]; onYes(): void; onCancel(): void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const yesRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
    yesRef.current?.focus();
  }, []);

  return (
    <dialog ref={ref} className={`${styles.dialog} ${styles.confirm}`} onCancel={onCancel} aria-labelledby="move-confirm-title">
      <p id="move-confirm-title" className={styles.confirmTitle}>
        予約時間を移動してよろしいですか？
      </p>
      <div className={styles.confirmDetail}>
        {detail.map((line) => (
          <div key={line}>{line}</div>
        ))}
      </div>
      <div className={styles.confirmActions}>
        <button type="button" className={styles.btn} onClick={onCancel}>
          キャンセル
        </button>
        <button ref={yesRef} type="button" className={styles.primaryBtn} onClick={onYes}>
          はい
        </button>
      </div>
    </dialog>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import type { Questionnaire } from "@/lib/domain/types";
import { fetchQuestionnaires } from "@/components/calendar/api";
import styles from "./questionnaires.module.css";

function Answers({ q }: { q: Questionnaire }) {
  const facts: [string, string | undefined][] = [
    ["既往歴", q.history],
    ["内服歴", q.medications],
    ["アレルギー", q.allergies],
  ];
  return (
    <>
      {facts.some(([, v]) => v) && (
        <dl className={styles.facts} data-key>
          {facts
            .filter(([, v]) => v)
            .map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
        </dl>
      )}
      <dl className={styles.facts}>
        {q.answers.map((a, j) => (
          <div key={j}>
            <dt>{a.q}</dt>
            <dd>{a.a}</dd>
          </div>
        ))}
      </dl>
    </>
  );
}

/** 予約の詳細の「問診票」：いちばん新しい問診票の回答をすべて開いた状態で出す（以前の分は押して開く） */
export function QuestionnaireDialog({ patientId, patientName, onClose }: { patientId: string; patientName: string; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [items, setItems] = useState<Questionnaire[] | null>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  useEffect(() => {
    let alive = true;
    fetchQuestionnaires(patientId).then(
      (xs) => alive && setItems(xs),
      () => alive && setItems([]),
    );
    return () => {
      alive = false;
    };
  }, [patientId]);
  const [latest, ...older] = items ?? [];
  return (
    <dialog ref={ref} className={styles.dialog} onCancel={onClose} onClose={onClose} aria-label="問診票">
      <div className={styles.dHead}>
        <h2>
          問診票<small>{patientName} 様</small>
        </h2>
        <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="閉じる">
          ×
        </button>
      </div>
      {!items && <p className={styles.note}>読み込み中…</p>}
      {items && items.length === 0 && <p className={styles.note}>この患者の問診票はまだありません。</p>}
      {latest && (
        <section className={styles.box}>
          <div className={styles.head}>📋 {latest.submittedAt || "日時不明"} の問診票</div>
          <Answers q={latest} />
        </section>
      )}
      {older.map((q) => (
        <details key={q.id} className={`${styles.box} ${styles.all}`}>
          <summary>以前の問診票（{q.submittedAt || "日時不明"}）</summary>
          <Answers q={q} />
        </details>
      ))}
    </dialog>
  );
}

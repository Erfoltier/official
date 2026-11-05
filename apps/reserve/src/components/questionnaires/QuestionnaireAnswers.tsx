"use client";

import { useEffect, useState } from "react";
import type { Questionnaire } from "@/lib/domain/types";
import { fetchQuestionnaires } from "@/components/calendar/api";
import styles from "./questionnaires.module.css";

/** 問診票の回答：最新の既往歴・内服歴・アレルギーと、押して開く全回答 */
export function QuestionnaireAnswers({ patientId }: { patientId: string }) {
  const [items, setItems] = useState<Questionnaire[] | null>(null);
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
  if (!items || items.length === 0) return null;
  const latest = items[0];
  const facts: [string, string | undefined][] = [
    ["既往歴", latest.history],
    ["内服歴", latest.medications],
    ["アレルギー", latest.allergies],
  ];
  return (
    <div className={styles.box}>
      <div className={styles.head}>
        📋 問診票（{latest.submittedAt || "日時不明"}）{items.length > 1 && <span className={styles.muted}>ほか{items.length - 1}件</span>}
      </div>
      {facts.some(([, v]) => v) && (
        <dl className={styles.facts}>
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
      {items.map((q, i) => (
        <details key={q.id} className={styles.all}>
          <summary>
            {i === 0 ? "この問診票の回答をすべて見る" : `以前の問診票（${q.submittedAt || "日時不明"}）`}
          </summary>
          <dl className={styles.facts}>
            {q.answers.map((a, j) => (
              <div key={j}>
                <dt>{a.q}</dt>
                <dd>{a.a}</dd>
              </div>
            ))}
          </dl>
        </details>
      ))}
    </div>
  );
}

"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { fetchReviewPatients, markPatientReviewed, type ReviewPatient } from "@/components/calendar/api";
import styles from "./settings.module.css";

/** 要確認の患者：自動予約などで新しく登録した患者のうち、名前かフリガナの似た患者がほかにいる人（二重登録の候補） */
export function ReviewPatientsCard({ fail }: { fail: (e: unknown) => void }) {
  const [items, setItems] = useState<ReviewPatient[] | null>(null);
  useEffect(() => {
    fetchReviewPatients().then((r) => setItems(r.items), fail);
  }, [fail]);
  return (
    <div className={styles.clinicCard}>
      <h3 className={styles.cardTitle}>要確認の患者{items ? `（${items.length}人）` : ""}</h3>
      <p className={styles.hint}>
        新しく登録した患者のうち、名前かフリガナの<b>似た患者がほかにいる人</b>
        を表示します（同一人物の二重登録の可能性があるため）。同一人物なら患者画面で統合し、別人なら「確認済み」を押してください。
      </p>
      {items && items.length === 0 && <p className={styles.hint}>該当する患者はいません。</p>}
      {items && items.length > 0 && (
        <ul style={{ margin: 0, paddingLeft: 18, maxHeight: 320, overflow: "auto" }}>
          {items.map((p) => (
            <li key={p.id} style={{ margin: "4px 0" }}>
              <Link href={`/patients/view/?id=${encodeURIComponent(p.id)}`}>
                {p.name}
                {p.kana && p.kana !== p.name && `（${p.kana}）`}
              </Link>
              {p.similar && p.similar.length > 0 && (
                <small style={{ marginLeft: 6 }}>
                  似た患者：
                  {p.similar.map((q, i) => (
                    <span key={q.id}>
                      {i > 0 && "・"}
                      <Link href={`/patients/view/?id=${encodeURIComponent(q.id)}`}>
                        {q.name}
                        {q.chartNo && `（${q.chartNo}）`}
                      </Link>
                    </span>
                  ))}
                </small>
              )}
              <button
                type="button"
                className={styles.btn}
                style={{ marginLeft: 8, padding: "2px 8px" }}
                onClick={async () => {
                  try {
                    await markPatientReviewed(p.id);
                    setItems(items.filter((x) => x.id !== p.id));
                  } catch (e) {
                    fail(e);
                  }
                }}
              >
                確認済み
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

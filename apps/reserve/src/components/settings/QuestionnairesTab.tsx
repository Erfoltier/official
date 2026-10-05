"use client";

import { useCallback, useEffect, useState } from "react";
import type { Questionnaire } from "@/lib/domain/types";
import { deleteQuestionnaire, fetchUnmatchedQuestionnaires, linkQuestionnaire } from "@/components/calendar/api";
import styles from "./settings.module.css";

/** 問診票：患者が見つからなかった回答を、診察券番号で結びつける */
export function QuestionnairesTab({ canEdit, notify, fail }: { canEdit: boolean; notify: (t: string) => void; fail: (e: unknown) => void }) {
  const [items, setItems] = useState<Questionnaire[] | null>(null);
  const [chartNo, setChartNo] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      setItems(await fetchUnmatchedQuestionnaires());
    } catch (err) {
      fail(err);
    }
  }, [fail]);

  useEffect(() => {
    // 開いたときに読み込む
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  return (
    <section>
      <p className={styles.lead}>
        Googleフォームの問診票の回答は、自動でこのソフトに送られ、<b>氏名（またはフリガナ）＋生年月日か電話番号</b>が合う患者に結びつきます。
        結びついた回答は、患者画面とカルテの「既往歴・内服歴」で見られます。
        合う患者が見つからない・2人以上いる回答は下に出るので、診察券番号を入れて結びつけてください。
        送る仕組み（Apps Script）の置き方は、配布物の questionnaire.gs の先頭に書いてあります。
      </p>
      {items === null && <p className={styles.muted}>読み込み中…</p>}
      {items?.length === 0 && <p className={styles.muted}>結びつけが必要な回答はありません</p>}
      {items && items.length > 0 && (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>回答日時</th>
              <th>氏名</th>
              <th>生年月日・電話</th>
              <th>診察券番号で結びつける</th>
            </tr>
          </thead>
          <tbody>
            {items.map((q) => (
              <tr key={q.id}>
                <td>{q.submittedAt || "—"}</td>
                <td>
                  {q.name}
                  {q.kana && <div className={styles.muted}>{q.kana}</div>}
                </td>
                <td>
                  {q.birthDate ?? "—"}
                  <div className={styles.muted}>{q.phone ?? ""}</div>
                </td>
                <td>
                  <input
                    className={styles.input}
                    value={chartNo[q.id] ?? ""}
                    onChange={(e) => setChartNo((m) => ({ ...m, [q.id]: e.target.value }))}
                    placeholder="診察券番号"
                    inputMode="numeric"
                    aria-label={`${q.name}の診察券番号`}
                    style={{ maxWidth: "9em" }}
                  />
                  <button
                    className={styles.primary}
                    disabled={!(chartNo[q.id] ?? "").trim()}
                    onClick={async () => {
                      try {
                        await linkQuestionnaire(q.id, chartNo[q.id]);
                        notify("患者に結びつけました");
                        await load();
                      } catch (err) {
                        fail(err);
                      }
                    }}
                  >
                    結びつける
                  </button>
                  {canEdit && (
                    <button
                      className={styles.btn}
                      onClick={async () => {
                        if (!window.confirm(`${q.name} さんの回答を削除しますか？`)) return;
                        try {
                          await deleteQuestionnaire(q.id);
                          notify("削除しました");
                          await load();
                        } catch (err) {
                          fail(err);
                        }
                      }}
                    >
                      削除
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

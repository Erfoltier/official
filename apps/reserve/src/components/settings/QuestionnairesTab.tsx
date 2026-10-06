"use client";

import { useCallback, useEffect, useState } from "react";
import type { Questionnaire } from "@/lib/domain/types";
import { createBackup, deleteQuestionnaire, fetchUnmatchedQuestionnaires, linkQuestionnaire, refillQuestionnaires } from "@/components/calendar/api";
import styles from "./settings.module.css";

/** 問診票：患者が見つからなかった回答を、診察券番号で結びつける */
export function QuestionnairesTab({ canEdit, isAdmin, notify, fail }: { canEdit: boolean; isAdmin?: boolean; notify: (t: string) => void; fail: (e: unknown) => void }) {
  const [items, setItems] = useState<Questionnaire[] | null>(null);
  const [chartNo, setChartNo] = useState<Record<string, string>>({});
  const [refilling, setRefilling] = useState(false);

  /** 控えを取ってから、結びついている問診票を患者の空いている欄へ写し直す */
  const refill = async () => {
    if (!window.confirm("結びついている問診票を、患者の基本情報の空いている欄へ写し直します（先にデータの控えを取ります）。よろしいですか？")) return;
    setRefilling(true);
    try {
      const b = await createBackup();
      if (b.integrity !== "ok") throw new Error("控えの検査で問題が見つかったため、写し直しを止めました");
      const r = await refillQuestionnaires();
      notify(`写し直しました（問診票${r.questionnaires}件を確認・患者${r.patients}名を更新）`);
    } catch (err) {
      fail(err);
    } finally {
      setRefilling(false);
    }
  };

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
      {isAdmin && (
        <div className={styles.actions}>
          <button className={styles.btn} disabled={refilling} onClick={refill}>
            {refilling ? "写し直し中…" : "問診票を患者の基本情報へ写し直す"}
          </button>
          <span className={styles.muted}>
            電話・住所・性別・生年月日・既往歴・内服歴・アレルギー（注意事項）・その他を、患者の空いている欄へ写します。手で直した欄は変えません。
          </span>
        </div>
      )}
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

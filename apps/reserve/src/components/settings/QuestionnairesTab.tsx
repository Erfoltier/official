"use client";

import { useCallback, useEffect, useState } from "react";
import type { Questionnaire } from "@/lib/domain/types";
import { createBackup, deleteQuestionnaire, fetchUnmatchedQuestionnaires, linkQuestionnaire, refillQuestionnaires, relinkQuestionnaires } from "@/components/calendar/api";
import { MonshinCard } from "./MonshinCard";
import styles from "./settings.module.css";

/** 問診票：患者が見つからなかった回答を、診察券番号で結びつける */
export function QuestionnairesTab({ canEdit, isAdmin, notify, fail }: { canEdit: boolean; isAdmin?: boolean; notify: (t: string) => void; fail: (e: unknown) => void }) {
  const [items, setItems] = useState<Questionnaire[] | null>(null);
  const [chartNo, setChartNo] = useState<Record<string, string>>({});
  const [refilling, setRefilling] = useState(false);

  /** 控えを取ってから、結びついている問診票を患者の空いている欄へ写し直す */
  const refill = async () => {
    if (!window.confirm("紐付け済みの問診票を、患者の基本情報の空欄へ反映します。先にデータの控えを作成します。よろしいですか？")) return;
    setRefilling(true);
    try {
      const b = await createBackup();
      if (b.integrity !== "ok") throw new Error("控えの検査で問題が見つかったため、反映を中止しました");
      const r = await refillQuestionnaires();
      notify(`反映しました（問診票${r.questionnaires}件を確認、患者${r.patients}名を更新）`);
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

  /** 控えを取ってから、未確認の問診票を今の患者の情報で照合し直す（登録より前に届いた初診の方の分など） */
  const relink = async () => {
    if (!window.confirm("未確認の問診票を、今の患者の情報（氏名・フリガナ・生年月日・電話）で照合し直して結びつけます。先にデータの控えを作成します。よろしいですか？")) return;
    setRefilling(true);
    try {
      const b = await createBackup();
      if (b.integrity !== "ok") throw new Error("控えの検査で問題が見つかったため、照合を中止しました");
      const r = await relinkQuestionnaires();
      notify(`照合しました（未確認${r.checked}件のうち${r.linked}件を患者${r.patients}名に結びつけました）`);
      await load();
    } catch (err) {
      fail(err);
    } finally {
      setRefilling(false);
    }
  };

  return (
    <section>
      <p className={styles.lead}>
        患者が入力する問診票（下の「患者が入力する問診票」）と Google フォームの問診票の回答は自動で取り込まれ、<b>氏名（またはフリガナ）と、生年月日か電話番号</b>が一致する患者に紐付きます。
        紐付いた回答は、患者画面とカルテの「既往歴・内服歴」で確認できます。
        該当する患者がいない、または2人以上いる回答は下に表示されます。あとから患者を登録・修正したときは、合う回答が自動で結びつきます。診察券番号を入力して紐付けてください。
        送信用の Apps Script の設定手順は、questionnaire.gs の先頭を参照してください。
      </p>
      {isAdmin && (
        <div className={styles.actions}>
          <button className={styles.btn} disabled={refilling} onClick={refill}>
            {refilling ? "反映中…" : "問診票を患者の基本情報へ反映"}
          </button>
          <button className={styles.btn} disabled={refilling} onClick={relink}>
            未確認の問診票をまとめて照合
          </button>
          <span className={styles.muted}>
            電話・住所・性別・生年月日・既往歴・内服歴・アレルギー（注意事項）・その他を、患者の空欄に反映します。入力済みの欄は変更しません。
          </span>
        </div>
      )}
      {items === null && <p className={styles.muted}>読み込み中…</p>}
      {items?.length === 0 && <p className={styles.muted}>紐付けが必要な回答はありません</p>}
      {items && items.length > 0 && (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>回答日時</th>
              <th>氏名</th>
              <th>生年月日・電話</th>
              <th>診察券番号で紐付け</th>
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
                        notify("患者に紐付けました");
                        await load();
                      } catch (err) {
                        fail(err);
                      }
                    }}
                  >
                    紐付け
                  </button>
                  {canEdit && (
                    <button
                      className={styles.btn}
                      onClick={async () => {
                        if (!window.confirm(`${q.name} さんの回答を削除します。よろしいですか？`)) return;
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
      {isAdmin && <MonshinCard notify={notify} fail={fail} />}
    </section>
  );
}

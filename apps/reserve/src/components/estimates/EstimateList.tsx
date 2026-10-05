"use client";

import { useCallback, useEffect, useState } from "react";
import type { Estimate } from "@/lib/domain/types";
import { nowInClinic } from "@/lib/domain/time";
import { ApiError, deleteEstimate, estimatePrintUrl, fetchEstimates } from "@/components/calendar/api";
import { EstimateDialog, yen } from "./EstimateDialog";
import styles from "./estimates.module.css";

/** 患者画面の見積書の一覧（作る・印刷・直す・削除） */
export function EstimateList(props: { patientId: string; patientName: string; readOnly: boolean; canManage: boolean }) {
  const [items, setItems] = useState<Estimate[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Estimate | "new" | null>(null);

  const load = useCallback(() => {
    fetchEstimates(props.patientId).then(
      (xs) => {
        setItems(xs);
        setError(null);
      },
      (err) => setError(err instanceof ApiError ? err.message : "見積書を読み込めませんでした"),
    );
  }, [props.patientId]);

  useEffect(load, [load]);

  const remove = async (e: Estimate) => {
    if (!window.confirm(`見積書 No.${e.no}（${yen(e.totalYen)}）を削除しますか？`)) return;
    try {
      await deleteEstimate(e.id, e.version);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "削除できませんでした");
    }
  };

  const today = nowInClinic().date;
  return (
    <div>
      {error && <p className={styles.error}>{error}</p>}
      {items === null && !error && <p className={styles.muted}>読み込み中…</p>}
      {items?.length === 0 && <p className={styles.muted}>まだ見積書はありません</p>}
      {items && items.length > 0 && (
        <table className={styles.list}>
          <thead>
            <tr>
              <th>No.</th>
              <th>発行日</th>
              <th>内容</th>
              <th className={styles.num}>合計（税込）</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items.map((e) => (
              <tr key={e.id}>
                <td>{e.no}</td>
                <td>
                  {e.date.replaceAll("-", "/")}
                  {e.validUntil < today && <span className={styles.expired}>期限切れ</span>}
                </td>
                <td className={styles.listItems} title={e.lines.map((l) => `${l.name}×${l.qty}`).join("、")}>
                  {e.lines.map((l) => (l.qty > 1 ? `${l.name}×${l.qty}` : l.name)).join("、")}
                </td>
                <td className={styles.num}>{yen(e.totalYen)}</td>
                <td>
                  <div className={styles.listBtns}>
                    <a className={styles.primaryBtn} href={estimatePrintUrl(e.id)} target="_blank" rel="noopener">
                      🖨 見積書
                    </a>
                    <a className={styles.btn} href={estimatePrintUrl(e.id, "bill")} target="_blank" rel="noopener">
                      🧾 会計書
                    </a>
                    {!props.readOnly && (
                      <button type="button" className={styles.btn} onClick={() => setEditing(e)}>
                        直す
                      </button>
                    )}
                    {!props.readOnly && props.canManage && (
                      <button type="button" className={styles.btn} onClick={() => remove(e)}>
                        削除
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {!props.readOnly && (
        <div className={styles.actions} style={{ justifyContent: "flex-start" }}>
          <button type="button" className={styles.btn} onClick={() => setEditing("new")}>
            ＋見積書を作る
          </button>
        </div>
      )}
      {editing && (
        <EstimateDialog
          patientId={props.patientId}
          patientName={props.patientName}
          estimate={editing === "new" ? undefined : editing}
          onClose={() => setEditing(null)}
          onSaved={load}
        />
      )}
    </div>
  );
}

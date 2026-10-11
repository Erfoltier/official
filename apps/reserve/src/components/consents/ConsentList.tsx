"use client";

import { useCallback, useEffect, useState } from "react";
import type { ConsentRecord, Patient } from "@/lib/domain/types";
import { ApiError, consentPrintUrl, deleteConsent, fetchConsents } from "@/components/calendar/api";
import { ConsentDialog } from "./ConsentDialog";
import styles from "@/components/estimates/estimates.module.css";

/** 患者画面の同意書（発行・署名の控え）の一覧 */
export function ConsentList(props: { patient: Pick<Patient, "id" | "name" | "kana" | "chartNo" | "birthDate">; readOnly: boolean; canManage: boolean }) {
  const [items, setItems] = useState<ConsentRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const pid = props.patient.id;

  const load = useCallback(() => {
    fetchConsents(pid).then(
      (xs) => {
        setItems(xs);
        setError(null);
      },
      (err) => setError(err instanceof ApiError ? err.message : "同意書を読み込めませんでした"),
    );
  }, [pid]);
  useEffect(load, [load]);

  return (
    <div>
      {error && <p className={styles.error}>{error}</p>}
      {items === null && !error && <p className={styles.muted}>読み込み中…</p>}
      {items?.length === 0 && <p className={styles.muted}>まだ同意書はありません</p>}
      {items && items.length > 0 && (
        <table className={styles.list}>
          <thead>
            <tr>
              <th>同意日</th>
              <th>同意書</th>
              <th>施術</th>
              <th>署名</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items.map((c) => (
              <tr key={c.id}>
                <td>{c.date.replaceAll("-", "/")}</td>
                <td>{c.title}</td>
                <td className={styles.listItems}>{c.treatment ?? ""}</td>
                <td>{c.signed ? "✍ 画面で署名" : "紙で署名"}</td>
                <td>
                  <div className={styles.listBtns}>
                    <a className={styles.primaryBtn} href={consentPrintUrl(c.id)} target="_blank" rel="noopener">
                      🖨 印刷・PDF
                    </a>
                    {!props.readOnly && props.canManage && (
                      <button
                        type="button"
                        className={styles.btn}
                        onClick={async () => {
                          if (!window.confirm(`「${c.title}」（${c.date}）の控えを削除しますか？`)) return;
                          try {
                            await deleteConsent(c.id);
                            load();
                          } catch (err) {
                            setError(err instanceof ApiError ? err.message : "削除できませんでした");
                          }
                        }}
                      >
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
          <button type="button" className={styles.btn} onClick={() => setOpen(true)}>
            ＋同意書を作る
          </button>
        </div>
      )}
      {open && <ConsentDialog patient={props.patient} onClose={() => setOpen(false)} onSaved={load} />}
    </div>
  );
}

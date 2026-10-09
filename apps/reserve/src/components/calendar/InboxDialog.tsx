"use client";

import { useEffect, useRef, useState } from "react";
import { ApiError, fetchIntake, markIntake, type IntakeItem } from "./api";
import styles from "./calendar.module.css";

const STATE_LABEL: Record<IntakeItem["state"], string> = { new: "未対応", booked: "予約済み", done: "済み", skip: "見送り" };

function dateJa(iso: string): string {
  if (!iso) return "";
  // 端末の時間帯に左右されないよう、日付だけで曜日を出す
  const [y, m, d] = iso.split("-").map(Number);
  return `${m}/${d}(${"日月火水木金土"[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]})`;
}

function stamp(iso: string): string {
  return new Date(iso).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

/**
 * LINE 予約フォームの申請の受付箱。申請を新しい順に並べ、「予約を作る」で予約登録の画面へ流し込む。
 * カレンダーに申請IDつきの予約があれば「予約済み」（Air から取り込んだ予約のメモも含む）。Air などで対応したものは「済み」に
 */
export function InboxDialog(props: { onClose: () => void; onBook: (item: IntakeItem) => void; onCount: (n: number) => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [items, setItems] = useState<IntakeItem[] | null>(null);
  const [available, setAvailable] = useState(true);
  const [showAll, setShowAll] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { onCount } = props;

  useEffect(() => {
    ref.current?.showModal();
    fetchIntake(30).then(
      (r) => {
        setItems(r.items);
        setAvailable(r.available);
        onCount(r.items.filter((x) => x.state === "new").length);
      },
      (e) => setError(e instanceof ApiError ? e.message : "読み込めませんでした"),
    );
  }, [onCount]);

  const mark = async (it: IntakeItem, action: "done" | "skip" | null) => {
    try {
      await markIntake(it.requestId, action);
      setItems((list) => {
        const next = (list ?? []).map((x) => (x.requestId === it.requestId ? { ...x, state: (action ?? "new") as IntakeItem["state"] } : x));
        onCount(next.filter((x) => x.state === "new").length);
        return next;
      });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "保存できませんでした");
    }
  };

  const shown = (items ?? []).filter((x) => showAll || x.state === "new");

  return (
    <dialog ref={ref} className={styles.dialog} style={{ width: "min(720px, calc(100vw - 24px))" }} onClose={(e) => e.target === e.currentTarget && props.onClose()} onCancel={(e) => e.target === e.currentTarget && props.onClose()}>
      <div className={styles.panelHead}>
        <div className={styles.panelName}>受付箱（LINE 予約申請）</div>
        <button type="button" className={styles.iconBtn} onClick={props.onClose} aria-label="閉じる">
          ×
        </button>
      </div>
      <p className={styles.pickedSub} style={{ margin: "0 0 8px" }}>
        最近30日の申請です。「予約を作る」で予約登録の画面に入ります。Airリザーブで予約した申請は、Air から取り込んだ予約のメモに申請IDがあれば自動で「予約済み」になります。電話などで対応した申請は「済み」にしてください。
      </p>
      <label style={{ display: "inline-flex", gap: 6, alignItems: "center", fontSize: 13, marginBottom: 8 }}>
        <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
        予約済み・済み・見送りも表示
      </label>
      {error && <p className={styles.error}>{error}</p>}
      {!items && !error && <p>読み込み中…</p>}
      {items && !available && <p>申請の保存場所が見つかりません（この版では使えません）</p>}
      {items && available && shown.length === 0 && <p>{showAll ? "最近30日の申請はありません" : "未対応の申請はありません"}</p>}
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 10 }}>
        {shown.map((it) => (
          <li key={it.requestId} style={{ border: "1px solid var(--line)", borderRadius: 10, padding: "10px 12px", background: "var(--surface)", opacity: it.state === "new" ? 1 : 0.7 }}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "baseline" }}>
              <b style={{ fontSize: 16 }}>{it.name || "（氏名なし）"}</b>
              <span className={styles.pickedSub}>{it.kana}</span>
              <span className={styles.pickedSub}>{it.visitType === "initial" ? "初診" : "再診"}</span>
              <span style={{ marginLeft: "auto", fontSize: 12 }} className={styles.pickedSub}>
                {STATE_LABEL[it.state]}
                {it.state === "booked" && it.reservation && `（${stamp(it.reservation.startAt)}）`}
                {it.handledBy && `・${it.handledBy}`}
              </span>
            </div>
            <div style={{ fontSize: 14, marginTop: 4, lineHeight: 1.6 }}>
              希望：<b>{dateJa(it.preferredDate)}</b> {it.timePreference}
              {it.timeNote && `（${it.timeNote}）`}
              <br />
              {it.wish && (
                <>
                  内容：{it.wish}
                  {it.area && ` ／ ${it.area}`}
                  <br />
                </>
              )}
              {it.notes && (
                <>
                  相談：{it.notes}
                  <br />
                </>
              )}
              <span className={styles.pickedSub}>
                {it.birthDate && `生年月日 ${it.birthDate}　`}
                {it.phone && `電話 ${it.phone}　`}
                申請 {stamp(it.receivedAt)}・{it.requestId}
              </span>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
              {it.state !== "booked" && (
                <button type="button" className={styles.primaryBtn} onClick={() => props.onBook(it)}>
                  予約を作る{it.preferredDate && `（${dateJa(it.preferredDate)}）`}
                </button>
              )}
              {it.state === "new" && (
                <>
                  <button type="button" className={styles.btn} onClick={() => void mark(it, "done")}>
                    済み
                  </button>
                  <button type="button" className={styles.btn} onClick={() => void mark(it, "skip")}>
                    見送り
                  </button>
                </>
              )}
              {(it.state === "done" || it.state === "skip") && (
                <button type="button" className={styles.btn} onClick={() => void mark(it, null)}>
                  未対応に戻す
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </dialog>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchM3SyncQueue, fetchM3SyncStatus, saveM3SyncSettings, startM3Sync, type M3SyncReviewItem, type M3SyncStatus } from "@/components/calendar/api";
import { withBase } from "@/lib/paths";
import styles from "./settings.module.css";

const stamp = (iso?: string | number | null) =>
  iso ? new Date(iso).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";

/**
 * デジカル（M3）の受付画面への予約の写し（Chrome 拡張機能）。院長だけ（docs/M3-SYNC.md）
 * Claude の利用キー（受付メモの1行を作る）・写し始め・今どのパソコンが写しているか・要確認の予約
 */
export function M3SyncCard({ notify, fail }: { notify: (t: string) => void; fail: (e: unknown) => void }) {
  const [st, setSt] = useState<M3SyncStatus | null>(null);
  const [review, setReview] = useState<M3SyncReviewItem[]>([]);
  const [pending, setPending] = useState(0);
  const [key, setKey] = useState("");
  const [trial, setTrial] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const s = await fetchM3SyncStatus();
      setSt(s);
      if (s.startAt) {
        const q = await fetchM3SyncQueue();
        setReview(q.review);
        setPending(q.items.length);
      }
    } catch (e) {
      fail(e);
    }
  }, [fail]);
  useEffect(() => {
    // 画面を開いたときに一度だけ読む
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const run = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try {
      await fn();
      notify(done);
      await load();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <details className={`${styles.clinicCard} ${styles.fold}`}>
      <summary className={styles.cardTitle}>デジカルへの予約の写し（院のパソコンの Chrome）</summary>
      <p className={styles.hint}>
        LANE RESERVE に入った予約を、デジカルの受付画面に写します。拡張機能を入れた院のパソコンのうち、Chrome で LANE RESERVE とデジカルにログインしているどれか1台が、2分ごとに写します。
        受付メモの1行は、予約の中身から Claude が作ります（Claude には時刻・メニュー・予約メモだけを送り、氏名や連絡先は送りません）。
      </p>
      {st && (
        <>
          <div className={styles.prefRow}>
            <b>Claude の利用キー</b>
            <small>{st.claude.hasKey ? `設定済み（${stamp(st.claude.updatedAt)}・${st.claude.model}）` : "まだ入っていません"}</small>
            <div className={styles.actions} style={{ alignItems: "center" }}>
              <input
                className={styles.input}
                style={{ width: "auto", flex: "1 1 220px" }}
                type="password"
                autoComplete="off"
                value={key}
                placeholder="sk-ant- で始まるキーを貼り付け"
                onChange={(e) => setKey(e.target.value)}
                aria-label="Claude の利用キー"
              />
              <button className={styles.primary} disabled={busy || !key.trim()} onClick={() => run(async () => { await saveM3SyncSettings({ apiKey: key.trim() }); setKey(""); }, "Claude の利用キーを保存しました")}>
                保存
              </button>
            </div>
          </div>
          <div className={styles.prefRow}>
            <b>試運転</b>
            <small>
              {st.claude.trialChartNos.length
                ? `試運転中：患者番号 ${st.claude.trialChartNos.join("・")} の予約だけを写します。空にして保存すると本番になり、その時刻から後に入った予約を写します（試運転の間に入った予約は写しません）。`
                : "本番：すべての予約を写します。患者番号を入れて保存すると、その患者だけを写す試運転になります（練習用の患者など）。"}
            </small>
            <div className={styles.actions} style={{ alignItems: "center" }}>
              <input
                className={styles.input}
                style={{ width: "auto", flex: "1 1 160px" }}
                value={trial ?? st.claude.trialChartNos.join(",")}
                placeholder="例：2（カンマで区切る。カルテ番号のない患者は患者ID p-…）"
                onChange={(e) => setTrial(e.target.value)}
                aria-label="試運転の患者番号"
              />
              <button
                className={styles.btn}
                disabled={busy || trial === null}
                onClick={() => {
                  const goLive = st.claude.trialChartNos.length > 0 && !(trial ?? "").trim();
                  if (goLive && !window.confirm("試運転を終えて本番にします。この時刻から後に LANE RESERVE に入った予約がデジカルに写されます。スタッフのデジカルへの手入力はやめてください。よろしいですか？")) return;
                  void run(async () => {
                    await saveM3SyncSettings({ trialChartNos: trial ?? "" });
                    setTrial(null);
                  }, goLive ? "本番の写しを始めました" : "試運転の患者を保存しました");
                }}
              >
                保存
              </button>
            </div>
          </div>
          <div className={styles.prefRow}>
            <b>写し始め</b>
            {st.startAt ? (
              <small>{stamp(st.startAt)} から（この時刻より後に入った予約と、その変更・取消を写します。前からある予約は取消だけ）</small>
            ) : (
              <>
                <small>まだ始めていません。始めると、この時刻より後に入った予約を写します（前からある予約には触りません。取消だけは写します）。始めた後はデジカルへの手入力をやめてください。</small>
                <div>
                  <button
                    className={styles.primary}
                    disabled={busy || !st.claude.hasKey}
                    onClick={() => {
                      if (window.confirm("デジカルへの写しを始めます。この時刻より後に LANE RESERVE に入った予約が、デジカルに写されます。よろしいですか？")) void run(() => startM3Sync(), "写しを始めました");
                    }}
                  >
                    写しを始める
                  </button>
                </div>
              </>
            )}
          </div>
          <div className={styles.prefRow}>
            <b>今写しているパソコン</b>
            <small>{st.lock ? `${st.lock.holder}（${stamp(st.lock.since ?? null)} から）` : "なし（拡張機能を入れたパソコンで LANE RESERVE とデジカルを開いてください）"}</small>
            {st.startAt && <small>写す予約：{pending}件</small>}
          </div>
          {review.length > 0 && (
            <div className={styles.prefRow}>
              <b>要確認（{review.length}件）</b>
              <ul className={styles.steps}>
                {review.map((r) => (
                  <li key={r.reservation.id}>
                    {r.reservation.date} {r.reservation.time.slice(0, 2)}:{r.reservation.time.slice(2)} {r.patient?.name ?? ""}（{r.reservation.menus.map((m) => m.name).join("・")}）：{r.previous?.reason}
                  </li>
                ))}
              </ul>
              <small>デジカルを確かめて手で直すか、LANE RESERVE の予約を直すと、もう一度写します。</small>
            </div>
          )}
        </>
      )}
      <p className={styles.hint}>
        入れ方（パソコンごとに最初の1回）：①
        <a href={withBase("/integrations/m3-sync-extension.zip")} download>
          拡張機能（zip）
        </a>
        をダウンロードして展開 ② Chrome で <code>chrome://extensions</code> を開き「デベロッパー モード」をオン →「パッケージ化されていない拡張機能を読み込む」で展開したフォルダを選ぶ ③ 拡張機能のボタンを押し、パソコンの名前を入れて「このパソコンで写す」をオン。
      </p>
    </details>
  );
}

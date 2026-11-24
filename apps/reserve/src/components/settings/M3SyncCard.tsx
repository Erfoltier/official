"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchM3SyncQueue, fetchM3SyncStatus, retryM3Sync, saveM3SyncSettings, startM3Sync, type M3SyncReviewItem, type M3SyncStatus } from "@/components/calendar/api";
import { withBase } from "@/lib/paths";
import styles from "./settings.module.css";

const stamp = (iso?: string | number | null) =>
  iso ? new Date(iso).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";

/**
 * デジカル（M3）の受付画面への予約の写し（Chrome 拡張機能）。スタッフも状況・要確認・入れ方を見られる。キー・上限・試運転・写し始めは院長・管理者だけ（docs/M3-SYNC.md）
 * Claude の利用キー（受付メモの1行を作る）・写し始め・今どのパソコンが写しているか・要確認の予約
 */
export function M3SyncCard({ isAdmin, notify, fail }: { isAdmin: boolean; notify: (t: string) => void; fail: (e: unknown) => void }) {
  const [st, setSt] = useState<M3SyncStatus | null>(null);
  const [review, setReview] = useState<M3SyncReviewItem[]>([]);
  const [pending, setPending] = useState(0);
  const [key, setKey] = useState("");
  const [trial, setTrial] = useState<string | null>(null);
  const [cap, setCap] = useState<string | null>(null);
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
          {isAdmin && (
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
            <b>Claude の利用（今月・見積もり）</b>
            <small>
              約{Math.round(st.claude.usage.yen).toLocaleString()}円（{st.claude.usage.calls}回）／上限 {st.claude.capYen.toLocaleString()}円。上限に達すると受付メモを作るのを止め、写しは「要確認」で止まります。1,000円ごとに警告を出します。
              同じ予約は1日5回まで、全体で1時間30回・1日200回までしか呼びません（くり返しの歯止め）。実際の請求は Anthropic の管理画面で確かめてください。
            </small>
            {st.claude.usage.paused && <p className={styles.hint}>⚠ 今月の上限に達したため、受付メモを作るのを止めています。</p>}
            {!st.claude.usage.paused && st.claude.usage.warnings.length > 0 && (
              <p className={styles.hint}>⚠ 今月の利用が約{st.claude.usage.warnings[st.claude.usage.warnings.length - 1].yen.toLocaleString()}円を超えました（{stamp(st.claude.usage.warnings[st.claude.usage.warnings.length - 1].at)}）。</p>
            )}
            <div className={styles.actions} style={{ alignItems: "center" }}>
              <input
                className={styles.input}
                style={{ width: "auto", flex: "0 1 120px" }}
                inputMode="numeric"
                value={cap ?? String(st.claude.capYen)}
                onChange={(e) => setCap(e.target.value.replace(/[^\d]/g, ""))}
                aria-label="月の上限（円）"
              />
              <span>円</span>
              <button className={styles.btn} disabled={busy || cap === null || cap === ""} onClick={() => void run(async () => { await saveM3SyncSettings({ capYen: Number(cap) }); setCap(null); }, "月の上限を保存しました")}>
                上限を保存
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
            </>
          )}
          <div className={styles.prefRow}>
            <b>写し始め</b>
            {st.startAt ? (
              <small>{stamp(st.startAt)} から（この時刻より後に入った予約と、その変更・取消を写します。前からある予約は取消だけ）</small>
            ) : (
              <>
                <small>まだ始めていません。始めると、この時刻より後に入った予約を写します（前からある予約には触りません。取消だけは写します）。始めた後はデジカルへの手入力をやめてください。</small>
                {isAdmin && (
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
                )}
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
                    {r.reservation.date} {r.reservation.time.slice(0, 2)}:{r.reservation.time.slice(2)} {r.patient?.name ?? ""}（{r.reservation.menus.map((m) => m.name).join("・")}）：{r.previous?.reason}{" "}
                    <button
                      className={styles.btn}
                      disabled={busy}
                      onClick={() => {
                        if (window.confirm("デジカルの画面を確かめましたか？ この予約を、次の写しでもう一度写します。")) void run(() => retryM3Sync(r.reservation.id), "もう一度写すようにしました");
                      }}
                    >
                      もう一度写す
                    </button>
                  </li>
                ))}
              </ul>
              <small>原因を直したら「もう一度写す」を押してください（LANE RESERVE の予約を直したときは押さなくても写し直します）。デジカルで手で直した場合は、そのままで構いません。</small>
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

"use client";

import { useEffect, useState } from "react";
import { fetchReminderSettings, runRemindersNow, saveReminderSettings, type ReminderSettings } from "@/components/calendar/api";
import styles from "./settings.module.css";

const DAY_OPTIONS = [0, 1, 2, 3, 4, 5, 6, 7, 14];
const PLACEHOLDERS = ["{患者名}", "{院名}", "{いつ}", "{日付}", "{時刻}", "{メニュー}", "{来院前のご案内}", "{院の電話}"];

function stamp(iso: string): string {
  return new Date(iso).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

/**
 * リマインド（予約のお知らせ）の設定（院長・管理者）。
 * LINE の鍵はここで入れ、暗号化して保存する（画面には二度と出さない）
 */
export function ReminderCard(props: { notify: (m: string) => void; fail: (e: unknown) => void }) {
  const [s, setS] = useState<ReminderSettings | null>(null);
  const [draft, setDraft] = useState<ReminderSettings | null>(null);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchReminderSettings().then(
      (r) => {
        setS(r);
        setDraft(r);
      },
      (e) => setError(e instanceof Error ? e.message : "読み込めませんでした"),
    );
  }, []);

  if (error) {
    return (
      <div className={styles.clinicCard}>
        <h3 className={styles.cardTitle}>リマインド（予約のお知らせ）</h3>
        <p className={styles.hint}>{error}</p>
      </div>
    );
  }
  if (!s || !draft) return null;

  const set = <K extends keyof ReminderSettings>(k: K, v: ReminderSettings[K]) => setDraft({ ...draft, [k]: v });
  const save = async (extra?: { lineToken?: string; enabled?: boolean }) => {
    setBusy(true);
    try {
      const r = await saveReminderSettings({
        enabled: extra?.enabled ?? draft.enabled,
        rounds: draft.rounds,
        useLine: draft.useLine,
        useEmail: draft.useEmail,
        fromEmail: draft.fromEmail,
        fromName: draft.fromName,
        replyTo: draft.replyTo,
        lineReserve: draft.lineReserve,
        template: draft.template,
        ...(extra?.lineToken !== undefined && { lineToken: extra.lineToken }),
      });
      setS(r);
      setDraft(r);
      setToken("");
      props.notify("リマインドの設定を保存しました");
    } catch (e) {
      props.fail(e);
    } finally {
      setBusy(false);
    }
  };

  const runNow = async () => {
    setBusy(true);
    try {
      const r = await runRemindersNow();
      if (!r.ran) {
        props.notify(r.reason === "disabled" ? "リマインドが「止めている」状態です" : "少し前に確認したばかりです");
      } else {
        const parts = Object.entries(r.rounds ?? {}).map(([k, x]) => `${k}：送信 ${x.sent}・送らない ${x.skipped}・失敗 ${x.failed}`);
        props.notify(parts.length ? parts.join("／") : "いまは送る時刻ではありません（決めた時刻から3時間のあいだに送ります）");
      }
      setS(await fetchReminderSettings());
    } catch (e) {
      props.fail(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.clinicCard}>
      <h3 className={styles.cardTitle}>リマインド（予約のお知らせ）</h3>
      <p className={styles.hint}>
        送る回ごとに、来院ごとに1通、LINE がつながっている人には LINE、ほかはメールで送ります（患者ごとに「リマインドの送り先」「リマインド不要」を変えられます）。キャンセル・承認待ちの予約と、当日に取った予約の当日の回には送りません。
      </p>

      <div className={styles.prefRow}>
        <b>状態</b>
        <div className={styles.segment} role="radiogroup" aria-label="リマインドの状態">
          <button type="button" role="radio" aria-checked={!s.enabled} disabled={busy} onClick={() => s.enabled && void save({ enabled: false })}>
            止めている
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={s.enabled}
            disabled={busy}
            onClick={() => {
              if (s.enabled) return;
              if (!window.confirm("自動送信を始めます。決めた時刻になると、予約のある患者へ LINE・メールが届きます。よろしいですか？")) return;
              void save({ enabled: true });
            }}
          >
            自動で送る
          </button>
        </div>
        <small>
          {s.lastRun ? `最後に確認：${stamp(s.lastRun.at)}` : "まだ一度も確認していません"}
          {`　cron の最終実行：${s.cronSeenAt ? stamp(s.cronSeenAt) : "まだ（サーバーの cron 設定を確かめてください）"}`}
          {s.lineConfigured && s.lineRemaining !== null && `　LINE の今月の残り：${s.lineRemaining}通`}
        </small>
      </div>

      <div className={styles.prefRow}>
        <b>送る回（最大3回）</b>
        <div style={{ display: "grid", gap: 6 }}>
          {draft.rounds.map((r, i) => (
            <div key={i} style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
              <select
                className={styles.input}
                style={{ width: "auto" }}
                value={r.daysBefore}
                onChange={(e) => set("rounds", draft.rounds.map((x, j) => (j === i ? { ...x, daysBefore: Number(e.target.value) } : x)))}
                aria-label="何日前"
              >
                {DAY_OPTIONS.map((d) => (
                  <option key={d} value={d}>
                    {d === 0 ? "当日" : d === 1 ? "前日" : `${d}日前`}
                  </option>
                ))}
              </select>
              <input
                className={styles.input}
                style={{ width: "auto" }}
                type="time"
                min="06:00"
                max="21:00"
                value={r.time}
                onChange={(e) => set("rounds", draft.rounds.map((x, j) => (j === i ? { ...x, time: e.target.value } : x)))}
                aria-label="送る時刻"
              />
              <button type="button" className={styles.btn} onClick={() => set("rounds", draft.rounds.filter((_, j) => j !== i))}>
                この回をなくす
              </button>
            </div>
          ))}
          {draft.rounds.length < 3 && (
            <button type="button" className={styles.btn} style={{ justifySelf: "start" }} onClick={() => set("rounds", [...draft.rounds, { daysBefore: 1, time: "18:00" }])}>
              ＋ 回を足す
            </button>
          )}
        </div>
        <small>時刻は 6:00〜21:00。決めた時刻から3時間のあいだに送ります。当日の回は、30分より先の来院だけに送ります。回をなくすと、自動では送りません。</small>
      </div>

      <div className={styles.m3Cols}>
        <label>
          <span>LINE で送る</span>
          <select className={styles.input} value={draft.useLine ? "1" : ""} onChange={(e) => set("useLine", !!e.target.value)}>
            <option value="1">送る</option>
            <option value="">送らない</option>
          </select>
        </label>
        <label>
          <span>LINE の残しておく通数</span>
          <input className={styles.input} type="number" min={0} value={draft.lineReserve} onChange={(e) => set("lineReserve", Number(e.target.value) || 0)} />
        </label>
        <label>
          <span>メールで送る</span>
          <select className={styles.input} value={draft.useEmail ? "1" : ""} onChange={(e) => set("useEmail", !!e.target.value)}>
            <option value="1">送る</option>
            <option value="">送らない</option>
          </select>
        </label>
        <label>
          <span>送信元のメール</span>
          <input className={styles.input} type="email" value={draft.fromEmail} placeholder="reserve@ishidahihuka.jp" onChange={(e) => set("fromEmail", e.target.value)} />
        </label>
        <label>
          <span>送信元の名前（空欄＝院名）</span>
          <input className={styles.input} value={draft.fromName} onChange={(e) => set("fromName", e.target.value)} maxLength={40} />
        </label>
        <label>
          <span>返信先のメール（空欄＝送信元）</span>
          <input className={styles.input} type="email" value={draft.replyTo} onChange={(e) => set("replyTo", e.target.value)} />
        </label>
      </div>
      <p className={styles.hint}>
        LINE の残り通数が「残しておく通数」以下になったら、LINE ではなくメールで送ります（メールがない人には送りません）。無料プランは月200通です。
      </p>

      <label className={styles.field} style={{ display: "block", marginTop: 10 }}>
        <span>文面（差し込み：{PLACEHOLDERS.join(" ")}）</span>
        <textarea className={styles.input} rows={8} value={draft.template} onChange={(e) => set("template", e.target.value)} style={{ width: "100%", fontFamily: "inherit" }} />
      </label>
      <div className={styles.actions}>
        <button type="button" className={styles.btn} onClick={() => set("template", s.defaultTemplate)} disabled={busy}>
          標準の文面に戻す
        </button>
        <button type="button" className={styles.primary} onClick={() => void save()} disabled={busy}>
          保存する
        </button>
      </div>

      <div className={styles.prefRow} style={{ marginTop: 14 }}>
        <b>LINE の鍵</b>
        <span>{s.lineConfigured ? "入れてあります" : "まだ入れていません"}</span>
        <small>LINE Developers の Messaging API チャネルの「チャネルアクセストークン（長期）」を入れます。保存すると画面には二度と表示しません。</small>
      </div>
      <div className={styles.actions}>
        <input className={styles.input} type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} placeholder="チャネルアクセストークン" style={{ flex: 1, minWidth: 200 }} />
        <button type="button" className={styles.btn} disabled={busy || token.trim() === ""} onClick={() => void save({ lineToken: token.trim() })}>
          鍵を入れる
        </button>
        {s.lineConfigured && (
          <button type="button" className={styles.btn} disabled={busy} onClick={() => window.confirm("LINE の鍵を消します。LINE ではリマインドを送れなくなります。よろしいですか？") && void save({ lineToken: "" })}>
            鍵を消す
          </button>
        )}
      </div>

      <div className={styles.actions}>
        <button type="button" className={styles.btn} disabled={busy} onClick={() => void runNow()}>
          今すぐ確認して送る
        </button>
      </div>
      <p className={styles.hint}>決めた時刻を過ぎていれば、まだ送っていない来院へ送ります（同じ来院・同じ回には二度送りません）。</p>
    </div>
  );
}

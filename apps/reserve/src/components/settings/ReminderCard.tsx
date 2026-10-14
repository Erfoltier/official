"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { fetchReminderSettings, previewReminders, runRemindersNow, saveReminderSettings, type ReminderPreview, type ReminderSettings } from "@/components/calendar/api";
import { patientPath } from "@/lib/paths";
import type { Menu } from "@/lib/domain/types";
import { ReminderMenusDialog } from "./ReminderMenusCard";
import styles from "./settings.module.css";

const DAY_OPTIONS = [0, 1, 2, 3, 4, 5, 6, 7, 14];
const PLACEHOLDERS = ["{患者名}", "{院名}", "{いつ}", "{日付}", "{時刻}", "{メニュー}", "{問診票}", "{院の電話}"];

function stamp(iso: string): string {
  return new Date(iso).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

/**
 * リマインド（予約のお知らせ）の設定（院長・管理者）。
 * LINE チャネルアクセストークンはここで入れ、暗号化して保存する（画面には二度と出さない）
 */
export function ReminderCard(props: { menus: Menu[]; onChanged: () => void; notify: (m: string) => void; fail: (e: unknown) => void }) {
  const [s, setS] = useState<ReminderSettings | null>(null);
  const [draft, setDraft] = useState<ReminderSettings | null>(null);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [menusOpen, setMenusOpen] = useState(false);
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
        props.notify(r.reason === "disabled" ? "自動配信が「しない」になっています" : "直前に確認したばかりです。1分ほど待ってからもう一度押してください");
      } else {
        const parts = Object.entries(r.rounds ?? {}).map(([k, x]) => (x.paused ? `${k}：一時停止中のため送信しませんでした` : `${k}：送信済 ${x.sent}・未送信 ${x.skipped}・送信失敗 ${x.failed}`));
        props.notify(parts.length ? parts.join("／") : "送信時刻ではないため、送信する予約はありません。送信時刻から3時間以内に送ります");
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
        予約のある患者に、来院1回につき1通お知らせを送ります。LINE 連携済の患者には LINE、それ以外の患者にはメールで送ります。送信方法は患者ごとに変更でき、送信しない設定もできます。キャンセル・承認待ちの予約には送りません。
      </p>

      <h4 className={styles.subTitle}>配信スケジュール</h4>
      <div className={styles.prefRow}>
        <b>自動配信</b>
        <div className={styles.segment} role="radiogroup" aria-label="自動配信">
          <button type="button" role="radio" aria-checked={!s.enabled} disabled={busy} onClick={() => s.enabled && void save({ enabled: false })}>
            しない
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={s.enabled}
            disabled={busy}
            onClick={() => {
              if (s.enabled) return;
              if (!window.confirm("自動配信を始めます。送信時刻になると、予約のある患者に LINE・メールでお知らせが届きます。よろしいですか？")) return;
              void save({ enabled: true });
            }}
          >
            する
          </button>
        </div>
        <small>
          {s.lastRun ? `最終確認：${stamp(s.lastRun.at)}` : "最終確認：未実行"}
          {`　定期実行（cron）：${s.cronSeenAt ? stamp(s.cronSeenAt) : "未確認（サーバーの cron 設定を確認してください）"}`}
          {s.lineConfigured && s.lineRemaining !== null && `　LINE の今月の残り：${s.lineRemaining}通`}
        </small>
      </div>

      <div className={styles.prefRow}>
        <b>送信時刻（最大3回）</b>
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
                aria-label="送信時刻"
              />
              <button type="button" className={styles.btn} onClick={() => set("rounds", draft.rounds.filter((_, j) => j !== i))}>
                削除
              </button>
            </div>
          ))}
          {draft.rounds.length < 3 && (
            <button type="button" className={styles.btn} style={{ justifySelf: "start" }} onClick={() => set("rounds", [...draft.rounds, { daysBefore: 1, time: "18:00" }])}>
              ＋ 送信時刻を追加
            </button>
          )}
        </div>
        <small>6:00〜21:00 の間で設定できます。送信時刻から3時間以内に送ります。当日の回は、30分以上先の予約にだけ送ります。</small>
      </div>


      <h4 className={styles.subTitle}>送信方法</h4>
      <div className={styles.m3Cols}>
        <label>
          <span>LINE で送信</span>
          <select className={styles.input} value={draft.useLine ? "1" : ""} onChange={(e) => set("useLine", !!e.target.value)}>
            <option value="1">する</option>
            <option value="">しない</option>
          </select>
        </label>
        <label>
          <span>LINE の予備通数</span>
          <input className={styles.input} type="number" min={0} value={draft.lineReserve} onChange={(e) => set("lineReserve", Number(e.target.value) || 0)} />
        </label>
        <label>
          <span>メールで送信</span>
          <select className={styles.input} value={draft.useEmail ? "1" : ""} onChange={(e) => set("useEmail", !!e.target.value)}>
            <option value="1">する</option>
            <option value="">しない</option>
          </select>
        </label>
        <label>
          <span>送信元メールアドレス</span>
          <input className={styles.input} type="email" value={draft.fromEmail} placeholder="info@ishidahihuka.jp" onChange={(e) => set("fromEmail", e.target.value)} />
        </label>
        <label>
          <span>送信者名（空欄なら院名）</span>
          <input className={styles.input} value={draft.fromName} onChange={(e) => set("fromName", e.target.value)} maxLength={40} />
        </label>
        <label>
          <span>返信先メールアドレス（空欄なら送信元）</span>
          <input className={styles.input} type="email" value={draft.replyTo} onChange={(e) => set("replyTo", e.target.value)} />
        </label>
      </div>
      <p className={styles.hint}>
        LINE の今月の残り通数が予備通数以下になると、LINE の代わりにメールで送ります。メールアドレス未回答の患者には送りません。LINE の無料プランは月200通です。送信元メールアドレスが未設定の場合、メールは送信できません。
      </p>

      <div className={styles.prefRow} style={{ marginTop: 10 }}>
        <b>LINE チャネルアクセストークン</b>
        <span>{s.lineConfigured ? "設定済み" : "未設定"}</span>
        <small>LINE Developers の Messaging API チャネルで発行した「チャネルアクセストークン（長期）」を貼り付けて保存してください。保存後は画面に表示されません。</small>
      </div>
      <div className={styles.actions}>
        <input className={styles.input} type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} placeholder="チャネルアクセストークン（長期）" style={{ flex: 1, minWidth: 200 }} />
        <button type="button" className={styles.btn} disabled={busy || token.trim() === ""} onClick={() => void save({ lineToken: token.trim() })}>
          保存
        </button>
        {s.lineConfigured && (
          <button type="button" className={styles.btn} disabled={busy} onClick={() => window.confirm("LINE チャネルアクセストークンを削除します。LINE でリマインドを送れなくなります。よろしいですか？") && void save({ lineToken: "" })}>
            削除
          </button>
        )}
      </div>

      <h4 className={styles.subTitle}>文面</h4>
      <label className={styles.field} style={{ display: "block" }}>
        <span>差し込める項目：{PLACEHOLDERS.join(" ")}</span>
        <textarea className={styles.input} rows={8} value={draft.template} onChange={(e) => set("template", e.target.value)} style={{ width: "100%", fontFamily: "inherit" }} />
      </label>
      <div className={styles.actions} style={{ marginTop: 6, justifyContent: "flex-start" }}>
        <button type="button" className={styles.btn} onClick={() => setMenusOpen(true)}>
          {"{メニュー}"} に表示するメニュー名を編集
        </button>
      </div>
      <p className={styles.hint} style={{ marginTop: 4 }}>{"{メニュー}"} を使うときに、予約カレンダー上のメニュー名と患者に送信したいメニュー名が異なる場合にご使用ください。</p>
      <div className={styles.actions}>
        <button type="button" className={styles.btn} onClick={() => set("template", s.defaultTemplate)} disabled={busy}>
          標準の文面に戻す
        </button>
        <button type="button" className={styles.primary} onClick={() => void save()} disabled={busy}>
          保存
        </button>
      </div>

      <h4 className={styles.subTitle}>手動送信</h4>
      <div className={styles.actions} style={{ justifyContent: "flex-start", marginTop: 0 }}>
        <button type="button" className={styles.btn} disabled={busy} onClick={() => void runNow()}>
          未送信分を今すぐ送る
        </button>
      </div>
      <p className={styles.hint}>送信時刻を過ぎた回のうち、未送信の予約に送ります。同じ予約に同じ回のリマインドを二重に送ることはありません。</p>

      {menusOpen && <ReminderMenusDialog menus={props.menus} onChanged={props.onChanged} notify={props.notify} fail={props.fail} onClose={() => setMenusOpen(false)} />}
      <PreviewSection fail={props.fail} />
    </div>
  );
}

const STATUS_LABEL = { sent: "送信済", pending: "未送信", failed: "送信失敗" } as const;
const METHOD_LABEL = { line: "LINE", email: "メール" } as const;

const stampShort = (iso: string) => new Date(iso).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });

function tomorrow(): string {
  const t = new Date(Date.now() + 9 * 3600e3 + 864e5);
  return t.toISOString().slice(0, 10);
}

/** 送信せずに、指定日の予約ごとの送信方法と送信状況を確認する */
function PreviewSection({ fail }: { fail: (e: unknown) => void }) {
  const [date, setDate] = useState(tomorrow);
  const [data, setData] = useState<ReminderPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const check = async () => {
    setBusy(true);
    try {
      setData(await previewReminders(date));
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div>
      <h4 className={styles.subTitle}>リマインド送信状況の確認</h4>
      <p className={styles.hint}>選んだ日の予約ごとに、送信状況・送信方法を表示します。ここからは送信しません。メールアドレスは一部を伏せて表示します。</p>
      <div className={styles.actions} style={{ marginTop: 0 }}>
        <input className={styles.input} type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="確認する日" />
        <button type="button" className={styles.btn} disabled={busy || !date} onClick={() => void check()}>
          {busy ? "確認中…" : "確認"}
        </button>
      </div>
      {data && (
        <>
          <p className={styles.hint}>
            {data.date}：送信済 {data.count.sent}件・未送信 {data.count.pending}件（うち送信方法なし {data.count.noMethod}件）・送信失敗 {data.count.failed}件
            {data.lineRemaining !== null && `（LINE の今月の残り ${data.lineRemaining}通）`}
          </p>
          {data.items.length === 0 ? (
            <p className={styles.hint}>この日の予約はありません</p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className={styles.previewTable}>
                <thead>
                  <tr>
                    <th>時刻</th>
                    <th>患者</th>
                    <th>送信状況</th>
                    <th>送信方法</th>
                    <th>LINE</th>
                    <th>メール</th>
                    <th>詳細</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((it, i) => (
                    <tr key={i} data-none={(it.status === "pending" && !it.method) || it.status === "failed" || undefined}>
                      <td>{it.time}</td>
                      <td>
                        <Link href={patientPath(it.patientId)}>{it.name}</Link>
                      </td>
                      <td>
                        <b>{STATUS_LABEL[it.status]}</b>
                        {it.at && <small> {stampShort(it.at)}</small>}
                      </td>
                      <td>{it.method ? METHOD_LABEL[it.method] : "—"}</td>
                      <td>{it.line ? "連携済" : "未連携"}</td>
                      <td>{it.email ?? "未回答"}</td>
                      <td>{it.why.join("／")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

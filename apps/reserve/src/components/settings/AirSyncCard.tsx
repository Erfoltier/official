"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { fetchAirSync, markPatientReviewed, runAirSync, saveAirSync, type AirSyncResult, type AirSyncSettings } from "@/components/calendar/api";
import styles from "./settings.module.css";

function stamp(iso: string): string {
  return new Date(iso).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function resultText(r: AirSyncResult): string {
  if (!r.ok) return `失敗：${r.error ?? "取り込めませんでした"}`;
  return `${r.date} の ${r.count ?? 0}件：新しく ${r.created ?? 0}・変更 ${r.updated ?? 0}・取り消し ${r.cancelled ?? 0}・そのまま ${r.unchanged ?? 0}（新しい患者 ${r.newPatients ?? 0}人）`;
}

/**
 * Airリザーブの予約の取り込み（院長・管理者）。毎朝、翌日の分を取り込んで、前日18時のリマインドに間に合わせる。
 * ログイン情報は暗号化して保存し、画面には二度と出さない
 */
export function AirSyncCard(props: { notify: (m: string) => void; fail: (e: unknown) => void }) {
  const [s, setS] = useState<AirSyncSettings | null>(null);
  const [time, setTime] = useState("07:00");
  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [date, setDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = (r: AirSyncSettings) => {
    setS(r);
    setTime(r.time);
  };
  useEffect(() => {
    fetchAirSync().then(load, (e) => setError(e instanceof Error ? e.message : "読み込めませんでした"));
  }, []);

  if (error) {
    return (
      <div className={styles.clinicCard}>
        <h3 className={styles.cardTitle}>Airリザーブの取り込み</h3>
        <p className={styles.hint}>{error}</p>
      </div>
    );
  }
  if (!s) return null;

  const save = async (body: Parameters<typeof saveAirSync>[0], done: string) => {
    setBusy(true);
    try {
      load(await saveAirSync(body));
      setPassword("");
      setLoginId("");
      props.notify(done);
    } catch (e) {
      props.fail(e);
    } finally {
      setBusy(false);
    }
  };

  const run = async () => {
    setBusy(true);
    try {
      const r = await runAirSync(date || undefined);
      props.notify(resultText(r));
      load(await fetchAirSync());
    } catch (e) {
      props.fail(e);
      fetchAirSync().then(load, () => undefined);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.clinicCard}>
      <h3 className={styles.cardTitle}>Airリザーブの取り込み</h3>
      <p className={styles.hint}>
        毎朝、決めた時刻を過ぎたら<b>翌日の予約</b>を Airリザーブから取り込みます（予約メモも入るので、メモの申請IDで LINE のリマインドが届きます）。Air予約番号で同じ予約を探し、時刻・レーン・メニューを Air に合わせ、Air で取り消された・消えた予約は取り消しにします。リマインドを送る20分前にも、その回の対象日をもう一度取り込むので、朝のあとに Air で取り消された予約にはリマインドが届きません。
        患者は「カナと漢字の両方が完全に合う人が1人だけ」のときだけ結びつけ、それ以外は新しい患者（要確認）として登録します。
      </p>

      <div className={styles.prefRow}>
        <b>状態</b>
        <div className={styles.segment} role="radiogroup" aria-label="取り込みの状態">
          <button type="button" role="radio" aria-checked={!s.enabled} disabled={busy} onClick={() => s.enabled && void save({ enabled: false }, "自動の取り込みを止めました")}>
            止めている
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={s.enabled}
            disabled={busy || !s.loginConfigured}
            onClick={() => !s.enabled && void save({ enabled: true }, "毎朝の自動取り込みを始めました")}
          >
            毎朝取り込む
          </button>
        </div>
        <small>{s.lastRun ? `最後に取り込み：${stamp(s.lastRun.at)}　${resultText(s.lastRun)}` : "まだ一度も取り込んでいません"}</small>
      </div>

      <div className={styles.prefRow}>
        <b>取り込む時刻</b>
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <input className={styles.input} style={{ width: "auto" }} type="time" min="05:00" max="16:59" value={time} onChange={(e) => setTime(e.target.value)} aria-label="取り込む時刻" />
          <button type="button" className={styles.btn} disabled={busy || time === s.time} onClick={() => void save({ time }, "取り込む時刻を保存しました")}>
            保存
          </button>
        </div>
        <small>この時刻を過ぎた最初の確認（10分ごと）で取り込みます。リマインドの時刻より前にしてください。</small>
      </div>

      <div className={styles.prefRow}>
        <b>Air のログイン</b>
        <span>{s.loginConfigured ? `入れてあります（${s.loginId}）` : "まだ入れていません"}</span>
        <small>Airリザーブにログインする ID とパスワードです。暗号化して保存し、画面には二度と表示しません。</small>
      </div>
      <div className={styles.actions}>
        <input className={styles.input} autoComplete="off" value={loginId} onChange={(e) => setLoginId(e.target.value)} placeholder="ログイン ID" style={{ flex: 1, minWidth: 160 }} />
        <input className={styles.input} type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="パスワード" style={{ flex: 1, minWidth: 160 }} />
        <button type="button" className={styles.btn} disabled={busy || loginId.trim() === "" || password === ""} onClick={() => void save({ loginId: loginId.trim(), password }, "Air のログイン情報を保存しました")}>
          保存
        </button>
        {s.loginConfigured && (
          <button
            type="button"
            className={styles.btn}
            disabled={busy}
            onClick={() => window.confirm("Air のログイン情報を消します。自動の取り込みはできなくなります。よろしいですか？") && void save({ loginId: "", password: "", enabled: false }, "Air のログイン情報を消しました")}
          >
            消す
          </button>
        )}
      </div>

      <div className={styles.actions}>
        <input className={styles.input} type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="取り込む日" style={{ width: "auto" }} />
        <button type="button" className={styles.btn} disabled={busy || !s.loginConfigured} onClick={() => void run()}>
          {busy ? "取り込んでいます…" : date ? "この日を今すぐ取り込む" : "明日の分を今すぐ取り込む"}
        </button>
      </div>

      {s.review.length > 0 && (
        <>
          <div className={styles.prefRow} style={{ marginTop: 14 }}>
            <b>要確認の患者（{s.review.length}人）</b>
            <small>Air から取り込んだとき、既存の患者と結びつけられずに新しく登録した患者です。同じ人がいれば患者画面で統合し、別の人なら「確認済み」を押してください。</small>
          </div>
          <ul style={{ margin: 0, paddingLeft: 18, maxHeight: 240, overflow: "auto" }}>
            {s.review.map((p) => (
              <li key={p.id} style={{ margin: "4px 0" }}>
                <Link href={`/patients/view/?id=${encodeURIComponent(p.id)}`}>
                  {p.name}
                  {p.kana && p.kana !== p.name && `（${p.kana}）`}
                </Link>
                <button
                  type="button"
                  className={styles.btn}
                  style={{ marginLeft: 8, padding: "2px 8px" }}
                  disabled={busy}
                  onClick={async () => {
                    try {
                      await markPatientReviewed(p.id);
                      setS({ ...s, review: s.review.filter((x) => x.id !== p.id) });
                    } catch (e) {
                      props.fail(e);
                    }
                  }}
                >
                  確認済み
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

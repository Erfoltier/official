"use client";

import { useEffect, useState } from "react";
import { fetchLineLink, saveLineLink, type LineLinkSettings } from "@/components/calendar/api";
import styles from "./settings.module.css";

/**
 * 設定 → 問診票：LINE の中で開く問診票の連携（院長・管理者）。
 * LINE Developers に登録するアドレス（Webhook・LIFF）を示し、LIFF ID とチャネルシークレットを受け取る
 */
export function LineLinkCard({ pageUrl, notify, fail }: { pageUrl: string; notify: (t: string) => void; fail: (e: unknown) => void }) {
  const [s, setS] = useState<LineLinkSettings | null>(null);
  const [liffId, setLiffId] = useState("");
  const [secret, setSecret] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchLineLink()
      .then((r) => {
        setS(r);
        setLiffId(r.liffId);
      })
      .catch(fail);
  }, [fail]);

  if (!s) return null;
  const base = pageUrl.replace(/\/?$/, "/");
  const save = async () => {
    setSaving(true);
    try {
      const r = await saveLineLink({ liffId, ...(secret.trim() && { channelSecret: secret.trim() }) });
      setS(r);
      setSecret("");
      notify("LINE の問診票連携を保存しました");
    } catch (err) {
      fail(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <h3 className={styles.subhead}>LINE の中で開く問診票</h3>
      <p className={styles.muted}>
        LINE で開くと、ご予約の患者さんの氏名・生年月日・電話番号は記入なしで送れます。問診票の案内は返信（LINE の通数を使わない）で行います。
        <br />
        LINE Developers に次のアドレスを登録してください。
      </p>
      <ul className={styles.muted}>
        <li>
          Messaging API の Webhook URL：<code>{base}line.php</code>（「Webhook の利用」をオン、「応答メッセージ」はオフ）
        </li>
        <li>
          LINE ログインの LIFF アプリのエンドポイント URL：<code>{base}liff/</code>（Scope は openid、サイズは Full）
        </li>
      </ul>
      <label className={styles.muted}>LIFF ID</label>
      <input className={styles.input} value={liffId} onChange={(e) => setLiffId(e.target.value)} placeholder="例：1234567890-AbCdEfGh" aria-label="LIFF ID" />
      <label className={styles.muted}>Messaging API のチャネルシークレット（{s.secretConfigured ? "設定済み。変えるときだけ入力" : "未設定"}）</label>
      <input className={styles.input} value={secret} onChange={(e) => setSecret(e.target.value)} type="password" autoComplete="off" aria-label="チャネルシークレット" />
      {!s.tokenConfigured && <p className={styles.muted}>※ 返信には、設定 → リマインド の LINE のチャネルアクセストークンも必要です。</p>}
      <div className={styles.actions}>
        <button className={styles.primary} disabled={saving} onClick={save}>
          {saving ? "保存中…" : "LINE 連携を保存"}
        </button>
      </div>
      {s.liffUrl && (
        <p className={styles.muted}>
          患者さんへの案内（予約確定のチャットの定型文などに貼る）：<code>{s.liffUrl}</code>
        </p>
      )}
    </>
  );
}

"use client";

import { useMemo, useState } from "react";
import qrcode from "qrcode-generator";
import { ApiError, type SecondStep } from "@/components/calendar/api";
import styles from "./login.module.css";

/**
 * ログインの2段階目：スマホの認証アプリ（Google Authenticator・Microsoft Authenticator など）の6桁を入れる。
 * 初めてのときは、認証アプリで読み取る QR コード（と手で入れる鍵）を見せて登録する
 */
export function SecondFactor({ name, step, onSubmit, onBack }: { name: string; step: SecondStep; onSubmit: (code: string) => Promise<void>; onBack: () => void }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const qr = useMemo(() => {
    if (!step.otpauth) return null;
    const q = qrcode(0, "M");
    q.addData(step.otpauth);
    q.make();
    return q.createDataURL(5, 2);
  }, [step.otpauth]);

  const submit = async () => {
    if (code.length !== 6 || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(code);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "確認できませんでした");
      setCode("");
      setBusy(false);
    }
  };

  return (
    <form
      className={styles.pinBox}
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      {step.need === "enroll" ? (
        <>
          <p className={styles.lead}>
            <strong>{name}</strong> さんの二要素認証の登録
          </p>
          <ol className={styles.steps}>
            <li>スマホに「Google Authenticator」（App Store・Google Play で無料）を入れます。</li>
            <li>アプリの「＋」→「QR コードをスキャン」で、下の QR コードを読み取ります。</li>
            <li>アプリに出た6桁の数字を入れて「登録」を押します。</li>
          </ol>
          {/* eslint-disable-next-line @next/next/no-img-element -- その場で作る QR コード */}
          {qr && <img src={qr} alt="認証アプリで読み取る QR コード" className={styles.qr} />}
          <p className={styles.secret}>
            読み取れないときは、この鍵を手で入れてください：
            <br />
            <code>{step.secret?.replace(/(.{4})/g, "$1 ").trim()}</code>
          </p>
        </>
      ) : (
        <p className={styles.lead}>
          <strong>{name}</strong> さんの Google Authenticator の6桁
        </p>
      )}
      <input
        className={styles.pinInput}
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="\d*"
        maxLength={6}
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
        aria-label="認証アプリの6桁の数字"
        autoFocus
      />
      <div className={styles.pad} style={{ gridTemplateColumns: "1fr", marginTop: 12 }}>
        <button type="submit" className={styles.ok} disabled={code.length !== 6 || busy}>
          {step.need === "enroll" ? "登録してログイン" : "ログイン"}
        </button>
      </div>
      {error && <p className={styles.error}>{error}</p>}
      <button type="button" className={styles.back} onClick={onBack}>
        ← PINからやり直す
      </button>
    </form>
  );
}

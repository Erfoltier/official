"use client";

import { useEffect, useState } from "react";
import type { StaffPublic } from "@/lib/domain/types";
import { ROLE_LABEL } from "@/lib/domain/types";
import { ApiError, fetchLoginStaff, login } from "@/components/calendar/api";
import styles from "./login.module.css";
import { withBase } from "@/lib/paths";

/** 戻り先は同じサイト内のパスだけ許す（外部サイトへの転送を防ぐ） */
function safeNext(): string {
  const home = withBase("/");
  const next = new URLSearchParams(window.location.search).get("next") ?? home;
  return next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : home;
}

export function LoginApp() {
  const [staff, setStaff] = useState<Pick<StaffPublic, "id" | "name" | "role">[] | null>(null);
  const [picked, setPicked] = useState<Pick<StaffPublic, "id" | "name" | "role"> | null>(null);
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetchLoginStaff().then(setStaff, () => setError("スタッフ一覧を読み込めませんでした"));
  }, []);

  const submit = async (value: string) => {
    if (!picked || busy) return;
    setBusy(true);
    setError(null);
    try {
      await login(picked.id, value);
      window.location.replace(safeNext());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "ログインできませんでした");
      setPin("");
      setBusy(false);
    }
  };

  const press = (d: string) => {
    if (busy) return;
    const next = (pin + d).slice(0, 8);
    setPin(next);
  };

  return (
    <main className={styles.page}>
      <h1 className={styles.title}>予約カレンダー</h1>
      {!picked ? (
        <>
          <p className={styles.lead}>あなたの名前を選んでください</p>
          <div className={styles.staffGrid}>
            {staff?.map((s) => (
              <button key={s.id} className={styles.staffBtn} onClick={() => setPicked(s)}>
                <span className={styles.staffName}>{s.name}</span>
                <span className={styles.role}>{ROLE_LABEL[s.role]}</span>
              </button>
            ))}
          </div>
        </>
      ) : (
        <form
          className={styles.pinBox}
          onSubmit={(e) => {
            e.preventDefault();
            submit(pin);
          }}
        >
          <p className={styles.lead}>
            <strong>{picked.name}</strong> さんのPIN
          </p>
          <input
            className={styles.pinInput}
            type="password"
            inputMode="numeric"
            autoComplete="off"
            pattern="\d*"
            maxLength={8}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 8))}
            aria-label="PIN"
            autoFocus
          />
          <div className={styles.pad}>
            {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
              <button type="button" key={d} onClick={() => press(d)}>
                {d}
              </button>
            ))}
            <button type="button" onClick={() => setPin((p) => p.slice(0, -1))} aria-label="1文字消す">
              ⌫
            </button>
            <button type="button" onClick={() => press("0")}>
              0
            </button>
            <button type="submit" className={styles.ok} disabled={pin.length < 4 || busy}>
              OK
            </button>
          </div>
          {error && <p className={styles.error}>{error}</p>}
          <button
            type="button"
            className={styles.back}
            onClick={() => {
              setPicked(null);
              setPin("");
              setError(null);
            }}
          >
            ← 名前を選び直す
          </button>
        </form>
      )}
      <p className={styles.note}>試作版：初期PINはすべて 1234 です。設定 → スタッフ から変更してください。</p>
    </main>
  );
}

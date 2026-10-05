"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { PatientEditor } from "@/components/patients/PatientEditor";
import styles from "@/components/patients/patients.module.css";

/** 患者画面。ID は ?id= で受け取る（静的書き出しでも動くように） */
export default function Page() {
  const [id, setId] = useState<string | null>(null);
  useEffect(() => {
    document.title = "患者情報｜予約カレンダー";
    // URL を読めるのは表示後のため、ここで初期化する
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setId(new URLSearchParams(window.location.search).get("id"));
  }, []);
  return (
    <div className={styles.page}>
      <header className={styles.pageHead}>
        <Link href="/patients/" className={styles.back}>
          ← 患者一覧
        </Link>
        <Link href="/" className={styles.back}>
          カレンダーへ
        </Link>
      </header>
      {id ? <PatientEditor key={id} patientId={id} /> : <p className={styles.muted}>患者が指定されていません</p>}
    </div>
  );
}

"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { Patient } from "@/lib/domain/types";
import { searchPatients } from "@/components/calendar/api";
import styles from "./patients.module.css";
import { patientPath } from "@/lib/paths";

/** 患者の検索・一覧。検索語が空のときは最近登録・更新した患者を出す */
export function PatientsApp() {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<Patient[] | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    const t = setTimeout(() => searchPatients(query, ac.signal).then(setItems, () => {}), query ? 200 : 0);
    return () => {
      clearTimeout(t);
      ac.abort();
    };
  }, [query]);

  return (
    <div className={styles.page}>
      <header className={styles.pageHead}>
        <Link href="/" className={styles.back}>
          ← カレンダーへ
        </Link>
        <h1>患者</h1>
      </header>
      <input
        className={styles.input}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="氏名・フリガナ・ローマ字・診察券番号・電話で検索"
        aria-label="患者を検索"
        autoFocus
      />
      <p className={styles.muted}>{query ? "検索結果" : "最近登録・更新した患者"}</p>
      <ul className={styles.list}>
        {items?.map((p) => (
          <li key={p.id}>
            <Link href={patientPath(p.id)}>
              <span className={styles.listName}>
                {p.caution && <span className={styles.caution}>!</span>}
                {p.name}
              </span>
              <span className={styles.muted}>
                {p.kana}
                {p.nameAlt && ` / ${p.nameAlt}`}
              </span>
              <span className={styles.muted}>診察券 {p.chartNo}</span>
              {p.lineUserId && <span className={styles.lineBadge}>LINE</span>}
            </Link>
          </li>
        ))}
        {items && items.length === 0 && <li className={styles.muted}>該当する患者がいません</li>}
      </ul>
    </div>
  );
}

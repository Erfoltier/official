"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { Patient } from "@/lib/domain/types";
import { ApiError, createPatient, searchPatients } from "@/components/calendar/api";
import styles from "./patients.module.css";
import { patientPath } from "@/lib/paths";

/** 患者の検索・一覧。検索語が空のときは最近登録・更新した患者を出す */
export function PatientsApp() {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<Patient[] | null>(null);
  const router = useRouter();
  /** 新規登録の入力（開いているときだけ） */
  const [draft, setDraft] = useState<{ name: string; kana: string; birthDate: string; phone: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const register = async () => {
    if (!draft || !draft.name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const p = await createPatient({
        name: draft.name.trim(),
        kana: draft.kana.trim() || undefined,
        birthDate: draft.birthDate || undefined,
        phone: draft.phone.trim() || undefined,
      });
      // 登録したら患者画面へ（住所・メモ・注意事項などはそこで入れる）
      router.push(patientPath(p.id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "登録できませんでした");
      setSaving(false);
    }
  };

  useEffect(() => {
    const ac = new AbortController();
    const t = setTimeout(() => searchPatients(query, ac.signal).then(setItems, () => {}), query ? 200 : 0);
    return () => {
      clearTimeout(t);
      ac.abort();
    };
  }, [query]);

  return (
    <div className={styles.page} data-ui-zoom>
      <header className={styles.pageHead}>
        <Link href="/" className={styles.back}>
          ← カレンダーへ
        </Link>
        <h1>患者</h1>
        <button
          type="button"
          className={draft ? styles.btn : styles.primary}
          style={{ marginLeft: "auto" }}
          onClick={() => {
            // 検索欄に名前を入れていたら、それを氏名に入れておく（番号・電話での検索のときは空）
            const q = query.trim();
            setDraft(draft ? null : { name: /\d/.test(q) ? "" : q, kana: "", birthDate: "", phone: "" });
            setError(null);
          }}
        >
          {draft ? "やめる" : "＋新規登録"}
        </button>
      </header>
      {draft && (
        <form
          className={styles.newPatientBox}
          onSubmit={(e) => {
            e.preventDefault();
            void register();
          }}
        >
          <div className={styles.grid2}>
            <label className={styles.field}>
              <span>氏名（必須）</span>
              <input className={styles.input} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} autoFocus required />
            </label>
            <label className={styles.field}>
              <span>フリガナ</span>
              <input className={styles.input} value={draft.kana} onChange={(e) => setDraft({ ...draft, kana: e.target.value })} />
            </label>
            <label className={styles.field}>
              <span>生年月日</span>
              <input className={styles.input} type="date" value={draft.birthDate} onChange={(e) => setDraft({ ...draft, birthDate: e.target.value })} />
            </label>
            <label className={styles.field}>
              <span>電話番号</span>
              <input className={styles.input} type="tel" value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} />
            </label>
          </div>
          {error && <div className={styles.alert}>{error}</div>}
          <div className={styles.newPatientActions}>
            <span className={styles.muted}>登録すると患者画面を開きます（住所・メモ・注意事項などはそこで入れられます）</span>
            <button type="submit" className={styles.primary} disabled={saving || !draft.name.trim()}>
              {saving ? "登録しています…" : "登録する"}
            </button>
          </div>
        </form>
      )}
      <input
        className={styles.input}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="氏名・フリガナ・ローマ字・診察券／M3番号・電話・予約申請IDで検索"
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
              <span className={styles.muted}>
                診察券 {p.chartNo}
                {p.m3ChartNo && `・M3 ${p.m3ChartNo}`}
              </span>
              {p.lineUserId && <span className={styles.lineBadge}>LINE</span>}
            </Link>
          </li>
        ))}
        {items && items.length === 0 && <li className={styles.muted}>該当する患者がいません</li>}
      </ul>
    </div>
  );
}

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ClinicSettings, ConsentRecord, ConsentTemplate, Patient } from "@/lib/domain/types";
import { nowInClinic } from "@/lib/domain/time";
import { searchKey } from "@/lib/domain/text";
import { ApiError, consentPrintUrl, createConsent, fetchConsentTemplate, fetchConsentTemplates, fetchSettings } from "@/components/calendar/api";
import { ConsentDocument } from "./ConsentDocument";
import { SignaturePad } from "./SignaturePad";
import styles from "./consents.module.css";

interface Props {
  patient: Pick<Patient, "id" | "name" | "kana" | "chartNo" | "birthDate">;
  /** 予約から開いたとき：その予約のメニューに結びついた同意書を先頭に出す */
  reservation?: { id: string; menuIds: string[]; menuNames: string[] };
  onClose(): void;
  onSaved?(r: ConsentRecord): void;
}

/** 同意書を選ぶ → 患者情報を差し込んだ本文を確かめる → この端末で署名 or 紙に署名する用に印刷 */
export function ConsentDialog({ patient, reservation, onClose, onSaved }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const [templates, setTemplates] = useState<ConsentTemplate[] | null>(null);
  const [clinic, setClinic] = useState<ClinicSettings | null>(null);
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<{ t: ConsentTemplate; html: string; stale?: boolean; modifiedTime: string } | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const [treatment, setTreatment] = useState(reservation?.menuNames.join("、") ?? "");
  const [signing, setSigning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<ConsentRecord | null>(null);
  const date = nowInClinic().date;

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);

  useEffect(() => {
    fetchConsentTemplates().then(
      (r) => setTemplates(r.items),
      () => setTemplates([]),
    );
    fetchSettings().then((s) => setClinic(s.clinic), () => {});
  }, []);

  const ordered = useMemo(() => {
    const key = searchKey(q);
    const menus = new Set(reservation?.menuIds ?? []);
    const list = (templates ?? []).filter((t) => !key || searchKey(t.title).includes(key));
    const matched = list.filter((t) => t.menuIds.some((m) => menus.has(m)));
    return { matched, rest: list.filter((t) => !matched.includes(t)) };
  }, [templates, q, reservation]);

  /** 選んだときに、ドライブから最新の文面を読み込む */
  const pick = async (t: ConsentTemplate) => {
    setError(null);
    setLoading(t.id);
    try {
      const full = await fetchConsentTemplate(t.id);
      if (!full.html) {
        setError("ドライブから同意書を読み込めませんでした。少し待ってからもう一度選んでください");
        return;
      }
      setPicked({ t, html: full.html, stale: full.stale, modifiedTime: full.modifiedTime });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "同意書を読み込めませんでした");
    } finally {
      setLoading(null);
    }
  };

  const save = async (signature?: string) => {
    if (!picked) return;
    setBusy(true);
    setError(null);
    try {
      const r = await createConsent(patient.id, {
        templateId: picked.t.id,
        ...(reservation && { reservationId: reservation.id }),
        date,
        treatment,
        ...(signature && { signature }),
      });
      setSaved(r);
      setSigning(false);
      onSaved?.(r);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "保存できませんでした");
    } finally {
      setBusy(false);
    }
  };

  return (
    <dialog ref={ref} className={styles.dialog} onCancel={onClose} aria-label="同意書">
      <div className={styles.dHead}>
        <h2>
          同意書<small>{patient.name} 様</small>
        </h2>
        <button type="button" className={styles.iconBtn} onClick={onClose} aria-label="閉じる">
          ×
        </button>
      </div>

      {saved ? (
        <div className={styles.done}>
          <p>
            「{saved.title}」を{saved.signed ? "署名済みで保存しました。" : "発行しました（紙に署名してください）。"}
          </p>
          <p className={styles.muted}>控えは患者画面の「同意書」に残ります。印刷画面から PDF にもできます。</p>
          <div className={styles.actions}>
            <button type="button" className={styles.btn} onClick={onClose}>
              閉じる
            </button>
            <a className={styles.primaryBtn} href={consentPrintUrl(saved.id)} target="_blank" rel="noopener">
              🖨 印刷・PDF
            </a>
          </div>
        </div>
      ) : !picked ? (
        <>
          <input className={styles.search} value={q} onChange={(e) => setQ(e.target.value)} placeholder="同意書をさがす" aria-label="同意書をさがす" />
          {templates === null && <p className={styles.muted}>読み込み中…</p>}
          {templates?.length === 0 && (
            <p className={styles.muted}>同意書のひな形がまだありません。Google ドライブの同意書フォルダから送る設定をしてください（設定 → 同意書）。</p>
          )}
          {ordered.matched.length > 0 && <h3 className={styles.groupTitle}>この予約のメニューの同意書</h3>}
          <div className={styles.tplList}>
            {ordered.matched.map((t) => (
              <button key={t.id} type="button" className={styles.tpl} data-match onClick={() => pick(t)} disabled={loading !== null}>
                {loading === t.id ? "ドライブから読み込み中…" : t.title}
              </button>
            ))}
          </div>
          {ordered.matched.length > 0 && ordered.rest.length > 0 && <h3 className={styles.groupTitle}>そのほか</h3>}
          <div className={styles.tplList}>
            {ordered.rest.map((t) => (
              <button key={t.id} type="button" className={styles.tpl} onClick={() => pick(t)} disabled={loading !== null}>
                {loading === t.id ? "ドライブから読み込み中…" : t.title}
              </button>
            ))}
          </div>
        </>
      ) : (
        <>
          <div className={styles.toolbar}>
            <button type="button" className={styles.btn} onClick={() => setPicked(null)} disabled={busy}>
              ← 選び直す
            </button>
            <label className={styles.treat}>
              施術
              <input value={treatment} onChange={(e) => setTreatment(e.target.value)} maxLength={120} />
            </label>
          </div>
          <p className={styles.version} data-stale={picked.stale || undefined}>
            {picked.stale
              ? `⚠ ドライブから最新を読み込めなかったため、前回読み込んだ文面（${picked.modifiedTime.slice(0, 10)} 更新）です`
              : `Google ドライブの最新の文面です（${new Date(picked.modifiedTime).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })} 更新）`}
          </p>
          <div className={styles.preview} data-signing={signing || undefined}>
            {clinic && <ConsentDocument html={picked.html} patient={patient} clinic={clinic} date={date} treatment={treatment || undefined} />}
          </div>
          {signing ? (
            <SignaturePad busy={busy} onCancel={() => setSigning(false)} onDone={(png) => save(png)} />
          ) : (
            <div className={styles.actions}>
              <button type="button" className={styles.btn} onClick={() => save()} disabled={busy}>
                🖨 署名せず印刷（紙に署名）
              </button>
              <button type="button" className={styles.primaryBtn} onClick={() => setSigning(true)} disabled={busy}>
                ✍ この端末で署名する
              </button>
            </div>
          )}
        </>
      )}
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </dialog>
  );
}

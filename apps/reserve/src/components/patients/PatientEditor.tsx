"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { PatientDetail } from "@/lib/domain/types";
import { STATUS_LABEL } from "@/lib/domain/types";
import { formatDateJa, formatHm, minutesOfDay, clinicDateOf, nowInClinic } from "@/lib/domain/time";
import { ApiError, fetchPatient, unlinkLine, updatePatient, type PatientUpdate } from "@/components/calendar/api";
import styles from "./patients.module.css";

interface Props {
  patientId: string;
  /** 保存後に呼ぶ（カレンダーの再読み込みなど） */
  onSaved?: () => void;
  onClose?: () => void;
}

type Form = Required<{ [K in keyof PatientUpdate]-?: K extends "caution" ? boolean : string }>;

function toForm(d: PatientDetail): Form {
  const p = d.patient;
  return {
    name: p.name,
    kana: p.kana ?? "",
    nameAlt: p.nameAlt ?? "",
    chartNo: p.chartNo,
    birthDate: p.birthDate ?? "",
    phone: p.phone ?? "",
    email: p.email ?? "",
    caution: !!p.caution,
    cautionNote: p.cautionNote ?? "",
    memo: p.memo ?? "",
  };
}

/** 満年齢 */
function ageOf(birthDate: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) return null;
  const today = nowInClinic().date;
  let age = Number(today.slice(0, 4)) - Number(birthDate.slice(0, 4));
  if (today.slice(5) < birthDate.slice(5)) age--;
  return age >= 0 && age < 150 ? age : null;
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function PatientEditor({ patientId, onSaved, onClose }: Props) {
  const [detail, setDetail] = useState<PatientDetail | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await fetchPatient(patientId);
      setDetail(d);
      setForm(toForm(d));
      setConflict(false);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "患者情報を読み込めませんでした");
    }
  }, [patientId]);

  useEffect(() => {
    // 初回の読み込み
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const original = useMemo(() => (detail ? toForm(detail) : null), [detail]);
  const changedKeys = useMemo(() => {
    if (!form || !original) return [];
    return (Object.keys(form) as (keyof Form)[]).filter((k) => form[k] !== original[k]);
  }, [form, original]);
  const dirty = changedKeys.length > 0;

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => (f ? { ...f, [k]: v } : f));

  const save = async () => {
    if (!detail || !form) return;
    setSaving(true);
    setError(null);
    const body: PatientUpdate & { version: number } = { version: detail.patient.version };
    for (const k of changedKeys) (body as Record<string, unknown>)[k] = form[k];
    try {
      const d = await updatePatient(patientId, body);
      setDetail(d);
      setForm(toForm(d));
      setNotice("保存しました");
      window.setTimeout(() => setNotice(null), 3000);
      onSaved?.();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) setConflict(true);
      setError(err instanceof ApiError ? err.message : "保存できませんでした");
    } finally {
      setSaving(false);
    }
  };

  const unlink = async () => {
    if (!detail) return;
    if (!window.confirm("この患者とLINEの紐付けを解除します。LINEでの連絡・リマインドは届かなくなります。よろしいですか？")) return;
    try {
      const d = await unlinkLine(patientId, detail.patient.version);
      setDetail(d);
      setForm((f) => (f ? { ...toForm(d), ...pickChanged(f, toForm(detail)) } : f));
      setNotice("LINEの紐付けを解除しました");
      onSaved?.();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) setConflict(true);
      setError(err instanceof ApiError ? err.message : "解除できませんでした");
    }
  };

  if (!detail || !form) {
    return <div className={styles.loading}>{error ?? "読み込み中…"}</div>;
  }

  const p = detail.patient;
  const age = ageOf(form.birthDate);
  const today = nowInClinic().date;
  const upcoming = detail.reservations.filter((r) => clinicDateOf(r.startAt) >= today).reverse();
  const past = detail.reservations.filter((r) => clinicDateOf(r.startAt) < today);

  return (
    <form
      className={styles.editor}
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <div className={styles.editorHead}>
        <div>
          <div className={styles.title}>
            {p.caution && <span className={styles.caution}>!</span>}
            {p.name}
          </div>
          <div className={styles.sub}>
            診察券 {p.chartNo}
            {p.updatedAt && `・最終更新 ${formatDateTime(p.updatedAt)}`}
          </div>
        </div>
        {onClose && (
          <button type="button" className={styles.iconBtn} onClick={onClose} aria-label="閉じる">
            ×
          </button>
        )}
      </div>

      {conflict && (
        <div className={styles.alert}>
          他の端末でこの患者の情報が先に更新されました。
          <button type="button" className={styles.linkBtn} onClick={load}>
            最新の内容を読み込む
          </button>
          （入力中の変更は消えます）
        </div>
      )}
      {error && !conflict && <div className={styles.alert}>{error}</div>}
      {notice && <div className={styles.notice} role="status">{notice}</div>}

      <fieldset className={styles.section}>
        <legend>基本情報</legend>
        <div className={styles.grid2}>
          <Field label="氏名（必須）" hint="漢字・ひらがな・カタカナ・ローマ字を混ぜて入力できます" changed={changedKeys.includes("name")}>
            <input className={styles.input} value={form.name} onChange={(e) => set("name", e.target.value)} maxLength={60} required />
          </Field>
          <Field label="フリガナ" changed={changedKeys.includes("kana")}>
            <input className={styles.input} value={form.kana} onChange={(e) => set("kana", e.target.value)} maxLength={60} />
          </Field>
          <Field label="別の表記（ローマ字・旧姓・通称など）" changed={changedKeys.includes("nameAlt")}>
            <input className={styles.input} value={form.nameAlt} onChange={(e) => set("nameAlt", e.target.value)} maxLength={60} />
          </Field>
          <Field label="診察券番号" changed={changedKeys.includes("chartNo")}>
            <input className={styles.input} value={form.chartNo} onChange={(e) => set("chartNo", e.target.value)} maxLength={20} required />
          </Field>
          <Field label={`生年月日${age !== null ? `（${age}歳）` : ""}`} changed={changedKeys.includes("birthDate")}>
            <input
              className={styles.input}
              type="date"
              value={form.birthDate}
              max={today}
              onChange={(e) => set("birthDate", e.target.value)}
            />
          </Field>
          <Field label="電話" changed={changedKeys.includes("phone")}>
            <input className={styles.input} type="tel" value={form.phone} onChange={(e) => set("phone", e.target.value)} maxLength={20} />
          </Field>
          <Field label="メール" changed={changedKeys.includes("email")}>
            <input className={styles.input} type="email" value={form.email} onChange={(e) => set("email", e.target.value)} maxLength={200} />
          </Field>
        </div>
      </fieldset>

      <fieldset className={styles.section}>
        <legend>注意事項・メモ</legend>
        <label className={styles.check}>
          <input type="checkbox" checked={form.caution} onChange={(e) => set("caution", e.target.checked)} />
          注意事項あり（予約表に <span className={styles.caution}>!</span> を表示）
        </label>
        <Field label="注意事項（アレルギー・既往・禁忌など）" changed={changedKeys.includes("cautionNote")}>
          <textarea className={styles.textarea} value={form.cautionNote} onChange={(e) => set("cautionNote", e.target.value)} maxLength={500} rows={2} />
        </Field>
        <Field label="院内メモ" changed={changedKeys.includes("memo")}>
          <textarea className={styles.textarea} value={form.memo} onChange={(e) => set("memo", e.target.value)} maxLength={2000} rows={3} />
        </Field>
      </fieldset>

      <fieldset className={styles.section}>
        <legend>LINE</legend>
        {p.lineUserId ? (
          <div className={styles.lineRow}>
            <span className={styles.lineBadge}>紐付け済み</span>
            <button type="button" className={styles.dangerBtn} onClick={unlink}>
              紐付けを解除
            </button>
          </div>
        ) : (
          <p className={styles.muted}>
            未連携です。紐付けは、患者さま本人が受付でQRコードを読み取る方法で行います（今後実装）。
          </p>
        )}
      </fieldset>

      <div className={styles.saveBar}>
        <span className={styles.muted}>{dirty ? `${changedKeys.length}項目を変更中` : "変更はありません"}</span>
        <button type="button" className={styles.btn} disabled={!dirty || saving} onClick={() => original && setForm(original)}>
          元に戻す
        </button>
        <button type="submit" className={styles.primary} disabled={!dirty || saving || conflict}>
          保存
        </button>
      </div>

      <fieldset className={styles.section}>
        <legend>予約</legend>
        {detail.reservations.length === 0 && <p className={styles.muted}>予約はありません</p>}
        {upcoming.length > 0 && <ReservationList title="今後の予約" items={upcoming} />}
        {past.length > 0 && <ReservationList title="これまでの予約" items={past.slice(0, 20)} />}
      </fieldset>

      <fieldset className={styles.section}>
        <legend>変更履歴</legend>
        {detail.history.length === 0 ? (
          <p className={styles.muted}>この画面での変更はまだありません</p>
        ) : (
          <ul className={styles.history}>
            {detail.history.slice(0, 20).map((h, i) => (
              <li key={i}>
                <span>{formatDateTime(h.at)}</span>
                {h.fields.join("、")}
              </li>
            ))}
          </ul>
        )}
      </fieldset>
    </form>
  );
}

function pickChanged(form: Form, before: Form): Partial<Form> {
  const out: Partial<Form> = {};
  for (const k of Object.keys(form) as (keyof Form)[]) if (form[k] !== before[k]) (out as Record<string, unknown>)[k] = form[k];
  return out;
}

function Field(props: { label: string; hint?: string; changed?: boolean; children: React.ReactNode }) {
  return (
    <label className={styles.field} data-changed={props.changed || undefined}>
      <span className={styles.label}>{props.label}</span>
      {props.children}
      {props.hint && <span className={styles.hint}>{props.hint}</span>}
    </label>
  );
}

function ReservationList({ title, items }: { title: string; items: PatientDetail["reservations"] }) {
  return (
    <div className={styles.resBlock}>
      <div className={styles.label}>{title}</div>
      <ul className={styles.resList}>
        {items.map((r) => {
          const date = clinicDateOf(r.startAt);
          return (
            <li key={r.id} data-status={r.status}>
              <a href={`/?date=${date}`}>
                {formatDateJa(date)} {formatHm(minutesOfDay(r.startAt))}
              </a>
              <span>{r.menuNames.join("、")}</span>
              <span className={styles.muted}>{r.laneName}</span>
              <span className={styles.status}>{STATUS_LABEL[r.status]}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

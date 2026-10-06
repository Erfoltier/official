"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { PatientDetail } from "@/lib/domain/types";
import { nowInClinic } from "@/lib/domain/time";
import { ageOf, ageSexText } from "@/lib/domain/age";
import { ApiError, fetchMe, fetchPatient, saveVisit, unlinkLine, updatePatient, type PatientUpdate } from "@/components/calendar/api";
import type { Patient, StaffPublic } from "@/lib/domain/types";
import { DeleteDialog, DeletedBanner, DuplicateBanner, MergeDialog } from "./PatientManage";
import { TreatmentHistory, type VisitSave } from "./VisitTable";
import { EstimateList } from "@/components/estimates/EstimateList";
import { ConsentList } from "@/components/consents/ConsentList";
import { CautionInline } from "./CautionInline";
import { RichTextEditor } from "@/components/richtext/RichTextEditor";
import { QuestionnaireAnswers } from "@/components/questionnaires/QuestionnaireAnswers";
import styles from "./patients.module.css";
import { patientPath, withBase } from "@/lib/paths";

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
    m3ChartNo: p.m3ChartNo ?? "",
    birthDate: p.birthDate ?? "",
    sex: p.sex ?? "",
    phone: p.phone ?? "",
    email: p.email ?? "",
    postalCode: p.postalCode ?? "",
    address: p.address ?? "",
    caution: !!p.caution,
    cautionNote: p.cautionNote ?? "",
    memo: p.memo ?? "",
    history: p.history ?? "",
    medications: p.medications ?? "",
    questionnaireOther: p.questionnaireOther ?? "",
  };
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
  const [me, setMe] = useState<StaffPublic | null>(null);
  const [mergeWith, setMergeWith] = useState<Patient | null | undefined>(undefined);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    fetchMe().then(setMe, () => {});
  }, []);

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

  /** ファイルの追加・削除のあと：施術歴だけ読み直す（編集中の基本情報は消さない） */
  const reloadHistory = useCallback(async () => {
    try {
      const d = await fetchPatient(patientId);
      setDetail((cur) => (cur ? { ...cur, visits: d.visits, upcoming: d.upcoming } : d));
    } catch {
      // 読み直しに失敗しても、表示中の内容はそのまま
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

  /** 名前の横から注意事項を書き足す・直す（基本情報の注意事項と同じ欄。入力中の他の項目はそのまま） */
  const saveCaution = async (text: string): Promise<boolean> => {
    if (!detail) return false;
    try {
      const d = await updatePatient(patientId, { version: detail.patient.version, cautionNote: text, caution: !!text });
      setDetail(d);
      setForm((f) => (f ? { ...toForm(d), ...pickChanged(f, toForm(detail)), cautionNote: d.patient.cautionNote ?? "", caution: !!d.patient.caution } : f));
      setNotice("注意事項を保存しました");
      window.setTimeout(() => setNotice(null), 3000);
      onSaved?.();
      return true;
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) setConflict(true);
      setError(err instanceof ApiError ? err.message : "保存できませんでした");
      return false;
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

  const saveVisitRow = async (date: string, body: VisitSave): Promise<boolean> => {
    setError(null);
    try {
      setDetail(await saveVisit(patientId, date, body));
      setNotice("施術歴の記録を保存しました");
      window.setTimeout(() => setNotice(null), 3000);
      return true;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "保存できませんでした");
      return false;
    }
  };

  if (!detail || !form) {
    return <div className={styles.loading}>{error ?? "読み込み中…"}</div>;
  }

  const p = detail.patient;
  const canManage = !!me?.canManage;
  const readOnly = !!p.deleted;
  const afterManage = (d: PatientDetail, done = "") => {
    setMergeWith(undefined);
    setDeleting(false);
    onSaved?.();
    if (d.patient.id !== patientId) {
      window.location.replace(withBase(patientPath(d.patient.id)));
      return;
    }
    setDetail(d);
    setForm(toForm(d));
    setNotice(done || (d.patient.deleted ? "削除しました" : "復元しました"));
  };
  const age = ageOf(form.birthDate);
  const today = nowInClinic().date;

  return (
    <div className={styles.editor}>
      <div className={styles.editorHead}>
        <div>
          <div className={styles.title}>
            {p.caution && <span className={styles.caution}>!</span>}
            {p.name}
            <CautionInline note={p.cautionNote} onSave={readOnly ? undefined : saveCaution} />
          </div>
          <div className={styles.sub}>
            {[
              [p.kana, ageSexText(p)].filter(Boolean).join("　"),
              p.nameAlt,
              p.chartNo ? `診察券 ${p.chartNo}` : null,
              p.m3ChartNo ? `M3 ${p.m3ChartNo}` : null,
              p.phone,
            ]
              .filter(Boolean)
              .join("・")}
            {p.lineUserId && <span className={styles.lineBadge}>LINE</span>}
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
      <DeletedBanner detail={detail} canManage={canManage} onChanged={afterManage} />
      {!readOnly && <DuplicateBanner detail={detail} canManage={canManage} onMerge={(o) => setMergeWith(o)} />}

      {!readOnly && (
      <details className={styles.section} open={dirty || undefined}>
        <summary className={styles.sectionTitle}>基本情報の表示/編集</summary>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
      <fieldset className={styles.subSection}>
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
            <input className={styles.input} value={form.chartNo} onChange={(e) => set("chartNo", e.target.value)} maxLength={20} />
          </Field>
          <Field label="M3カルテ番号" hint="電子カルテ（M3）の患者番号。カルテとの突き合わせに使います" changed={changedKeys.includes("m3ChartNo")}>
            <input
              className={styles.input}
              value={form.m3ChartNo}
              onChange={(e) => set("m3ChartNo", e.target.value)}
              maxLength={20}
              inputMode="text"
              autoComplete="off"
            />
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
          <Field label="性別" changed={changedKeys.includes("sex")}>
            <select className={styles.input} value={form.sex} onChange={(e) => set("sex", e.target.value)}>
              <option value="">未入力</option>
              <option value="female">女性</option>
              <option value="male">男性</option>
              <option value="other">その他</option>
            </select>
          </Field>
        </div>
        <details className={styles.contactBox}>
          <summary className={styles.contactSummary}>
            連絡先情報
            <span className={styles.contactPeek}>{[form.phone, form.address && "住所あり"].filter(Boolean).join("・")}</span>
          </summary>
          <div className={styles.grid2}>
            <Field label="電話" changed={changedKeys.includes("phone")}>
              <input className={styles.input} type="tel" value={form.phone} onChange={(e) => set("phone", e.target.value)} maxLength={20} />
            </Field>
            <Field label="メール" changed={changedKeys.includes("email")}>
              <input className={styles.input} type="email" value={form.email} onChange={(e) => set("email", e.target.value)} maxLength={200} />
            </Field>
            <Field label="郵便番号" changed={changedKeys.includes("postalCode")}>
              <input
                className={styles.input}
                value={form.postalCode}
                onChange={(e) => set("postalCode", e.target.value)}
                maxLength={10}
                inputMode="numeric"
                placeholder="123-4567"
                autoComplete="off"
              />
            </Field>
            <Field label="住所" changed={changedKeys.includes("address")}>
              <input className={styles.input} value={form.address} onChange={(e) => set("address", e.target.value)} maxLength={200} placeholder="都道府県から" autoComplete="off" />
            </Field>
          </div>
        </details>
      </fieldset>

      <fieldset className={styles.subSection}>
        <legend>注意事項・既往歴・メモ</legend>
        <label className={styles.check}>
          <input type="checkbox" checked={form.caution} onChange={(e) => set("caution", e.target.checked)} />
          注意事項あり（予約表に <span className={styles.caution}>!</span> を表示）
        </label>
        <Field label="重要事項（アルコール綿禁止・薬疹・アレルギー・禁忌など。カルテの上に目立つように出ます）" changed={changedKeys.includes("cautionNote")}>
          <textarea className={styles.textarea} value={form.cautionNote} onChange={(e) => set("cautionNote", e.target.value)} maxLength={500} rows={2} />
        </Field>
        <Field label="既往歴" changed={changedKeys.includes("history")}>
          <textarea className={styles.textarea} value={form.history} onChange={(e) => set("history", e.target.value)} maxLength={2000} rows={2} placeholder="例：高血圧、帝王切開（2019）" />
        </Field>
        <Field label="内服歴・服用中の薬" changed={changedKeys.includes("medications")}>
          <textarea className={styles.textarea} value={form.medications} onChange={(e) => set("medications", e.target.value)} maxLength={2000} rows={2} placeholder="例：ロキソニン頓用、低用量ピル" />
        </Field>
        <Field label="その他の問診票情報（既往歴・内服歴・アレルギー・連絡先以外の問診票の回答。問診票が届くたびに日付付きで足されます）" changed={changedKeys.includes("questionnaireOther")}>
          <textarea className={styles.textarea} value={form.questionnaireOther} onChange={(e) => set("questionnaireOther", e.target.value)} maxLength={8000} rows={3} />
        </Field>
        <QuestionnaireAnswers patientId={p.id} />
        <Field label="院内メモ" changed={changedKeys.includes("memo")}>
          <RichTextEditor value={form.memo} onChange={(v) => set("memo", v)} maxLength={4000} rows={3} ariaLabel="院内メモ" />
        </Field>
      </fieldset>

      <fieldset className={styles.subSection}>
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

      </form>
      </details>
      )}

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>施術歴</h2>
        <TreatmentHistory
          detail={detail}
          onSave={saveVisitRow}
          onFilesChanged={reloadHistory}
          onReservationChanged={() => {
            reloadHistory();
            // カレンダーから開いたときは、カレンダーにも反映する
            onSaved?.();
          }}
          readOnly={readOnly}
          canManage={canManage}
        />
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>同意書</h2>
        <ConsentList patient={detail.patient} readOnly={readOnly} canManage={canManage} />
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>見積・会計</h2>
        <EstimateList patientId={patientId} patientName={detail.patient.name} readOnly={readOnly} canManage={canManage} />
      </section>


      {canManage && !readOnly && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>その他の操作</h2>
          <div className={styles.manageRow}>
            <button type="button" className={styles.btn} onClick={() => setMergeWith(null)}>
              重複している患者をまとめる
            </button>
            <button type="button" className={styles.dangerBtn} onClick={() => setDeleting(true)}>
              この患者を削除
            </button>
          </div>
        </section>
      )}
      {mergeWith !== undefined && (
        <MergeDialog current={p} initialOther={mergeWith} onClose={() => setMergeWith(undefined)} onMerged={(d) => afterManage(d, "統合しました")} />
      )}
      {deleting && <DeleteDialog patient={p} onClose={() => setDeleting(false)} onDeleted={afterManage} />}

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>変更履歴</h2>
        {detail.history.length === 0 ? (
          <p className={styles.muted}>この画面での変更はまだありません</p>
        ) : (
          <ul className={styles.history}>
            {detail.history.slice(0, 20).map((h, i) => (
              <li key={i}>
                <span>{formatDateTime(h.at)}</span>
                <strong className={styles.who}>{h.by ? h.by.name : "（記録なし）"}</strong>
                {h.fields.join("、")}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
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

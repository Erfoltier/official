"use client";

import { useEffect, useRef, useState } from "react";
import type { MergePreview, Patient, PatientDetail } from "@/lib/domain/types";
import {
  ApiError,
  deletePatient,
  mergePatients,
  previewMerge,
  restorePatient,
  searchPatients,
} from "@/components/calendar/api";
import { formatDateFull } from "./VisitTable";
import styles from "./patients.module.css";

function stamp(iso: string): string {
  return new Date(iso).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** 削除済みの患者の表示（統合先へのリンク・復元） */
export function DeletedBanner(props: { detail: PatientDetail; canManage: boolean; onChanged: (d: PatientDetail) => void }) {
  const p = props.detail.patient;
  const [error, setError] = useState<string | null>(null);
  if (!p.deleted) return null;
  return (
    <div className={styles.deletedBanner}>
      <strong>この患者は削除されています</strong>（{stamp(p.deleted.at)}
      {p.deleted.by && `・${p.deleted.by.name}`}）
      <div>理由：{p.deleted.reason}</div>
      {p.mergedInto ? (
        <a href={`/patients/${encodeURIComponent(p.mergedInto)}`}>統合先の患者を開く →</a>
      ) : (
        props.canManage && (
          <button
            type="button"
            className={styles.smallBtn}
            onClick={async () => {
              try {
                props.onChanged(await restorePatient(p.id, p.version));
              } catch (err) {
                setError(err instanceof ApiError ? err.message : "復元できませんでした");
              }
            }}
          >
            削除を取り消して復元する
          </button>
        )
      )}
      {error && <div className={styles.alert}>{error}</div>}
    </div>
  );
}

/** 重複の可能性がある患者の案内 */
export function DuplicateBanner(props: { detail: PatientDetail; canManage: boolean; onMerge: (other: Patient) => void }) {
  const { duplicates } = props.detail;
  if (duplicates.length === 0) return null;
  return (
    <div className={styles.dupBanner}>
      <strong>同じ人が重複して登録されているかもしれません</strong>
      <ul>
        {duplicates.map((d) => (
          <li key={d.patient.id}>
            <a href={`/patients/${encodeURIComponent(d.patient.id)}`}>
              {d.patient.name}（診察券 {d.patient.chartNo}）
            </a>
            <span className={styles.muted}>{d.reasons.join("・")}</span>
            {props.canManage && (
              <button type="button" className={styles.smallBtn} onClick={() => props.onMerge(d.patient)}>
                この患者とまとめる
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function useModal() {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return ref;
}

function Summary({ p }: { p: Patient }) {
  return (
    <div className={styles.mergeCard}>
      <div className={styles.mergeName}>{p.name}</div>
      <div className={styles.muted}>診察券 {p.chartNo}</div>
      <dl>
        <dt>フリガナ</dt>
        <dd>{p.kana || "—"}</dd>
        <dt>別の表記</dt>
        <dd>{p.nameAlt || "—"}</dd>
        <dt>生年月日</dt>
        <dd>{p.birthDate || "—"}</dd>
        <dt>電話</dt>
        <dd>{p.phone || "—"}</dd>
        <dt>LINE</dt>
        <dd>{p.lineUserId ? "紐付け済み" : "—"}</dd>
      </dl>
    </div>
  );
}

/**
 * 重複患者の統合。相手を選ぶ → 残す方を選ぶ → 何が移るかを確認 → 統合
 */
export function MergeDialog(props: {
  current: Patient;
  initialOther?: Patient | null;
  onClose: () => void;
  onMerged: (keep: PatientDetail) => void;
}) {
  const ref = useModal();
  const [other, setOther] = useState<Patient | null>(props.initialOther ?? null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Patient[]>([]);
  const [keepCurrent, setKeepCurrent] = useState(true);
  const [preview, setPreview] = useState<MergePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const selfId = props.current.id;
  useEffect(() => {
    if (other || !query.trim()) return;
    const ac = new AbortController();
    const t = setTimeout(
      () => searchPatients(query, ac.signal).then((r) => setResults(r.filter((x) => x.id !== selfId)), () => {}),
      200,
    );
    return () => {
      clearTimeout(t);
      ac.abort();
    };
  }, [query, other, selfId]);

  const currentId = props.current.id;
  const keepId = other ? (keepCurrent ? currentId : other.id) : null;
  const dupId = other ? (keepCurrent ? other.id : currentId) : null;

  useEffect(() => {
    if (!keepId || !dupId) return;
    let alive = true;
    previewMerge(keepId, dupId).then(
      (p) => alive && setPreview(p),
      (err) => alive && setError(err instanceof ApiError ? err.message : "確認できませんでした"),
    );
    return () => {
      alive = false;
    };
  }, [keepId, dupId]);

  const run = async () => {
    if (!preview) return;
    setBusy(true);
    setError(null);
    try {
      props.onMerged(
        await mergePatients({
          keepId: preview.keep.id,
          dupId: preview.dup.id,
          keepVersion: preview.keep.version,
          dupVersion: preview.dup.version,
        }),
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "統合できませんでした");
      setBusy(false);
    }
  };

  return (
    <dialog ref={ref} className={styles.dialog} onClose={props.onClose} onCancel={props.onClose} aria-label="重複患者の統合">
      <div className={styles.editorHead}>
        <div className={styles.title}>重複している患者をまとめる</div>
        <button type="button" className={styles.iconBtn} onClick={props.onClose} aria-label="閉じる">
          ×
        </button>
      </div>

      {!other ? (
        <div className={styles.field}>
          <span className={styles.label}>まとめる相手の患者を探す</span>
          <input
            className={styles.input}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="氏名・フリガナ・ローマ字・診察券番号・電話"
            autoFocus
          />
          <ul className={styles.list}>
            {results.map((p) => (
              <li key={p.id}>
                <button type="button" className={styles.pickRow} onClick={() => setOther(p)}>
                  <span className={styles.listName}>{p.name}</span>
                  <span className={styles.muted}>
                    {p.kana}・診察券 {p.chartNo}
                    {p.phone && `・${p.phone}`}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <>
          <p className={styles.muted}>残す方を選んでください。もう一方の予約・施術歴・記録は、残す方へ移ります。</p>
          <div className={styles.mergeGrid}>
            {[props.current, other].map((p) => {
              const isKeep = (p.id === props.current.id) === keepCurrent;
              return (
                <label key={p.id} className={styles.mergeChoice} data-keep={isKeep || undefined}>
                  <input
                    type="radio"
                    name="keep"
                    checked={isKeep}
                    onChange={() => {
                      setPreview(null);
                      setKeepCurrent(p.id === props.current.id);
                    }}
                  />
                  <span className={styles.keepLabel}>{isKeep ? "こちらを残す" : "こちらをまとめて削除扱いにする"}</span>
                  <Summary p={p} />
                </label>
              );
            })}
          </div>

          {preview ? (
            <ul className={styles.previewList}>
              <li>予約 {preview.reservations} 件を移します</li>
              <li>施術歴の記録 {preview.visitNotes} 日分を移します</li>
              {preview.sameDayNotes.length > 0 && (
                <li>同じ日に両方の記録がある日（{preview.sameDayNotes.map(formatDateFull).join("、")}）は、メモをつなげ、スキンケアを合わせます</li>
              )}
              {preview.filledFields.length > 0 && <li>残す方の空欄を埋めます：{preview.filledFields.join("・")}</li>}
              <li>注意事項・院内メモはつなげます</li>
              {preview.lineConflict && (
                <li className={styles.warn}>両方がLINEと紐付いています。残す方の紐付けを使い、もう一方の紐付けは外します</li>
              )}
              <li>
                まとめた側（診察券 {preview.dup.chartNo}）は削除扱いで記録として残り、検索には出なくなります。<strong>統合は元に戻せません。</strong>
              </li>
            </ul>
          ) : (
            !error && <p className={styles.muted}>確認中…</p>
          )}
          {error && <div className={styles.alert}>{error}</div>}
          <div className={styles.editActions}>
            <button type="button" className={styles.linkBtn} onClick={() => { setOther(null); setPreview(null); }}>
              ← 相手を選び直す
            </button>
            <button type="button" className={styles.btn} onClick={props.onClose}>
              やめる
            </button>
            <button type="button" className={styles.dangerFill} disabled={!preview || busy} onClick={run}>
              統合する
            </button>
          </div>
        </>
      )}
    </dialog>
  );
}

const REASONS = ["誤って登録した", "重複して登録した（統合できない場合）", "本人の希望", "その他"];

/** 患者の削除（論理削除） */
export function DeleteDialog(props: { patient: Patient; onClose: () => void; onDeleted: (d: PatientDetail) => void }) {
  const ref = useModal();
  const [reason, setReason] = useState(REASONS[0]);
  const [other, setOther] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const text = reason === "その他" ? other.trim() : reason;

  return (
    <dialog ref={ref} className={styles.dialogSmall} onClose={props.onClose} onCancel={props.onClose} aria-label="患者の削除">
      <div className={styles.title}>「{props.patient.name}」を削除</div>
      <p className={styles.muted}>
        削除しても、予約・施術歴・記録は消えずに残ります（診療の記録は保存が必要なため）。検索や一覧には出なくなり、あとから復元できます。
        今日以降の予約がある場合は削除できません。
      </p>
      <div className={styles.field}>
        <span className={styles.label}>削除の理由</span>
        {REASONS.map((r) => (
          <label key={r} className={styles.check}>
            <input type="radio" name="reason" checked={reason === r} onChange={() => setReason(r)} />
            {r}
          </label>
        ))}
        {reason === "その他" && (
          <input className={styles.input} value={other} onChange={(e) => setOther(e.target.value)} maxLength={100} placeholder="理由を入力" autoFocus />
        )}
      </div>
      {error && <div className={styles.alert}>{error}</div>}
      <div className={styles.editActions}>
        <button type="button" className={styles.btn} onClick={props.onClose}>
          やめる
        </button>
        <button
          type="button"
          className={styles.dangerFill}
          disabled={!text || busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              props.onDeleted(await deletePatient(props.patient.id, props.patient.version, text));
            } catch (err) {
              setError(err instanceof ApiError ? err.message : "削除できませんでした");
              setBusy(false);
            }
          }}
        >
          削除する
        </button>
      </div>
    </dialog>
  );
}

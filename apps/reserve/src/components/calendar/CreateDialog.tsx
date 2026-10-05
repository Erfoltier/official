"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { DayBundle, Patient, Reservation } from "@/lib/domain/types";
import { formatDateJa, formatHm, toIso } from "@/lib/domain/time";
import { ApiError, postReservation, searchPatients } from "./api";
import styles from "./calendar.module.css";

interface Props {
  bundle: DayBundle;
  date: string;
  laneId: string;
  minute: number;
  onClose: () => void;
  onCreated: (r: Reservation) => void;
}

export function CreateDialog({ bundle, date, laneId: initialLane, minute, onClose, onCreated }: Props) {
  const { clinic } = bundle;
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Patient[]>([]);
  const [patient, setPatient] = useState<Patient | null>(null);
  const [laneId, setLaneId] = useState(initialLane);
  const [start, setStart] = useState(minute);
  const [treatmentIds, setTreatmentIds] = useState<string[]>([]);
  const [duration, setDuration] = useState<number | null>(null);
  const [memo, setMemo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  useEffect(() => {
    if (patient || query.trim().length === 0) return;
    const ac = new AbortController();
    const t = setTimeout(() => {
      searchPatients(query, ac.signal).then(setResults, () => {});
    }, 200);
    return () => {
      clearTimeout(t);
      ac.abort();
    };
  }, [query, patient]);

  const autoDuration = useMemo(
    () =>
      treatmentIds.reduce((sum, id) => sum + (bundle.treatments.find((t) => t.id === id)?.durationMin ?? 0), 0),
    [treatmentIds, bundle.treatments],
  );
  const dur = duration ?? (autoDuration || clinic.slotMin * 2);

  const startOptions: number[] = [];
  for (let m = clinic.dayStartMin; m < clinic.dayEndMin; m += clinic.slotMin) startOptions.push(m);

  const toggleTreatment = (id: string) =>
    setTreatmentIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));

  const submit = async () => {
    if (!patient) return setError("患者を選んでください");
    if (treatmentIds.length === 0) return setError("施術を選んでください");
    if (start + dur > clinic.dayEndMin) return setError("診療時間を超えています");
    setSaving(true);
    setError(null);
    try {
      const r = await postReservation({
        patientId: patient.id,
        laneId,
        treatmentIds,
        startAt: toIso(date, start),
        endAt: toIso(date, start + dur),
        memo: memo || undefined,
      });
      onCreated(r);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "登録できませんでした");
      setSaving(false);
    }
  };

  return (
    <dialog ref={dialogRef} className={styles.dialog} onClose={onClose} onCancel={onClose}>
      <form
        method="dialog"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className={styles.panelHead}>
          <div className={styles.panelName}>新しい予約 {formatDateJa(date)}</div>
          <button type="button" className={styles.iconBtn} onClick={onClose} aria-label="閉じる">
            ×
          </button>
        </div>

        <div className={styles.field}>
          <label htmlFor="pq">患者</label>
          {patient ? (
            <div className={styles.picked}>
              <span>
                {patient.name}（{patient.kana}・{patient.chartNo}）
              </span>
              <button type="button" className={styles.btn} onClick={() => setPatient(null)}>
                変更
              </button>
            </div>
          ) : (
            <>
              <input
                id="pq"
                className={styles.input}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="氏名・カナ・診察券番号"
                autoComplete="off"
                autoFocus
              />
              {query.trim() && (
                <ul className={styles.results}>
                  {results.map((p) => (
                    <li key={p.id}>
                      <button type="button" onClick={() => setPatient(p)}>
                        {p.name} <small>{p.kana}・{p.chartNo}</small>
                      </button>
                    </li>
                  ))}
                  {results.length === 0 && <li className={styles.hint}>該当する患者がいません</li>}
                </ul>
              )}
            </>
          )}
        </div>

        <div className={styles.fieldRow}>
          <div className={styles.field}>
            <label htmlFor="ps">開始</label>
            <select id="ps" className={styles.input} value={start} onChange={(e) => setStart(Number(e.target.value))}>
              {startOptions.map((m) => (
                <option key={m} value={m}>
                  {formatHm(m)}
                </option>
              ))}
            </select>
          </div>
          <div className={styles.field}>
            <label htmlFor="pd">時間（分）</label>
            <input
              id="pd"
              className={styles.input}
              type="number"
              min={clinic.slotMin}
              step={clinic.slotMin}
              value={dur}
              onChange={(e) => setDuration(Math.max(clinic.slotMin, Number(e.target.value) || clinic.slotMin))}
            />
          </div>
          <div className={styles.field}>
            <label htmlFor="pl">レーン</label>
            <select id="pl" className={styles.input} value={laneId} onChange={(e) => setLaneId(e.target.value)}>
              {bundle.lanes.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.shortName}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className={styles.field}>
          <span>施術（複数可）</span>
          <div className={styles.treatPicker}>
            {bundle.treatments.map((t) => (
              <button
                type="button"
                key={t.id}
                className={styles.treatChip}
                style={{ ["--c" as string]: t.color }}
                data-active={treatmentIds.includes(t.id) || undefined}
                onClick={() => toggleTreatment(t.id)}
              >
                {t.name} <small>{t.durationMin}分</small>
              </button>
            ))}
          </div>
        </div>

        <div className={styles.field}>
          <label htmlFor="pm">メモ</label>
          <input id="pm" className={styles.input} value={memo} maxLength={500} onChange={(e) => setMemo(e.target.value)} />
        </div>

        {error && <p className={styles.error}>{error}</p>}

        <div className={styles.dialogActions}>
          <button type="button" className={styles.btn} onClick={onClose}>
            やめる
          </button>
          <button type="submit" className={styles.primaryBtn} disabled={saving}>
            {formatHm(start)}–{formatHm(start + dur)} で登録
          </button>
        </div>
      </form>
    </dialog>
  );
}

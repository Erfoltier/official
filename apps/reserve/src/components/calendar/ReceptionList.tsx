"use client";

import { useMemo, useState, type CSSProperties } from "react";
import type { DayBundle, Menu, Patient, Reservation } from "@/lib/domain/types";
import { INACTIVE_STATUSES } from "@/lib/domain/types";
import { formatHm, minutesOfDay } from "@/lib/domain/time";
import { displayName } from "./names";
import { stageOf } from "./stages";
import { StageTimeInput, parseHm } from "./StageTime";
import { RichText } from "@/components/richtext/RichText";
import { RichTextEditor } from "@/components/richtext/RichTextEditor";
import { richToPlain } from "@/lib/domain/richtext";
import styles from "./calendar.module.css";

export const ALL_LANES = "all";

interface Props {
  /** 開くときにスライドインする */
  animate?: boolean;
  bundle: DayBundle;
  laneFilter: string;
  onLaneFilter(id: string): void;
  maskNames: boolean;
  showCancelled: boolean;
  selectedId: string | null;
  /** 今日なら現在の分（過ぎた予約を薄くする） */
  nowMinutes: number | null;
  onSelect(id: string): void;
  onClose(): void;
  /** 状態を変える。min を省くと今の時刻 */
  onStage(r: Reservation, stageId: string, min?: number): void;
  /** 状態はそのままで、変えた時刻だけ直す */
  onStageTime(r: Reservation, min: number): void;
  /** 患者情報のメモを保存（患者画面のメモと同じもの） */
  onPatientMemo(patient: Patient, memo: string): Promise<boolean>;
}

/** M3の受付画面のような、その日の予約を時刻順に並べた一覧（現在の状態つき） */
export function ReceptionList(props: Props) {
  const { bundle, laneFilter, maskNames, showCancelled, selectedId, nowMinutes, animate } = props;
  const lanes = useMemo(() => [...bundle.lanes].sort((a, b) => a.order - b.order), [bundle.lanes]);
  const laneOf = useMemo(() => new Map(lanes.map((l) => [l.id, l])), [lanes]);
  const patients = useMemo(() => new Map<string, Patient>(bundle.patients.map((p) => [p.id, p])), [bundle.patients]);
  const menus = useMemo(() => new Map<string, Menu>(bundle.menus.map((m) => [m.id, m])), [bundle.menus]);
  /** 状態を変える窓を開いている予約 */
  const [pickerFor, setPickerFor] = useState<string | null>(null);

  const rows = useMemo(
    () =>
      bundle.reservations
        .filter((r) => showCancelled || !INACTIVE_STATUSES.has(r.status))
        .filter((r) => laneFilter === ALL_LANES || r.laneId === laneFilter)
        .sort(
          (a, b) =>
            a.startAt.localeCompare(b.startAt) ||
            (laneOf.get(a.laneId)?.order ?? 0) - (laneOf.get(b.laneId)?.order ?? 0) ||
            a.id.localeCompare(b.id),
        ),
    [bundle.reservations, showCancelled, laneFilter, laneOf],
  );

  /**
   * 1人が同じ日に複数の枠（例：ネオボ撮影→脱毛説明→脱毛→注射）にまたがるときは1行にまとめる。
   * 行の状態は代表の枠（いま・次に行う枠）のもので、状態は全部の枠でそろえて変わる
   */
  const groups = useMemo(() => {
    const byPatient = new Map<string, Reservation[]>();
    for (const r of rows) {
      const list = byPatient.get(r.patientId);
      if (list) list.push(r);
      else byPatient.set(r.patientId, [r]);
    }
    return [...byPatient.values()].map((list) => {
      const active = list.filter((x) => !INACTIVE_STATUSES.has(x.status));
      const upcoming = active.find((x) => nowMinutes === null || minutesOfDay(x.endAt) > nowMinutes);
      return { list, main: upcoming ?? active[0] ?? list[0] };
    });
  }, [rows, nowMinutes]);

  return (
    <>
      {/* スマホで一覧の外を押したら閉じる */}
      <div className={styles.receptionBackdrop} onClick={props.onClose} aria-hidden />
      <aside className={styles.reception} data-ui-zoom aria-label="受付一覧" data-enter={animate || undefined}>
        <div className={styles.receptionHead}>
          <b>受付一覧</b>
          <span className={styles.receptionCount}>{groups.length}人</span>
          <select
            className={styles.select}
            value={laneFilter}
            onChange={(e) => props.onLaneFilter(e.target.value)}
            aria-label="受付一覧のレーン"
          >
            <option value={ALL_LANES}>全レーン</option>
            {lanes.map((l) => (
              <option key={l.id} value={l.id}>
                {l.shortName}
              </option>
            ))}
          </select>
          <button className={styles.iconBtn} onClick={props.onClose} aria-label="受付一覧をたたむ" title="たたむ">
            «
          </button>
        </div>
        {rows.length === 0 && <p className={styles.receptionEmpty}>予約はありません</p>}
        <ol className={styles.receptionRows}>
          {groups.map(({ list, main: r }) => {
            const start = minutesOfDay(list[0].startAt);
            const end = Math.max(...list.map((x) => minutesOfDay(x.endAt)));
            const ms = r.menuIds.map((id) => menus.get(id)).filter((m): m is Menu => !!m);
            const steps = list.flatMap((x) =>
              (x.menuIds.length ? x.menuIds : [""]).map((id, i) => ({ key: `${x.id}:${i}`, menu: menus.get(id), off: INACTIVE_STATUSES.has(x.status) })),
            );
            const lane = laneOf.get(r.laneId);
            const patient = patients.get(r.patientId);
            const sv = stageOf(r, bundle.stages);
            const inactive = INACTIVE_STATUSES.has(r.status);
            const done = sv.stage?.phase === "done";
            const past = nowMinutes !== null && end <= nowMinutes;
            const open = pickerFor === r.id;
            return (
              <li key={r.id}>
                <div
                  className={styles.receptionRow}
                  data-selected={list.some((x) => x.id === selectedId) || undefined}
                  data-dim={inactive || done || undefined}
                  data-past={past || undefined}
                  style={{ "--c": ms[0]?.color ?? "#94a3b8" } as CSSProperties}
                >
                  <button type="button" className={styles.receptionHit} onClick={() => props.onSelect(r.id)}>
                    <span className={styles.receptionTime}>
                      {formatHm(start)}
                      <small>{lane?.shortName}</small>
                    </span>
                    <span className={styles.receptionMain}>
                      <span className={styles.receptionName}>{displayName(patient, maskNames)}</span>
                      {list.length === 1 ? (
                        <span className={styles.receptionMenu}>{ms.map((m) => m.abbr).join("+") || "—"}</span>
                      ) : (
                        <span className={styles.receptionSteps} title={steps.map((s) => s.menu?.name ?? "—").join(" → ")}>
                          {steps.map((s, i) => (
                            <span key={s.key} className={styles.stepChip} data-off={s.off || undefined} style={{ "--c": s.menu?.color ?? "#94a3b8" } as CSSProperties}>
                              {i > 0 && <i aria-hidden>›</i>}
                              {s.menu?.abbr ?? "—"}
                            </span>
                          ))}
                        </span>
                      )}
                    </span>
                  </button>
                  <span className={styles.receptionStage}>
                    <button
                      type="button"
                      className={styles.stagePill}
                      data-clickable
                      data-open={open || undefined}
                      style={{ "--sc": sv.plain ? "#94a3b8" : sv.color } as CSSProperties}
                      onClick={() => setPickerFor(open ? null : r.id)}
                      disabled={inactive}
                      aria-expanded={open}
                      title="押すと状態を変えられます"
                    >
                      {sv.at && !sv.plain && <b className={styles.stageAt}>{sv.at}</b>}
                      {sv.label}
                    </button>
                    {sv.note && (
                      <span className={styles.stagePill} data-note style={{ "--sc": sv.noteColor } as CSSProperties}>
                        {sv.note}
                      </span>
                    )}
                  </span>
                  {patient && (
                    <MemoCell key={`${patient.id}:${patient.version}`} patient={patient} masked={maskNames} onSave={props.onPatientMemo} />
                  )}
                </div>
                {open && (
                  <StagePicker
                    bundle={bundle}
                    reservation={r}
                    currentId={sv.stage?.id}
                    onPick={(id, min) => {
                      props.onStage(r, id, min);
                      setPickerFor(null);
                    }}
                    onTimeOnly={(min) => {
                      props.onStageTime(r, min);
                      setPickerFor(null);
                    }}
                    onClose={() => setPickerFor(null)}
                  />
                )}
              </li>
            );
          })}
        </ol>
      </aside>
    </>
  );
}

/** 一覧の行の下に出す、状態を変える窓 */
function StagePicker(props: {
  bundle: DayBundle;
  reservation: Reservation;
  currentId?: string;
  onPick(stageId: string, min?: number): void;
  onTimeOnly(min: number): void;
  onClose(): void;
}) {
  const [time, setTime] = useState("");
  const min = parseHm(time);
  const stages = props.bundle.stages.filter((s) => !s.free && !s.deleted && (s.active || s.id === props.currentId));
  return (
    <div className={styles.receptionPicker} role="group" aria-label="状態を変える">
      <div className={styles.receptionPickerHead}>
        <StageTimeInput className={styles.stageTime} value={time} onChange={setTime} />
        {min !== undefined && props.currentId && props.reservation.stageAt && (
          <button type="button" className={styles.btn} onClick={() => props.onTimeOnly(min)} title="状態はそのままで時刻だけ直す">
            時刻だけ直す
          </button>
        )}
        <button type="button" className={styles.iconBtn} onClick={props.onClose} aria-label="閉じる">
          ×
        </button>
      </div>
      <div className={styles.stageGrid}>
        {stages.map((s) => {
          const on = s.id === props.currentId;
          return (
            <button
              key={s.id}
              type="button"
              className={styles.stageBtn}
              style={{ "--sc": s.color } as CSSProperties}
              data-active={on || undefined}
              aria-pressed={on}
              onClick={() => props.onPick(s.id, min)}
            >
              {s.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** 患者情報のメモ（患者画面と同じもの）。押すとその場で書ける */
function MemoCell({ patient, masked, onSave }: { patient: Patient; masked: boolean; onSave: Props["onPatientMemo"] }) {
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const memo = patient.memo ?? "";

  const save = async () => {
    if (draft === null || busy) return;
    if (draft.trim() === memo.trim()) {
      setDraft(null);
      return;
    }
    setBusy(true);
    const ok = await onSave(patient, draft.trim());
    setBusy(false);
    if (ok) setDraft(null);
  };

  if (draft !== null) {
    return (
      <div className={styles.receptionMemo} data-editing>
        <RichTextEditor
          value={draft}
          onChange={setDraft}
          autoFocus
          rows={3}
          maxLength={4000}
          disabled={busy}
          onKeyDown={(e) => {
            if (e.key === "Escape") setDraft(null);
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) save();
          }}
          ariaLabel="患者メモ"
          placeholder="患者メモ（患者情報のメモと同じ）"
        />
        <div className={styles.receptionMemoBtns}>
          <button type="button" className={styles.btn} onMouseDown={(e) => e.preventDefault()} onClick={() => setDraft(null)} disabled={busy}>
            やめる
          </button>
          <button type="button" className={styles.primaryBtn} onClick={save} disabled={busy}>
            {busy ? "保存中…" : "保存"}
          </button>
        </div>
      </div>
    );
  }
  return (
    <button
      type="button"
      className={styles.receptionMemo}
      data-empty={!memo || undefined}
      onClick={() => setDraft(memo)}
      title={masked ? "患者メモ（押すと書けます）" : richToPlain(memo) || "押すと患者メモを書けます"}
    >
      {masked ? (memo ? "（メモあり）" : "") : memo ? <RichText value={memo} inline /> : "メモ"}
    </button>
  );
}

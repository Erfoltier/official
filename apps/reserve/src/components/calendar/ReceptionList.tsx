"use client";

import { useMemo, type CSSProperties } from "react";
import type { DayBundle, Menu, Patient } from "@/lib/domain/types";
import { INACTIVE_STATUSES } from "@/lib/domain/types";
import { formatHm, minutesOfDay } from "@/lib/domain/time";
import { displayName } from "./names";
import { stageOf } from "./stages";
import styles from "./calendar.module.css";

export const ALL_LANES = "all";

interface Props {
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
}

/** M3の受付画面のような、その日の予約を時刻順に並べた一覧（現在の状態つき） */
export function ReceptionList(props: Props) {
  const {
    bundle,
    laneFilter,
    maskNames,
    showCancelled,
    selectedId,
    nowMinutes,
  } = props;
  const lanes = useMemo(
    () => [...bundle.lanes].sort((a, b) => a.order - b.order),
    [bundle.lanes],
  );
  const laneOf = useMemo(() => new Map(lanes.map((l) => [l.id, l])), [lanes]);
  const patients = useMemo(
    () => new Map<string, Patient>(bundle.patients.map((p) => [p.id, p])),
    [bundle.patients],
  );
  const menus = useMemo(
    () => new Map<string, Menu>(bundle.menus.map((m) => [m.id, m])),
    [bundle.menus],
  );

  const rows = useMemo(
    () =>
      bundle.reservations
        .filter((r) => showCancelled || !INACTIVE_STATUSES.has(r.status))
        .filter((r) => laneFilter === ALL_LANES || r.laneId === laneFilter)
        .sort(
          (a, b) =>
            a.startAt.localeCompare(b.startAt) ||
            (laneOf.get(a.laneId)?.order ?? 0) -
              (laneOf.get(b.laneId)?.order ?? 0) ||
            a.id.localeCompare(b.id),
        ),
    [bundle.reservations, showCancelled, laneFilter, laneOf],
  );

  return (
    <>
      {/* スマホで一覧の外を押したら閉じる */}
      <div
        className={styles.receptionBackdrop}
        onClick={props.onClose}
        aria-hidden
      />
      <aside className={styles.reception} aria-label="受付一覧">
        <div className={styles.receptionHead}>
          <b>受付一覧</b>
          <span className={styles.receptionCount}>{rows.length}件</span>
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
          <button
            className={styles.iconBtn}
            onClick={props.onClose}
            aria-label="受付一覧をたたむ"
            title="たたむ"
          >
            «
          </button>
        </div>
        {rows.length === 0 && (
          <p className={styles.receptionEmpty}>予約はありません</p>
        )}
        <ol className={styles.receptionRows}>
          {rows.map((r) => {
            const start = minutesOfDay(r.startAt);
            const end = minutesOfDay(r.endAt);
            const ms = r.menuIds
              .map((id) => menus.get(id))
              .filter((m): m is Menu => !!m);
            const lane = laneOf.get(r.laneId);
            const sv = stageOf(r, bundle.stages);
            const inactive = INACTIVE_STATUSES.has(r.status);
            const done = sv.stage?.phase === "done";
            const past = nowMinutes !== null && end <= nowMinutes;
            return (
              <li key={r.id}>
                <button
                  type="button"
                  className={styles.receptionRow}
                  data-selected={r.id === selectedId || undefined}
                  data-dim={inactive || done || undefined}
                  data-past={past || undefined}
                  style={{ "--c": ms[0]?.color ?? "#94a3b8" } as CSSProperties}
                  onClick={() => props.onSelect(r.id)}
                >
                  <span className={styles.receptionTime}>
                    {formatHm(start)}
                    <small>{lane?.shortName}</small>
                  </span>
                  <span className={styles.receptionMain}>
                    <span className={styles.receptionName}>
                      {displayName(patients.get(r.patientId), maskNames)}
                    </span>
                    <span className={styles.receptionMenu}>
                      {ms.map((m) => m.abbr).join("+") || "—"}
                    </span>
                  </span>
                  <span className={styles.receptionStage}>
                    <span
                      className={styles.stagePill}
                      style={
                        {
                          "--sc": sv.plain ? "#94a3b8" : sv.color,
                        } as CSSProperties
                      }
                    >
                      {sv.at && !sv.plain && (
                        <b className={styles.stageAt}>{sv.at}</b>
                      )}
                      {sv.label}
                    </span>
                    {sv.note && (
                      <span
                        className={styles.stagePill}
                        data-note
                        style={{ "--sc": sv.noteColor } as CSSProperties}
                      >
                        {sv.note}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </aside>
    </>
  );
}

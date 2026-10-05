"use client";

import { memo, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import type { Patient, Reservation, Treatment } from "@/lib/domain/types";
import { STATUS_LABEL } from "@/lib/domain/types";
import { formatHm } from "@/lib/domain/time";
import { densityFor, lineFontSize } from "@/lib/calendar/scale";
import { displayName } from "./names";
import styles from "./calendar.module.css";

interface Props {
  reservation: Reservation;
  patient: Patient | undefined;
  treatments: Treatment[];
  top: number;
  height: number;
  col: number;
  cols: number;
  startMin: number;
  endMin: number;
  maskNames: boolean;
  selected?: boolean;
  conflict?: boolean;
  faded?: boolean;
  ghost?: boolean;
  onPointerDown?: (e: ReactPointerEvent, mode: "move" | "resize") => void;
  /** キーボード（Enter・スペース）で選択したとき */
  onActivate?: () => void;
}

/**
 * 予約1件の枠。枠の高さに応じて表示内容を切り替え、5分枠でも名前と施術が読めるようにする。
 */
export const ReservationBlock = memo(function ReservationBlock(props: Props) {
  const { reservation: r, patient, treatments, top, height, col, cols, startMin, endMin, maskNames } = props;
  const h = Math.max(3, height - 1);
  const density = densityFor(h);
  const name = displayName(patient, maskNames);
  const color = treatments[0]?.color ?? "#94a3b8";
  const abbr = treatments.map((t) => t.abbr).join("+");
  const fullNames = treatments.map((t) => t.name).join("、");
  const time = `${formatHm(startMin)}–${formatHm(endMin)}`;
  const label = `${time} ${name} ${fullNames}（${STATUS_LABEL[r.status]}）`;

  const style: CSSProperties = {
    top,
    height: h,
    left: `calc(${(col / cols) * 100}% + 2px)`,
    width: `calc(${100 / cols}% - 4px)`,
    "--c": color,
    ...(density !== "full" && { "--fs": `${lineFontSize(h)}px` }),
  } as CSSProperties;

  return (
    <div
      role="button"
      tabIndex={props.ghost ? -1 : 0}
      aria-label={label}
      title={label}
      className={styles.block}
      style={style}
      data-density={density}
      data-status={r.status}
      data-selected={props.selected || undefined}
      data-conflict={props.conflict || undefined}
      data-faded={props.faded || undefined}
      data-ghost={props.ghost || undefined}
      data-stack={h >= 26 || undefined}
      onPointerDown={(e) => props.onPointerDown?.(e, "move")}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          props.onActivate?.();
        }
      }}
    >
      {density === "full" ? (
        <>
          <div className={styles.blockTitle}>
            {patient?.caution && <span className={styles.caution} aria-label="注意事項あり">!</span>}
            <span className={styles.blockName}>{name}</span>
            {patient?.lineUserId && <span className={styles.lineBadge}>LINE</span>}
          </div>
          <div className={styles.blockMeta}>
            <span>{time}</span>
            <span className={styles.blockTreat}>{h >= 56 ? fullNames : abbr}</span>
          </div>
          {r.status !== "booked" && h >= 56 && <span className={styles.statusChip}>{STATUS_LABEL[r.status]}</span>}
        </>
      ) : density === "bar" ? null : (
        <div className={styles.blockLine}>
          {patient?.caution && <span className={styles.caution}>!</span>}
          <span className={styles.blockName}>{name}</span>
          <span className={styles.sep}>｜</span>
          <span className={styles.blockTreat}>{abbr}</span>
        </div>
      )}
      {props.selected && !props.ghost && (
        <div
          className={styles.resizeHandle}
          aria-hidden
          onPointerDown={(e) => {
            e.stopPropagation();
            props.onPointerDown?.(e, "resize");
          }}
        />
      )}
    </div>
  );
});

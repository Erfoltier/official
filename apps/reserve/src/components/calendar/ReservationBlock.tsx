"use client";

import { memo, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import type { Patient, Reservation, Menu, Stage } from "@/lib/domain/types";
import { stageOf } from "./stages";
import { formatHm } from "@/lib/domain/time";
import { densityFor, lineFontSize } from "@/lib/calendar/scale";
import { displayName } from "./names";
import styles from "./calendar.module.css";
import type { BlockInfo } from "@/lib/displayPrefs";

interface Props {
  /** 枠に出す情報（既定は名前・時刻・施術） */
  info?: BlockInfo;
  reservation: Reservation;
  patient: Patient | undefined;
  menus: Menu[];
  stages: Stage[];
  top: number;
  height: number;
  col: number;
  cols: number;
  startMin: number;
  endMin: number;
  maskNames: boolean;
  selected?: boolean;
  /** 同じ日に同じ人の枠が複数あるとき「2/4」（何工程目か／その日の工程数） */
  step?: string;
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
  const { reservation: r, patient, menus, top, height, col, cols, startMin, endMin, maskNames } = props;
  /** 枠に出す情報（設定 → 画面の表示・配色。端末ごと） */
  const info = props.info ?? "all";
  const h = Math.max(3, height - 1);
  const density = densityFor(h);
  const name = displayName(patient, maskNames);
  const color = menus[0]?.color ?? "#94a3b8";
  const abbr = menus.map((t) => t.abbr).join("+");
  const fullNames = menus.map((t) => t.name).join("、");
  const time = `${formatHm(startMin)}–${formatHm(endMin)}`;
  const sv = stageOf(r, props.stages);
  const label = `${time} ${name} ${fullNames}（${[sv.at && `${sv.at} `, sv.label, sv.note && `・${sv.note}`].filter(Boolean).join("")}）`;
  const pill = density !== "bar" && (sv.note || !sv.plain) && (
    <span className={styles.stagePills}>
      {sv.note && (
        <span className={styles.stagePill} data-note style={{ "--sc": sv.noteColor } as CSSProperties}>
          {sv.note}
        </span>
      )}
      {!sv.plain && (
        <span className={styles.stagePill} style={{ "--sc": sv.color } as CSSProperties}>
          {sv.at && <b className={styles.stageAt}>{sv.at}</b>}
          {sv.label}
        </span>
      )}
    </span>
  );

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
            {props.step && <span className={styles.stepBadge}>{props.step}</span>}
            {patient?.lineUserId && <span className={styles.lineBadge}>LINE</span>}
            {h < 44 && pill}
          </div>
          {info !== "name" && (
            <div className={styles.blockMeta}>
              {info === "all" && <span>{time}</span>}
              <span className={styles.blockTreat}>{h >= 56 ? fullNames : abbr}</span>
            </div>
          )}
          {h >= 44 && pill && <div className={styles.pillRow}>{pill}</div>}
        </>
      ) : density === "bar" ? null : (
        <div className={styles.blockLine}>
          {patient?.caution && <span className={styles.caution}>!</span>}
          <span className={styles.blockName}>{name}</span>
          {props.step && <span className={styles.stepBadge}>{props.step}</span>}
          {info !== "name" && (
            <>
              <span className={styles.sep}>｜</span>
              <span className={styles.blockTreat}>{abbr}</span>
            </>
          )}
          {pill}
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

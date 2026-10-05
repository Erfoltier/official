import type { Reservation, Stage } from "@/lib/domain/types";
import { INACTIVE_STATUSES, STATUS_LABEL } from "@/lib/domain/types";
import { formatHm, minutesOfDay } from "@/lib/domain/time";
import { STAGE_FOR_STATUS } from "@/lib/seed/stages";

export interface StageView {
  /** 選ばれている状態（自由入力以外） */
  stage?: Stage;
  label: string;
  color: string;
  /** 状態を変えた時刻（"16:15"）。分からなければ undefined */
  at?: string;
  /** 「予約」のまま（枠には状態を出さない） */
  plain: boolean;
  /** 自由入力の文字と色（状態と同時に出す） */
  note?: string;
  noteColor: string;
}

/** 予約の状態の表示（院で決めた状態 → なければ大まかな段階から）＋自由入力 */
export function stageOf(r: Reservation, stages: Stage[]): StageView {
  const freeStage = stages.find((s) => s.free);
  const noteColor = freeStage?.color ?? "#6366f1";
  const note = r.stageText || undefined;
  const at = r.stageAt ? formatHm(minutesOfDay(r.stageAt)) : undefined;
  if (INACTIVE_STATUSES.has(r.status)) {
    return { label: STATUS_LABEL[r.status], color: r.status === "no_show" ? "#d43c5a" : "#9ca3af", plain: false, note, noteColor };
  }
  let stage = stages.find((s) => s.id === r.stageId);
  // 以前の版で「自由入力」を状態として選んでいた予約は、段階から決める
  if (!stage || stage.free) stage = stages.find((s) => s.id === STAGE_FOR_STATUS[r.status]);
  if (!stage) return { label: STATUS_LABEL[r.status], color: "#94a3b8", plain: r.status === "booked", at, note, noteColor };
  return { stage, label: stage.label, color: stage.color, at, plain: stage.id === "stage-booked", note, noteColor };
}

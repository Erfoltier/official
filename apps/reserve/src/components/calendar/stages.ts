import type { Reservation, Stage } from "@/lib/domain/types";
import { INACTIVE_STATUSES, STATUS_LABEL } from "@/lib/domain/types";
import { STAGE_FOR_STATUS } from "@/lib/seed/stages";

export interface StageView {
  /** 選ばれている状態（キャンセル時も残っていれば） */
  stage?: Stage;
  label: string;
  color: string;
  /** 「予約」のまま（枠には何も出さない） */
  plain: boolean;
}

/** 予約の状態の表示（院で決めた状態 → なければ大まかな段階から） */
export function stageOf(r: Reservation, stages: Stage[]): StageView {
  const stage = stages.find((s) => s.id === (r.stageId ?? STAGE_FOR_STATUS[r.status]));
  if (INACTIVE_STATUSES.has(r.status)) {
    return { stage, label: STATUS_LABEL[r.status], color: r.status === "no_show" ? "#d43c5a" : "#9ca3af", plain: false };
  }
  if (!stage) return { label: STATUS_LABEL[r.status], color: "#94a3b8", plain: r.status === "booked" };
  return {
    stage,
    label: stage.free && r.stageText ? r.stageText : stage.label,
    color: stage.color,
    plain: stage.id === "stage-booked",
  };
}

import type { Stage } from "@/lib/domain/types";

/**
 * 初期の「状態」（院ごとに増減・名前・色を変えられる）。
 * phase は予約の大まかな段階（リマインド・回数の数え上げなどはこれで判断する）
 */
const DEFS: [string, string, Stage["phase"], string, boolean?][] = [
  ["stage-booked", "予約", "booked", "#94a3b8"],
  ["stage-arrived", "来院済", "arrived", "#0ea5e9"],
  ["stage-wait-dr", "医師待ち", "arrived", "#f59e0b"],
  ["stage-wait-ns", "看護師待ち", "arrived", "#f97316"],
  ["stage-wait-photo", "撮影待ち", "arrived", "#14b8a6"],
  ["stage-wait-anes", "麻酔待ち", "arrived", "#06b6d4"],
  ["stage-exam", "診察中", "in_treatment", "#8b5cf6"],
  ["stage-treat", "処置中", "in_treatment", "#a855f7"],
  ["stage-standby", "待機中", "arrived", "#64748b"],
  ["stage-consider", "検討中", "arrived", "#eab308"],
  ["stage-checkout", "会計待ち", "checkout", "#ec4899"],
  ["stage-done", "帰宅", "done", "#22c55e"],
  ["stage-free", "自由入力", "arrived", "#6366f1", true],
];

export const DEFAULT_STAGES: Stage[] = DEFS.map(([id, label, phase, color, free], i) => ({
  id,
  label,
  phase,
  color,
  free: !!free,
  order: i,
  active: true,
}));

/** 状態を選んでいない（古い）予約の表示：大まかな段階から決める */
export const STAGE_FOR_STATUS: Record<string, string> = {
  booked: "stage-booked",
  arrived: "stage-arrived",
  in_treatment: "stage-treat",
  checkout: "stage-checkout",
  done: "stage-done",
};

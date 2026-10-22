/**
 * Airリザーブ（いしだ皮フ科）の設定を 2026-10-05 に画面から読み取って移したもの。
 * - レーン：リソースグループ「美容皮膚科」のリソース4件（メインレーンは医師のレーンと分かるよう名前に（医師）を付けた）
 * - メニュー：メニュー設定の35件（表示順・提供時間・開始時間単位・料金・同時予約受付可能数・関連リソース）
 *
 * 略称と色はAirリザーブにない項目なので、こちらで仮に付けた。設定画面から変更できる。
 * 名前に「使用しない」とあるメニューは、予約の選択肢から外した（active: false）。
 * 患者情報・予約は一切含まない。
 */
import type { Lane, Menu, MenuDuration } from "@/lib/domain/types";

export const AIR_LANES: Lane[] = [
  { id: "lane-main", name: "メインレーン（医師）", shortName: "メイン(医師)", order: 0, active: true },
  { id: "lane-1", name: "1番レーン(レーザー脱毛など)", shortName: "1番", order: 1, active: true },
  { id: "lane-3", name: "3番レーン針脱毛、ハイフ", shortName: "3番", order: 2, active: true },
  { id: "lane-4", name: "4番ネオボ撮影・麻酔・ゼオ説明", shortName: "4番", order: 3, active: true },
];

const M = "lane-main";
const L1 = "lane-1";
const L3 = "lane-3";
const L4 = "lane-4";
const ALL = [M, L1, L3, L4];

const fixed = (minutes: number): MenuDuration => ({ kind: "fixed", minutes });
const range = (min: number, max: number, step = 5): MenuDuration => ({ kind: "range", min, max, step });

type Row = [
  airId: string,
  name: string,
  abbr: string,
  duration: MenuDuration,
  startStepMin: number,
  laneIds: string[],
  color: string,
  extra?: Partial<Pick<Menu, "priceYen" | "capacity" | "defaultMinutes" | "active">>,
];

const ROWS: Row[] = [
  ["s000099B91", "シミまとめ標準20分", "シミ", fixed(20), 20, [M], "#0ea5e9"],
  ["s0000C1A4F", "シミ4個まで/男性/75歳以上/説明済照射のみ/ゼオ不要", "シミ4個", range(5, 60), 5, ALL, "#38bdf8"],
  ["s00009A192", "ほくろ", "ほくろ", fixed(20), 5, [M], "#a16207"],
  ["s000099BF0", "色素レーザー5/5使用しない11/3", "色素(旧)", fixed(10), 30, [M], "#0284c7", { active: false }],
  ["s000099DC1", "予約（メモに自由記載）", "予約", range(10, 90), 5, ALL, "#64748b", { capacity: 4 }],
  ["s000099DBF", "部分炭酸ガスフラクショナル", "部分CO2", range(10, 60), 30, [M], "#b45309"],
  ["s000099E62", "スネコス【再診】使用しない9/30", "スネコス再(旧)", fixed(15), 5, [M], "#db2777", { active: false }],
  ["s00009A0D8", "ヒアルロン酸", "ヒアル", range(5, 90), 5, [M], "#a855f7"],
  ["s000099E63", "スネコス【再診】", "スネコス再", fixed(15), 5, [M], "#db2777"],
  ["s00009A18A", "マッサージピール", "MPピール", fixed(20), 5, [L1, L3], "#f97316"],
  ["s00009A18B", "ミラノリピール", "ミラノ", fixed(20), 5, [L1, L3], "#fb923c"],
  ["s00009A18C", "サリチル酸マクロゴール", "サリチル", fixed(20), 5, [L1, L3], "#ea580c"],
  ["s0000C1A4E", "ボトックス初診標準20分", "BTX初", range(5, 30), 5, ALL, "#8b5cf6", { defaultMinutes: 20 }],
  ["s00009A18E", "ボトックス【再診】", "BTX再", fixed(10), 5, [M], "#7c3aed"],
  ["s00009A18F", "脂肪溶解【初診】", "脂肪溶解初", fixed(30), 5, [M], "#ca8a04"],
  ["s00009A191", "脂肪溶解【再診】", "脂肪溶解再", fixed(15), 5, [M], "#ca8a04"],
  ["s00009A3AE", "色素レーザー【再診】", "色素再", range(5, 360), 5, [M], "#0284c7"],
  ["s00009E6B7", "初診スネコスやクマ", "初診スネコス", fixed(30), 30, [M], "#be185d"],
  ["s0000A1344", "レーザー脱毛", "脱毛", range(5, 360), 5, [L1, L3], "#14b8a6"],
  ["s0000A1349", "ヴェル医師施術", "ヴェル医", fixed(10), 5, [M], "#e11d48"],
  ["s0000A134B", "ヴェル麻酔", "ヴェル麻酔", fixed(10), 5, [L1, L3, L4], "#a8a29e"],
  ["s0000A134C", "炭酸ガスフラクショナル麻酔", "CO2麻酔", fixed(10), 5, [L1, L3, L4], "#a8a29e"],
  ["s0000A43A3", "脱毛初診説明", "脱毛説明", fixed(15), 15, [L1, L3], "#0d9488"],
  ["s0000A7D2D", "全顔炭酸ガスフラクショナル", "全顔CO2", fixed(15), 5, [M, L1], "#92400e", { priceYen: 49500 }],
  ["s0000B54EA", "ヴェル看護師施術", "ヴェル看", fixed(15), 15, [L1, L3], "#f43f5e"],
  ["s0000B6B1C", "針脱毛", "針脱毛", range(5, 600), 30, [L1, L3, L4], "#f59e0b"],
  ["s0000B6B52", "ネオボ撮影＋頬麻酔", "ネオボ+麻酔", range(5, 60), 5, [L1, L3, L4], "#78716c"],
  ["s0000B6EB5", "トラネ注射", "トラネ", range(5, 90), 5, [L1, L3], "#6366f1"],
  ["s0000B6EB7", "フィルロード時間自由設定", "フィルロード", range(5, 60), 5, [M, L1, L3], "#10b981"],
  ["s0000BB7B7", "完全初診", "初診", range(10, 360), 5, [M, L1, L3], "#2563eb"],
  ["s0000C0E47", "ハイフ", "HIFU", range(5, 360), 5, [M, L1, L3], "#ef4444"],
  ["s0000C60FE", "予約不可", "予約不可", range(5, 360), 5, ALL, "#334155"],
  ["s0000CF1CB", "ニキビ・ニキビ跡", "ニキビ", range(10, 90), 30, [M], "#65a30d"],
  ["s0000D0B81", "ジュブアセル看護師施術", "ジュブ看", range(10, 30), 30, [L1, L3], "#06b6d4"],
  ["s0000D14AA", "ジュブアセル医師施術", "ジュブ医", range(5, 60), 5, [M], "#0891b2"],
];

export const AIR_MENUS: Menu[] = ROWS.map(([airId, name, abbr, duration, startStepMin, laneIds, color, extra], i) => ({
  id: `menu-${airId}`,
  name,
  abbr,
  duration,
  defaultMinutes: extra?.defaultMinutes ?? (duration.kind === "fixed" ? duration.minutes : duration.min),
  startStepMin,
  priceYen: extra?.priceYen ?? null,
  capacity: extra?.capacity ?? null,
  laneIds,
  color,
  order: i,
  active: extra?.active ?? true,
}));

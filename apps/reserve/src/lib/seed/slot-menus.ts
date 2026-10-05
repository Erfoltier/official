/**
 * Airリザーブの35件に足すメニュー（2026-10-05）。
 * - 院の「予約枠時間一覧」スプレッドシート：レーザー脱毛の部位ごと（男女）、看護師レーンの施術、ハイフの部位ごと、
 *   医師レーンの初診・再診の枠。所要時間はシートの「予約時間枠（案内～退出）」のまま。
 * - ホームページの料金表にあって、上のどちらにもない施術（所要時間はシートにないので仮。設定画面で直せる）。
 * Airリザーブから移したメニューと同じものは足さない（過去の予約がそのIDを使っているため）。
 * レーンはシートの決まり：医師＝メイン、看護師＝1番・3番、4番＝ネオボ撮影・麻酔・ゼオ説明。
 */
import type { LaneId, Menu, MenuDuration } from "@/lib/domain/types";

const M = "lane-main";
const L1 = "lane-1";
const L3 = "lane-3";
const L4 = "lane-4";
const NURSE = [L1, L3];

const fixed = (minutes: number): MenuDuration => ({ kind: "fixed", minutes });
const range = (min: number, max: number): MenuDuration => ({ kind: "range", min, max, step: 5 });

type Row = [name: string, abbr: string, duration: MenuDuration, laneIds: LaneId[], color: string, defaultMinutes?: number];

const HAIR_PARTS: [string, string, number, number][] = [
  // 部位, 略称, 男, 女
  ["下肢全部", "下肢", 90, 60],
  ["大腿", "大腿", 40, 30],
  ["下腿～足先", "下腿足", 40, 30],
  ["膝", "膝", 10, 10],
  ["下腿", "下腿", 30, 20],
  ["鼻下", "鼻下", 10, 10],
  ["顎", "顎", 10, 10],
  ["顎下", "顎下", 10, 10],
  ["鼻下＋顎＋顎下", "鼻顎顎下", 15, 15],
  ["鼻下＋顎", "鼻下顎", 10, 10],
  ["眉", "眉", 10, 10],
  ["前腕", "前腕", 20, 20],
  ["前腕～手先", "前腕手", 25, 25],
  ["へそ回り", "へそ", 10, 10],
  ["V", "V", 10, 10],
  ["IO", "IO", 20, 15],
  ["VIO", "VIO", 30, 20],
];

const HAIR: Row[] = [
  ...HAIR_PARTS.map(([part, ab, men]): Row => [`レーザー脱毛（男性） ${part}`, `脱毛男 ${ab}`, fixed(men), NURSE, "#0f766e"]),
  ...HAIR_PARTS.map(([part, ab, , women]): Row => [`レーザー脱毛（女性） ${part}`, `脱毛女 ${ab}`, fixed(women), NURSE, "#14b8a6"]),
];

const HIFU_PARTS: [string, string, number, number][] = [
  // 部位, 略称, スタンダード・引き締め, ライト
  ["顔＋顎下", "顔顎下", 45, 30],
  ["顔", "顔", 30, 20],
  ["頬", "頬", 15, 10],
  ["顎下", "顎下", 15, 10],
  ["首", "首", 15, 10],
];

const HIFU: Row[] = [
  ["ハイフ ナースカウンセリング", "HIFU CS", fixed(15), NURSE, "#ef4444"],
  ["ハイフ ドクター診察（ナース施術枠の最初の10分に重ねる）", "HIFU 診察", fixed(10), [M], "#ef4444"],
  ...HIFU_PARTS.map(([part, ab, std]): Row => [`ハイフ スタンダード・引き締め ${part}`, `HIFU ${ab}`, fixed(std), NURSE, "#ef4444"]),
  ...HIFU_PARTS.map(([part, ab, std]): Row => [`ハイフ オーダーメイド ${part}`, `HIFU OM ${ab}`, fixed(std + 15), NURSE, "#dc2626"]),
  ...HIFU_PARTS.map(([part, ab, , light]): Row => [`ハイフ ライト ${part}`, `HIFUライト ${ab}`, fixed(light), NURSE, "#f87171"]),
  ["頬または顎下の脂肪集中（1部位）", "脂肪集中", fixed(15), NURSE, "#f87171"],
];

const NURSE_ROWS: Row[] = [
  ["レーザーシャワー", "Lシャワー", fixed(15), NURSE, "#e879f9"],
  ["タイトニングレーザー", "タイトニング", fixed(15), NURSE, "#d946ef"],
  ["フィル・TAピンク 機械打ち（麻酔クリーム）", "フィル機械 麻ク", fixed(20), NURSE, "#10b981"],
  ["フィル・TAピンク 機械打ち（麻酔注射）", "フィル機械 麻注", fixed(15), NURSE, "#10b981"],
  ["フィル・TAピンク 手打ち（麻酔クリーム）", "フィル手 麻ク", fixed(25), NURSE, "#059669"],
  ["フィル・TAピンク 手打ち（麻酔注射）", "フィル手 麻注", fixed(20), NURSE, "#059669"],
  ["麻酔クリーム", "麻クリ", fixed(10), [L1, L3, L4], "#a8a29e"],
  ["ヴェルヴェット施術", "ヴェル", fixed(20), NURSE, "#f43f5e"],
  ["スーパーヴェルヴェット施術", "Sヴェル", fixed(20), NURSE, "#e11d48"],
  ["針脱毛 初診説明（レーザー脱毛と両方の希望もまとめて15分）", "針脱毛説明", fixed(15), NURSE, "#d97706"],
  ["ゼオ説明", "ゼオ説明", range(10, 30), [L4], "#78716c", 15],
  ["モニター経過診察のネオボ撮影", "モニター撮影", fixed(15), [L4], "#78716c"],
];

const DOCTOR_FIRST: Row[] = [
  ["初診 当日施術希望なし", "初診 施術なし", fixed(15), [M], "#2563eb"],
  ["初診 シミ（4個まで/男性/75歳以上/説明済照射のみ/ゼオ不要）", "初診シミ小", fixed(15), [M], "#0ea5e9"],
  ["初診 シミ", "初診シミ", fixed(20), [M], "#0ea5e9"],
  ["初診 シミ＋α（肝斑は除く）", "初診シミ+α", fixed(30), [M], "#0ea5e9"],
  ["初診 ほくろまとめ（15個まで）", "初診ほくろ15", fixed(20), [M], "#a16207"],
  ["初診 ほくろまとめ（20個以上）", "初診ほくろ20+", fixed(30), [M], "#a16207"],
  ["初診 イソトレチノイン", "初診イソトレ", fixed(15), [M], "#65a30d"],
  ["初診 ヒアルロン酸 ほうれい線", "初診ヒアル ほうれい", fixed(30), [M], "#a855f7"],
  ["初診 ヒアルロン酸 クマ（希望ほぼ確定）", "初診ヒアル クマ確", fixed(40), [M], "#a855f7"],
  ["初診 ヒアルロン酸 クマ（希望不明）", "初診ヒアル クマ?", fixed(30), [M], "#a855f7"],
  ["初診 ヒアルロン酸 その他の部位", "初診ヒアル 他", fixed(30), [M], "#a855f7"],
  ["初診 クマ（適応不明）", "初診クマ", fixed(20), [M], "#be185d"],
  ["初診 頭皮注射", "初診頭皮", fixed(20), [M], "#4f46e5"],
  ["初診 フラクショナルレーザー・ニキビ跡相談", "初診フラ", fixed(20), [M], "#b45309"],
  ["初診 ボトックス・多汗ボトックス", "初診BTX", fixed(20), [M], "#8b5cf6"],
  ["初診 その他（お悩み1種類）", "初診 他1", fixed(20), [M], "#2563eb"],
  ["初診 その他（お悩み2種類以上）", "初診 他2+", fixed(30), [M], "#2563eb"],
  ["初診 モニター希望（医師診察のみ）", "初診モニター", range(15, 20), [M], "#2563eb", 15],
];

const DOCTOR_REVISIT: Row[] = [
  ["再診 薬の相談", "再診 薬", fixed(15), [M], "#64748b"],
  ["再診 イソトレチノイン", "再診イソ", fixed(10), [M], "#65a30d"],
  ["再診 色素レーザー", "再診色素", fixed(10), [M], "#0284c7"],
  ["再診 フラクショナル 全顔", "再診フラ全顔", fixed(15), [M], "#92400e"],
  ["再診 フラクショナル 部分", "再診部分フラ", fixed(10), [M], "#b45309"],
  ["再診 スネコス", "再診スネ", fixed(15), [M], "#db2777"],
  ["再診 ボトックス", "再診BTX", fixed(10), [M], "#7c3aed"],
  ["再診 汗ボトックス", "再診汗BTX", fixed(15), [M], "#7c3aed"],
  ["再診 頭皮注射", "再診頭皮", fixed(15), [M], "#4f46e5"],
  ["モニター経過診察（医師）", "モニター診察", fixed(15), [M], "#64748b"],
];

/** ホームページの料金表の施術（所要時間は仮） */
const HOMEPAGE: Row[] = [
  ["ダーマペン", "ダーマペン", range(15, 60), [M, L1, L3], "#f472b6", 30],
  ["サブシジョン", "サブシジョン", range(10, 60), [M], "#9a3412", 20],
  ["TCAピーリング（ニキビ凹み跡）", "TCA", range(10, 30), [M], "#c2410c", 15],
  ["ベビーコラーゲン注射", "ベビコラ", range(10, 30), [M], "#c084fc", 20],
  ["ジュベルックボリューム", "ジュベルック", range(10, 40), [M], "#9333ea", 20],
  ["リトゥオ（ブナジュ）医師施術", "リトゥオ医", range(5, 60), [M], "#0891b2", 20],
  ["口元たるみ集中治療（部分HIFU＋エクステンダーマスター）", "口元たるみ", range(20, 60), [M, L1, L3], "#dc2626", 30],
  ["毛髪成長因子 頭皮注射（HARG+）", "HARG", range(10, 40), [M], "#4f46e5", 20],
  ["AGA・FAGA 内服外用の相談", "AGA相談", range(10, 30), [M], "#4338ca", 15],
  ["ネオボワール肌診断のみ", "ネオボ診断", range(10, 30), [L4], "#78716c", 15],
  ["Qスイッチルビーレーザー（シミ）", "Qルビー", range(5, 60), [M], "#0ea5e9", 15],
];

const ROWS: Row[] = [...DOCTOR_FIRST, ...DOCTOR_REVISIT, ...NURSE_ROWS, ...HIFU, ...HAIR, ...HOMEPAGE];

/** 足す順に order を振る（既存の35件の後ろ） */
export const SLOT_MENUS: Menu[] = ROWS.map(([name, abbr, duration, laneIds, color, defaultMinutes], i) => ({
  id: `menu-x${String(i + 1).padStart(3, "0")}`,
  name,
  abbr,
  duration,
  defaultMinutes: defaultMinutes ?? (duration.kind === "fixed" ? duration.minutes : duration.min),
  startStepMin: 5,
  priceYen: null,
  capacity: null,
  laneIds,
  color,
  order: 100 + i,
  active: true,
}));

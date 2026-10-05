/**
 * 試作用のダミーデータ。実在の患者情報は一切含まない。
 * 日付ごとに同じ予約が再現されるよう、日付から作った乱数で生成する。
 */
import type { ClinicSettings, Lane, Patient, Reservation, Treatment } from "@/lib/domain/types";
import { toIso, weekdayOf } from "@/lib/domain/time";

export const DEMO_CLINIC: ClinicSettings = {
  name: "デモ皮フ科",
  timeZone: "Asia/Tokyo",
  dayStartMin: 9 * 60 + 30,
  dayEndMin: 19 * 60,
  slotMin: 5,
};

export const DEMO_LANES: Lane[] = [
  { id: "lane-main", name: "メインレーン", shortName: "メイン", order: 0 },
  { id: "lane-1", name: "1番レーン（レーザー脱毛など）", shortName: "1番 脱毛", order: 1 },
  { id: "lane-3", name: "3番レーン（針脱毛・ハイフ）", shortName: "3番 針・HIFU", order: 2 },
  { id: "lane-4", name: "4番レーン（撮影・麻酔・説明）", shortName: "4番 撮影・麻酔", order: 3 },
];

export const DEMO_TREATMENTS: Treatment[] = [
  { id: "t-consult", name: "診察", abbr: "診察", durationMin: 10, color: "#64748b" },
  { id: "t-check", name: "経過確認", abbr: "経過", durationMin: 5, color: "#94a3b8" },
  { id: "t-botox", name: "ボトックス注射", abbr: "BTX", durationMin: 10, color: "#8b5cf6" },
  { id: "t-hyal", name: "ヒアルロン酸注入", abbr: "ヒアル", durationMin: 15, color: "#a855f7" },
  { id: "t-pico", name: "ピコトーニング", abbr: "ピコ", durationMin: 15, color: "#0ea5e9" },
  { id: "t-hair-face", name: "医療脱毛（顔）", abbr: "脱毛顔", durationMin: 20, color: "#14b8a6" },
  { id: "t-hair-body", name: "医療脱毛（全身）", abbr: "脱毛全身", durationMin: 60, color: "#0d9488" },
  { id: "t-needle", name: "針脱毛", abbr: "針脱毛", durationMin: 30, color: "#f59e0b" },
  { id: "t-hifu", name: "ハイフ", abbr: "HIFU", durationMin: 45, color: "#ef4444" },
  { id: "t-photo", name: "写真撮影", abbr: "撮影", durationMin: 5, color: "#78716c" },
  { id: "t-numb", name: "麻酔クリーム", abbr: "麻酔", durationMin: 30, color: "#d6d3d1" },
  { id: "t-zo", name: "ゼオスキン説明", abbr: "ゼオ説明", durationMin: 15, color: "#ec4899" },
  { id: "t-derma", name: "ダーマペン", abbr: "ダーマ", durationMin: 30, color: "#f97316" },
];

/** レーンごとに入りやすい施術 */
const LANE_TREATMENTS: Record<string, string[]> = {
  "lane-main": ["t-consult", "t-check", "t-botox", "t-hyal", "t-consult", "t-check"],
  "lane-1": ["t-hair-face", "t-hair-body", "t-pico", "t-hair-face", "t-derma"],
  "lane-3": ["t-needle", "t-hifu", "t-needle"],
  "lane-4": ["t-photo", "t-numb", "t-zo", "t-photo", "t-check"],
};

const FAMILY = ["佐藤", "鈴木", "高橋", "田中", "伊藤", "渡辺", "山本", "中村", "小林", "加藤", "吉田", "山田", "佐々木", "松本", "井上", "木村", "林", "清水", "山崎", "森"];
const FAMILY_KANA = ["サトウ", "スズキ", "タカハシ", "タナカ", "イトウ", "ワタナベ", "ヤマモト", "ナカムラ", "コバヤシ", "カトウ", "ヨシダ", "ヤマダ", "ササキ", "マツモト", "イノウエ", "キムラ", "ハヤシ", "シミズ", "ヤマザキ", "モリ"];
const GIVEN = ["花子", "美咲", "結衣", "陽菜", "葵", "さくら", "凛", "芽依", "優花", "七海", "健太", "翔"];
const GIVEN_KANA = ["ハナコ", "ミサキ", "ユイ", "ヒナ", "アオイ", "サクラ", "リン", "メイ", "ユウカ", "ナナミ", "ケンタ", "ショウ"];

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function buildDemoPatients(): Patient[] {
  const rnd = mulberry32(42);
  const out: Patient[] = [];
  for (let i = 0; i < 120; i++) {
    const f = Math.floor(rnd() * FAMILY.length);
    const g = Math.floor(rnd() * GIVEN.length);
    out.push({
      id: `p-${String(i + 1).padStart(4, "0")}`,
      chartNo: String(10001 + i),
      name: `${FAMILY[f]} ${GIVEN[g]}`,
      kana: `${FAMILY_KANA[f]} ${GIVEN_KANA[g]}`,
      // 架空の番号帯（0120-000-xxx）を使う
      phone: `0120-000-${String(100 + i).slice(-3)}`,
      lineUserId: rnd() < 0.45 ? `Udemo${hashString(String(i)).toString(16).padStart(8, "0")}` : undefined,
      caution: rnd() < 0.08,
    });
  }
  return out;
}

/** 指定日のダミー予約。水曜・祝日（デモでは日曜も）を混む日にする */
export function buildDemoReservations(date: string, patients: Patient[], nowIso: string): Reservation[] {
  const rnd = mulberry32(hashString(date));
  const busy = [0, 3].includes(weekdayOf(date));
  const treatmentById = new Map(DEMO_TREATMENTS.map((t) => [t.id, t]));
  const out: Reservation[] = [];
  let n = 0;

  for (const lane of DEMO_LANES) {
    let t = DEMO_CLINIC.dayStartMin + Math.floor(rnd() * 3) * 5;
    while (t < DEMO_CLINIC.dayEndMin - 10) {
      // 昼休み
      if (t >= 13 * 60 && t < 14 * 60) {
        t = 14 * 60;
        continue;
      }
      const gapChance = busy ? 0.18 : 0.5;
      if (rnd() < gapChance) {
        t += 5 * (1 + Math.floor(rnd() * 4));
        continue;
      }
      const options = LANE_TREATMENTS[lane.id];
      const tr = treatmentById.get(options[Math.floor(rnd() * options.length)])!;
      const extraPick = rnd() < 0.15 ? DEMO_TREATMENTS[Math.floor(rnd() * 3)] : undefined;
      const extra = extraPick?.id === tr.id ? undefined : extraPick;
      const dur = tr.durationMin + (extra?.durationMin ?? 0);
      const end = Math.min(t + dur, DEMO_CLINIC.dayEndMin);
      const patient = patients[Math.floor(rnd() * patients.length)];
      const r = rnd();
      out.push({
        id: `r-${date}-${++n}`,
        patientId: patient.id,
        laneId: lane.id,
        treatmentIds: extra ? [tr.id, extra.id] : [tr.id],
        startAt: toIso(date, t),
        endAt: toIso(date, end),
        status: r < 0.05 ? "cancelled" : "booked",
        memo: rnd() < 0.1 ? "前回赤み強め。出力控えめで" : undefined,
        reminder: { status: "pending" },
        version: 1,
        createdAt: nowIso,
        updatedAt: nowIso,
      });
      // ときどき同じレーンに重ねて入れる（2名同時の施術）
      if (rnd() < 0.08) t += 5;
      else t = end;
    }
  }
  return out;
}

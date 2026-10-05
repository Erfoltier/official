/**
 * 試作用のダミーデータ。患者・予約は架空のもので、実在の患者情報は一切含まない。
 * レーンとメニューはAirリザーブから移した設定（airreserve-import.ts）を使う。
 * 日付ごとに同じ予約が再現されるよう、日付から作った乱数で生成する。
 */
import type { ClinicSettings, Lane, Menu, Patient, Reservation } from "@/lib/domain/types";
import { menuDurationOptions } from "@/lib/domain/types";
import { toIso, weekdayOf } from "@/lib/domain/time";

export const DEMO_CLINIC: ClinicSettings = {
  name: "デモ皮フ科",
  timeZone: "Asia/Tokyo",
  dayStartMin: 9 * 60 + 30,
  dayEndMin: 19 * 60,
  slotMin: 5,
};

const FAMILY = ["佐藤", "鈴木", "高橋", "田中", "伊藤", "渡辺", "山本", "中村", "小林", "加藤", "吉田", "山田", "佐々木", "松本", "井上", "木村", "林", "清水", "山崎", "森"];
const FAMILY_KANA = ["サトウ", "スズキ", "タカハシ", "タナカ", "イトウ", "ワタナベ", "ヤマモト", "ナカムラ", "コバヤシ", "カトウ", "ヨシダ", "ヤマダ", "ササキ", "マツモト", "イノウエ", "キムラ", "ハヤシ", "シミズ", "ヤマザキ", "モリ"];
const FAMILY_ROMAJI = ["Sato", "Suzuki", "Takahashi", "Tanaka", "Ito", "Watanabe", "Yamamoto", "Nakamura", "Kobayashi", "Kato", "Yoshida", "Yamada", "Sasaki", "Matsumoto", "Inoue", "Kimura", "Hayashi", "Shimizu", "Yamazaki", "Mori"];
const GIVEN = ["花子", "美咲", "結衣", "陽菜", "葵", "さくら", "凛", "芽依", "優花", "七海", "健太", "翔"];
const GIVEN_KANA = ["ハナコ", "ミサキ", "ユイ", "ヒナ", "アオイ", "サクラ", "リン", "メイ", "ユウカ", "ナナミ", "ケンタ", "ショウ"];
const GIVEN_ROMAJI = ["Hanako", "Misaki", "Yui", "Hina", "Aoi", "Sakura", "Rin", "Mei", "Yuka", "Nanami", "Kenta", "Sho"];

/** 漢字以外を含む氏名の例（Airリザーブでは登録できなかった形） */
const MIXED_NAMES: [name: string, kana: string, alt?: string][] = [
  ["山田 Anna", "ヤマダ アンナ", "Yamada Anna"],
  ["さくら 田中", "サクラ タナカ"],
  ["LEE Min-ji", "イ ミンジ", "이민지"],
  ["佐藤 ゆい", "サトウ ユイ", "Sato Yui"],
  ["Emily Johnson", "エミリー ジョンソン"],
  ["高橋 エマ", "タカハシ エマ", "Takahashi Emma"],
  ["王 美玲", "オウ メイリン", "Wang Meiling"],
  ["鈴木 Mari（旧姓 森）", "スズキ マリ", "Suzuki Mari / 森"],
];

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
    const id = `p-${String(i + 1).padStart(4, "0")}`;
    const chartNo = String(10001 + i);
    // 架空の番号帯（0120-000-xxx）を使う
    const phone = `0120-000-${String(100 + i).slice(-3)}`;
    const lineUserId = rnd() < 0.45 ? `Udemo${hashString(String(i)).toString(16).padStart(8, "0")}` : undefined;
    const caution = rnd() < 0.08;
    if (i % 15 === 7) {
      const [name, kana, nameAlt] = MIXED_NAMES[Math.floor(i / 15) % MIXED_NAMES.length];
      out.push({ id, chartNo, name, kana, nameAlt, phone, lineUserId, caution });
      continue;
    }
    const f = Math.floor(rnd() * FAMILY.length);
    const g = Math.floor(rnd() * GIVEN.length);
    out.push({
      id,
      chartNo,
      name: `${FAMILY[f]} ${GIVEN[g]}`,
      kana: `${FAMILY_KANA[f]} ${GIVEN_KANA[g]}`,
      nameAlt: rnd() < 0.3 ? `${FAMILY_ROMAJI[f]} ${GIVEN_ROMAJI[g]}` : undefined,
      phone,
      lineUserId,
      caution,
    });
  }
  return out;
}

/** デモで使いにくいメニュー（自由記載・予約不可）は出にくくする */
const RARE_MENUS = new Set(["予約（メモに自由記載）", "予約不可"]);

/** 範囲指定のメニューは、現実的な長さ（60分まで）から選ぶ */
function demoMinutes(menu: Menu, rnd: () => number): number {
  const options = menuDurationOptions(menu.duration).filter((m) => m <= 60);
  if (menu.duration.kind === "fixed" || options.length === 0) return menu.defaultMinutes;
  const short = options.filter((m) => m <= 30);
  const pool = short.length > 0 && rnd() < 0.7 ? short : options;
  return pool[Math.floor(rnd() * pool.length)];
}

/** 指定日のダミー予約。水曜・日曜を混む日にする */
export function buildDemoReservations(
  date: string,
  patients: Patient[],
  lanes: Lane[],
  menus: Menu[],
  clinic: ClinicSettings,
  nowIso: string,
): Reservation[] {
  const rnd = mulberry32(hashString(date));
  const busy = [0, 3].includes(weekdayOf(date));
  const out: Reservation[] = [];
  let n = 0;

  for (const lane of lanes.filter((l) => l.active)) {
    const laneMenus = menus.filter((m) => m.active && (m.laneIds.length === 0 || m.laneIds.includes(lane.id)));
    if (laneMenus.length === 0) continue;
    let t = clinic.dayStartMin + Math.floor(rnd() * 3) * 5;
    while (t < clinic.dayEndMin - 10) {
      if (t >= 13 * 60 && t < 14 * 60) {
        t = 14 * 60; // 昼休み
        continue;
      }
      if (rnd() < (busy ? 0.18 : 0.5)) {
        t += 5 * (1 + Math.floor(rnd() * 4));
        continue;
      }
      const menu = laneMenus[Math.floor(rnd() * laneMenus.length)];
      if (RARE_MENUS.has(menu.name) && rnd() < 0.85) continue;
      const end = Math.min(t + demoMinutes(menu, rnd), clinic.dayEndMin);
      const patient = patients[Math.floor(rnd() * patients.length)];
      out.push({
        id: `r-${date}-${++n}`,
        patientId: patient.id,
        laneId: lane.id,
        menuIds: [menu.id],
        startAt: toIso(date, t),
        endAt: toIso(date, end),
        status: rnd() < 0.05 ? "cancelled" : "booked",
        memo: rnd() < 0.1 ? "前回赤み強め。出力控えめで" : undefined,
        reminder: { status: "pending" },
        version: 1,
        createdAt: nowIso,
        updatedAt: nowIso,
      });
      // ときどき同じレーンに重ねて入れる（2名同時の施術）
      t = rnd() < 0.08 ? t + 5 : end;
    }
  }
  return out;
}

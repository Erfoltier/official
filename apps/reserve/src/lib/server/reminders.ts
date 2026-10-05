import "server-only";

import { INACTIVE_STATUSES } from "@/lib/domain/types";
import { getDayBundle } from "@/lib/server/store";

/**
 * 外部の送信プログラム（前日リマインド等）向けの、指定日の予約一覧。
 *
 * 形式は「1予約＝1件」で、送信に必要な最小限の項目だけを返す。
 * 項目名を変えると外部プログラムが壊れるので、変更するときは schemaVersion を上げる。
 */
export interface ReminderFeed {
  schemaVersion: 1;
  date: string;
  clinicName: string;
  generatedAt: string;
  items: ReminderItem[];
}

export interface ReminderItem {
  reservationId: string;
  /** この版のときに送った、と書き戻すために使う */
  version: number;
  startAt: string;
  endAt: string;
  laneName: string;
  treatmentNames: string[];
  patient: {
    id: string;
    name: string;
    lineUserId: string | null;
    phone: string | null;
    email: string | null;
  };
  reminderStatus: "pending" | "sent" | "skipped" | "failed";
}

export function buildReminderFeed(date: string): ReminderFeed {
  const day = getDayBundle(date);
  const lanes = new Map(day.lanes.map((l) => [l.id, l]));
  const treatments = new Map(day.treatments.map((t) => [t.id, t]));
  const patients = new Map(day.patients.map((p) => [p.id, p]));

  const items: ReminderItem[] = day.reservations
    .filter((r) => !INACTIVE_STATUSES.has(r.status))
    .map((r) => {
      const p = patients.get(r.patientId)!;
      return {
        reservationId: r.id,
        version: r.version,
        startAt: r.startAt,
        endAt: r.endAt,
        laneName: lanes.get(r.laneId)?.name ?? "",
        treatmentNames: r.treatmentIds.map((id) => treatments.get(id)?.name ?? ""),
        patient: {
          id: p.id,
          name: p.name,
          lineUserId: p.lineUserId ?? null,
          phone: p.phone ?? null,
          email: p.email ?? null,
        },
        reminderStatus: r.reminder.status,
      };
    });

  return {
    schemaVersion: 1,
    date,
    clinicName: day.clinic.name,
    generatedAt: new Date().toISOString(),
    items,
  };
}

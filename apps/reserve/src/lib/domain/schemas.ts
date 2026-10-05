import { z } from "zod";
import { RESERVATION_STATUSES } from "@/lib/domain/types";
import { isDateString } from "@/lib/domain/time";

const id = z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/);
const isoDateTime = z.iso.datetime({ offset: true });

export const dateParam = z.string().refine(isDateString, "日付の形式が正しくありません");

export const createReservationSchema = z.object({
  patientId: id,
  laneId: id,
  treatmentIds: z.array(id).min(1).max(5),
  startAt: isoDateTime,
  endAt: isoDateTime,
  memo: z.string().max(500).optional(),
});

export const updateReservationSchema = z
  .object({
    version: z.number().int().positive(),
    laneId: id.optional(),
    startAt: isoDateTime.optional(),
    endAt: isoDateTime.optional(),
    status: z.enum(RESERVATION_STATUSES).optional(),
    treatmentIds: z.array(id).min(1).max(5).optional(),
    memo: z.string().max(500).optional(),
  })
  .strict();

export const reminderResultSchema = z
  .object({ status: z.enum(["sent", "skipped", "failed"]) })
  .strict();

export const reservationIdParam = id;

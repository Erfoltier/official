import { z } from "zod";
import { RESERVATION_STATUSES } from "@/lib/domain/types";
import { isDateString } from "@/lib/domain/time";

const id = z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/);
const isoDateTime = z.iso.datetime({ offset: true });

export const dateParam = z.string().refine(isDateString, "日付の形式が正しくありません");

/** "2026-10" の形の月 */
export const monthParam = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

export const createReservationSchema = z.object({
  patientId: id,
  laneId: id,
  menuIds: z.array(id).min(1).max(5),
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
    menuIds: z.array(id).min(1).max(5).optional(),
    memo: z.string().max(500).optional(),
  })
  .strict();

export const reminderResultSchema = z
  .object({ status: z.enum(["sent", "skipped", "failed"]) })
  .strict();

export const reservationIdParam = id;

const shortText = (max: number) => z.string().max(max);

const patientFieldsSchema = {
  kana: shortText(120).optional(),
  nameAlt: shortText(120).optional(),
  phone: shortText(30).optional(),
  email: shortText(200).optional(),
  chartNo: shortText(30).optional(),
  birthDate: shortText(10).optional(),
  caution: z.boolean().optional(),
  cautionNote: shortText(1000).optional(),
  memo: shortText(4000).optional(),
};

export const createPatientSchema = z.object({ name: shortText(120), ...patientFieldsSchema }).strict();

export const updatePatientSchema = z
  .object({ version: z.number().int().positive(), name: shortText(120).optional(), ...patientFieldsSchema })
  .strict();

export const versionOnlySchema = z.object({ version: z.number().int().positive() }).strict();

export const laneSchema = z
  .object({
    name: shortText(80).optional(),
    shortName: shortText(30).optional(),
    active: z.boolean().optional(),
  })
  .strict();

const minutes = z.number().int().min(0).max(1440);

export const menuSchema = z
  .object({
    name: shortText(160).optional(),
    abbr: shortText(30).optional(),
    duration: z
      .discriminatedUnion("kind", [
        z.object({ kind: z.literal("fixed"), minutes }).strict(),
        z.object({ kind: z.literal("range"), min: minutes, max: minutes, step: minutes }).strict(),
      ])
      .optional(),
    defaultMinutes: minutes.optional(),
    startStepMin: minutes.optional(),
    priceYen: z.number().int().nullable().optional(),
    capacity: z.number().int().nullable().optional(),
    laneIds: z.array(id).max(50).optional(),
    color: z.string().max(7).optional(),
    active: z.boolean().optional(),
  })
  .strict();

export const reorderSchema = z.object({ ids: z.array(id).min(1).max(500) }).strict();
export const idParam = id;

export const visitNoteSchema = z
  .object({
    note: z.string().max(8000),
    skincare: z.array(z.string().max(120)).max(30),
    version: z.number().int().min(0),
  })
  .strict();

export const loginSchema = z.object({ staffId: id, pin: z.string().max(16) }).strict();

const role = z.enum(["admin", "doctor", "nurse", "reception"]);

export const createStaffSchema = z.object({ name: z.string().max(60), role, pin: z.string().max(16) }).strict();

export const updateStaffSchema = z
  .object({ name: z.string().max(60).optional(), role: role.optional(), active: z.boolean().optional(), pin: z.string().max(16).optional() })
  .strict();

export const deletePatientSchema = z.object({ version: z.number().int().positive(), reason: z.string().max(200) }).strict();

export const mergePatientsSchema = z
  .object({ keepId: id, dupId: id, keepVersion: z.number().int().positive(), dupVersion: z.number().int().positive() })
  .strict();

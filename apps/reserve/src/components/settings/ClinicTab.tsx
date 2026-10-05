"use client";

import { useState } from "react";
import type { ClinicSettings } from "@/lib/domain/types";
import { formatHm } from "@/lib/domain/time";
import { saveClinic } from "@/components/calendar/api";
import styles from "./settings.module.css";

const toHm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const fromHm = (s: string) => {
  const [h, m] = s.split(":").map(Number);
  return h * 60 + m;
};

/** 院名・診療時間（カレンダーに出す時間帯）・予約の刻み */
export function ClinicTab({
  clinic,
  canEdit,
  onChanged,
  notify,
  fail,
}: {
  clinic: ClinicSettings;
  canEdit: boolean;
  onChanged: () => Promise<void>;
  notify: (text: string) => void;
  fail: (err: unknown) => void;
}) {
  const [name, setName] = useState(clinic.name);
  const [start, setStart] = useState(toHm(clinic.dayStartMin));
  const [end, setEnd] = useState(toHm(clinic.dayEndMin === 1440 ? 1435 : clinic.dayEndMin));
  const [slot, setSlot] = useState(clinic.slotMin);
  const [busy, setBusy] = useState(false);

  const s = start ? fromHm(start) : NaN;
  const e = end ? fromHm(end) : NaN;
  const valid = Number.isFinite(s) && Number.isFinite(e) && e - s >= 60 && s % 5 === 0 && e % 5 === 0 && name.trim() !== "";
  const changed = name !== clinic.name || s !== clinic.dayStartMin || e !== clinic.dayEndMin || slot !== clinic.slotMin;

  const save = async () => {
    setBusy(true);
    try {
      await saveClinic({ name, dayStartMin: s, dayEndMin: e, slotMin: slot });
      await onChanged();
      notify("診療時間を保存しました。カレンダーに反映されます");
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={styles.clinic}>
      <p className={styles.lead}>
        カレンダーに表示する時間帯と、予約を入れるときの時間の刻みです。院ごとに変えられます。
        時間外に入っている予約も、カレンダーには表示されます。
      </p>
      <div className={styles.clinicCard}>
        <label className={styles.field}>
          <span>院名</span>
          <input className={styles.input} value={name} maxLength={40} onChange={(ev) => setName(ev.target.value)} disabled={!canEdit} />
        </label>
        <div className={styles.timeRow}>
          <label className={styles.field}>
            <span>開院時間</span>
            <input className={styles.input} type="time" step={300} value={start} onChange={(ev) => setStart(ev.target.value)} disabled={!canEdit} />
          </label>
          <span className={styles.timeSep}>〜</span>
          <label className={styles.field}>
            <span>閉院時間</span>
            <input className={styles.input} type="time" step={300} value={end} onChange={(ev) => setEnd(ev.target.value)} disabled={!canEdit} />
          </label>
        </div>
        <label className={styles.field}>
          <span>予約の刻み</span>
          <select className={styles.input} value={slot} onChange={(ev) => setSlot(Number(ev.target.value))} disabled={!canEdit}>
            {[5, 10, 15, 30].map((m) => (
              <option key={m} value={m}>
                {m}分
              </option>
            ))}
          </select>
        </label>
        <p className={styles.hint} data-invalid={!valid || undefined}>
          {valid
            ? `カレンダーに ${formatHm(s)}〜${formatHm(e)}（${Math.round(((e - s) / 60) * 10) / 10}時間）を表示し、${slot}分刻みで予約を入れます`
            : "閉院時間は開院時間の1時間以上あとにしてください（5分単位）"}
        </p>
        {canEdit && (
          <div className={styles.actions}>
            <button className={styles.primary} onClick={save} disabled={!valid || !changed || busy}>
              保存
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

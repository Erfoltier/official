"use client";

import { useState } from "react";
import type { DayBundle, Reservation, ReservationStatus } from "@/lib/domain/types";
import { STATUS_LABEL } from "@/lib/domain/types";
import { formatDateJa, formatHm, minutesOfDay, durationMin } from "@/lib/domain/time";
import { displayName } from "./names";
import styles from "./calendar.module.css";

const FLOW: ReservationStatus[] = ["booked", "arrived", "in_treatment", "checkout", "done"];

const REMINDER_LABEL = {
  pending: "未送信",
  sent: "送信済み",
  skipped: "送信しない",
  failed: "送信失敗",
} as const;

interface Props {
  bundle: DayBundle;
  reservation: Reservation;
  maskNames: boolean;
  onClose: () => void;
  onStatus: (s: ReservationStatus) => void;
  onMemo: (memo: string) => void;
  onEditPatient: () => void;
}

export function DetailPanel({ bundle, reservation: r, maskNames, onClose, onStatus, onMemo, onEditPatient }: Props) {
  const patient = bundle.patients.find((p) => p.id === r.patientId);
  const lane = bundle.lanes.find((l) => l.id === r.laneId);
  const menus = r.menuIds.map((id) => bundle.menus.find((t) => t.id === id)).filter(Boolean);
  const [memo, setMemo] = useState(r.memo ?? "");
  const start = minutesOfDay(r.startAt);
  const end = minutesOfDay(r.endAt);

  return (
    <aside className={styles.panel} aria-label="予約の詳細">
      <div className={styles.panelHead}>
        <div>
          <div className={styles.panelName}>
            {patient?.caution && <span className={styles.caution}>!</span>}
            {displayName(patient, maskNames)}
          </div>
          {!maskNames && patient && (
            <div className={styles.panelSub}>
              {patient.kana}
              {patient.nameAlt && ` / ${patient.nameAlt}`}・診察券 {patient.chartNo}
              {patient.m3ChartNo && `・M3 ${patient.m3ChartNo}`}
            </div>
          )}
        </div>
        <button className={styles.iconBtn} onClick={onClose} aria-label="閉じる">
          ×
        </button>
      </div>

      {!maskNames && patient?.caution && patient.cautionNote && (
        <div className={styles.cautionNote}>
          <span className={styles.caution}>!</span>
          {patient.cautionNote}
        </div>
      )}
      <button type="button" className={styles.linkBtn} onClick={onEditPatient}>
        患者情報を見る・編集する
      </button>

      <dl className={styles.facts}>
        <dt>日時</dt>
        <dd>
          {formatDateJa(bundle.date)} {formatHm(start)}–{formatHm(end)}（{durationMin(r.startAt, r.endAt)}分）
        </dd>
        <dt>レーン</dt>
        <dd>{lane?.name}</dd>
        <dt>施術</dt>
        <dd>
          {menus.map((t) => (
            <span key={t!.id} className={styles.treatChip} style={{ ["--c" as string]: t!.color }}>
              {t!.name}
            </span>
          ))}
        </dd>
        {(r.createdBy || r.updatedBy) && (
          <>
            <dt>担当記録</dt>
            <dd>
              {[
                r.createdBy && `登録：${r.createdBy.name}`,
                r.updatedBy && r.updatedBy.id !== r.createdBy?.id && `最終更新：${r.updatedBy.name}`,
              ]
                .filter(Boolean)
                .join(" ／ ")}
            </dd>
          </>
        )}
        <dt>リマインド</dt>
        <dd>{REMINDER_LABEL[r.reminder.status]}</dd>
      </dl>

      <div className={styles.panelSection}>
        <div className={styles.sectionLabel}>状態</div>
        <div className={styles.statusRow}>
          {FLOW.map((s) => (
            <button
              key={s}
              className={styles.statusBtn}
              data-active={r.status === s || undefined}
              onClick={() => onStatus(s)}
            >
              {STATUS_LABEL[s]}
            </button>
          ))}
        </div>
        <div className={styles.statusRow}>
          <button
            className={styles.statusBtn}
            data-danger
            data-active={r.status === "cancelled" || undefined}
            onClick={() => onStatus("cancelled")}
          >
            キャンセル
          </button>
          <button
            className={styles.statusBtn}
            data-danger
            data-active={r.status === "no_show" || undefined}
            onClick={() => onStatus("no_show")}
          >
            無断キャンセル
          </button>
        </div>
      </div>

      <div className={styles.panelSection}>
        <div className={styles.sectionLabel}>連絡</div>
        <div className={styles.contactRow}>
          <button
            className={styles.btn}
            disabled
            title={patient?.lineUserId ? "LINE連携は今後実装します" : "この患者はLINE未連携です"}
          >
            {patient?.lineUserId ? "LINEで連絡（準備中）" : "LINE未連携"}
          </button>
          {patient?.phone && !maskNames && (
            <a className={styles.btn} href={`tel:${patient.phone.replace(/[^\d+]/g, "")}`}>
              電話 {patient.phone}
            </a>
          )}
        </div>
      </div>

      <div className={styles.panelSection}>
        <label className={styles.sectionLabel} htmlFor="memo">
          メモ
        </label>
        <textarea
          id="memo"
          className={styles.memo}
          value={memo}
          maxLength={500}
          rows={3}
          onChange={(e) => setMemo(e.target.value)}
          onBlur={() => memo !== (r.memo ?? "") && onMemo(memo)}
          placeholder="施術の注意点など"
        />
      </div>

      <p className={styles.hint}>予約枠をドラッグで時間・レーン変更、下端のつまみで長さ変更（5分刻み）</p>
    </aside>
  );
}

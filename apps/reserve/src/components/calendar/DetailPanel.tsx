"use client";

import { useState } from "react";
import type { DayBundle, Reservation, ReservationStatus } from "@/lib/domain/types";
import { REQUEST_ID_RE } from "@/lib/domain/bookingRequest";
import { STATUS_LABEL } from "@/lib/domain/types";
import { addDays, formatDateJa, formatHm, minutesOfDay, durationMin } from "@/lib/domain/time";
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
  onRequestId: (requestId: string) => void;
  /** 日時・レーンの変更（別の日への移動も可） */
  onReschedule: (to: { date: string; startMin: number; endMin: number; laneId: string }) => Promise<boolean>;
  onEditPatient: () => void;
}

export function DetailPanel({ bundle, reservation: r, maskNames, onClose, onStatus, onMemo, onRequestId, onReschedule, onEditPatient }: Props) {
  const patient = bundle.patients.find((p) => p.id === r.patientId);
  const lane = bundle.lanes.find((l) => l.id === r.laneId);
  const menus = r.menuIds.map((id) => bundle.menus.find((t) => t.id === id)).filter(Boolean);
  const [memo, setMemo] = useState(r.memo ?? "");
  const [requestId, setRequestId] = useState(r.requestId ?? "");
  const [editingRequestId, setEditingRequestId] = useState(false);
  const requestIdValid = requestId === "" || REQUEST_ID_RE.test(requestId);
  const start = minutesOfDay(r.startAt);
  const end = minutesOfDay(r.endAt);
  const [resched, setResched] = useState<{ date: string; start: number; dur: number; laneId: string } | null>(null);
  const [moving, setMoving] = useState(false);
  const { clinic } = bundle;
  const startOptions: number[] = [];
  if (resched) {
    for (let m = Math.min(clinic.dayStartMin, start); m < Math.max(clinic.dayEndMin, end); m += clinic.slotMin) startOptions.push(m);
    if (!startOptions.includes(resched.start)) startOptions.push(resched.start);
    startOptions.sort((a, b) => a - b);
  }
  const durOptions: number[] = [];
  for (let m = 5; m <= 240; m += 5) durOptions.push(m);
  const curDur = durationMin(r.startAt, r.endAt);
  if (!durOptions.includes(curDur)) durOptions.push(curDur);

  const saveRequestId = () => {
    if (!requestIdValid) return;
    if (requestId !== (r.requestId ?? "")) onRequestId(requestId);
    setEditingRequestId(false);
  };

  return (
    <aside className={styles.panel} aria-label="予約の詳細">
      <div className={styles.panelHead}>
        <div>
          <div className={styles.panelName}>
            {patient?.caution && <span className={styles.caution}>!</span>}
            {displayName(patient, maskNames)}
          </div>
          {!maskNames && patient && (
            <>
              <div className={styles.panelSub}>
                {patient.kana}
                {patient.nameAlt && ` / ${patient.nameAlt}`}
              </div>
              <div className={styles.idLine}>
                <span>診察券 {patient.chartNo}</span>
                {patient.m3ChartNo && <span>M3 {patient.m3ChartNo}</span>}
                {editingRequestId ? (
                  <span className={styles.idEdit}>
                    <input
                      className={styles.idInput}
                      value={requestId}
                      maxLength={40}
                      placeholder="予約申請ID"
                      autoComplete="off"
                      spellCheck={false}
                      autoFocus
                      aria-label="予約申請ID"
                      aria-invalid={!requestIdValid || undefined}
                      onChange={(e) => setRequestId(e.target.value.normalize("NFKC").replace(/\s/g, ""))}
                      onKeyDown={(e) => e.key === "Enter" && saveRequestId()}
                      onBlur={saveRequestId}
                    />
                  </span>
                ) : (
                  <button type="button" className={styles.idBtn} onClick={() => setEditingRequestId(true)} title="予約申請ID（LINE予約フォーム）を入力・変更">
                    {r.requestId ? `申請 ${r.requestId}` : "＋申請ID"} <span aria-hidden>✎</span>
                  </button>
                )}
              </div>
              {!requestIdValid && <p className={styles.error}>予約申請IDは英数字・ハイフンで入力してください</p>}
            </>
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
          {formatDateJa(bundle.date)} {formatHm(start)}–{formatHm(end)}（{curDur}分）
          {!resched && (
            <button
              type="button"
              className={styles.miniBtn}
              onClick={() => setResched({ date: bundle.date, start, dur: curDur, laneId: r.laneId })}
            >
              日時を変更
            </button>
          )}
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

      {resched && (
        <div className={styles.reschedule}>
          <div className={styles.sectionLabel}>日時・レーンを変更</div>
          <div className={styles.reschedGrid}>
            <label>
              日付
              <input
                type="date"
                className={styles.input}
                value={resched.date}
                onChange={(e) => e.target.value && setResched({ ...resched, date: e.target.value })}
              />
            </label>
            <label>
              開始
              <select className={styles.input} value={resched.start} onChange={(e) => setResched({ ...resched, start: Number(e.target.value) })}>
                {startOptions.map((m) => (
                  <option key={m} value={m}>
                    {formatHm(m)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              時間
              <select className={styles.input} value={resched.dur} onChange={(e) => setResched({ ...resched, dur: Number(e.target.value) })}>
                {durOptions.sort((a, b) => a - b).map((m) => (
                  <option key={m} value={m}>
                    {m}分
                  </option>
                ))}
              </select>
            </label>
            <label>
              レーン
              <select className={styles.input} value={resched.laneId} onChange={(e) => setResched({ ...resched, laneId: e.target.value })}>
                {bundle.lanes.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.shortName}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className={styles.reschedQuick}>
            {[-7, 7, 14, 28].map((d) => (
              <button key={d} type="button" className={styles.miniBtn} onClick={() => setResched({ ...resched, date: addDays(resched.date, d) })}>
                {d < 0 ? `${-d / 7}週前` : `${d / 7}週後`}
              </button>
            ))}
          </div>
          <p className={styles.reschedPreview}>
            → {formatDateJa(resched.date)} {formatHm(resched.start)}–{formatHm(resched.start + resched.dur)}・
            {bundle.lanes.find((l) => l.id === resched.laneId)?.shortName}
          </p>
          <div className={styles.pasteActions}>
            <button type="button" className={styles.btn} onClick={() => setResched(null)} disabled={moving}>
              やめる
            </button>
            <button
              type="button"
              className={styles.primaryBtn}
              disabled={moving || resched.start + resched.dur > 1440}
              onClick={async () => {
                setMoving(true);
                const ok = await onReschedule({ date: resched.date, startMin: resched.start, endMin: resched.start + resched.dur, laneId: resched.laneId });
                setMoving(false);
                if (ok) setResched(null);
              }}
            >
              この日時に変更
            </button>
          </div>
        </div>
      )}

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

"use client";

import { useEffect, useState, type CSSProperties } from "react";
import type { DayBundle, PatientFile, Reservation, ReservationStatus } from "@/lib/domain/types";
import { fetchFiles } from "./api";
import { FileUploader } from "@/components/files/FileUploader";
import { EstimateDialog } from "@/components/estimates/EstimateDialog";
import { ChartDialog } from "@/components/charts/ChartDialog";
import { ConsentDialog } from "@/components/consents/ConsentDialog";
import { ReservationEditDialog } from "@/components/reservations/ReservationEditDialog";
import { RichTextEditor } from "@/components/richtext/RichTextEditor";
import { FileThumbs } from "@/components/files/FileThumbs";
import { REQUEST_ID_RE } from "@/lib/domain/bookingRequest";
import { INACTIVE_STATUSES } from "@/lib/domain/types";
import { stageOf } from "./stages";
import { StageTimeInput, parseHm } from "./StageTime";
import { formatDateJa, formatHm, minutesOfDay, durationMin } from "@/lib/domain/time";
import { displayName } from "./names";
import styles from "./calendar.module.css";

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
  /** 院で決めた状態を選ぶ */
  onStage: (stageId: string, min?: number) => void;
  /** 状態はそのままで、変えた時刻だけ直す */
  onStageTime: (min: number) => void;
  /** 自由入力の一言（空で消す）。状態とは別に出す */
  onFreeNote: (text: string) => void;
  onMemo: (memo: string) => void;
  onRequestId: (requestId: string) => void;
  /** 日時・レーンの変更（別の日への移動も可） */
  /** 「予約を変更」で日時・レーン・メニューを変えた、または取り消した */
  onChanged: (next: Reservation, kind: "changed" | "cancelled") => void;
  onEditPatient: () => void;
  /** ファイルを削除できる（院長・管理者と受付） */
  canManage?: boolean;
}

export function DetailPanel({ bundle, reservation: r, maskNames, onClose, onStatus, onStage, onStageTime, onFreeNote, onMemo, onRequestId, onChanged, onEditPatient, canManage }: Props) {
  const patient = bundle.patients.find((p) => p.id === r.patientId);
  const lane = bundle.lanes.find((l) => l.id === r.laneId);
  const menus = r.menuIds.map((id) => bundle.menus.find((t) => t.id === id)).filter(Boolean);
  const [memo, setMemo] = useState(r.memo ?? "");
  const [requestId, setRequestId] = useState(r.requestId ?? "");
  const [editingRequestId, setEditingRequestId] = useState(false);
  const sv = stageOf(r, bundle.stages);
  const freeStage = bundle.stages.find((s) => s.free && s.active && !s.deleted);
  const [freeText, setFreeText] = useState<string | null>(null);
  const [estimateOpen, setEstimateOpen] = useState(false);
  // 閉じた状態から開いたときだけスライドインする（別の予約に切り替えたときは動かさない）。
  // 描画の時点で前のパネルがまだ画面にあれば「切り替え」
  const [entering] = useState(() => typeof document !== "undefined" && !document.querySelector("[data-detail-panel]"));
  // 開いた直後は押せないようにする（予約を押した指の動きが、出てきたボタンを押したことにならないように）
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setArmed(true), 400);
    return () => window.clearTimeout(t);
  }, []);
  const [chartOpen, setChartOpen] = useState(false);
  const [consentOpen, setConsentOpen] = useState(false);
  /** 状態を変えた時刻（空欄なら押した時刻） */
  const [stageTime, setStageTime] = useState("");
  const stageMin = parseHm(stageTime);
  const [files, setFiles] = useState<PatientFile[] | null>(null);
  useEffect(() => {
    let alive = true;
    fetchFiles(r.patientId, bundle.date).then(
      (items) => alive && setFiles(items),
      () => alive && setFiles([]),
    );
    return () => {
      alive = false;
    };
  }, [r.patientId, bundle.date]);
  const requestIdValid = requestId === "" || REQUEST_ID_RE.test(requestId);
  const start = minutesOfDay(r.startAt);
  const end = minutesOfDay(r.endAt);
  const [editOpen, setEditOpen] = useState(false);
  const curDur = durationMin(r.startAt, r.endAt);

  const saveRequestId = () => {
    if (!requestIdValid) return;
    if (requestId !== (r.requestId ?? "")) onRequestId(requestId);
    setEditingRequestId(false);
  };

  return (
    <aside
      className={styles.panel}
      aria-label="予約の詳細"
      data-detail-panel
      data-enter={entering || undefined}
      style={armed ? undefined : { pointerEvents: "none" }}
    >
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
      <div className={styles.panelLinks}>
        <button type="button" className={styles.linkBtn} onClick={onEditPatient}>
          患者情報を見る・編集する
        </button>
        {patient && !patient.deleted && (
          <span className={styles.panelLinkBtns}>
            <button type="button" className={styles.estimateBtn} onClick={() => setChartOpen(true)}>
              🩺 カルテ
            </button>
            <button type="button" className={styles.estimateBtn} onClick={() => setConsentOpen(true)}>
              📄 同意書
            </button>
            <button type="button" className={styles.estimateBtn} onClick={() => setEstimateOpen(true)}>
              📝 見積/会計
            </button>
          </span>
        )}
      </div>
      {consentOpen && patient && (
        <ConsentDialog
          patient={patient}
          reservation={{ id: r.id, menuIds: r.menuIds, menuNames: menus.map((m) => m!.name) }}
          onClose={() => setConsentOpen(false)}
        />
      )}
      {chartOpen && patient && (
        <ChartDialog
          patientId={patient.id}
          patientName={patient.name}
          date={bundle.date}
          reservationId={r.id}
          menuNames={menus.map((m) => m!.name)}
          onClose={() => {
            setChartOpen(false);
            // カルテの画面で写真を足したり消したりしたかもしれないので読み直す
            fetchFiles(r.patientId, bundle.date).then(setFiles, () => {});
          }}
        />
      )}
      {estimateOpen && patient && (
        <EstimateDialog
          patientId={patient.id}
          patientName={patient.name}
          reservationId={r.id}
          initialMenuIds={r.menuIds}
          onClose={() => setEstimateOpen(false)}
          onSaved={() => {}}
        />
      )}

      <dl className={styles.facts}>
        <dt>日時</dt>
        <dd>
          {formatDateJa(bundle.date)} {formatHm(start)}–{formatHm(end)}（{curDur}分）
          {!INACTIVE_STATUSES.has(r.status) && (
            <button type="button" className={styles.miniBtn} onClick={() => setEditOpen(true)}>
              予約を変更
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

      {editOpen && (
        <ReservationEditDialog
          reservation={r}
          patientName={patient?.name ?? ""}
          canCancel={!!canManage}
          onClose={() => setEditOpen(false)}
          onSaved={(next, kind) => {
            setEditOpen(false);
            onChanged(next, kind);
          }}
        />
      )}

      {!maskNames && (
        <div className={styles.panelSection}>
          <div className={styles.sectionLabel}>
            写真・同意書など（{formatDateJa(bundle.date)}）{files && files.length > 0 && ` ${files.length}件`}
          </div>
          {files && files.length > 0 && (
            <div className={styles.panelFiles}>
              <FileThumbs files={files} size="m" canDelete onDeleted={(id) => setFiles((fs) => fs?.filter((f) => f.id !== id) ?? null)} />
            </div>
          )}
          <FileUploader
            patientId={r.patientId}
            date={bundle.date}
            reservationId={r.id}
            onUploaded={(f) => setFiles((fs) => [...(fs ?? []), f])}
          />
        </div>
      )}

      <div className={styles.panelSection}>
        <div className={styles.stageHead}>
          <div className={styles.sectionLabel}>状態</div>
          <StageTimeInput className={styles.stageTime} value={stageTime} onChange={setStageTime} />
          {stageMin !== undefined && sv.stage && r.stageAt && !INACTIVE_STATUSES.has(r.status) && (
            <button
              type="button"
              className={styles.btn}
              onClick={() => {
                onStageTime(stageMin);
                setStageTime("");
              }}
            >
              時刻だけ直す
            </button>
          )}
        </div>
        <div className={styles.stageGrid}>
          {bundle.stages
            .filter((s) => !s.free && !s.deleted && (s.active || s.id === sv.stage?.id))
            .map((s) => {
              const on = !INACTIVE_STATUSES.has(r.status) && sv.stage?.id === s.id;
              return (
                <button
                  key={s.id}
                  type="button"
                  className={styles.stageBtn}
                  style={{ "--sc": s.color } as CSSProperties}
                  data-active={on || undefined}
                  aria-pressed={on}
                  onClick={() => {
                    onStage(s.id, stageMin);
                    setStageTime("");
                  }}
                >
                  {s.label}
                  {on && sv.at && <small className={styles.stageBtnAt}>{sv.at}〜</small>}
                </button>
              );
            })}
          {freeStage && (
            <button
              type="button"
              className={styles.stageBtn}
              data-free
              style={{ "--sc": freeStage.color } as CSSProperties}
              data-active={!!r.stageText || undefined}
              aria-pressed={!!r.stageText}
              title="ほかの状態と一緒に出せる自由な一言（例：15時までに出たい）"
              onClick={() => setFreeText(r.stageText ?? "")}
            >
              {r.stageText ? `✎ ${r.stageText}` : `＋${freeStage.label}`}
            </button>
          )}
        </div>
        {freeText !== null && (
          <div className={styles.freeRow}>
            <input
              className={styles.input}
              value={freeText}
              maxLength={20}
              autoFocus
              placeholder="例：15時までに出たい"
              aria-label="自由入力"
              onChange={(e) => setFreeText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  onFreeNote(freeText.trim());
                  setFreeText(null);
                }
              }}
            />
            <button
              type="button"
              className={styles.primaryBtn}
              onClick={() => {
                onFreeNote(freeText.trim());
                setFreeText(null);
              }}
            >
              決定
            </button>
            {r.stageText && (
              <button
                type="button"
                className={styles.btn}
                onClick={() => {
                  onFreeNote("");
                  setFreeText(null);
                }}
              >
                消す
              </button>
            )}
            <button type="button" className={styles.btn} onClick={() => setFreeText(null)}>
              やめる
            </button>
          </div>
        )}
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
        <div className={styles.sectionLabel}>メモ</div>
        <RichTextEditor
          value={memo}
          onChange={setMemo}
          maxLength={500}
          rows={3}
          onBlur={() => memo !== (r.memo ?? "") && onMemo(memo)}
          placeholder="施術の注意点など"
          ariaLabel="予約メモ"
        />
      </div>

      <p className={styles.hint}>予約枠をドラッグで時間・レーン変更、下端のつまみで長さ変更（5分刻み）</p>
    </aside>
  );
}

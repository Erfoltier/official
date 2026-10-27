"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { ageSexText } from "@/lib/domain/age";
import { CautionInline } from "@/components/patients/CautionInline";
import type { DayBundle, PatientFile, Reservation, ReservationStatus } from "@/lib/domain/types";
import { ApiError, fetchFiles, fetchLineChat, linkLineFromReservation, remindNow } from "./api";
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

/** リマインドの回の表示（d1 → 前日、d0 → 当日、d3 → 3日前） */
function roundLabel(round?: string): string {
  const n = Number(round?.slice(1));
  return n === 0 ? "当日" : n === 1 ? "前日" : Number.isFinite(n) ? `${n}日前` : "";
}

const REMINDER_REASON: Record<string, string> = {
  optout: "送信不要の患者",
  no_contact: "送信先なし",
  line_quota: "LINE の残り通数不足",
  line_token: "LINE チャネルアクセストークンを確認",
  line_limit: "LINE の送信上限",
  mail_failed: "メール送信失敗",
  request_mismatch: "申請の氏名・生年月日が患者と不一致",
};

/** リマインドの状態は「未送信／LINE送信済／メール送信済／送信失敗」の4つで見せる（送らなかった来院は未送信＋理由） */
function reminderLabel(m: { status: string; channel?: string | null }): string {
  if (m.status === "sent") return m.channel === "email" ? "メール送信済" : "LINE送信済";
  if (m.status === "failed") return "送信失敗";
  return "未送信";
}

interface Props {
  bundle: DayBundle;
  reservation: Reservation;
  maskNames: boolean;
  onClose: () => void;
  /** reason：キャンセルの理由（スタッフのコメント。患者画面の「キャンセル履歴」に出る） */
  onStatus: (s: ReservationStatus, reason?: string) => void;
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
  /** 患者画面を開く。line: true なら「LINEと連携」の候補をすぐ出す */
  onEditPatient: (opts?: { line?: boolean }) => void;
  /** 注意事項を書き足す・直す（患者の基本情報の注意事項と同じ欄） */
  onCaution?: (text: string) => Promise<boolean>;
  /** ファイルを削除できる（院長・管理者と受付） */
  canManage?: boolean;
}

export function DetailPanel({ bundle, reservation: r, maskNames, onClose, onStatus, onStage, onStageTime, onFreeNote, onMemo, onRequestId, onChanged, onEditPatient, onCaution, canManage }: Props) {
  const patient = bundle.patients.find((p) => p.id === r.patientId);
  const lane = bundle.lanes.find((l) => l.id === r.laneId);
  const menus = r.menuIds.map((id) => bundle.menus.find((t) => t.id === id)).filter(Boolean);
  const [memo, setMemo] = useState(r.memo ?? "");
  const [reminding, setReminding] = useState(false);
  const [lineLinked, setLineLinked] = useState(false);
  /** LINE のチャットを開く先（連携済みの患者だけ、開いたときに読む。押してすぐ新しいタブを開けるように） */
  const [lineChatOf, setLineChatOf] = useState<{ pid: string; displayName: string; chatUrl: string | null; listUrl: string } | null>(null);
  const [lineNoteOf, setLineNoteOf] = useState<{ pid: string; text: string } | null>(null);
  // 別の患者に切り替えた直後に、前の患者のチャットを開かないよう、患者が合うときだけ使う
  const lineChat = lineChatOf && lineChatOf.pid === patient?.id ? lineChatOf : null;
  const lineNote = lineNoteOf && lineNoteOf.pid === patient?.id ? lineNoteOf.text : null;
  useEffect(() => {
    if (!patient?.lineUserId || maskNames) return;
    let alive = true;
    const pid = patient.id;
    fetchLineChat(pid).then((v) => alive && setLineChatOf({ pid, ...v }), () => {});
    return () => {
      alive = false;
    };
  }, [patient?.id, patient?.lineUserId, maskNames]);
  const openLineChat = () => {
    if (!lineChat) return;
    if (lineChat.chatUrl) {
      window.open(lineChat.chatUrl, "_blank", "noopener");
      return;
    }
    // 対応表にまだない人：チャット一覧を開き、表示名をコピーしておく（検索欄に貼るだけで見つかる）
    window.open(lineChat.listUrl, "_blank", "noopener");
    if (lineChat.displayName) {
      navigator.clipboard?.writeText(lineChat.displayName).then(
        () => setLineNoteOf({ pid: lineChat.pid, text: `LINE の表示名「${lineChat.displayName}」をコピーしました。開いたチャット一覧の検索欄に貼り付けてください` }),
        () => setLineNoteOf({ pid: lineChat.pid, text: `LINE の表示名は「${lineChat.displayName}」です。開いたチャット一覧で探してください` }),
      );
    }
  };
  /** 予約キャンセルは誤タッチで消えないよう確認を挟む。無断キャンセルはその中のチェックで分ける */
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [noShow, setNoShow] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [requestId, setRequestId] = useState(r.requestId ?? "");
  const [editingRequestId, setEditingRequestId] = useState(false);
  const sv = stageOf(r, bundle.stages);
  const [copied, setCopied] = useState(false);
  /** 予約確定の連絡文（LINE のチャットに貼る）。初めての来院で問診票がまだなら、問診票の入口を足す */
  const confirmationText = () => {
    const d = new Date(`${bundle.date}T00:00:00Z`);
    const week = ["日", "月", "火", "水", "木", "金", "土"][d.getUTCDay()];
    const menuNames = menus.map((m) => m!.publicName || m!.name).join("・");
    const lines = [
      `${patient?.name ?? ""} 様`,
      "",
      "ご予約が確定しました。",
      `日時：${d.getUTCMonth() + 1}月${d.getUTCDate()}日（${week}）${formatHm(start)}`,
      ...(menuNames ? [`メニュー：${menuNames}`] : []),
    ];
    if (r.questionnaire === "missing" && bundle.questionnaireUrl) {
      lines.push("", "初めてご来院の方は、ご来院前に問診票のご記入をお願いいたします。", bundle.questionnaireUrl);
    }
    lines.push("", "ご来院をお待ちしております。", bundle.clinic.docName || bundle.clinic.name);
    return lines.join("\n");
  };
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
      data-ui-zoom
      aria-label="予約の詳細"
      data-detail-panel
      data-enter={entering || undefined}
      style={armed ? undefined : { pointerEvents: "none" }}
    >
      <div className={styles.panelHead}>
        <div>
          <div className={styles.panelName}>
            {patient?.caution && <span className={styles.caution}>!</span>}
            <span className={styles.nameText}>{displayName(patient, maskNames)}</span>
            {!maskNames && patient?.needsReview && (
              <span
                className={styles.subGap}
                style={{ color: "var(--danger, #c0392b)", fontSize: "0.8em", whiteSpace: "nowrap" }}
                title="Airリザーブからの取り込み時に、既存の患者と結びつけられず新規登録した患者です。同じ人がいれば患者画面で統合し、別の人なら「設定 → リマインド」の「Airリザーブの取り込み」で確認済みにしてください"
              >
                要確認
              </span>
            )}
            {!maskNames && patient && (
              <span className={styles.nameSide}>
                <CautionInline note={patient.cautionNote} onSave={onCaution} />
                <span className={styles.idSlot}>
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
                    <button type="button" className={styles.idBtn} onClick={() => setEditingRequestId(true)} title="予約申請ID（LINE予約フォーム）を入力・編集">
                      {r.requestId ? `申請 ${r.requestId}` : "＋申請ID"} <span aria-hidden>✎</span>
                    </button>
                  )}
                  {r.questionnaire && (
                    <span
                      className={styles.subGap}
                      title={r.questionnaire === "done" ? "問診票が届いています（患者画面で確認できます）" : "初めての来院で、問診票がまだ届いていません"}
                      style={r.questionnaire === "missing" ? { color: "var(--danger, #c0392b)" } : undefined}
                    >
                      {r.questionnaire === "done" ? "問診票 記入済" : "問診票 未記入"}
                    </span>
                  )}
                  {!editingRequestId && r.requestLine && (
                    <span
                      className={styles.subGap}
                      title={
                        r.requestLine === "ok"
                          ? "リマインドは、この申請を送った LINE に届きます"
                          : r.requestLine === "mismatch"
                            ? "申請の氏名・生年月日がこの患者と一致しません。予約申請IDを確認してください（LINE では送信しません）"
                            : "この予約申請IDの LINE が見つかりません（LINE では送信しません）"
                      }
                      style={r.requestLine === "ok" ? undefined : { color: "var(--danger, #c0392b)" }}
                    >
                      {r.requestLine === "ok" ? "LINE（申込者）" : r.requestLine === "mismatch" ? "⚠ 申請と患者が不一致" : "LINE 不明"}
                    </span>
                  )}
                  {!editingRequestId && r.requestLine === "ok" && patient && !patient.lineUserId && !lineLinked && (
                    <button
                      type="button"
                      className={styles.idBtn}
                      title="この申請の LINE を患者に紐付けます。電話・窓口で取った予約にも LINE でリマインドが届くようになります"
                      onClick={async () => {
                        if (!window.confirm(`申請の氏名・生年月日が「${patient.name}」さんと一致しています。\nこの LINE を患者に紐付けます。よろしいですか？\n（家族が代理で申し込んだ場合は、紐付けないでください）`)) return;
                        try {
                          await linkLineFromReservation(r.id);
                          setLineLinked(true);
                          window.alert("LINE を紐付けました");
                        } catch (err) {
                          window.alert(err instanceof ApiError ? err.message : "紐付けできませんでした");
                        }
                      }}
                    >
                      ＋患者に紐付け
                    </button>
                  )}
                </span>
              </span>
            )}
          </div>
          {!maskNames && patient && (
            <>
              <div className={styles.panelSub}>
                {patient.kana}
                {patient.nameAlt && ` / ${patient.nameAlt}`}
                {ageSexText(patient) && <span className={styles.subGap}>{ageSexText(patient)}</span>}
                {patient.chartNo && <span className={styles.subGap}>診察券 {patient.chartNo}</span>}
                {patient.m3ChartNo && patient.m3ChartNo !== patient.chartNo && <span className={styles.subGap}>M3 {patient.m3ChartNo}</span>}
              </div>
              {!requestIdValid && <p className={styles.error}>予約申請IDは英数字・ハイフンで入力してください</p>}
            </>
          )}
        </div>
        <button className={styles.iconBtn} onClick={onClose} aria-label="閉じる">
          ×
        </button>
      </div>

      <div className={styles.panelLinks}>
        <span className={styles.panelLinkBtns}>
          <button type="button" className={styles.estimateBtn} onClick={() => onEditPatient()}>
            👤 患者情報の表示・編集
          </button>
          {!INACTIVE_STATUSES.has(r.status) && (
            <button type="button" className={styles.estimateBtn} onClick={() => setEditOpen(true)}>
              🗓 予約を変更
            </button>
          )}
          {!INACTIVE_STATUSES.has(r.status) && (
            <button
              type="button"
              className={styles.estimateBtn}
              data-danger
              onClick={() => {
                setNoShow(false);
                setCancelReason("");
                setConfirmCancel(true);
              }}
            >
              ✕ 予約キャンセル
            </button>
          )}
        </span>
        {patient && !patient.deleted && (
          <span className={styles.panelLinkBtns}>
            <button type="button" className={styles.estimateBtn} onClick={() => setChartOpen(true)}>
              🩺 カルテ
            </button>
            <button type="button" className={styles.estimateBtn} onClick={() => setConsentOpen(true)}>
              📄 同意書
            </button>
            <button type="button" className={styles.estimateBtn} onClick={() => setEstimateOpen(true)}>
              📝 見積・会計
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

      <div className={styles.copyRow}>
        <button
          type="button"
          className={styles.idBtn}
          title="LINE のチャットに貼る、予約確定の連絡文をコピーします（日時・メニュー、初めての方には問診票の入口）"
          onClick={async () => {
            const text = confirmationText();
            try {
              await navigator.clipboard.writeText(text);
              setCopied(true);
              window.setTimeout(() => setCopied(false), 2000);
            } catch {
              window.prompt("コピーできなかったので、下の文を選んでコピーしてください", text);
            }
          }}
        >
          {copied ? "コピーしました ✓" : "確定連絡文をコピー"}
        </button>
      </div>
      <dl className={styles.facts}>
        <dt>日時</dt>
        <dd>
          {formatDateJa(bundle.date)} {formatHm(start)}–{formatHm(end)}（{curDur}分）
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
        <dd>
          {reminderLabel(r.reminder)}
          {r.reminder.status === "sent" && r.reminder.round && `（${roundLabel(r.reminder.round)}）`}
          {r.reminder.status !== "sent" && r.reminder.reason && `（${REMINDER_REASON[r.reminder.reason] ?? r.reminder.reason}）`}
          {!["cancelled", "no_show"].includes(r.status) && (
            <button
              type="button"
              className={styles.linkBtn}
              style={{ marginLeft: 8 }}
              disabled={reminding}
              onClick={async () => {
                if (!window.confirm("この予約のリマインドを今すぐ送信します。よろしいですか？")) return;
                setReminding(true);
                try {
                  const res = await remindNow(r.id);
                  window.alert(`送信しました（${res.channel === "line" ? "LINE" : "メール"}）`);
                } catch (err) {
                  window.alert(err instanceof ApiError ? err.message : "送信できませんでした");
                } finally {
                  setReminding(false);
                }
              }}
            >
              {reminding ? "送信中…" : "今すぐ送る"}
            </button>
          )}
        </dd>
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
              時刻のみ修正
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
              title="ほかの状態と併せて表示できる一言メモ（例：15時までに出たい）"
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
                削除
              </button>
            )}
            <button type="button" className={styles.btn} onClick={() => setFreeText(null)}>
              キャンセル
            </button>
          </div>
        )}
        {(r.status === "cancelled" || r.status === "no_show") && (
          <div className={styles.restoreBar} role="status">
            <span>
              この予約は{r.status === "cancelled" ? "キャンセル" : "無断キャンセル"}です。
              {r.cancelReason && <>（理由：{r.cancelReason}）</>}
            </span>
            <button
              type="button"
              className={styles.btn}
              onClick={() => {
                if (!window.confirm("この予約を「予約」に戻します。よろしいですか？")) return;
                const booked = bundle.stages.find((st) => st.phase === "booked" && st.active && !st.deleted);
                if (booked) onStage(booked.id);
                else onStatus("booked");
              }}
            >
              予約に戻す
            </button>
          </div>
        )}
        {confirmCancel && (
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="confirm-status-title"
            style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.35)", display: "grid", placeItems: "center", padding: 16 }}
            onClick={() => setConfirmCancel(false)}
          >
            <div
              style={{ background: "var(--surface, #fff)", color: "var(--text, #222)", borderRadius: 12, padding: "20px 22px", maxWidth: 360, width: "100%", boxShadow: "0 10px 30px rgba(0,0,0,0.25)" }}
              onClick={(e) => e.stopPropagation()}
            >
              <p id="confirm-status-title" style={{ margin: "0 0 18px", fontSize: "1.05em", lineHeight: 1.6 }}>
                {displayName(patient, maskNames)}さんの予約を<b>{noShow ? "無断キャンセル" : "キャンセル"}</b>にします。よろしいですか？
              </p>
              <label style={{ display: "flex", alignItems: "center", gap: 8, margin: "0 0 18px", minHeight: 44, cursor: "pointer" }}>
                <input type="checkbox" checked={noShow} onChange={(e) => setNoShow(e.target.checked)} style={{ width: 20, height: 20 }} />
                無断キャンセル
              </label>
              <label style={{ display: "block", margin: "0 0 18px" }}>
                <span style={{ display: "block", fontSize: "0.9em", marginBottom: 4 }}>キャンセルの理由（任意）</span>
                <textarea
                  className={styles.input}
                  value={cancelReason}
                  maxLength={200}
                  rows={2}
                  placeholder="例：体調不良のため、日を改めて連絡するとのこと"
                  onChange={(e) => setCancelReason(e.target.value)}
                  style={{ width: "100%", resize: "vertical" }}
                />
              </label>
              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                <button type="button" className={styles.btn} style={{ minWidth: 96, minHeight: 44 }} autoFocus onClick={() => setConfirmCancel(false)}>
                  いいえ
                </button>
                <button
                  type="button"
                  className={styles.statusBtn}
                  data-danger
                  data-active
                  style={{ minWidth: 96, minHeight: 44 }}
                  onClick={() => {
                    setConfirmCancel(false);
                    onStatus(noShow ? "no_show" : "cancelled", cancelReason);
                  }}
                >
                  確定
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className={styles.panelSection}>
        <div className={styles.sectionLabel}>連絡</div>
        <div className={styles.contactRow}>
          {patient?.lineUserId && !maskNames ? (
            <button type="button" className={styles.btn} disabled={!lineChat} onClick={openLineChat} title="LINE 公式アカウントの管理画面で、この患者とのチャットを新しいタブで開きます">
              LINEで連絡 ↗
            </button>
          ) : maskNames ? (
            <button className={styles.btn} disabled>
              {patient?.lineUserId ? "LINE連携済み" : "LINE未連携"}
            </button>
          ) : (
            <button type="button" className={styles.btn} onClick={() => onEditPatient({ line: true })} title="押すと患者画面で LINE と連携できます">
              LINE未連携 → 連携する
            </button>
          )}
          {patient?.phone && !maskNames && (
            <a className={styles.btn} href={`tel:${patient.phone.replace(/[^\d+]/g, "")}`}>
              電話 {patient.phone}
            </a>
          )}
        </div>
        {lineNote && <p className={styles.hint}>{lineNote}</p>}
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

      <p className={styles.hint}>予約枠をドラッグすると時間・レーンを、下端のつまみで長さを変更できます（5分刻み）。</p>
    </aside>
  );
}

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ChartDrug, ChartEntry, Patient, PatientFile, StaffPublic } from "@/lib/domain/types";
import { ApiError, createChart, deleteChart, fetchCharts, fetchFiles, fetchMe, fetchPatient, updateChart, updatePatient } from "@/components/calendar/api";
import { usePref } from "@/components/calendar/usePref";
import { RichTextEditor } from "@/components/richtext/RichTextEditor";
import { FileThumbs } from "@/components/files/FileThumbs";
import { FileUploader } from "@/components/files/FileUploader";
import { ChartCard } from "./ChartCard";
import { QuestionnaireAnswers } from "@/components/questionnaires/QuestionnaireAnswers";
import { conditionHints } from "./chartHints";
import styles from "./charts.module.css";

/** よく使う部位（すぐ押せる）と、展開して選ぶ部位 */
const AREAS_MAIN = ["顔", "頬", "首", "VIO", "二の腕", "背中"];
const AREAS_MORE = ["全顔", "額", "眉間", "目尻", "目の下", "鼻", "口周り", "顎", "顎下", "デコルテ", "脇", "腕", "手", "腹部", "お尻", "脚", "膝下", "頭皮"];
const ANESTHESIA = ["なし", "麻酔クリーム", "局所麻酔注射", "冷却"];
const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");

interface Props {
  patientId: string;
  patientName: string;
  /** 施術日（YYYY-MM-DD） */
  date: string;
  /** 予約から開いたとき：その予約と、施術名の候補になるメニュー */
  reservationId?: string;
  menuNames?: string[];
  /** 見るだけ（削除された患者など） */
  readOnly?: boolean;
  onClose(): void;
  /** 記入・変更・削除のあと（呼び出し元の一覧を読み直す） */
  onChanged?(): void;
}

/** その日のカルテ（施術記録）：記入済みの一覧と、記入・変更の欄。写真はその日のファイル */
export function ChartDialog(props: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const [entries, setEntries] = useState<ChartEntry[] | null>(null);
  const [files, setFiles] = useState<PatientFile[]>([]);
  const [me, setMe] = useState<StaffPublic | null>(null);
  const [patient, setPatient] = useState<Patient | null>(null);
  const [editing, setEditing] = useState<ChartEntry | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { patientId, date, onChanged } = props;

  const load = useCallback(async () => {
    try {
      const [all, fs] = await Promise.all([fetchCharts(patientId), fetchFiles(patientId, date)]);
      const today = all.filter((c) => c.date === date);
      setEntries(today);
      setFiles(fs);
      return today;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "カルテを読み込めませんでした");
      return [];
    }
  }, [patientId, date]);

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
    fetchMe().then(setMe, () => {});
    fetchPatient(patientId).then((d) => setPatient(d.patient), () => {});
    // 開いたときに読み込む
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load().then((today) => {
      // まだ何も書いていない日は、すぐ書けるように記入欄を開く
      if (today.length === 0 && !props.readOnly) setEditing("new");
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  const changed = async () => {
    setEditing(null);
    await load();
    onChanged?.();
  };

  return createPortal(
    <dialog
      ref={ref}
      className={styles.dialog}
      onClose={(e) => {
        e.stopPropagation();
        props.onClose();
      }}
      onCancel={(e) => e.stopPropagation()}
      aria-label="カルテ"
    >
      <div className={styles.head}>
        <h2>
          🩺 カルテ <small>{props.patientName} 様・{date.replaceAll("-", "/")}</small>
        </h2>
        <button type="button" className={styles.iconBtn} onClick={() => ref.current?.close()} aria-label="閉じる">
          ×
        </button>
      </div>
      {patient && <PatientNotes patient={patient} readOnly={props.readOnly} onSaved={setPatient} />}
      {error && <p className={styles.error}>{error}</p>}
      {entries === null && <p className={styles.muted}>読み込み中…</p>}

      {entries?.map((c) =>
        editing !== "new" && editing?.id === c.id ? (
          <ChartForm key={c.id} entry={c} {...props} me={me} onCancel={() => setEditing(null)} onSaved={changed} />
        ) : (
          <ChartCard
            key={c.id}
            entry={c}
            actions={
              !props.readOnly && (
                <>
                  <button type="button" className={styles.btn} onClick={() => setEditing(c)} disabled={editing !== null}>
                    直す
                  </button>
                  {(me?.canManage || c.createdBy?.id === me?.id) && (
                    <button
                      type="button"
                      className={styles.btn}
                      onClick={async () => {
                        if (!window.confirm(`「${c.treatment}」のカルテを削除しますか？`)) return;
                        try {
                          await deleteChart(c.id, c.version);
                          await changed();
                        } catch (err) {
                          setError(err instanceof ApiError ? err.message : "削除できませんでした");
                        }
                      }}
                    >
                      削除
                    </button>
                  )}
                </>
              )
            }
          />
        ),
      )}

      {editing === "new" ? (
        <ChartForm {...props} me={me} onCancel={() => setEditing(null)} onSaved={changed} />
      ) : (
        !props.readOnly &&
        entries !== null && (
          <button type="button" className={styles.addBtn} onClick={() => setEditing("new")} disabled={editing !== null}>
            ＋ 施術を記録する
          </button>
        )
      )}

      <section className={styles.photos}>
        <h3>この日の写真・ファイル</h3>
        <FileThumbs files={files} size="m" canDelete={!props.readOnly} onDeleted={(id) => setFiles((fs) => fs.filter((f) => f.id !== id))} />
        {files.length === 0 && <p className={styles.muted}>まだありません</p>}
        {!props.readOnly && (
          <FileUploader compact patientId={patientId} date={date} reservationId={props.reservationId} onUploaded={(f) => setFiles((fs) => [...fs, f])} />
        )}
      </section>
    </dialog>,
    document.body,
  );
}

function ChartForm(props: Props & { entry?: ChartEntry; me: StaffPublic | null; onCancel(): void; onSaved(): void }) {
  const e = props.entry;
  const [treatment, setTreatment] = useState(e?.treatment ?? (props.menuNames?.length === 1 ? props.menuNames[0] : ""));
  const [area, setArea] = useState(e?.area ?? "");
  const [settings, setSettings] = useState(e?.settings ?? "");
  const [drugs, setDrugs] = useState<ChartDrug[]>(e?.drugs ?? []);
  const [anesthesia, setAnesthesia] = useState(e?.anesthesia ?? "");
  const [findings, setFindings] = useState(e?.findings ?? "");
  const [nextPlan, setNextPlan] = useState(e?.nextPlan ?? "");
  const [operator, setOperator] = useState(e?.operator ?? "");
  const [saving, setSaving] = useState(false);
  const [moreAreas, setMoreAreas] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recentDrugs, setRecentDrugs] = usePref<string[]>("recentDrugs", [], isStringArray);
  const hints = useMemo(() => conditionHints(treatment), [treatment]);
  const operatorDefault = props.me?.name;

  // 施術者の初期値はログインしている人
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!e && operatorDefault) setOperator((o) => o || operatorDefault);
  }, [e, operatorDefault]);

  const appendTo = (cur: string, word: string, sep: string) => (cur.split(sep).map((x) => x.trim()).includes(word) ? cur : cur ? `${cur}${sep}${word}` : word);
  const setDrug = (i: number, patch: Partial<ChartDrug>) => setDrugs((ds) => ds.map((d, j) => (j === i ? { ...d, ...patch } : d)));

  const save = async () => {
    setError(null);
    if (!treatment.trim()) return setError("施術名を入れてください");
    // ロット番号は入力しない（前に入れたものはそのまま残す）
    const cleanDrugs = drugs.filter((d) => d.name.trim()).map((d) => ({ name: d.name, ...(d.lot && { lot: d.lot }), amount: d.amount ?? "" }));
    const body = { treatment, area, settings, drugs: cleanDrugs, anesthesia, findings, nextPlan, operator };
    setSaving(true);
    try {
      if (e) await updateChart(e.id, { ...body, version: e.version });
      else await createChart(props.patientId, { ...body, date: props.date, ...(props.reservationId && { reservationId: props.reservationId }) });
      setRecentDrugs((r) => [...new Set([...cleanDrugs.map((d) => d.name.trim()), ...r])].slice(0, 30));
      props.onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "保存できませんでした");
      setSaving(false);
    }
  };

  return (
    <div className={styles.form}>
      <label className={styles.field}>
        <span>施術名</span>
        <input className={styles.input} value={treatment} onChange={(ev) => setTreatment(ev.target.value)} maxLength={120} placeholder="例：ボトックス 額" aria-label="施術名" />
      </label>
      {(props.menuNames?.length ?? 0) > 0 && (
        <div className={styles.chips}>
          {props.menuNames!.map((m) => (
            <button key={m} type="button" className={styles.chip} data-on={treatment === m || undefined} onClick={() => setTreatment(m)}>
              {m}
            </button>
          ))}
        </div>
      )}

      <label className={styles.field}>
        <span>部位</span>
        <input className={styles.input} value={area} onChange={(ev) => setArea(ev.target.value)} maxLength={200} placeholder="例：額・眉間" aria-label="部位" />
      </label>
      <div className={styles.chips}>
        {(moreAreas ? [...AREAS_MAIN, ...AREAS_MORE] : AREAS_MAIN).map((a) => (
          <button key={a} type="button" className={styles.chip} data-on={area.split("・").includes(a) || undefined} onClick={() => setArea((cur) => appendTo(cur, a, "・"))}>
            {a}
          </button>
        ))}
        <button type="button" className={styles.moreBtn} onClick={() => setMoreAreas((v) => !v)} aria-expanded={moreAreas}>
          {moreAreas ? "▲ 閉じる" : "▼ ほかの部位"}
        </button>
      </div>

      <label className={styles.field}>
        <span>条件（機器・出力・ショット数・深さなど）</span>
        <textarea className={styles.input} rows={3} value={settings} onChange={(ev) => setSettings(ev.target.value)} maxLength={1000} aria-label="条件" />
      </label>
      {hints.length > 0 && (
        <div className={styles.chips}>
          {hints.map((h) => (
            <button key={h} type="button" className={styles.chip} onClick={() => setSettings((cur) => (cur ? `${cur}\n${h}：` : `${h}：`))}>
              ＋{h}
            </button>
          ))}
        </div>
      )}

      <div className={styles.field}>
        <span>薬剤</span>
        {drugs.map((d, i) => (
          <div key={i} className={styles.drugRow}>
            <input className={styles.input} value={d.name} onChange={(ev) => setDrug(i, { name: ev.target.value })} list="chart-drugs" maxLength={80} placeholder="薬剤名" aria-label={`薬剤名${i + 1}`} />
            <input className={styles.input} value={d.amount ?? ""} onChange={(ev) => setDrug(i, { amount: ev.target.value })} maxLength={40} placeholder="使用量（例：20単位）" aria-label={`使用量${i + 1}`} />
            <button type="button" className={styles.remove} onClick={() => setDrugs((ds) => ds.filter((_, j) => j !== i))} aria-label={`薬剤${i + 1}を外す`}>
              ×
            </button>
          </div>
        ))}
        <datalist id="chart-drugs">
          {recentDrugs.map((n) => (
            <option key={n} value={n} />
          ))}
        </datalist>
        {drugs.length < 10 && (
          <button type="button" className={styles.btn} onClick={() => setDrugs((ds) => [...ds, { name: "" }])} style={{ alignSelf: "flex-start" }}>
            ＋ 薬剤を追加
          </button>
        )}
      </div>

      <label className={styles.field}>
        <span>麻酔</span>
        <input className={styles.input} value={anesthesia} onChange={(ev) => setAnesthesia(ev.target.value)} maxLength={100} aria-label="麻酔" />
      </label>
      <div className={styles.chips}>
        {ANESTHESIA.map((a) => (
          <button key={a} type="button" className={styles.chip} data-on={anesthesia === a || undefined} onClick={() => setAnesthesia(a)}>
            {a}
          </button>
        ))}
      </div>

      <div className={styles.field}>
        <span>所見・経過</span>
        <RichTextEditor value={findings} onChange={setFindings} rows={4} maxLength={8000} ariaLabel="所見・経過" placeholder="例：施術直後の赤みあり。内出血なし" />
      </div>

      <div className={styles.twoCols}>
        <label className={styles.field}>
          <span>次回の予定</span>
          <input className={styles.input} value={nextPlan} onChange={(ev) => setNextPlan(ev.target.value)} maxLength={200} placeholder="例：3か月後に再診" aria-label="次回の予定" />
        </label>
        <label className={styles.field}>
          <span>施術者</span>
          <input className={styles.input} value={operator} onChange={(ev) => setOperator(ev.target.value)} maxLength={60} aria-label="施術者" />
        </label>
      </div>

      {error && <p className={styles.error}>{error}</p>}
      <div className={styles.actions}>
        <button type="button" className={styles.btn} onClick={props.onCancel} disabled={saving}>
          やめる
        </button>
        <button type="button" className={styles.primaryBtn} onClick={save} disabled={saving}>
          {saving ? "保存中…" : "保存"}
        </button>
      </div>
    </div>
  );
}

/** カルテの上：重要事項（目立つように）と、押して開く既往歴・内服歴 */
function PatientNotes({ patient: p, readOnly, onSaved }: { patient: Patient; readOnly?: boolean; onSaved(p: Patient): void }) {
  const [editing, setEditing] = useState<"caution" | "history" | null>(null);
  const [caution, setCaution] = useState(p.cautionNote ?? "");
  const [history, setHistory] = useState(p.history ?? "");
  const [medications, setMedications] = useState(p.medications ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (body: { cautionNote?: string; caution?: boolean; history?: string; medications?: string }) => {
    setSaving(true);
    setError(null);
    try {
      const d = await updatePatient(p.id, { ...body, version: p.version });
      onSaved(d.patient);
      setEditing(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "保存できませんでした");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={styles.notes}>
      {editing === "caution" ? (
        <div className={styles.cautionBox}>
          <strong>⚠ 重要事項</strong>
          <textarea
            className={styles.input}
            rows={2}
            value={caution}
            onChange={(e) => setCaution(e.target.value)}
            maxLength={500}
            placeholder="例：アルコール綿禁止、薬疹（セフェム系）、ラテックスアレルギー"
            aria-label="重要事項"
            autoFocus
          />
          <div className={styles.actions}>
            <button type="button" className={styles.btn} onClick={() => setEditing(null)} disabled={saving}>
              やめる
            </button>
            <button type="button" className={styles.primaryBtn} disabled={saving} onClick={() => save({ cautionNote: caution, caution: !!caution.trim() || !!p.caution })}>
              保存
            </button>
          </div>
        </div>
      ) : p.cautionNote ? (
        <div className={styles.cautionBox} role="alert">
          <strong>⚠ 重要事項</strong>
          <span className={styles.cautionText}>{p.cautionNote}</span>
          {!readOnly && (
            <button type="button" className={styles.linkBtn} onClick={() => setEditing("caution")}>
              直す
            </button>
          )}
        </div>
      ) : (
        !readOnly && (
          <button type="button" className={styles.linkBtn} onClick={() => setEditing("caution")}>
            ＋ 重要事項（アルコール綿禁止・薬疹など）を書く
          </button>
        )
      )}

      <details className={styles.historyBox}>
        <summary>
          既往歴・内服歴
          <span className={styles.muted}>{p.history || p.medications ? "（記入あり）" : "（未記入）"}</span>
        </summary>
        {editing === "history" ? (
          <div className={styles.form}>
            <label className={styles.field}>
              <span>既往歴</span>
              <textarea className={styles.input} rows={2} value={history} onChange={(e) => setHistory(e.target.value)} maxLength={2000} aria-label="既往歴" />
            </label>
            <label className={styles.field}>
              <span>内服歴・服用中の薬</span>
              <textarea className={styles.input} rows={2} value={medications} onChange={(e) => setMedications(e.target.value)} maxLength={2000} aria-label="内服歴" />
            </label>
            <div className={styles.actions}>
              <button type="button" className={styles.btn} onClick={() => setEditing(null)} disabled={saving}>
                やめる
              </button>
              <button type="button" className={styles.primaryBtn} disabled={saving} onClick={() => save({ history, medications })}>
                保存
              </button>
            </div>
          </div>
        ) : (
          <dl className={styles.facts}>
            <div>
              <dt>既往歴</dt>
              <dd className={styles.pre}>{p.history || "—"}</dd>
            </div>
            <div>
              <dt>内服歴</dt>
              <dd className={styles.pre}>{p.medications || "—"}</dd>
            </div>
            {!readOnly && (
              <button type="button" className={styles.linkBtn} onClick={() => setEditing("history")} style={{ justifySelf: "start" }}>
                直す
              </button>
            )}
          </dl>
        )}
        <QuestionnaireAnswers patientId={p.id} />
      </details>
      {error && <p className={styles.error}>{error}</p>}
    </div>
  );
}

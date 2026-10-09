"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { DayBundle, Menu, Patient, Reservation } from "@/lib/domain/types";
import { formatDateJa, formatHm, toIso } from "@/lib/domain/time";
import { searchKey } from "@/lib/domain/text";
import { REQUEST_ID_RE, parseBookingRequest, type BookingRequest } from "@/lib/domain/bookingRequest";
import { ApiError, createPatient, postReservation, searchPatients } from "./api";
import { durationLabel } from "./menuFormat";
import { RichTextEditor } from "@/components/richtext/RichTextEditor";
import { MenuManagerDialog } from "@/components/settings/MenuManagerDialog";
import styles from "./calendar.module.css";

interface Props {
  bundle: DayBundle;
  date: string;
  laneId: string;
  minute: number;
  onClose: () => void;
  onCreated: (r: Reservation) => void;
  /** メニューの追加・削除ができる人（院長・管理者と受付）だけ。変更のあと予約表を読み直す */
  onMenusChanged?: () => Promise<void>;
  /** 受付箱から開いたときの申請の文面（開いたときに読み取って入れる） */
  initialRequestText?: string;
}

interface NewPatientForm {
  name: string;
  kana: string;
  nameAlt: string;
  phone: string;
  m3ChartNo: string;
  birthDate: string;
}

export function CreateDialog({ bundle, date, laneId: initialLane, minute, onClose, onCreated, onMenusChanged, initialRequestText }: Props) {
  const [manageMenus, setManageMenus] = useState(false);
  const { clinic } = bundle;
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Patient[]>([]);
  const [patient, setPatient] = useState<Patient | null>(null);
  const [newPatient, setNewPatient] = useState<NewPatientForm | null>(
    null,
  );
  const [laneId, setLaneId] = useState(initialLane);
  const [start, setStart] = useState(minute);
  const [menuIds, setMenuIds] = useState<string[]>([]);
  const [menuQuery, setMenuQuery] = useState("");
  const [duration, setDuration] = useState<number | null>(null);
  const [memo, setMemo] = useState("");
  const [requestId, setRequestId] = useState("");
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [pasteNote, setPasteNote] = useState<string | null>(null);
  /** 貼り付けた予約申請（「新しい患者として登録」を押したときに使う） */
  const [parsed, setParsed] = useState<BookingRequest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  useEffect(() => {
    if (patient || newPatient || query.trim().length === 0) return;
    const ac = new AbortController();
    const t = setTimeout(() => {
      searchPatients(query, ac.signal).then(setResults, () => {});
    }, 200);
    return () => {
      clearTimeout(t);
      ac.abort();
    };
  }, [query, patient, newPatient]);

  const menuById = useMemo(() => new Map(bundle.menus.map((m) => [m.id, m])), [bundle.menus]);
  /** 削除したメニューは選択に出さない */
  const selectedMenus = menuIds.map((id) => menuById.get(id)).filter((m): m is Menu => !!m && !m.deleted);

  const visibleMenus = useMemo(() => {
    const q = searchKey(menuQuery);
    return bundle.menus
      .filter((m) => m.active && !menuIds.includes(m.id))
      .filter((m) => !q || searchKey(`${m.name}${m.abbr}`).includes(q))
      .sort((a, b) => Number(!fitsLane(a, laneId)) - Number(!fitsLane(b, laneId)) || a.order - b.order);
  }, [bundle.menus, menuIds, menuQuery, laneId]);

  const autoDuration = selectedMenus.reduce((sum, m) => sum + m.defaultMinutes, 0);
  const dur = duration ?? (autoDuration || clinic.slotMin * 2);
  const durationOptions: number[] = [];
  for (let m = clinic.slotMin; m <= Math.max(180, dur); m += clinic.slotMin) durationOptions.push(m);

  const startOptions: number[] = [];
  for (let m = clinic.dayStartMin; m < clinic.dayEndMin; m += clinic.slotMin) startOptions.push(m);

  const laneName = (id: string) => bundle.lanes.find((l) => l.id === id)?.shortName ?? "";
  const laneWarnings = selectedMenus
    .filter((m) => !fitsLane(m, laneId))
    .map((m) => `「${m.name}」は通常 ${m.laneIds.map(laneName).filter(Boolean).join("・")} で行います`);
  const single = selectedMenus.length === 1 ? selectedMenus[0] : null;
  const durationWarning =
    single && single.duration.kind === "range" && (dur < single.duration.min || dur > single.duration.max)
      ? `メニューの設定（${durationLabel(single.duration)}）の範囲外です`
      : single && single.duration.kind === "fixed" && dur !== single.duration.minutes
        ? `メニューの設定は${single.duration.minutes}分（固定）です`
        : null;

  const addMenu = (m: Menu) => {
    setMenuIds((ids) => [...ids, m.id]);
    setMenuQuery("");
    setDuration(null);
  };
  const removeMenu = (id: string) => {
    setMenuIds((ids) => ids.filter((x) => x !== id));
    setDuration(null);
  };

  /** LINE予約申請の文面を読み取り、患者・予約申請ID・メモを入れる */
  const applyRequest = async (text: string = pasteText) => {
    const r = parseBookingRequest(text);
    if (!r.requestId && !r.name && !r.phone) {
      setPasteNote("予約申請の文面を読み取れませんでした（「項目名：内容」の形の文面を貼り付けてください）");
      return;
    }
    setParsed(r);
    if (r.requestId) setRequestId(r.requestId);
    if (r.memo) setMemo(r.memo);
    const notes: string[] = [];
    if (r.desiredDate && r.desiredDate !== date) {
      notes.push(`希望日は ${formatDateJa(r.desiredDate)}${r.desiredTime ? ` ${r.desiredTime}` : ""} です（この予約は ${formatDateJa(date)} に入ります）`);
    }
    // 同じ電話番号の患者を探す。氏名かフリガナも一致すればその患者を選ぶ
    const found = r.phone ? await searchPatients(r.phone).catch(() => [] as Patient[]) : [];
    const same = found.filter(
      (p) => (r.kana && searchKey(p.kana) === searchKey(r.kana)) || (r.name && searchKey(p.name) === searchKey(r.name)),
    );
    if (same.length === 1) {
      setPatient(same[0]);
      setNewPatient(null);
      notes.push(`登録済みの患者「${same[0].name}」（診察券 ${same[0].chartNo}）を選びました`);
    } else if (found.length > 0) {
      setPatient(null);
      setNewPatient(null);
      setQuery(r.phone ?? "");
      notes.push("同じ電話番号の患者がいます。同じ方なら選び、違う方なら「＋新規患者登録」を押してください");
    } else {
      setPatient(null);
      setNewPatient({ name: "", kana: "", nameAlt: "", phone: "", m3ChartNo: "", birthDate: "", ...fromRequest(r) });
      notes.push("新しい患者として入力しました。内容を確かめて登録してください");
    }
    setPasteNote(notes.join("\n"));
    setPasteOpen(false);
  };

  // 受付箱から開いたときは、申請の文面をすぐ読み取る（1回だけ）
  const appliedInitial = useRef(false);
  useEffect(() => {
    if (!initialRequestText || appliedInitial.current) return;
    appliedInitial.current = true;
    void applyRequest(initialRequestText);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialRequestText]);

  const submit = async () => {
    setError(null);
    if (requestId && !REQUEST_ID_RE.test(requestId)) return setError("予約申請IDは英数字・ハイフンで入力してください");
    if (!patient && !newPatient) return setError("患者を選ぶか、新しい患者として登録してください");
    if (selectedMenus.length === 0) return setError("メニューを選んでください");
    if (start + dur > clinic.dayEndMin) return setError("診療時間を超えています");
    setSaving(true);
    try {
      let p = patient;
      if (!p && newPatient) {
        p = await createPatient({
          name: newPatient.name,
          kana: newPatient.kana || undefined,
          nameAlt: newPatient.nameAlt || undefined,
          phone: newPatient.phone || undefined,
          m3ChartNo: newPatient.m3ChartNo || undefined,
          birthDate: newPatient.birthDate || undefined,
        });
        setPatient(p);
        setNewPatient(null);
      }
      const r = await postReservation({
        patientId: p!.id,
        laneId,
        menuIds: selectedMenus.map((m) => m.id),
        startAt: toIso(date, start),
        endAt: toIso(date, start + dur),
        memo: memo || undefined,
        requestId: requestId || undefined,
      });
      onCreated(r);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "登録できませんでした");
      setSaving(false);
    }
  };

  return (
    <dialog ref={dialogRef} className={styles.dialog} onClose={(e) => e.target === e.currentTarget && onClose()} onCancel={(e) => e.target === e.currentTarget && onClose()}>
      <form
        method="dialog"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className={styles.panelHead}>
          <div className={styles.panelName}>新しい予約 {formatDateJa(date)}</div>
          <button type="button" className={styles.iconBtn} onClick={onClose} aria-label="閉じる">
            ×
          </button>
        </div>

        <div className={styles.pasteBox}>
          {pasteOpen ? (
            <>
              <label htmlFor="paste" className={styles.sectionLabel}>
                LINE予約申請の文面を貼り付け
              </label>
              <textarea
                id="paste"
                className={styles.memo}
                rows={6}
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                placeholder={"【美容皮膚科・初診予約申請】\n漢字氏名：…\nカナ氏名：…\n電話番号：…\n予約申請ID：R2026…"}
                autoFocus
              />
              <div className={styles.pasteActions}>
                <button type="button" className={styles.btn} onClick={() => setPasteOpen(false)}>
                  閉じる
                </button>
                <button type="button" className={styles.primaryBtn} onClick={() => void applyRequest()} disabled={!pasteText.trim()}>
                  読み取って入力
                </button>
              </div>
            </>
          ) : (
            <button type="button" className={styles.pasteBtn} onClick={() => setPasteOpen(true)}>
              📋 LINE予約申請を貼り付けて入力
            </button>
          )}
          {pasteNote && <p className={styles.pasteNote}>{pasteNote}</p>}
        </div>

        <div className={styles.field}>
          <label htmlFor="pq">患者</label>
          {patient ? (
            <div className={styles.picked}>
              <span>
                {patient.name}
                <small className={styles.pickedSub}>
                  {patient.kana && ` ${patient.kana}`}
                  {patient.nameAlt && ` / ${patient.nameAlt}`}・{patient.chartNo}
                  {patient.m3ChartNo && `・M3 ${patient.m3ChartNo}`}
                </small>
              </span>
              <button type="button" className={styles.btn} onClick={() => setPatient(null)}>
                変更
              </button>
            </div>
          ) : newPatient ? (
            <div className={styles.newPatient}>
              <div className={styles.fieldRow}>
                <div className={styles.field}>
                  <label htmlFor="np-name">氏名（必須）</label>
                  <input
                    id="np-name"
                    className={styles.input}
                    value={newPatient.name}
                    onChange={(e) => setNewPatient({ ...newPatient, name: e.target.value })}
                    placeholder="例：山田 Anna／さくら 田中"
                    maxLength={60}
                    autoFocus
                  />
                </div>
                <div className={styles.field}>
                  <label htmlFor="np-kana">フリガナ</label>
                  <input
                    id="np-kana"
                    className={styles.input}
                    value={newPatient.kana}
                    onChange={(e) => setNewPatient({ ...newPatient, kana: e.target.value })}
                    placeholder="ヤマダ アンナ"
                    maxLength={60}
                  />
                </div>
              </div>
              <div className={styles.fieldRow}>
                <div className={styles.field}>
                  <label htmlFor="np-alt">別の表記（ローマ字・旧姓など）</label>
                  <input
                    id="np-alt"
                    className={styles.input}
                    value={newPatient.nameAlt}
                    onChange={(e) => setNewPatient({ ...newPatient, nameAlt: e.target.value })}
                    placeholder="Yamada Anna"
                    maxLength={60}
                  />
                </div>
                <div className={styles.field}>
                  <label htmlFor="np-phone">電話</label>
                  <input
                    id="np-phone"
                    className={styles.input}
                    type="tel"
                    value={newPatient.phone}
                    onChange={(e) => setNewPatient({ ...newPatient, phone: e.target.value })}
                    maxLength={20}
                  />
                </div>
              </div>
              <div className={styles.fieldRow}>
                <div className={styles.field}>
                  <label htmlFor="np-birth">生年月日</label>
                  <input
                    id="np-birth"
                    className={styles.input}
                    type="date"
                    value={newPatient.birthDate}
                    onChange={(e) => setNewPatient({ ...newPatient, birthDate: e.target.value })}
                  />
                </div>
                <div className={styles.field}>
                  <label htmlFor="np-m3">M3カルテ番号</label>
                  <input
                    id="np-m3"
                    className={styles.input}
                    value={newPatient.m3ChartNo}
                    onChange={(e) => setNewPatient({ ...newPatient, m3ChartNo: e.target.value })}
                    maxLength={20}
                    autoComplete="off"
                  />
                </div>
              </div>
              <p className={styles.hint}>
                氏名は漢字・ひらがな・カタカナ・ローマ字を混ぜて入力できます。診察券番号は自動で振ります。
              </p>
              <button type="button" className={styles.linkBtn} onClick={() => setNewPatient(null)}>
                ← 既存の患者から探す
              </button>
            </div>
          ) : (
            <>
              <input
                id="pq"
                className={styles.input}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="氏名・フリガナ・ローマ字・診察券／M3番号・電話・予約申請ID"
                autoComplete="off"
                autoFocus
              />
              {query.trim() && (
                <ul className={styles.results}>
                  {results.map((p) => (
                    <li key={p.id}>
                      <button type="button" onClick={() => setPatient(p)}>
                        {p.name}{" "}
                        <small>
                          {p.kana}
                          {p.nameAlt && ` / ${p.nameAlt}`}・{p.chartNo}
                          {p.m3ChartNo && `・M3 ${p.m3ChartNo}`}
                        </small>
                      </button>
                    </li>
                  ))}
                  {results.length === 0 && <li className={styles.hint}>該当する患者がいません</li>}
                </ul>
              )}
              <button
                type="button"
                className={styles.linkBtn}
                onClick={() =>
                  setNewPatient({
                    name: /^[\d\s-]+$/.test(query) ? "" : query.trim(),
                    kana: "",
                    nameAlt: "",
                    phone: /^[\d\s-]+$/.test(query) ? query.trim() : "",
                    m3ChartNo: "",
                    birthDate: "",
                    ...(parsed && fromRequest(parsed)),
                  })
                }
              >
                ＋新規患者登録
              </button>
            </>
          )}
        </div>

        <div className={styles.field}>
          <span>メニュー（複数可）</span>
          {selectedMenus.length > 0 && (
            <div className={styles.treatPicker}>
              {selectedMenus.map((m) => (
                <button
                  type="button"
                  key={m.id}
                  className={styles.treatChip}
                  style={{ ["--c" as string]: m.color }}
                  data-active
                  onClick={() => removeMenu(m.id)}
                  aria-label={`${m.name}を外す`}
                >
                  {m.name} <small>{durationLabel(m.duration)}</small> ×
                </button>
              ))}
            </div>
          )}
          <input
            className={styles.input}
            value={menuQuery}
            onChange={(e) => setMenuQuery(e.target.value)}
            placeholder="メニューを絞り込む（例：ボトックス、HIFU、脱毛）"
            aria-label="メニューを絞り込む"
          />
          <div className={styles.menuList}>
            {visibleMenus.map((m) => (
              <button
                type="button"
                key={m.id}
                className={styles.treatChip}
                style={{ ["--c" as string]: m.color }}
                data-other-lane={!fitsLane(m, laneId) || undefined}
                onClick={() => addMenu(m)}
                title={fitsLane(m, laneId) ? undefined : "このレーンでは通常行わないメニュー"}
              >
                {m.name} <small>{durationLabel(m.duration)}</small>
              </button>
            ))}
            {visibleMenus.length === 0 && <span className={styles.hint}>該当するメニューがありません</span>}
          </div>
          {onMenusChanged && (
            <button type="button" className={styles.menuManageBtn} onClick={() => setManageMenus(true)}>
              ⚙ メニューの追加・削除
            </button>
          )}
          {manageMenus && onMenusChanged && (
            <MenuManagerDialog
              onClose={() => setManageMenus(false)}
              onChanged={async (created) => {
                await onMenusChanged();
                // 新しく作ったメニューはこの予約に入れる
                if (created?.active) {
                  setMenuIds((ids) => (ids.includes(created.id) ? ids : [...ids, created.id]));
                  setDuration(null);
                }
              }}
            />
          )}
        </div>

        <div className={styles.fieldRow}>
          <div className={styles.field}>
            <label htmlFor="ps">開始</label>
            <select id="ps" className={styles.input} value={start} onChange={(e) => setStart(Number(e.target.value))}>
              {startOptions.map((m) => (
                <option key={m} value={m}>
                  {formatHm(m)}
                </option>
              ))}
            </select>
          </div>
          <div className={styles.field}>
            <label htmlFor="pd">時間</label>
            <select id="pd" className={styles.input} value={dur} onChange={(e) => setDuration(Number(e.target.value))}>
              {durationOptions.map((m) => (
                <option key={m} value={m}>
                  {m}分
                </option>
              ))}
            </select>
          </div>
          <div className={styles.field}>
            <label htmlFor="pl">レーン</label>
            <select id="pl" className={styles.input} value={laneId} onChange={(e) => setLaneId(e.target.value)}>
              {bundle.lanes.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.shortName}
                </option>
              ))}
            </select>
          </div>
        </div>
        {(durationWarning || laneWarnings.length > 0) && (
          <ul className={styles.warnings}>
            {durationWarning && <li>{durationWarning}</li>}
            {laneWarnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        )}

        <div className={styles.field}>
          <span>メモ</span>
          <RichTextEditor value={memo} onChange={setMemo} rows={memo.includes("\n") ? 4 : 2} maxLength={500} ariaLabel="予約メモ" />
        </div>

        <div className={styles.field}>
          <label htmlFor="prid">予約申請ID（LINE予約フォーム）</label>
          <input
            id="prid"
            className={styles.input}
            value={requestId}
            maxLength={40}
            placeholder="例：R2026100506574020A34A8B"
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => setRequestId(e.target.value.normalize("NFKC").replace(/\s/g, ""))}
          />
        </div>

        {error && <p className={styles.error}>{error}</p>}

        <div className={styles.dialogActions}>
          <button type="button" className={styles.btn} onClick={onClose}>
            やめる
          </button>
          <button type="submit" className={styles.primaryBtn} disabled={saving}>
            {formatHm(start)}–{formatHm(start + dur)} で登録
          </button>
        </div>
      </form>
    </dialog>
  );
}

/** 予約申請から新規患者の入力欄に入れる値 */
function fromRequest(r: BookingRequest): Partial<NewPatientForm> {
  return {
    ...(r.name && { name: r.name }),
    ...(r.kana && { kana: r.kana }),
    ...(r.phone && { phone: r.phone }),
    ...(r.birthDate && { birthDate: r.birthDate }),
  };
}

function fitsLane(m: Menu, laneId: string): boolean {
  return m.laneIds.length === 0 || m.laneIds.includes(laneId);
}

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { DayBundle, Menu, Patient, Reservation } from "@/lib/domain/types";
import { formatDateJa, formatHm, toIso } from "@/lib/domain/time";
import { searchKey } from "@/lib/domain/text";
import { ApiError, createPatient, postReservation, searchPatients } from "./api";
import { durationLabel } from "./menuFormat";
import styles from "./calendar.module.css";

interface Props {
  bundle: DayBundle;
  date: string;
  laneId: string;
  minute: number;
  onClose: () => void;
  onCreated: (r: Reservation) => void;
}

export function CreateDialog({ bundle, date, laneId: initialLane, minute, onClose, onCreated }: Props) {
  const { clinic } = bundle;
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Patient[]>([]);
  const [patient, setPatient] = useState<Patient | null>(null);
  const [newPatient, setNewPatient] = useState<{ name: string; kana: string; nameAlt: string; phone: string; m3ChartNo: string } | null>(
    null,
  );
  const [laneId, setLaneId] = useState(initialLane);
  const [start, setStart] = useState(minute);
  const [menuIds, setMenuIds] = useState<string[]>([]);
  const [menuQuery, setMenuQuery] = useState("");
  const [duration, setDuration] = useState<number | null>(null);
  const [memo, setMemo] = useState("");
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
  const selectedMenus = menuIds.map((id) => menuById.get(id)).filter((m): m is Menu => !!m);

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

  const submit = async () => {
    setError(null);
    if (!patient && !newPatient) return setError("患者を選ぶか、新しい患者として登録してください");
    if (menuIds.length === 0) return setError("メニューを選んでください");
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
        });
        setPatient(p);
        setNewPatient(null);
      }
      const r = await postReservation({
        patientId: p!.id,
        laneId,
        menuIds,
        startAt: toIso(date, start),
        endAt: toIso(date, start + dur),
        memo: memo || undefined,
      });
      onCreated(r);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "登録できませんでした");
      setSaving(false);
    }
  };

  return (
    <dialog ref={dialogRef} className={styles.dialog} onClose={onClose} onCancel={onClose}>
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
                placeholder="氏名・フリガナ・ローマ字・診察券／M3番号・電話"
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
                  })
                }
              >
                ＋ 新しい患者として登録
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
          <label htmlFor="pm">メモ</label>
          <input id="pm" className={styles.input} value={memo} maxLength={500} onChange={(e) => setMemo(e.target.value)} />
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

function fitsLane(m: Menu, laneId: string): boolean {
  return m.laneIds.length === 0 || m.laneIds.includes(laneId);
}

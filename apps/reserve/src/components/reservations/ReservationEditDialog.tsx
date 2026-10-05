"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { ClinicSettings, Lane, Menu, Reservation } from "@/lib/domain/types";
import { addDays, clinicDateOf, formatDateJa, formatHm, minutesOfDay, toIso } from "@/lib/domain/time";
import { searchKey } from "@/lib/domain/text";
import { ApiError, fetchSettings, patchReservation } from "@/components/calendar/api";
import styles from "./reservations.module.css";

/** 変更に必要な予約の情報（カレンダーの予約・患者画面の予約のどちらからでも作れる） */
export interface EditableReservation {
  id: string;
  version: number;
  startAt: string;
  endAt: string;
  laneId: string;
  menuIds: string[];
}

interface Props {
  reservation: EditableReservation;
  patientName: string;
  /** 予約を取り消せるか（院長・管理者と受付） */
  canCancel: boolean;
  onClose(): void;
  /** 変更・取り消しのあと。kind で何をしたか分かる */
  onSaved(next: Reservation, kind: "changed" | "cancelled"): void;
}

const MAX_MENUS = 5;

/** 予約の変更：日時・時間・レーン・メニュー、予約の取り消し */
export function ReservationEditDialog({ reservation: r, patientName, canCancel, onClose, onSaved }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const [lanes, setLanes] = useState<Lane[] | null>(null);
  const [menus, setMenus] = useState<Menu[]>([]);
  const [clinic, setClinic] = useState<ClinicSettings | null>(null);
  const start0 = minutesOfDay(r.startAt);
  const dur0 = Math.max(5, Math.round((Date.parse(r.endAt) - Date.parse(r.startAt)) / 60000));
  const [date, setDate] = useState(clinicDateOf(r.startAt));
  const [start, setStart] = useState(start0);
  const [dur, setDur] = useState(dur0);
  /** 時間を手で変えたら、メニューを変えても時間を自動で変えない */
  const [durTouched, setDurTouched] = useState(false);
  const [laneId, setLaneId] = useState(r.laneId);
  const [menuIds, setMenuIds] = useState<string[]>(r.menuIds);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);

  useEffect(() => {
    fetchSettings().then(
      (s) => {
        setLanes([...s.lanes].sort((a, b) => a.order - b.order));
        setMenus(s.menus);
        setClinic(s.clinic);
      },
      () => setError("設定を読み込めませんでした"),
    );
  }, []);

  const menuOf = useMemo(() => new Map(menus.map((m) => [m.id, m])), [menus]);
  const slot = clinic?.slotMin ?? 5;
  const startOptions = useMemo(() => {
    const out: number[] = [];
    const from = Math.min(clinic?.dayStartMin ?? 540, start0);
    const to = Math.max(clinic?.dayEndMin ?? 1200, start0 + 5);
    for (let m = from; m < to; m += slot) out.push(m);
    if (!out.includes(start)) out.push(start);
    return out.sort((a, b) => a - b);
  }, [clinic, slot, start0, start]);
  const durOptions = useMemo(() => {
    const out: number[] = [];
    for (let m = 5; m <= 240; m += 5) out.push(m);
    if (!out.includes(dur)) out.push(dur);
    return out.sort((a, b) => a - b);
  }, [dur]);

  /** メニューを足したらその標準時間を足し、外したら引く（時間を手で変えていなければ） */
  const setMenusAndDuration = (ids: string[]) => {
    const minutes = (xs: string[]) => xs.reduce((sum, id) => sum + (menuOf.get(id)?.defaultMinutes ?? 0), 0);
    if (!durTouched) setDur((d) => Math.min(240, Math.max(5, d + minutes(ids) - minutes(menuIds))));
    setMenuIds(ids);
  };

  const candidates = useMemo(() => {
    const key = searchKey(q);
    return menus
      .filter((m) => (m.active || menuIds.includes(m.id)) && !menuIds.includes(m.id))
      .filter((m) => !key || searchKey(m.name).includes(key) || searchKey(m.abbr).includes(key))
      .filter((m) => m.laneIds.length === 0 || m.laneIds.includes(laneId))
      .slice(0, 60);
  }, [menus, menuIds, q, laneId]);

  const end = start + dur;
  const startAt = toIso(date, start);
  const endAt = toIso(date, end);
  const changed = startAt !== r.startAt || endAt !== r.endAt || laneId !== r.laneId || menuIds.join() !== r.menuIds.join();
  const valid = menuIds.length > 0 && end <= 1440;

  const save = async () => {
    if (!changed || !valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      const next = await patchReservation(r.id, {
        version: r.version,
        ...(startAt !== r.startAt && { startAt }),
        ...(endAt !== r.endAt && { endAt }),
        ...(laneId !== r.laneId && { laneId }),
        ...(menuIds.join() !== r.menuIds.join() && { menuIds }),
      });
      onSaved(next, "changed");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "変更できませんでした");
    } finally {
      setBusy(false);
    }
  };

  const cancelReservation = async () => {
    setBusy(true);
    setError(null);
    try {
      const next = await patchReservation(r.id, { version: r.version, status: "cancelled" });
      onSaved(next, "cancelled");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "取り消せませんでした");
    } finally {
      setBusy(false);
    }
  };

  const laneName = (id: string) => lanes?.find((l) => l.id === id)?.shortName ?? "";

  return (
    <dialog ref={ref} className={styles.dialog} onCancel={onClose} aria-label="予約を変更">
      <div className={styles.head}>
        <h2>
          予約を変更<small>{patientName} 様</small>
        </h2>
        <button type="button" className={styles.iconBtn} onClick={onClose} aria-label="閉じる">
          ×
        </button>
      </div>
      <p className={styles.current}>
        いまの予約：{formatDateJa(clinicDateOf(r.startAt))} {formatHm(start0)}–{formatHm(start0 + dur0)}・{laneName(r.laneId)}・
        {r.menuIds.map((id) => menuOf.get(id)?.name ?? "").join("、")}
      </p>

      <section className={styles.block}>
        <h3>日時・レーン</h3>
        <div className={styles.grid}>
          <label>
            日付
            <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
          </label>
          <label>
            開始
            <select value={start} onChange={(e) => setStart(Number(e.target.value))}>
              {startOptions.map((m) => (
                <option key={m} value={m}>
                  {formatHm(m)}
                </option>
              ))}
            </select>
          </label>
          <label>
            時間
            <select
              value={dur}
              onChange={(e) => {
                setDur(Number(e.target.value));
                setDurTouched(true);
              }}
            >
              {durOptions.map((m) => (
                <option key={m} value={m}>
                  {m}分
                </option>
              ))}
            </select>
          </label>
          <label>
            レーン
            <select value={laneId} onChange={(e) => setLaneId(e.target.value)}>
              {(lanes ?? []).map((l) => (
                <option key={l.id} value={l.id}>
                  {l.shortName}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className={styles.quick}>
          {[-7, 7, 14, 28].map((d) => (
            <button key={d} type="button" onClick={() => setDate((x) => addDays(x, d))}>
              {d < 0 ? `${-d / 7}週前` : `${d / 7}週後`}
            </button>
          ))}
        </div>
      </section>

      <section className={styles.block}>
        <h3>メニュー</h3>
        <div className={styles.selected}>
          {menuIds.length === 0 && <span className={styles.warn}>メニューを1つ以上選んでください</span>}
          {menuIds.map((id) => {
            const m = menuOf.get(id);
            return (
              <span key={id} className={styles.menuChip} style={{ "--c": m?.color ?? "#94a3b8" } as CSSProperties}>
                {m?.name ?? "（削除されたメニュー）"}
                <button type="button" onClick={() => setMenusAndDuration(menuIds.filter((x) => x !== id))} aria-label={`${m?.name ?? "メニュー"}を外す`}>
                  ×
                </button>
              </span>
            );
          })}
        </div>
        {menuIds.length < MAX_MENUS && (
          <>
            <input className={styles.search} value={q} onChange={(e) => setQ(e.target.value)} placeholder="メニューをさがす（追加）" aria-label="メニューをさがす" />
            <div className={styles.candidates}>
              {candidates.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className={styles.candidate}
                  style={{ "--c": m.color } as CSSProperties}
                  onClick={() => setMenusAndDuration([...menuIds, m.id])}
                >
                  {m.name}
                  <small>{m.defaultMinutes}分</small>
                </button>
              ))}
            </div>
          </>
        )}
      </section>

      <p className={styles.preview} data-changed={changed || undefined}>
        → {formatDateJa(date)} {formatHm(start)}–{formatHm(end)}・{laneName(laneId)}・{menuIds.map((id) => menuOf.get(id)?.name ?? "").join("、")}
      </p>
      {end > 1440 && <p className={styles.error}>終了が日付をまたいでいます。開始か時間を直してください</p>}
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

      <div className={styles.actions}>
        {canCancel &&
          (confirmCancel ? (
            <span className={styles.confirm}>
              取り消しますか？
              <button type="button" className={styles.dangerBtn} onClick={cancelReservation} disabled={busy}>
                はい、取り消す
              </button>
              <button type="button" className={styles.btn} onClick={() => setConfirmCancel(false)} disabled={busy}>
                いいえ
              </button>
            </span>
          ) : (
            <button type="button" className={styles.dangerLink} onClick={() => setConfirmCancel(true)} disabled={busy}>
              予約を取り消す
            </button>
          ))}
        <span className={styles.spacer} />
        <button type="button" className={styles.btn} onClick={onClose} disabled={busy}>
          やめる
        </button>
        <button type="button" className={styles.primaryBtn} onClick={save} disabled={!changed || !valid || busy}>
          {busy ? "保存中…" : "変更する"}
        </button>
      </div>
    </dialog>
  );
}

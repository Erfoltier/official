"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DayBundle, Reservation, ReservationStatus, StaffPublic } from "@/lib/domain/types";
import { addDays, formatDateJa, nowInClinic, toIso } from "@/lib/domain/time";
import { DEFAULT_PX_PER_MIN, MAX_PX_PER_MIN, MIN_PX_PER_MIN, clampScale } from "@/lib/calendar/scale";
import { ApiError, fetchDay, fetchMe, logout, patchReservation } from "./api";
import { DayGrid, type DayGridHandle, type MoveTarget } from "./DayGrid";
import { DetailPanel } from "./DetailPanel";
import { CreateDialog } from "./CreateDialog";
import { DatePicker } from "./DatePicker";
import { ChevronDown } from "./Chevron";
import { PatientDialog } from "@/components/patients/PatientDialog";
import { isBoolean, isNumber, isString, usePref } from "./usePref";
import styles from "./calendar.module.css";
import { withBase } from "@/lib/paths";

const POLL_MS = 20_000;
const ALL_LANES = "all";

export function CalendarApp({ initialDate }: { initialDate: string }) {
  const [date, setDate] = useState(initialDate);
  const [bundle, setBundle] = useState<DayBundle | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ text: string; kind: "info" | "error" } | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createAt, setCreateAt] = useState<{ laneId: string; minute: number } | null>(null);
  const [editPatientId, setEditPatientId] = useState<string | null>(null);
  const [me, setMe] = useState<StaffPublic | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const closePicker = useCallback(() => setPickerOpen(false), []);

  useEffect(() => {
    fetchMe().then(setMe, () => {});
  }, []);
  const [now, setNow] = useState(() => nowInClinic());

  const [scale, setScale] = usePref("scale", DEFAULT_PX_PER_MIN, isNumber);
  const [maskNames, setMaskNames] = usePref("maskNames", false, isBoolean);
  const [showCancelled, setShowCancelled] = usePref("showCancelled", false, isBoolean);
  const [laneFilter, setLaneFilter] = usePref("laneFilter", ALL_LANES, isString);

  const gridRef = useRef<DayGridHandle>(null);
  const busyRef = useRef(false);
  const didInitialScroll = useRef<string | null>(null);

  const showToast = useCallback((text: string, kind: "info" | "error" = "info") => {
    setToast({ text, kind });
    window.setTimeout(() => setToast((t) => (t?.text === text ? null : t)), 3500);
  }, []);

  const load = useCallback(
    async (d: string, signal?: AbortSignal) => {
      try {
        const b = await fetchDay(d, signal);
        setBundle(b);
        setLoadError(null);
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        setLoadError(err instanceof ApiError ? err.message : "予約を読み込めませんでした");
      }
    },
    [],
  );

  useEffect(() => {
    const ac = new AbortController();
    // 日付を変えたら選択を解除してから読み込む
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelectedId(null);
    load(date, ac.signal);
    return () => ac.abort();
  }, [date, load]);

  // 他の端末での変更を取り込む（ドラッグ中・保存中は止める）
  useEffect(() => {
    const tick = () => {
      setNow(nowInClinic());
      if (document.visibilityState === "visible" && !busyRef.current) load(date);
    };
    const id = window.setInterval(tick, POLL_MS);
    const onVisible = () => document.visibilityState === "visible" && tick();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [date, load]);

  // 初回表示：今日なら現在時刻の少し前へ
  useEffect(() => {
    if (!bundle || didInitialScroll.current === bundle.date) return;
    didInitialScroll.current = bundle.date;
    const target = bundle.date === now.date ? now.minutes - 30 : bundle.clinic.dayStartMin;
    requestAnimationFrame(() => gridRef.current?.scrollToMinute(target));
  }, [bundle, now]);

  const lanes = useMemo(() => {
    if (!bundle) return [];
    const sorted = [...bundle.lanes].sort((a, b) => a.order - b.order);
    if (laneFilter === ALL_LANES) return sorted;
    const one = sorted.filter((l) => l.id === laneFilter);
    return one.length ? one : sorted;
  }, [bundle, laneFilter]);

  const applyLocal = (next: Reservation) =>
    setBundle((b) => (b ? { ...b, reservations: b.reservations.map((r) => (r.id === next.id ? next : r)) } : b));

  const save = async (r: Reservation, patch: Parameters<typeof patchReservation>[1], optimistic: Reservation) => {
    busyRef.current = true;
    applyLocal(optimistic);
    try {
      applyLocal(await patchReservation(r.id, patch));
    } catch (err) {
      applyLocal(r);
      showToast(err instanceof ApiError ? err.message : "保存できませんでした", "error");
      if (err instanceof ApiError && err.status === 409) load(date);
    } finally {
      busyRef.current = false;
    }
  };

  const onMove = (r: Reservation, to: MoveTarget) => {
    const startAt = toIso(date, to.startMin);
    const endAt = toIso(date, to.endMin);
    save(r, { version: r.version, laneId: to.laneId, startAt, endAt }, { ...r, laneId: to.laneId, startAt, endAt });
  };

  const onStatus = (r: Reservation, status: ReservationStatus) => {
    save(r, { version: r.version, status }, { ...r, status });
  };

  const onMemo = (r: Reservation, memo: string) => {
    save(r, { version: r.version, memo }, { ...r, memo });
  };

  const onRequestId = (r: Reservation, requestId: string) => {
    save(r, { version: r.version, requestId }, { ...r, requestId: requestId || undefined });
  };

  const selected = bundle?.reservations.find((r) => r.id === selectedId) ?? null;
  const isToday = date === now.date;
  const activeCount = bundle?.reservations.filter((r) => r.status !== "cancelled" && r.status !== "no_show").length ?? 0;
  const zoomPercent = Math.round((scale / DEFAULT_PX_PER_MIN) * 100);

  return (
    <div className={styles.app} data-panel-open={selected ? true : undefined}>
      <header className={styles.toolbar}>
        <div className={styles.group}>
          <button className={styles.iconBtn} onClick={() => setDate((d) => addDays(d, -1))} aria-label="前の日">
            ‹
          </button>
          <span className={styles.dateWrap}>
            <button
              type="button"
              className={styles.dateBtn}
              data-datepicker-toggle
              data-open={pickerOpen || undefined}
              onClick={() => setPickerOpen((v) => !v)}
              aria-haspopup="dialog"
              aria-expanded={pickerOpen}
              title="カレンダーから日付を選ぶ"
            >
              {formatDateJa(date)}
              <ChevronDown className={styles.dateCaret} />
            </button>
            {pickerOpen && (
              <DatePicker
                value={date}
                today={now.date}
                onPick={(d) => {
                  setDate(d);
                  setPickerOpen(false);
                  if (d === now.date) didInitialScroll.current = null;
                }}
                onClose={closePicker}
              />
            )}
          </span>
          <button className={styles.iconBtn} onClick={() => setDate((d) => addDays(d, 1))} aria-label="次の日">
            ›
          </button>
          <button
            className={styles.btn}
            data-active={isToday || undefined}
            onClick={() => {
              setDate(now.date);
              didInitialScroll.current = null;
            }}
          >
            今日
          </button>
          <span className={styles.count}>{activeCount}件</span>
        </div>

        <div className={styles.group} role="group" aria-label="時間軸の拡大縮小">
          <button className={styles.iconBtn} onClick={() => gridRef.current?.zoomBy(1 / 1.25)} aria-label="縮小">
            −
          </button>
          <input
            className={styles.zoomRange}
            type="range"
            min={Math.log(MIN_PX_PER_MIN)}
            max={Math.log(MAX_PX_PER_MIN)}
            step={0.01}
            value={Math.log(scale)}
            onChange={(e) => setScale(clampScale(Math.exp(Number(e.target.value))))}
            aria-label={`拡大率 ${zoomPercent}%`}
          />
          <button className={styles.iconBtn} onClick={() => gridRef.current?.zoomBy(1.25)} aria-label="拡大">
            ＋
          </button>
          <button className={styles.btn} onClick={() => gridRef.current?.fitAll()} title="1日全体を画面に収める">
            全体
          </button>
          {isToday && (
            <button
              className={styles.btn}
              onClick={() => gridRef.current?.scrollToMinute(now.minutes - 30)}
              title="現在時刻へ移動"
            >
              今
            </button>
          )}
        </div>

        <div className={styles.group}>
          {bundle && (
            <select
              className={styles.select}
              value={laneFilter}
              onChange={(e) => setLaneFilter(e.target.value)}
              aria-label="表示するレーン"
            >
              <option value={ALL_LANES}>全レーン</option>
              {bundle.lanes.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.shortName}
                </option>
              ))}
            </select>
          )}
          <button
            className={styles.btn}
            data-active={maskNames || undefined}
            onClick={() => setMaskNames((v) => !v)}
            aria-pressed={maskNames}
            title="患者から画面が見える場所で使う"
          >
            <span className={styles.long}>氏名を伏せる</span>
            <span className={styles.short}>伏字</span>
          </button>
          <button
            className={styles.btn}
            data-active={showCancelled || undefined}
            onClick={() => setShowCancelled((v) => !v)}
            aria-pressed={showCancelled}
          >
            <span className={styles.long}>キャンセル表示</span>
            <span className={styles.short}>取消</span>
          </button>
          <button
            className={styles.iconBtn}
            onClick={() => {
              const el = document.documentElement;
              if (document.fullscreenElement) document.exitFullscreen?.();
              else if (el.requestFullscreen) el.requestFullscreen().catch(() => showToast("全画面表示にできませんでした"));
              else showToast("この端末は全画面表示に対応していません。ホーム画面に追加すると広く使えます");
            }}
            aria-label="全画面表示"
            title="全画面表示"
          >
            ⛶
          </button>
          {me && (
            <button
              className={styles.btn}
              title="ログイン中のスタッフ（押すと交代）"
              onClick={async () => {
                if (!window.confirm(`${me.name} をログアウトして、スタッフを交代しますか？`)) return;
                await logout();
                window.location.replace(withBase("/login/"));
              }}
            >
              {me.name} ⇄
            </button>
          )}
          <Link href="/patients" className={styles.iconBtn} aria-label="患者" title="患者の検索・編集">
            👤
          </Link>
                    <Link href="/settings" className={styles.iconBtn} aria-label="設定（レーン・メニュー）" title="設定（レーン・メニュー）">
            ⚙
          </Link>
        </div>
      </header>

      <main className={styles.main}>
        {loadError && !bundle && <div className={styles.empty}>{loadError}</div>}
        {!bundle && !loadError && <div className={styles.empty}>読み込み中…</div>}
        {bundle && (
          <DayGrid
            ref={gridRef}
            bundle={bundle}
            lanes={lanes}
            scale={scale}
            onScaleChange={setScale}
            maskNames={maskNames}
            showCancelled={showCancelled}
            selectedId={selectedId}
            nowMinutes={isToday ? now.minutes : null}
            onSelect={setSelectedId}
            onMove={onMove}
            onCreateAt={(laneId, minute) => setCreateAt({ laneId, minute })}
          />
        )}
        {bundle && selected && (
          <DetailPanel
            key={selected.id}
            bundle={bundle}
            reservation={selected}
            maskNames={maskNames}
            onClose={() => setSelectedId(null)}
            onStatus={(s) => onStatus(selected, s)}
            onMemo={(m) => onMemo(selected, m)}
            onRequestId={(v) => onRequestId(selected, v)}
            onEditPatient={() => setEditPatientId(selected.patientId)}
          />
        )}
      </main>

      {bundle && createAt && (
        <CreateDialog
          bundle={bundle}
          date={date}
          laneId={createAt.laneId}
          minute={createAt.minute}
          onClose={() => setCreateAt(null)}
          onCreated={(r) => {
            setCreateAt(null);
            showToast("予約を登録しました");
            load(date).then(() => setSelectedId(r.id));
          }}
        />
      )}

      {editPatientId && (
        <PatientDialog
          patientId={editPatientId}
          onClose={() => setEditPatientId(null)}
          onSaved={() => load(date)}
        />
      )}

      {toast && (
        <div className={styles.toast} data-kind={toast.kind} role="status">
          {toast.text}
        </div>
      )}
    </div>
  );
}

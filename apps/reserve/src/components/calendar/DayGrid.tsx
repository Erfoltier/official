"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { DayBundle, Lane, Patient, Reservation, Menu } from "@/lib/domain/types";
import { INACTIVE_STATUSES } from "@/lib/domain/types";
import { formatHm, minutesOfDay } from "@/lib/domain/time";
import { findConflicts, layoutLane } from "@/lib/calendar/layout";
import {
  anchoredScrollTop,
  clampScale,
  fitScale,
  snapMinutes,
  tickStepFor,
} from "@/lib/calendar/scale";
import { ReservationBlock } from "./ReservationBlock";
import styles from "./calendar.module.css";

export interface MoveTarget {
  laneId: string;
  startMin: number;
  endMin: number;
}

export interface DayGridHandle {
  /** 表示時間帯全体を画面の高さに収める */
  fitAll(): void;
  /** 指定時刻が上から1/4あたりに来るようにスクロール */
  scrollToMinute(min: number): void;
  /** 現在の表示の中心を保ったまま拡大率を変える */
  zoomBy(factor: number): void;
}

interface Props {
  bundle: DayBundle;
  lanes: Lane[];
  scale: number;
  onScaleChange: (scale: number) => void;
  maskNames: boolean;
  showCancelled: boolean;
  selectedId: string | null;
  nowMinutes: number | null;
  onSelect: (id: string | null) => void;
  onMove: (r: Reservation, to: MoveTarget) => void;
  onCreateAt: (laneId: string, minute: number) => void;
}

interface DragState {
  id: string;
  mode: "move" | "resize";
  pointerId: number;
  originX: number;
  originY: number;
  /** ブロック上端からつかんだ位置までの分 */
  grabOffsetMin: number;
  active: boolean;
  laneId: string;
  startMin: number;
  endMin: number;
}

const TIME_COL_PX = 48;
/**
 * 予約枠の最低の高さ（px）。これより短い枠は文字が読めないので、見た目だけ伸ばす。
 * 伸ばした分で次の予約と重なる場合は、横に並べて重ならないようにする。
 */
const MIN_BLOCK_PX = 15;
const LONG_PRESS_MS = 350;
const TOUCH_SLOP_PX = 8;
const MOUSE_SLOP_PX = 4;

export const DayGrid = forwardRef<DayGridHandle, Props>(function DayGrid(props, ref) {
  const {
    bundle,
    lanes,
    scale,
    onScaleChange,
    maskNames,
    showCancelled,
    selectedId,
    nowMinutes,
    onSelect,
    onMove,
    onCreateAt,
  } = props;
  const { clinic } = bundle;
  // 診療時間の外に予約が入っていても見えるよう、表示する時間帯を1時間単位で広げる
  const { dayStart, dayEnd } = useMemo(() => {
    let start = clinic.dayStartMin;
    let end = clinic.dayEndMin;
    for (const r of bundle.reservations) {
      if (INACTIVE_STATUSES.has(r.status)) continue;
      start = Math.min(start, Math.floor(minutesOfDay(r.startAt) / 60) * 60);
      const e = minutesOfDay(r.endAt) || 1440;
      end = Math.max(end, Math.min(1440, Math.ceil(e / 60) * 60));
    }
    return { dayStart: start, dayEnd: end };
  }, [bundle.reservations, clinic.dayStartMin, clinic.dayEndMin]);
  const totalMin = dayEnd - dayStart;

  const scrollerRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const scaleRef = useRef(scale);
  const pendingScrollTop = useRef<number | null>(null);
  const suppressClickUntil = useRef(0);
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);

  useLayoutEffect(() => {
    scaleRef.current = scale;
    const el = scrollerRef.current;
    if (el && pendingScrollTop.current !== null) {
      el.scrollTop = pendingScrollTop.current;
      pendingScrollTop.current = null;
    }
  }, [scale]);

  const headerHeight = () => headerRef.current?.offsetHeight ?? 0;

  /** clientY の位置にある時刻を動かさずに拡大率を変える */
  const zoomAt = useCallback(
    (nextScale: number, clientY: number | null) => {
      const el = scrollerRef.current;
      const old = scaleRef.current;
      const next = clampScale(nextScale);
      if (!el || next === old) return;
      const rect = el.getBoundingClientRect();
      const h = headerHeight();
      const focusY = clientY === null ? (rect.height - h) / 2 : clientY - rect.top - h;
      pendingScrollTop.current = anchoredScrollTop(el.scrollTop, Math.max(0, focusY), old, next);
      scaleRef.current = next;
      onScaleChange(next);
    },
    [onScaleChange],
  );

  useImperativeHandle(
    ref,
    () => ({
      fitAll() {
        const el = scrollerRef.current;
        if (!el) return;
        const avail = el.clientHeight - headerHeight() - 8;
        pendingScrollTop.current = 0;
        const next = fitScale(avail, totalMin);
        if (next === scaleRef.current) el.scrollTop = 0;
        scaleRef.current = next;
        onScaleChange(next);
      },
      scrollToMinute(min: number) {
        const el = scrollerRef.current;
        if (!el) return;
        const visible = el.clientHeight - headerHeight();
        el.scrollTop = Math.max(0, (min - dayStart) * scaleRef.current - visible / 4);
      },
      zoomBy(factor: number) {
        zoomAt(scaleRef.current * factor, null);
      },
    }),
    [dayStart, onScaleChange, totalMin, zoomAt],
  );

  // ピンチ（タッチ）と Ctrl+ホイール（PC・トラックパッドのピンチ）での拡大縮小
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    let pinch: { d0: number; s0: number } | null = null;
    let raf = 0;
    let latest: { scale: number; y: number } | null = null;

    const flush = () => {
      raf = 0;
      if (latest) zoomAt(latest.scale, latest.y);
      latest = null;
    };
    const schedule = (s: number, y: number) => {
      latest = { scale: s, y };
      if (!raf) raf = requestAnimationFrame(flush);
    };
    const dist = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const midY = (t: TouchList) => (t[0].clientY + t[1].clientY) / 2;

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2 && !dragRef.current?.active) {
        pinch = { d0: Math.max(10, dist(e.touches)), s0: scaleRef.current };
      }
    };
    const onTouchMove = (e: TouchEvent) => {
      if (pinch && e.touches.length === 2) {
        e.preventDefault();
        schedule(pinch.s0 * (dist(e.touches) / pinch.d0), midY(e.touches));
      }
    };
    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) pinch = null;
    };
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const dy = Math.max(-60, Math.min(60, e.deltaY));
      schedule((latest?.scale ?? scaleRef.current) * Math.exp(-dy * 0.01), e.clientY);
    };
    // iOS Safari 独自のジェスチャーイベント（ページ全体の拡大）を止める
    const stopGesture = (e: Event) => e.preventDefault();

    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd, { passive: true });
    el.addEventListener("touchcancel", onTouchEnd, { passive: true });
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("gesturestart", stopGesture);
    el.addEventListener("gesturechange", stopGesture);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchEnd);
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("gesturestart", stopGesture);
      el.removeEventListener("gesturechange", stopGesture);
    };
  }, [zoomAt]);

  const patients = useMemo(() => new Map<string, Patient>(bundle.patients.map((p) => [p.id, p])), [bundle.patients]);
  const menus = useMemo(
    () => new Map<string, Menu>(bundle.menus.map((t) => [t.id, t])),
    [bundle.menus],
  );
  const byId = useMemo(() => new Map(bundle.reservations.map((r) => [r.id, r])), [bundle.reservations]);

  /** レーンごとの予約（分単位）と横並び配置・重複 */
  const laneData = useMemo(() => {
    return lanes.map((lane) => {
      const items = bundle.reservations
        .filter((r) => r.laneId === lane.id && (showCancelled || !INACTIVE_STATUSES.has(r.status)))
        .map((r) => {
          const start = minutesOfDay(r.startAt);
          const end = minutesOfDay(r.endAt) || 1440;
          return { r, start, end, visualEnd: Math.max(end, start + MIN_BLOCK_PX / scale) };
        });
      const active = items.filter((i) => !INACTIVE_STATUSES.has(i.r.status));
      const placed = layoutLane(items.map((i) => ({ id: i.r.id, start: i.start, end: i.visualEnd })));
      const conflicts = findConflicts(active.map((i) => ({ id: i.r.id, start: i.start, end: i.end })));
      return { lane, items, placed, conflicts, activeCount: active.length };
    });
  }, [bundle.reservations, lanes, scale, showCancelled]);

  // ---- ドラッグ（移動・時間変更） ----

  const minuteAtClientY = (clientY: number) => {
    const rect = bodyRef.current!.getBoundingClientRect();
    return (clientY - rect.top) / scaleRef.current + dayStart;
  };
  const laneAtClientX = (clientX: number): string | null => {
    const rect = bodyRef.current!.getBoundingClientRect();
    const lanesLeft = rect.left + TIME_COL_PX;
    const w = (rect.width - TIME_COL_PX) / lanes.length;
    const idx = Math.floor((clientX - lanesLeft) / w);
    return lanes[Math.max(0, Math.min(lanes.length - 1, idx))]?.id ?? null;
  };

  const updateDrag = (next: DragState | null) => {
    dragRef.current = next;
    setDrag(next);
  };

  const beginPointer = (e: ReactPointerEvent, r: Reservation, mode: DragState["mode"]) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (INACTIVE_STATUSES.has(r.status)) return;
    e.stopPropagation();
    // マウスでドラッグしたときに周りの文字が選択されないようにする
    if (e.pointerType === "mouse") e.preventDefault();
    const start = minutesOfDay(r.startAt);
    const end = minutesOfDay(r.endAt) || 1440;
    const state: DragState = {
      id: r.id,
      mode,
      pointerId: e.pointerId,
      originX: e.clientX,
      originY: e.clientY,
      grabOffsetMin: minuteAtClientY(e.clientY) - start,
      active: false,
      laneId: r.laneId,
      startMin: start,
      endMin: end,
    };
    dragRef.current = state;
    const isTouch = e.pointerType !== "mouse";
    const slop = isTouch ? TOUCH_SLOP_PX : MOUSE_SLOP_PX;
    // タッチでは、選択中の予約（スクロールしない設定）とつまみはすぐ動かせる。
    // それ以外は長押しでドラッグ開始（普通に触ったときはスクロールを優先）
    const immediate = !isTouch || mode === "resize" || selectedId === r.id;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const blockScroll = (ev: TouchEvent) => {
      if (dragRef.current?.active) ev.preventDefault();
    };
    const activate = () => {
      const cur = dragRef.current;
      if (!cur || cur.id !== r.id) return;
      updateDrag({ ...cur, active: true });
      // ここで選ぶと右の詳細が開いて列の幅が変わり、指の下のレーンがずれる。選ぶのは離したとき
      if (isTouch) navigator.vibrate?.(10);
    };

    const onMoveEv = (ev: PointerEvent) => {
      if (ev.pointerId !== state.pointerId) return;
      const cur = dragRef.current;
      if (!cur) return;
      const moved = Math.hypot(ev.clientX - cur.originX, ev.clientY - cur.originY);
      if (!cur.active) {
        if (moved <= slop) return;
        if (!immediate) {
          // 長押し前に指が動いた → スクロールとみなしてドラッグしない
          cleanup();
          return;
        }
        activate();
      }
      const slot = clinic.slotMin;
      const dur = end - start;
      if (cur.mode === "move") {
        let s = snapMinutes(minuteAtClientY(ev.clientY) - cur.grabOffsetMin, slot);
        s = Math.max(dayStart, Math.min(dayEnd - dur, s));
        const laneId = laneAtClientX(ev.clientX) ?? cur.laneId;
        updateDrag({ ...dragRef.current!, active: true, laneId, startMin: s, endMin: s + dur });
      } else {
        let e2 = snapMinutes(minuteAtClientY(ev.clientY), slot);
        e2 = Math.max(start + slot, Math.min(dayEnd, e2));
        updateDrag({ ...dragRef.current!, active: true, endMin: e2 });
      }
    };

    const onUpEv = (ev: PointerEvent) => {
      if (ev.pointerId !== state.pointerId) return;
      const cur = dragRef.current;
      cleanup();
      if (!cur) return;
      if (!cur.active) {
        onSelect(r.id);
        suppressClickUntil.current = Date.now() + 300;
        return;
      }
      suppressClickUntil.current = Date.now() + 300;
      onSelect(r.id);
      if (cur.laneId !== r.laneId || cur.startMin !== start || cur.endMin !== end) {
        onMove(r, { laneId: cur.laneId, startMin: cur.startMin, endMin: cur.endMin });
      }
    };

    const onCancelEv = (ev: PointerEvent) => {
      if (ev.pointerId === state.pointerId) cleanup();
    };

    function cleanup() {
      if (timer) clearTimeout(timer);
      window.removeEventListener("pointermove", onMoveEv);
      window.removeEventListener("pointerup", onUpEv);
      window.removeEventListener("pointercancel", onCancelEv);
      window.removeEventListener("touchmove", blockScroll);
      updateDrag(null);
    }

    window.addEventListener("pointermove", onMoveEv);
    window.addEventListener("pointerup", onUpEv);
    window.addEventListener("pointercancel", onCancelEv);
    window.addEventListener("touchmove", blockScroll, { passive: false });
    if (!immediate) timer = setTimeout(activate, LONG_PRESS_MS);
  };

  const onLaneClick = (laneId: string, clientY: number) => {
    if (Date.now() < suppressClickUntil.current) return;
    if (selectedId) {
      onSelect(null);
      return;
    }
    const m = Math.floor(minuteAtClientY(clientY) / clinic.slotMin) * clinic.slotMin;
    if (m >= dayStart && m < dayEnd) onCreateAt(laneId, m);
  };

  // ---- 描画 ----

  const ticks = tickStepFor(scale);
  const firstHour = Math.ceil(dayStart / 60) * 60;
  const hourLabels: number[] = [];
  for (let m = firstHour; m < dayEnd; m += 60) hourLabels.push(m);
  const minorLabels: number[] = [];
  if (scale >= 3) {
    const step = scale >= 5 ? 15 : 30;
    for (let m = Math.ceil(dayStart / step) * step; m < dayEnd; m += step) if (m % 60 !== 0) minorLabels.push(m);
  }

  const gridStyle: CSSProperties = {
    "--lanes": lanes.length,
    "--time-col": `${TIME_COL_PX}px`,
    "--body-h": `${totalMin * scale}px`,
    "--hour-px": `${60 * scale}px`,
    "--minor-px": `${ticks.minor * scale}px`,
    "--hour-offset": `${((firstHour - dayStart) * scale) % (60 * scale)}px`,
    "--minor-offset": `${((Math.ceil(dayStart / ticks.minor) * ticks.minor - dayStart) * scale) % (ticks.minor * scale)}px`,
  } as CSSProperties;

  const dragged = drag?.active ? byId.get(drag.id) : undefined;

  return (
    <div ref={scrollerRef} className={styles.scroller} style={gridStyle} data-dragging={drag?.active || undefined}>
      <div ref={headerRef} className={styles.header}>
        <div className={styles.corner} aria-hidden />
        {laneData.map(({ lane, activeCount }) => (
          <div key={lane.id} className={styles.laneHead} title={lane.name}>
            <span className={styles.laneName}>{lane.name}</span>
            <span className={styles.laneShort}>{lane.shortName}</span>
            <span className={styles.laneCount}>{activeCount}件</span>
          </div>
        ))}
      </div>

      <div ref={bodyRef} className={styles.body}>
        <div className={styles.timeCol} aria-hidden>
          {hourLabels.map((m) => (
            <div key={m} className={styles.hourLabel} style={{ top: (m - dayStart) * scale }}>
              {formatHm(m)}
            </div>
          ))}
          {minorLabels.map((m) => (
            <div key={m} className={styles.minorLabel} style={{ top: (m - dayStart) * scale }}>
              {formatHm(m)}
            </div>
          ))}
          {nowMinutes !== null && nowMinutes >= dayStart && nowMinutes <= dayEnd && (
            <div className={styles.nowLabel} style={{ top: (nowMinutes - dayStart) * scale }}>
              {formatHm(nowMinutes)}
            </div>
          )}
        </div>

        {laneData.map(({ lane, items, placed, conflicts }) => (
          <div
            key={lane.id}
            className={styles.laneCol}
            data-drop-target={drag?.active && drag.laneId === lane.id ? true : undefined}
            onClick={(e) => onLaneClick(lane.id, e.clientY)}
          >
            {items.map(({ r, start, end, visualEnd }) => {
              const p = placed.get(r.id);
              const isDragged = drag?.active && drag.id === r.id;
              return (
                <ReservationBlock
                  key={r.id}
                  reservation={r}
                  patient={patients.get(r.patientId)}
                  menus={r.menuIds.map((id) => menus.get(id)).filter((t): t is Menu => !!t)}
                  stages={bundle.stages}
                  top={(start - dayStart) * scale}
                  height={(visualEnd - start) * scale}
                  col={p?.col ?? 0}
                  cols={p?.cols ?? 1}
                  startMin={start}
                  endMin={end}
                  maskNames={maskNames}
                  selected={selectedId === r.id}
                  conflict={conflicts.has(r.id)}
                  faded={!!isDragged}
                  onPointerDown={(e, mode) => beginPointer(e, r, mode)}
                  onActivate={() => onSelect(r.id)}
                />
              );
            })}
            {dragged && drag && drag.laneId === lane.id && (
              <ReservationBlock
                reservation={dragged}
                patient={patients.get(dragged.patientId)}
                menus={dragged.menuIds.map((id) => menus.get(id)).filter((t): t is Menu => !!t)}
                stages={bundle.stages}
                top={(drag.startMin - dayStart) * scale}
                height={Math.max(MIN_BLOCK_PX, (drag.endMin - drag.startMin) * scale)}
                col={0}
                cols={1}
                startMin={drag.startMin}
                endMin={drag.endMin}
                maskNames={maskNames}
                selected
                ghost
              />
            )}
          </div>
        ))}

        {nowMinutes !== null && nowMinutes >= dayStart && nowMinutes <= dayEnd && (
          <div className={styles.nowLine} style={{ top: (nowMinutes - dayStart) * scale }} aria-hidden />
        )}
      </div>
    </div>
  );
});

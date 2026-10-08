"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent, type DragEvent as ReactDragEvent, type KeyboardEvent as ReactKeyboardEvent } from "react";
import type { PatientFile } from "@/lib/domain/types";
import { ApiError, fetchFiles, fileUrl } from "@/components/calendar/api";
import styles from "./photoCompare.module.css";

/** 並べる枚数の選択肢 */
const COUNTS = [1, 2, 3, 4, 6] as const;
const MAX_SCALE = 8;

interface View {
  s: number;
  x: number;
  y: number;
}
const RESET: View = { s: 1, x: 0, y: 0 };

/** ネオボワールのファイル名「顧客番号_回_向き_光_氏名」から向きと光を読む。違う形なら空 */
function shotInfo(f: PatientFile): { angle: string; light: string } {
  if (f.source !== "neovoir") return { angle: "", light: "" };
  const parts = f.name.replace(/\.[^.]+$/, "").split("_");
  return parts.length >= 5 ? { angle: parts[2], light: parts[3] } : { angle: "", light: "" };
}

const dotDate = (d: string) => d.replaceAll("-", ".");
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
const thumbUrl = (id: string) => `${fileUrl(id)}?size=thumb`;
const viewable = (f: PatientFile) => f.kind === "image" && !f.deleted && f.type !== "image/heic" && f.type !== "image/heif";

/** 枠の下の日付の行の高さ（px） */
const META_H = 26;
const GAP = 12;

/**
 * 並べ方を決める：写真の縦横比（幅÷高さ）のまま、余白なくいちばん大きく収まる列数を選ぶ。
 * 縦長の写真を横に2枚、スマホの縦画面なら上下に2枚、のように画面の形に合わせて変わる
 */
function bestLayout(n: number, w: number, h: number, ar: number): { cols: number; pw: number; ph: number } {
  let best = { cols: 1, pw: 0, ph: 0 };
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    const cellW = (w - GAP * (cols - 1)) / cols;
    const cellH = (h - GAP * (rows - 1)) / rows - META_H;
    if (cellW <= 0 || cellH <= 0) continue;
    const pw = Math.min(cellW, cellH * ar);
    if (pw > best.pw) best = { cols, pw: Math.floor(pw), ph: Math.floor(pw / ar) };
  }
  return best;
}

/**
 * 写真比較（アルバムモード）。患者の写真から好きなものを枠へ入れ（ドラッグ／タップ）、なるべく大きく並べて経過を比べる。
 * 下の帯は縮小版だけを読み、大きい写真は枠に入れた分だけ読む
 */
export function PhotoCompare(props: { patientId: string; patientName: string; onClose: () => void }) {
  const { patientId, onClose } = props;
  const dialogRef = useRef<HTMLDialogElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const [files, setFiles] = useState<PatientFile[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [count, setCount] = useState<number>(2);
  const [slots, setSlots] = useState<(string | null)[]>([null, null]);
  const [active, setActive] = useState(0);
  const [focus, setFocus] = useState<number | null>(null);
  const [linked, setLinked] = useState(true);
  const [views, setViews] = useState<View[]>([]);
  const [light, setLight] = useState<string>("");
  const [dropOver, setDropOver] = useState<number | null>(null);
  const stageRef = useRef<HTMLElement>(null);
  const [stageSize, setStageSize] = useState({ w: 0, h: 0 });
  /** 写真の縦横比（幅÷高さ）。最初に表示した写真から読む。ネオボワールは縦長 */
  const [ar, setAr] = useState(3 / 4);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setStageSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const d = dialogRef.current;
    if (d && !d.open) d.showModal();
  }, []);

  useEffect(() => {
    let alive = true;
    fetchFiles(patientId)
      .then((all) => {
        if (!alive) return;
        const imgs = all.filter(viewable).sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
        setFiles(imgs);
        // はじめは、最初の写真と同じ向き・光の「いちばん古い1枚」と「いちばん新しい1枚」を並べる
        if (imgs.length) {
          const first = shotInfo(imgs[0]);
          const same = imgs.filter((f) => {
            const i = shotInfo(f);
            return i.angle === first.angle && i.light === first.light;
          });
          const pick = same.length > 1 ? [same[0].id, same[same.length - 1].id] : [imgs[0].id, imgs.length > 1 ? imgs[imgs.length - 1].id : null];
          setSlots(pick);
          setLight(first.light);
        }
      })
      .catch((err) => alive && setError(err instanceof ApiError ? err.message : "写真を読み込めませんでした"));
    return () => {
      alive = false;
    };
  }, [patientId]);

  // 下の帯は最新の写真が見えるよう右端から
  useEffect(() => {
    const el = stripRef.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [files, light]);

  const byId = useMemo(() => new Map((files ?? []).map((f) => [f.id, f])), [files]);
  const dates = useMemo(() => [...new Set((files ?? []).map((f) => f.date))], [files]);
  const lights = useMemo(() => [...new Set((files ?? []).map((f) => shotInfo(f).light).filter(Boolean))], [files]);
  const groups = useMemo(() => {
    const list = (files ?? []).filter((f) => !light || shotInfo(f).light === light || !shotInfo(f).light);
    const out: { date: string; items: PatientFile[] }[] = [];
    for (const f of list) {
      const last = out[out.length - 1];
      if (last && last.date === f.date) last.items.push(f);
      else out.push({ date: f.date, items: [f] });
    }
    return out;
  }, [files, light]);

  const changeCount = (n: number) => {
    setCount(n);
    setFocus(null);
    setSlots((cur) => Array.from({ length: n }, (_, i) => cur[i] ?? null));
    setActive((a) => Math.min(a, n - 1));
  };

  const place = useCallback(
    (id: string, at?: number) => {
      setFocus(null);
      setSlots((cur) => {
        const next = [...cur];
        let i = at ?? next.indexOf(null);
        if (i < 0) i = active;
        const from = next.indexOf(id);
        if (from >= 0 && from !== i) next[from] = next[i];
        next[i] = id;
        return next;
      });
      setViews((v) => {
        const n = [...v];
        if (at !== undefined) n[at] = RESET;
        return n;
      });
    },
    [active],
  );

  const swap = (a: number, b: number) =>
    setSlots((cur) => {
      const next = [...cur];
      [next[a], next[b]] = [next[b], next[a]];
      return next;
    });

  const sortByDate = () =>
    setSlots((cur) => {
      const filled = cur.filter((id): id is string => !!id && byId.has(id)).sort((a, b) => byId.get(a)!.date.localeCompare(byId.get(b)!.date));
      return Array.from({ length: cur.length }, (_, i) => filled[i] ?? null);
    });

  // ---- 拡大・移動（連動中は全部の枠が同じ倍率・同じ場所） ----
  const viewOf = (i: number): View => (linked ? views[0] : views[i]) ?? RESET;
  const setView = (i: number, f: (v: View) => View) =>
    setViews((cur) => {
      const n = [...cur];
      if (linked) {
        const v = f(n[0] ?? RESET);
        return n.length ? n.map(() => v) : [v];
      }
      n[i] = f(n[i] ?? RESET);
      return n;
    });
  const clampView = (v: View): View => (v.s <= 1 ? RESET : v);
  const zoomAt = (i: number, el: HTMLElement, clientX: number, clientY: number, factor: number) => {
    const r = el.getBoundingClientRect();
    const px = clientX - r.left - r.width / 2;
    const py = clientY - r.top - r.height / 2;
    setView(i, (v) => {
      const s = Math.min(MAX_SCALE, Math.max(1, v.s * factor));
      const k = s / v.s;
      return clampView({ s, x: px - (px - v.x) * k, y: py - (py - v.y) * k });
    });
  };
  /** 枠の真ん中を中心に拡大・縮小（キーボード用） */
  const zoomCenter = (i: number, factor: number) =>
    setView(i, (v) => {
      const s = Math.min(MAX_SCALE, Math.max(1, v.s * factor));
      const k = s / v.s;
      return clampView({ s, x: v.x * k, y: v.y * k });
    });

  // ---- 全画面（ブラウザの全画面表示。タスクバーなども隠れる） ----
  const [fullscreen, setFullscreen] = useState(false);
  const canFullscreen = typeof document !== "undefined" && !!document.documentElement.requestFullscreen;
  useEffect(() => {
    const on = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", on);
    return () => {
      document.removeEventListener("fullscreenchange", on);
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    };
  }, []);
  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    else void document.documentElement.requestFullscreen?.().catch(() => {});
  }, []);

  // ---- キーボード：＋ / − で拡大・縮小、0 で元に戻す、矢印で移動、F で全画面 ----
  const onKeyDown = (e: ReactKeyboardEvent<HTMLDialogElement>) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const i = focus ?? active;
    const step = 60;
    switch (e.key) {
      case "+":
      case "=":
      case ";":
        zoomCenter(i, 1.25);
        break;
      case "-":
      case "_":
        zoomCenter(i, 1 / 1.25);
        break;
      case "0":
        setView(i, () => RESET);
        break;
      case "ArrowLeft":
      case "ArrowRight":
      case "ArrowUp":
      case "ArrowDown": {
        const dx = e.key === "ArrowLeft" ? step : e.key === "ArrowRight" ? -step : 0;
        const dy = e.key === "ArrowUp" ? step : e.key === "ArrowDown" ? -step : 0;
        setView(i, (v) => (v.s > 1 ? { ...v, x: v.x + dx, y: v.y + dy } : v));
        break;
      }
      case "f":
      case "F":
        toggleFullscreen();
        break;
      default:
        return;
    }
    e.preventDefault();
  };
  const onWheel = (i: number) => (e: ReactWheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    zoomAt(i, e.currentTarget, e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0015));
  };
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ d: number } | null>(null);
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { d: Math.hypot(a.x - b.x, a.y - b.y) };
    }
  };
  const onPointerMove = (i: number) => (e: ReactPointerEvent<HTMLDivElement>) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      zoomAt(i, e.currentTarget, (a.x + b.x) / 2, (a.y + b.y) / 2, d / pinch.current.d);
      pinch.current = { d };
      return;
    }
    const dx = e.clientX - prev.x;
    const dy = e.clientY - prev.y;
    setView(i, (v) => (v.s > 1 ? { ...v, x: v.x + dx, y: v.y + dy } : v));
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
  };

  // ---- ドラッグで入れる・入れ替える ----
  const onDrop = (i: number) => (e: ReactDragEvent) => {
    e.preventDefault();
    setDropOver(null);
    const data = e.dataTransfer.getData("text/plain");
    if (data.startsWith("f:")) place(data.slice(2), i);
    else if (data.startsWith("s:")) swap(Number(data.slice(2)), i);
  };

  // ---- 指でのドラッグ（Android などはブラウザのドラッグが指で動かないため自前で行う） ----
  // 下の帯の写真は「上へ引き上げる」とつかむ（横の動きは帯のスクロールのまま）。枠の ⠿ は押してすぐつかむ
  const [touchDrag, setTouchDrag] = useState<{ data: string; src?: string; x: number; y: number } | null>(null);
  const pending = useRef<{ data: string; src?: string; x: number; y: number; id: number } | null>(null);
  const suppressClick = useRef(false);
  const slotAt = (x: number, y: number): number | null => {
    const el = document.elementFromPoint(x, y)?.closest("[data-slot]");
    return el ? Number(el.getAttribute("data-slot")) : null;
  };
  const touchStart = (data: string, src: string | undefined, immediate: boolean) => (e: ReactPointerEvent<HTMLElement>) => {
    if (e.pointerType === "mouse") return;
    e.stopPropagation();
    if (immediate) {
      e.currentTarget.setPointerCapture(e.pointerId);
      setTouchDrag({ data, src, x: e.clientX, y: e.clientY });
    } else pending.current = { data, src, x: e.clientX, y: e.clientY, id: e.pointerId };
  };
  const touchMove = (e: ReactPointerEvent<HTMLElement>) => {
    if (e.pointerType === "mouse") return;
    const p = pending.current;
    if (!touchDrag && p && p.id === e.pointerId) {
      const dx = e.clientX - p.x;
      const dy = e.clientY - p.y;
      if (dy < -12 && Math.abs(dy) > Math.abs(dx)) {
        e.currentTarget.setPointerCapture(e.pointerId);
        pending.current = null;
        setTouchDrag({ data: p.data, src: p.src, x: e.clientX, y: e.clientY });
      }
      return;
    }
    if (touchDrag) {
      e.stopPropagation();
      setTouchDrag({ ...touchDrag, x: e.clientX, y: e.clientY });
      setDropOver(slotAt(e.clientX, e.clientY));
    }
  };
  const touchEnd = (e: ReactPointerEvent<HTMLElement>) => {
    pending.current = null;
    if (!touchDrag) return;
    e.stopPropagation();
    const i = slotAt(e.clientX, e.clientY);
    if (i !== null) {
      if (touchDrag.data.startsWith("f:")) place(touchDrag.data.slice(2), i);
      else swap(Number(touchDrag.data.slice(2)), i);
    }
    suppressClick.current = true;
    setTouchDrag(null);
    setDropOver(null);
  };
  const touchHandlers = (data: string, src: string | undefined, immediate: boolean) => ({
    onPointerDown: touchStart(data, src, immediate),
    onPointerMove: touchMove,
    onPointerUp: touchEnd,
    onPointerCancel: () => {
      pending.current = null;
      setTouchDrag(null);
      setDropOver(null);
    },
  });

  const filled = slots.filter((id): id is string => !!id && byId.has(id));
  const earliest = filled.map((id) => byId.get(id)!.date).sort()[0];
  const shown = focus !== null ? [focus] : slots.map((_, i) => i);
  // 1枚のときは枠を画面いっぱいに取る。等倍では写真の形のまま見え、拡大すると左右（上下）の余白まで使って大きく映す
  const single = shown.length === 1;
  const layout = single
    ? { cols: 1, pw: Math.floor(stageSize.w), ph: Math.max(0, Math.floor(stageSize.h - META_H)) }
    : bestLayout(shown.length, stageSize.w, stageSize.h, ar);

  return (
    <dialog ref={dialogRef} className={styles.dialog} onKeyDown={onKeyDown} onClose={onClose} onCancel={onClose} aria-label="写真比較">
      <div className={styles.shell}>
        <header className={styles.top}>
          <div className={styles.titleBox}>
            <div className={styles.title}>写真比較</div>
            <div className={styles.sub}>{props.patientName}</div>
          </div>
          <button type="button" className={styles.chip} data-on={linked || undefined} onClick={() => setLinked((v) => !v)} title="1枚を拡大・移動すると、ほかの枚も同じ場所を同じ倍率で映します">
            ↔ 拡大・移動を連動
          </button>
          <button type="button" className={styles.chip} onClick={sortByDate}>
            撮影日順に並べる
          </button>
          <button type="button" className={styles.chip} onClick={() => setViews([])}>
            拡大を戻す
          </button>
          <span className={styles.hint}>下の写真を枠へドラッグ（タップでも入ります）／枠どうしは ⠿ で入れ替え／拡大：ホイール・2本指・＋−キー（0で戻す・矢印で移動・Fで全画面）</span>
          <div className={styles.seg} role="group" aria-label="並べる枚数">
            {COUNTS.map((n) => (
              <button key={n} type="button" data-on={n === count || undefined} onClick={() => changeCount(n)}>
                {n}
              </button>
            ))}
            <span className={styles.segUnit} aria-hidden>
              枚
            </span>
          </div>
          {canFullscreen && (
            <button type="button" className={styles.chip} data-on={fullscreen || undefined} onClick={toggleFullscreen} title="画面いっぱいに表示（F キー）">
              {fullscreen ? "全画面を終える" : "⛶ 全画面"}
            </button>
          )}
          <button type="button" className={styles.close} onClick={() => dialogRef.current?.close()} aria-label="閉じる">
            ✕
          </button>
        </header>

        <main ref={stageRef} className={styles.stage} data-single={single || undefined} style={{ gridTemplateColumns: `repeat(${layout.cols}, ${layout.pw || 0}px)`, gridAutoRows: `${layout.ph + META_H}px` }}>
          {error ? (
            <p className={styles.message}>{error}</p>
          ) : files === null ? (
            <p className={styles.message}>写真を読み込んでいます…</p>
          ) : files.length === 0 ? (
            <p className={styles.message}>この患者さんの写真はまだありません</p>
          ) : (
            shown.map((i) => {
              const f = slots[i] ? byId.get(slots[i]!) : undefined;
              const v = viewOf(i);
              return (
                <section
                  key={i}
                  className={styles.slot}
                  data-slot={i}
                  data-active={i === active || undefined}
                  data-over={dropOver === i || undefined}
                  onClick={() => setActive(i)}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDropOver(i);
                  }}
                  onDragLeave={() => setDropOver((d) => (d === i ? null : d))}
                  onDrop={onDrop(i)}
                >
                  {f ? (
                    <>
                      <div
                        className={styles.photo}
                        onWheel={onWheel(i)}
                        onPointerDown={onPointerDown}
                        onPointerMove={onPointerMove(i)}
                        onPointerUp={onPointerUp}
                        onPointerCancel={onPointerUp}
                        onDoubleClick={() => setView(i, () => RESET)}
                        data-zoomed={v.s > 1 || undefined}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={fileUrl(f.id)}
                          alt=""
                          draggable={false}
                          decoding="async"
                          onLoad={(e) => {
                            const im = e.currentTarget;
                            if (im.naturalWidth && im.naturalHeight) setAr((cur) => (Math.abs(cur - im.naturalWidth / im.naturalHeight) > 0.01 ? im.naturalWidth / im.naturalHeight : cur));
                          }}
                          style={{ transform: `translate3d(${v.x}px, ${v.y}px, 0) scale(${v.s})` }}
                        />
                        <span className={styles.badge} data-before={f.date === earliest || undefined}>
                          {f.date === earliest ? "Before" : `+${daysBetween(earliest!, f.date)}日`}
                        </span>
                        <div className={styles.tools}>
                          <span
                            className={styles.grip}
                            {...touchHandlers(`s:${i}`, thumbUrl(f.id), true)}
                            draggable
                            onDragStart={(e) => {
                              e.dataTransfer.setData("text/plain", `s:${i}`);
                              e.dataTransfer.effectAllowed = "move";
                            }}
                            title="ドラッグでほかの枠と入れ替え"
                          >
                            ⠿
                          </span>
                          <button type="button" onClick={() => setFocus(focus === i ? null : i)} title={focus === i ? "並べた表示に戻す" : "この1枚を大きく"}>
                            {focus === i ? "⤡" : "⤢"}
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setFocus(null);
                              setSlots((cur) => cur.map((id, k) => (k === i ? null : id)));
                            }}
                            title="枠から外す"
                          >
                            ✕
                          </button>
                        </div>
                      </div>
                      <div className={styles.meta}>
                        <span className={styles.date}>{dotDate(f.date)}</span>
                        <span className={styles.tag}>
                          {[shotInfo(f).angle, shotInfo(f).light].filter(Boolean).join("・")}
                          {shotInfo(f).angle ? "　" : ""}
                          {dates.indexOf(f.date) + 1}回目の撮影
                        </span>
                      </div>
                    </>
                  ) : (
                    <div className={styles.empty}>
                      <span>ここへ写真をドラッグ</span>
                      <small>タブレット・スマホは、下の写真を指で上へ引き上げてここで離す。この枠を選んでから写真をタップでも入ります</small>
                    </div>
                  )}
                </section>
              );
            })
          )}
        </main>

        <footer className={styles.stripWrap}>
          {lights.length > 1 && (
            <div className={styles.filters}>
              <button type="button" data-on={!light || undefined} onClick={() => setLight("")}>
                すべて
              </button>
              {lights.map((l) => (
                <button key={l} type="button" data-on={light === l || undefined} onClick={() => setLight(l)}>
                  {l}
                </button>
              ))}
            </div>
          )}
          <div className={styles.strip} ref={stripRef}>
            {groups.map((g) => (
              <div key={g.date} className={styles.group}>
                <h4>{dotDate(g.date)}</h4>
                <div className={styles.thumbs}>
                  {g.items.map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      className={styles.thumb}
                      data-used={slots.includes(f.id) || undefined}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData("text/plain", `f:${f.id}`);
                        e.dataTransfer.effectAllowed = "copy";
                      }}
                      {...touchHandlers(`f:${f.id}`, thumbUrl(f.id), false)}
                      onClick={() => {
                        if (suppressClick.current) {
                          suppressClick.current = false;
                          return;
                        }
                        place(f.id, slots[active] === null ? active : slots.includes(null) ? undefined : active);
                      }}
                      title={f.name}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={thumbUrl(f.id)} alt="" loading="lazy" decoding="async" draggable={false} />
                      {shotInfo(f).angle && <span className={styles.thumbLabel}>{shotInfo(f).angle}</span>}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </footer>
      </div>
      {touchDrag?.src && (
        // eslint-disable-next-line @next/next/no-img-element
        <img className={styles.ghost} src={touchDrag.src} alt="" style={{ transform: `translate3d(${touchDrag.x - 34}px, ${touchDrag.y - 60}px, 0)` }} />
      )}
    </dialog>
  );
}

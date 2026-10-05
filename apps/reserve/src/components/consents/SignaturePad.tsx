"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./consents.module.css";

/** 指・ペン・マウスで署名を書く欄。書き終えたら PNG（data URL）を返す */
export function SignaturePad({ onDone, onCancel, busy }: { onDone(png: string): void; onCancel(): void; busy?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawing = useRef<{ id: number; x: number; y: number } | null>(null);
  const [empty, setEmpty] = useState(true);

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const rect = c.getBoundingClientRect();
    c.width = Math.round(rect.width * dpr);
    c.height = Math.round(rect.height * dpr);
    const ctx = c.getContext("2d")!;
    ctx.scale(dpr, dpr);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = 2.6;
    ctx.strokeStyle = "#111827";
  }, []);

  const pos = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const clear = () => {
    const c = ref.current!;
    c.getContext("2d")!.clearRect(0, 0, c.width, c.height);
    setEmpty(true);
  };

  return (
    <div className={styles.padWrap}>
      <p className={styles.padHint}>枠の中に、指またはペンでお名前をご記入ください</p>
      <canvas
        ref={ref}
        className={styles.pad}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          drawing.current = { id: e.pointerId, ...pos(e) };
          const ctx = ref.current!.getContext("2d")!;
          ctx.beginPath();
          ctx.arc(drawing.current.x, drawing.current.y, 1.2, 0, Math.PI * 2);
          ctx.fillStyle = "#111827";
          ctx.fill();
          setEmpty(false);
        }}
        onPointerMove={(e) => {
          const d = drawing.current;
          if (!d || d.id !== e.pointerId) return;
          const p = pos(e);
          const ctx = ref.current!.getContext("2d")!;
          ctx.beginPath();
          ctx.moveTo(d.x, d.y);
          ctx.lineTo(p.x, p.y);
          ctx.stroke();
          drawing.current = { id: d.id, ...p };
        }}
        onPointerUp={() => (drawing.current = null)}
        onPointerCancel={() => (drawing.current = null)}
        aria-label="署名欄"
      />
      <div className={styles.padActions}>
        <button type="button" className={styles.btn} onClick={clear} disabled={busy}>
          書き直す
        </button>
        <span className={styles.spacer} />
        <button type="button" className={styles.btn} onClick={onCancel} disabled={busy}>
          やめる
        </button>
        <button type="button" className={styles.primaryBtn} disabled={empty || busy} onClick={() => onDone(ref.current!.toDataURL("image/png"))}>
          {busy ? "保存中…" : "署名して保存"}
        </button>
      </div>
    </div>
  );
}

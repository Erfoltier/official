"use client";

/** "HH:MM" → その日の0時からの分。空や不正なら undefined（＝今の時刻） */
export function parseHm(v: string): number | undefined {
  const m = /^(\d{1,2}):(\d{2})$/.exec(v.trim());
  if (!m) return undefined;
  const min = Number(m[1]) * 60 + Number(m[2]);
  return min >= 0 && min < 1440 ? min : undefined;
}

/** 状態を変えた時刻の入力（空欄なら押した時刻になる） */
export function StageTimeInput({ value, onChange, className }: { value: string; onChange(v: string): void; className?: string }) {
  return (
    <label className={className}>
      <span>時刻</span>
      <input type="time" step={60} value={value} onChange={(e) => onChange(e.target.value)} aria-label="状態を変えた時刻（空欄なら今の時刻）" />
      {value ? (
        <button type="button" onClick={() => onChange("")} aria-label="時刻を空欄に戻す">
          ×
        </button>
      ) : (
        <small>空欄＝今</small>
      )}
    </label>
  );
}

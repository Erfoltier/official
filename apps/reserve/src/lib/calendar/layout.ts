import { overlaps } from "@/lib/domain/time";

export interface Interval {
  id: string;
  start: number;
  end: number;
}

export interface PlacedInterval {
  id: string;
  /** 重なりグループ内の列番号（0始まり） */
  col: number;
  /** 重なりグループの列数 */
  cols: number;
}

/**
 * 同じレーン内で時間が重なる予約を横に並べる配置を計算する。
 *
 * 重なりが連鎖する予約をひとまとまり（クラスタ）にし、クラスタ内で
 * 空いている一番左の列に詰める。列数はクラスタ単位で揃えるので、
 * 重なっていない予約はレーン幅いっぱいに表示される。
 */
export function layoutLane(items: Interval[]): Map<string, PlacedInterval> {
  const sorted = [...items].sort(
    (a, b) => a.start - b.start || b.end - b.start - (a.end - a.start) || a.id.localeCompare(b.id),
  );
  const result = new Map<string, PlacedInterval>();

  let cluster: { id: string; col: number }[] = [];
  let colEnds: number[] = [];
  let clusterEnd = -Infinity;

  const flush = () => {
    const cols = colEnds.length;
    for (const c of cluster) result.set(c.id, { id: c.id, col: c.col, cols });
    cluster = [];
    colEnds = [];
  };

  for (const it of sorted) {
    if (cluster.length > 0 && it.start >= clusterEnd) flush();
    let col = colEnds.findIndex((end) => end <= it.start);
    if (col === -1) {
      col = colEnds.length;
      colEnds.push(it.end);
    } else {
      colEnds[col] = it.end;
    }
    cluster.push({ id: it.id, col });
    clusterEnd = cluster.length === 1 ? it.end : Math.max(clusterEnd, it.end);
  }
  if (cluster.length > 0) flush();
  return result;
}

/** 同じレーンで時間が重なっている予約のIDを返す（重複予約の警告用） */
export function findConflicts(items: Interval[]): Set<string> {
  const sorted = [...items].sort((a, b) => a.start - b.start);
  const out = new Set<string>();
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length && sorted[j].start < sorted[i].end; j++) {
      if (overlaps(sorted[i].start, sorted[i].end, sorted[j].start, sorted[j].end)) {
        out.add(sorted[i].id);
        out.add(sorted[j].id);
      }
    }
  }
  return out;
}

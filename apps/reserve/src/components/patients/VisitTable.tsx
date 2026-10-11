"use client";

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import type { ChartEntry, PatientDetail, PriceItem, VisitRow } from "@/lib/domain/types";
import { INACTIVE_STATUSES, STATUS_LABEL } from "@/lib/domain/types";
import { formatHm, minutesOfDay, nowInClinic, clinicDateOf } from "@/lib/domain/time";
import { FileThumbs } from "@/components/files/FileThumbs";
import { FileUploader } from "@/components/files/FileUploader";
import { ReservationEditDialog } from "@/components/reservations/ReservationEditDialog";
import { RichText } from "@/components/richtext/RichText";
import { RichTextEditor } from "@/components/richtext/RichTextEditor";
import { skincareOptions, type SkincareOption } from "@/lib/domain/skincare";
import { fetchCharts, fetchPrices } from "@/components/calendar/api";
import { ChartCard } from "@/components/charts/ChartCard";
import { ChartDialog } from "@/components/charts/ChartDialog";
import { SkincarePicker } from "./SkincarePicker";
import styles from "./patients.module.css";

/** 料金表は画面を開いている間1回だけ読む（読めなければ設定の商品だけで動く） */
let pricesOnce: Promise<PriceItem[]> | null = null;
function loadPrices(): Promise<PriceItem[]> {
  pricesOnce ??= fetchPrices().then(
    (l) => l.items,
    () => {
      pricesOnce = null;
      return [];
    },
  );
  return pricesOnce;
}
import { calendarPath, withBase } from "@/lib/paths";

export interface VisitSave {
  note: string;
  skincare: string[];
  version: number;
}

type Res = VisitRow["reservations"][number];

/** 患者画面では、Airリザーブから移したときの「Air予約番号:…」の行は出さない（予約メモそのものには残す） */
function withoutAirNo(memo?: string): string {
  return (memo ?? "")
    .split("\n")
    .filter((l) => !/^\s*Air予約番号\s*[:：]/.test(l.replace(/<[^>]*>/g, "")))
    .join("\n")
    .trim();
}

const PAGE = 15;

function formatStamp(iso: string): string {
  return new Date(iso).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** "2026-10-07" → "2026/10/7(水)" */
export function formatDateFull(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  const w = ["日", "月", "火", "水", "木", "金", "土"][d.getUTCDay()];
  return `${d.getUTCFullYear()}/${d.getUTCMonth() + 1}/${d.getUTCDate()}(${w})`;
}

const yen = (n: number) => `¥${n.toLocaleString("ja-JP")}`;

/**
 * 同じメニューを何回目に受けたか（キャンセルを除き、古い順に数える）。
 * 脱毛はメニューが部位ごとに分かれているので、同じ部位どうしで数えることになる
 */
function useNth(detail: PatientDetail): (r: Res, menuId: string) => number | null {
  return useMemo(() => {
    const all = [...detail.visits.flatMap((v) => v.reservations), ...detail.upcoming]
      .filter((r) => !INACTIVE_STATUSES.has(r.status))
      .sort((a, b) => a.startAt.localeCompare(b.startAt));
    const seen = new Map<string, number>();
    const nth = new Map<string, number>();
    for (const r of all) {
      for (const m of r.menuIds) {
        const n = (seen.get(m) ?? 0) + 1;
        seen.set(m, n);
        nth.set(`${r.id}|${m}`, n);
      }
    }
    return (r: Res, m: string) => nth.get(`${r.id}|${m}`) ?? null;
  }, [detail.visits, detail.upcoming]);
}

function MenuChips({ r, detail, nth }: { r: Res; detail: PatientDetail; nth: (r: Res, m: string) => number | null }) {
  const inactive = INACTIVE_STATUSES.has(r.status);
  return (
    <span className={styles.menuChips}>
      {r.menuIds.map((m, i) => {
        const info = detail.menuInfo[m];
        const n = inactive ? null : nth(r, m);
        return (
          <span key={`${m}-${i}`} className={styles.menuChip} style={{ "--c": info?.color ?? "#94a3b8" } as CSSProperties} data-inactive={inactive || undefined}>
            {info?.name ?? r.menuNames[i]}
            {n !== null && <b className={styles.nth}>〈{n}回目〉</b>}
          </span>
        );
      })}
    </span>
  );
}

interface Props {
  detail: PatientDetail;
  onSave: (date: string, body: VisitSave) => Promise<boolean>;
  /** ファイルの追加・削除のあと、患者の情報を読み直す */
  onFilesChanged: () => void;
  /** 削除された患者など、見るだけのとき */
  readOnly?: boolean;
  canManage?: boolean;
  /** 予約を変更・取り消したあと（患者の情報を読み直す） */
  onReservationChanged?: () => void;
}

/**
 * 施術歴：今回の予約／過去の履歴／今後の予約。
 * 表は 日付・施術内容・メモ・スキンケア＆内服・ファイル の5列。メニューは色分けし、何回目かを付ける
 */
export function TreatmentHistory({ detail, onSave, onFilesChanged, readOnly, canManage, onReservationChanged }: Props) {
  const today = nowInClinic().date;
  const nth = useNth(detail);
  const [editing, setEditing] = useState<string | null>(null);
  const [extraDate, setExtraDate] = useState<string | null>(null);
  const [limit, setLimit] = useState(PAGE);
  /** 「変更」を押した予約 */
  const [changing, setChanging] = useState<Res | null>(null);
  const onChange = readOnly ? undefined : (r: Res) => setChanging(r);

  /** カルテ（施術記録）：画面を開いたときと、書いたあとに読み直す */
  const [charts, setCharts] = useState<ChartEntry[]>([]);
  const [chartDate, setChartDate] = useState<string | null>(null);
  const loadCharts = useCallback(() => {
    fetchCharts(detail.patient.id).then(setCharts, () => {});
  }, [detail.patient.id]);
  useEffect(() => {
    loadCharts();
  }, [loadCharts]);
  const chartsByDate = useMemo(() => {
    const m = new Map<string, ChartEntry[]>();
    for (const c of charts) m.set(c.date, [...(m.get(c.date) ?? []), c]);
    return m;
  }, [charts]);

  // 予約やメモのない日でも、カルテを書いた日・記録を足す日は行に出す
  const emptyRow = (date: string): VisitRow => ({ date, reservations: [], note: "", skincare: [], files: [], noteVersion: 0 });
  const extraDates = [...new Set([...(extraDate ? [extraDate] : []), ...chartsByDate.keys()])].filter((d) => !detail.visits.some((v) => v.date === d));
  const rows: VisitRow[] =
    extraDates.length > 0 ? [...detail.visits, ...extraDates.map(emptyRow)].sort((a, b) => b.date.localeCompare(a.date)) : detail.visits;
  const todayRow = rows.find((v) => v.date === today);
  const past = rows.filter((v) => v.date !== today);
  const next = detail.upcoming.find((r) => !INACTIVE_STATUSES.has(r.status));

  /** その日より前で、スキンケア＆内服が記録されている直近の内容 */
  const previousSkincare = (date: string) => rows.find((v) => v.date < date && v.skincare.length > 0)?.skincare ?? [];
  const [prices, setPrices] = useState<PriceItem[]>([]);
  useEffect(() => {
    let alive = true;
    loadPrices().then((l) => alive && setPrices(l));
    return () => {
      alive = false;
    };
  }, []);
  const options = useMemo(() => skincareOptions(prices, detail.products), [prices, detail.products]);
  /** 値段：料金表の値段、なければ設定の商品の値段（削除した商品も過去の記録のために使う） */
  const priceOf = useMemo(() => {
    const m = new Map<string, number | null>(detail.products.map((p) => [p.name, p.priceYen]));
    for (const o of options) if (o.priceYen !== null || !m.has(o.name)) m.set(o.name, o.priceYen);
    return m;
  }, [detail.products, options]);

  const rowProps = {
    detail,
    nth,
    today,
    readOnly,
    canManage,
    priceOf,
    editing,
    onFilesChanged,
    onChange,
    onEdit: (d: string) => setEditing(d),
    onCancel: (d: string) => {
      setEditing(null);
      if (extraDate === d) setExtraDate(null);
    },
    onSave: async (d: string, body: VisitSave) => {
      const ok = await onSave(d, body);
      if (ok) {
        setEditing(null);
        setExtraDate(null);
      }
    },
    previousSkincare,
    options,
    chartsOf: (d: string) => chartsByDate.get(d) ?? [],
    onChart: (d: string) => setChartDate(d),
  };

  return (
    <div className={styles.treatHistory}>
      <section className={styles.histBlock} data-kind="now">
        <h3 className={styles.histTitle}>今回の予約</h3>
        {todayRow ? (
          <HistoryTable rows={[todayRow]} {...rowProps} />
        ) : next ? (
          <p className={styles.nextLine}>
            本日の予約はありません。次回：
            <a href={withBase(calendarPath(clinicDateOf(next.startAt)))} className={styles.dateLink}>
              {formatDateFull(clinicDateOf(next.startAt))} {formatHm(minutesOfDay(next.startAt))}
            </a>{" "}
            <MenuChips r={next} detail={detail} nth={nth} />
          </p>
        ) : (
          <p className={styles.muted}>本日・今後の予約はありません</p>
        )}
      </section>

      <details className={styles.histBlock} open>
        <summary className={styles.histTitle}>
          過去の履歴 <span className={styles.histCount}>{past.length}件</span>
        </summary>
        {!readOnly && (
          <div className={styles.tableTools}>
            <AddRecord
              today={today}
              onPick={(d) => {
                setExtraDate(d);
                setEditing(d);
              }}
            />
          </div>
        )}
        {past.length === 0 ? (
          <p className={styles.muted}>過去の施術歴はまだありません</p>
        ) : (
          <HistoryTable rows={past.slice(0, limit)} {...rowProps} />
        )}
        {past.length > limit && (
          <button type="button" className={styles.moreBtn} onClick={() => setLimit((n) => n + PAGE)}>
            さらに表示（残り{past.length - limit}日）
          </button>
        )}
      </details>

      <details className={styles.histBlock} open>
        <summary className={styles.histTitle}>
          今後の予約 <span className={styles.histCount}>{detail.upcoming.length}件</span>
        </summary>
        <UpcomingTable items={detail.upcoming} detail={detail} nth={nth} onChange={onChange} />
      </details>
      {chartDate && (
        <ChartDialog
          patientId={detail.patient.id}
          patientName={detail.patient.name}
          date={chartDate}
          reservationId={rows.find((v) => v.date === chartDate)?.reservations.find((r) => !INACTIVE_STATUSES.has(r.status))?.id}
          menuNames={[...new Set(rows.find((v) => v.date === chartDate)?.reservations.filter((r) => !INACTIVE_STATUSES.has(r.status)).flatMap((r) => r.menuNames) ?? [])]}
          readOnly={readOnly}
          onClose={() => {
            setChartDate(null);
            // その画面で写真を足したり消したりしたかもしれないので読み直す
            onFilesChanged();
          }}
          onChanged={loadCharts}
        />
      )}
      {changing && (
        <ReservationEditDialog
          reservation={changing}
          patientName={detail.patient.name}
          canCancel={!!canManage}
          onClose={() => setChanging(null)}
          onSaved={() => {
            setChanging(null);
            onReservationChanged?.();
          }}
        />
      )}
    </div>
  );
}

type RowProps = {
  detail: PatientDetail;
  nth: (r: Res, m: string) => number | null;
  today: string;
  readOnly?: boolean;
  canManage?: boolean;
  priceOf: Map<string, number | null>;
  editing: string | null;
  onFilesChanged: () => void;
  /** 予約の「変更」（見るだけのときはなし） */
  onChange?: (r: Res) => void;
  onEdit: (date: string) => void;
  onCancel: (date: string) => void;
  onSave: (date: string, body: VisitSave) => Promise<void>;
  previousSkincare: (date: string) => string[];
  options: SkincareOption[];
  chartsOf: (date: string) => ChartEntry[];
  onChart: (date: string) => void;
};

function HistoryTable({ rows, ...p }: RowProps & { rows: VisitRow[] }) {
  return (
    <table className={styles.visitTable}>
      <thead>
        <tr>
          <th className={styles.colDate}>日付</th>
          <th className={styles.colMenu}>施術内容</th>
          <th className={styles.colNote}>メモ</th>
          <th className={styles.colSkin}>スキンケア＆内服</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((v) =>
          p.editing === v.date ? (
            <EditRow
              key={v.date}
              visit={v}
              options={p.options}
              previous={p.previousSkincare(v.date)}
              onCancel={() => p.onCancel(v.date)}
              onSave={(body) => p.onSave(v.date, body)}
            />
          ) : (
            <Row key={v.date} v={v} {...p} />
          ),
        )}
      </tbody>
    </table>
  );
}

function Row({ v, detail, nth, today, readOnly, priceOf, editing, onEdit, onFilesChanged, onChange, chartsOf, onChart }: RowProps & { v: VisitRow }) {
  const dayCharts = chartsOf(v.date);
  // 予約の変更は日付の横に1つだけ。その日に予約が複数あるときは、押すと「予約①・予約②…」から選ぶ
  const changeable = onChange && v.date >= today ? v.reservations.filter((r) => !INACTIVE_STATUSES.has(r.status)) : [];
  const [picking, setPicking] = useState(false);
  return (
    <tr data-today={v.date === today || undefined}>
      <td className={styles.colDate} data-label="日付">
        <a href={withBase(calendarPath(v.date))} className={styles.dateLink}>
          {formatDateFull(v.date)}
        </a>
        {onChange && changeable.length > 0 && (
          <button
            type="button"
            className={styles.changeBtn}
            aria-expanded={changeable.length > 1 ? picking : undefined}
            onClick={() => (changeable.length === 1 ? onChange(changeable[0]) : setPicking((x) => !x))}
          >
            予約変更
          </button>
        )}
        {picking && changeable.length > 1 && (
          <div className={styles.changePick} role="group" aria-label="変更する予約を選ぶ">
            {changeable.map((r, i) => (
              <button
                key={r.id}
                type="button"
                className={styles.changePickBtn}
                onClick={() => {
                  setPicking(false);
                  onChange?.(r);
                }}
              >
                <b>予約{"①②③④⑤⑥⑦⑧⑨⑩"[i] ?? i + 1}</b> {formatHm(minutesOfDay(r.startAt))} {r.menuNames.join("・") || "—"}
              </button>
            ))}
          </div>
        )}
        {/* メモ・カルテ・撮影・ファイルの4つのボタン（2×2）と、その日の写真 */}
        <div className={styles.actGrid}>
          {!readOnly && (
            <button type="button" className={styles.actBtn} onClick={() => onEdit(v.date)} disabled={editing !== null}>
              📝 メモ
            </button>
          )}
          {(!readOnly || dayCharts.length > 0) && (
            <button type="button" className={styles.actBtn} onClick={() => onChart(v.date)} title="カルテ（施術記録）">
              🩺 カルテ{dayCharts.length > 0 && `（${dayCharts.length}）`}
            </button>
          )}
          {!readOnly && <FileUploader compact patientId={detail.patient.id} date={v.date} onUploaded={onFilesChanged} />}
        </div>
        <FileThumbs files={v.files} canDelete={!readOnly} onDeleted={onFilesChanged} />
      </td>
      <td className={styles.colMenu} data-label="施術内容">
        {v.reservations.length === 0 && <span className={styles.muted}>（予約なしの記録）</span>}
        {v.reservations.map((r) => (
          <div key={r.id} className={styles.resLine} data-inactive={INACTIVE_STATUSES.has(r.status) || undefined}>
            <span className={styles.time}>{formatHm(minutesOfDay(r.startAt))}</span>
            <MenuChips r={r} detail={detail} nth={nth} />
            {r.status !== "done" && r.status !== "booked" && <span className={styles.status}>{r.stageLabel ?? STATUS_LABEL[r.status]}</span>}
            {withoutAirNo(r.memo) && (
              <div className={styles.resMemo}>
                予約メモ：<RichText value={withoutAirNo(r.memo)} inline />
              </div>
            )}
            {r.requestId && <div className={styles.resMemo}>申請ID：{r.requestId}</div>}
          </div>
        ))}
      </td>
      <td className={styles.colNote} data-label="メモ">
        {v.note ? <RichText value={v.note} className={styles.noteText} /> : dayCharts.length === 0 && <span className={styles.muted}>—</span>}
        {v.noteUpdatedBy && (
          <div className={styles.writer}>
            記入：{v.noteUpdatedBy.name}
            {v.noteUpdatedAt && `（${formatStamp(v.noteUpdatedAt)}）`}
          </div>
        )}
        {dayCharts.map((c) => (
          <button key={c.id} type="button" className={styles.chartLink} onClick={() => onChart(v.date)} aria-label={`${c.treatment}のカルテを開く`}>
            <ChartCard entry={c} compact />
          </button>
        ))}
      </td>
      <td className={styles.colSkin} data-label="スキンケア＆内服">
        <SkincareCell items={v.skincare} priceOf={priceOf} />
      </td>
    </tr>
  );
}

/** スキンケア＆内服：普段は2件まで。押すと全項目と価格を出す */
/** スキンケア＆内服：2つまで出し、ほかは「すべて表示」で開く。開いたときは高さを抑えて中で動かせるようにする */
function SkincareCell({ items, priceOf }: { items: string[]; priceOf: Map<string, number | null> }) {
  const [open, setOpen] = useState(false);
  if (items.length === 0) return <span className={styles.muted}>—</span>;
  const total = items.reduce<number>((sum, x) => sum + (priceOf.get(x) ?? 0), 0);
  if (!open) {
    return (
      <div className={styles.skinCell}>
        <span className={styles.chips}>
          {items.slice(0, 2).map((x) => (
            <span key={x} className={styles.chip}>
              {x}
            </span>
          ))}
        </span>
        {items.length > 2 && (
          <button type="button" className={styles.skinToggle} onClick={() => setOpen(true)} aria-expanded={false}>
            ▼ ほか{items.length - 2}件を表示
          </button>
        )}
      </div>
    );
  }
  return (
    <div className={styles.skinCell}>
      <ul className={styles.skinList}>
        {items.map((x) => (
          <li key={x}>
            <span>{x}</span>
            {priceOf.get(x) != null && <small className={styles.price}>{yen(priceOf.get(x)!)}</small>}
          </li>
        ))}
      </ul>
      {total > 0 && <span className={styles.total}>合計 {yen(total)}（{items.length}点）</span>}
      <button type="button" className={styles.skinToggle} onClick={() => setOpen(false)} aria-expanded>
        ▲ たたむ
      </button>
    </div>
  );
}


function AddRecord({ today, onPick }: { today: string; onPick: (date: string) => void }) {
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(today);
  if (!open) {
    return (
      <button type="button" className={styles.smallBtn} onClick={() => setOpen(true)}>
        ＋ 予約のない日の記録を追加
      </button>
    );
  }
  return (
    <span className={styles.inlineForm}>
      <input type="date" className={styles.input} value={date} max={today} onChange={(e) => setDate(e.target.value)} aria-label="記録する日" />
      <button
        type="button"
        className={styles.smallBtn}
        disabled={!date || date > today}
        onClick={() => {
          onPick(date);
          setOpen(false);
        }}
      >
        この日に書く
      </button>
      <button type="button" className={styles.linkBtn} onClick={() => setOpen(false)}>
        やめる
      </button>
    </span>
  );
}

function EditRow(props: { visit: VisitRow; options: SkincareOption[]; previous: string[]; onCancel: () => void; onSave: (body: VisitSave) => Promise<void> }) {
  const { visit } = props;
  const [note, setNote] = useState(visit.note);
  const [skincare, setSkincare] = useState<string[]>(visit.skincare);
  const [saving, setSaving] = useState(false);

  return (
    <tr className={styles.editRow}>
      <td colSpan={4}>
        <div className={styles.editHead}>
          <strong>{formatDateFull(visit.date)}</strong>
          {visit.reservations.length > 0 && <span className={styles.muted}>{visit.reservations.flatMap((r) => r.menuNames).join("、")}</span>}
        </div>
        <div className={styles.field}>
          <span className={styles.label}>メモ（自由記載）</span>
          <RichTextEditor
            value={note}
            onChange={setNote}
            rows={4}
            maxLength={4000}
            ariaLabel="メモ（自由記載）"
            placeholder="例：全顔HIFU 300ショット。頬下部に痛み。次回3か月後"
            autoFocus
          />
        </div>
        <div className={styles.field}>
          <span className={styles.label}>スキンケア＆内服（タップで追加・もう一度で外す）</span>
          <SkincarePicker value={skincare} onChange={setSkincare} options={props.options} previous={props.previous} />
        </div>
        <div className={styles.editActions}>
          <span className={styles.muted}>メモとスキンケア＆内服を両方空にして保存すると、この日の記録を消します</span>
          <button type="button" className={styles.btn} onClick={props.onCancel} disabled={saving}>
            やめる
          </button>
          <button
            type="button"
            className={styles.primary}
            disabled={saving}
            onClick={async () => {
              setSaving(true);
              await props.onSave({ note, skincare, version: visit.noteVersion });
              setSaving(false);
            }}
          >
            保存
          </button>
        </div>
      </td>
    </tr>
  );
}

function UpcomingTable({
  items,
  detail,
  nth,
  onChange,
}: {
  items: Res[];
  detail: PatientDetail;
  nth: (r: Res, m: string) => number | null;
  onChange?: (r: Res) => void;
}) {
  if (items.length === 0) return <p className={styles.muted}>今後の予約はありません</p>;
  return (
    <table className={`${styles.visitTable} ${styles.upTable}`}>
      <thead>
        <tr>
          <th className={styles.upDate}>日付</th>
          <th className={styles.upTime}>時間</th>
          <th className={styles.upMenu}>メニュー</th>
          <th className={styles.upLane}>レーン</th>
          <th className={styles.upStatus}>状態</th>
          <th>予約メモ・申請ID</th>
        </tr>
      </thead>
      <tbody>
        {items.map((r) => {
          const date = clinicDateOf(r.startAt);
          return (
            <tr key={r.id} data-inactive={INACTIVE_STATUSES.has(r.status) || undefined}>
              <td className={styles.upDate} data-label="日付">
                <a href={withBase(calendarPath(date))} className={styles.dateLink}>
                  {formatDateFull(date)}
                </a>
                {/* 変更は日付の2行目に（列を増やさず、予約メモの幅を広く取るため） */}
                {onChange && !INACTIVE_STATUSES.has(r.status) && (
                  <div>
                    <button type="button" className={styles.changeBtn} onClick={() => onChange(r)}>
                      変更
                    </button>
                  </div>
                )}
              </td>
              <td data-label="時間" className={styles.time}>
                {formatHm(minutesOfDay(r.startAt))}–{formatHm(minutesOfDay(r.endAt))}
              </td>
              <td className={styles.upMenu} data-label="メニュー">
                <MenuChips r={r} detail={detail} nth={nth} />
              </td>
              <td className={styles.upLane} data-label="レーン">{r.laneName}</td>
              <td className={styles.upStatus} data-label="状態">{r.stageLabel ?? STATUS_LABEL[r.status]}</td>
              <td data-label="予約メモ・申請ID">
                {withoutAirNo(r.memo) ? <RichText value={withoutAirNo(r.memo)} inline /> : r.requestId ? null : <span className={styles.muted}>—</span>}
                {r.requestId && <div className={styles.reqId}>申請ID：{r.requestId}</div>}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

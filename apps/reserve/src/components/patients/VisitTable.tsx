"use client";

import { useId, useMemo, useState, type CSSProperties } from "react";
import type { PatientDetail, PatientFile, Product, VisitRow } from "@/lib/domain/types";
import { INACTIVE_STATUSES, PRODUCT_CATEGORY_LABEL, STATUS_LABEL } from "@/lib/domain/types";
import { formatHm, minutesOfDay, nowInClinic, clinicDateOf } from "@/lib/domain/time";
import { FileThumbs } from "@/components/files/FileThumbs";
import { FileUploader } from "@/components/files/FileUploader";
import styles from "./patients.module.css";
import { calendarPath, withBase } from "@/lib/paths";

export interface VisitSave {
  note: string;
  skincare: string[];
  version: number;
}

type Res = VisitRow["reservations"][number];

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
}

/**
 * 施術歴：今回の予約／過去の履歴／今後の予約。
 * 表は 日付・施術内容・メモ・スキンケア＆内服・ファイル の5列。メニューは色分けし、何回目かを付ける
 */
export function TreatmentHistory({ detail, onSave, onFilesChanged, readOnly, canManage }: Props) {
  const today = nowInClinic().date;
  const nth = useNth(detail);
  const [editing, setEditing] = useState<string | null>(null);
  const [extraDate, setExtraDate] = useState<string | null>(null);
  const [limit, setLimit] = useState(PAGE);

  const rows: VisitRow[] =
    extraDate && !detail.visits.some((v) => v.date === extraDate)
      ? [...detail.visits, { date: extraDate, reservations: [], note: "", skincare: [], files: [], noteVersion: 0 }].sort((a, b) =>
          b.date.localeCompare(a.date),
        )
      : detail.visits;
  const todayRow = rows.find((v) => v.date === today);
  const past = rows.filter((v) => v.date !== today);
  const next = detail.upcoming.find((r) => !INACTIVE_STATUSES.has(r.status));

  /** その日より前で、スキンケア＆内服が記録されている直近の内容 */
  const previousSkincare = (date: string) => rows.find((v) => v.date < date && v.skincare.length > 0)?.skincare ?? [];
  const priceOf = useMemo(() => new Map(detail.products.map((p) => [p.name, p.priceYen])), [detail.products]);

  const rowProps = {
    detail,
    nth,
    today,
    readOnly,
    canManage,
    priceOf,
    editing,
    onFilesChanged,
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
        <UpcomingTable items={detail.upcoming} detail={detail} nth={nth} />
      </details>
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
  onEdit: (date: string) => void;
  onCancel: (date: string) => void;
  onSave: (date: string, body: VisitSave) => Promise<void>;
  previousSkincare: (date: string) => string[];
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
          <th className={styles.colFiles}>ファイル</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((v) =>
          p.editing === v.date ? (
            <EditRow
              key={v.date}
              visit={v}
              products={p.detail.products}
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

function Row({ v, detail, nth, today, readOnly, canManage, priceOf, editing, onEdit, onFilesChanged }: RowProps & { v: VisitRow }) {
  return (
    <tr data-today={v.date === today || undefined}>
      <td className={styles.colDate} data-label="日付">
        <a href={withBase(calendarPath(v.date))} className={styles.dateLink}>
          {formatDateFull(v.date)}
        </a>
        {v.date === today && <span className={styles.todayChip}>今日</span>}
        {!readOnly && (
          <div>
            <button type="button" className={styles.smallBtn} onClick={() => onEdit(v.date)} disabled={editing !== null}>
              {v.noteVersion > 0 ? "編集" : "記入"}
            </button>
          </div>
        )}
      </td>
      <td className={styles.colMenu} data-label="施術内容">
        {v.reservations.length === 0 && <span className={styles.muted}>（予約なしの記録）</span>}
        {v.reservations.map((r) => (
          <div key={r.id} className={styles.resLine} data-inactive={INACTIVE_STATUSES.has(r.status) || undefined}>
            <span className={styles.time}>{formatHm(minutesOfDay(r.startAt))}</span>
            <MenuChips r={r} detail={detail} nth={nth} />
            {r.status !== "done" && <span className={styles.status}>{r.stageLabel ?? STATUS_LABEL[r.status]}</span>}
            {r.memo && <div className={styles.resMemo}>予約メモ：{r.memo}</div>}
            {r.requestId && <div className={styles.resMemo}>申請ID：{r.requestId}</div>}
          </div>
        ))}
      </td>
      <td className={styles.colNote} data-label="メモ">
        {v.note ? <div className={styles.noteText}>{v.note}</div> : <span className={styles.muted}>—</span>}
        {v.noteUpdatedBy && (
          <div className={styles.writer}>
            記入：{v.noteUpdatedBy.name}
            {v.noteUpdatedAt && `（${formatStamp(v.noteUpdatedAt)}）`}
          </div>
        )}
      </td>
      <td className={styles.colSkin} data-label="スキンケア＆内服">
        <SkincareCell items={v.skincare} priceOf={priceOf} />
      </td>
      <td className={styles.colFiles} data-label="ファイル">
        <FilesCell files={v.files} patientId={detail.patient.id} date={v.date} readOnly={readOnly} canManage={canManage} onChanged={onFilesChanged} />
      </td>
    </tr>
  );
}

/** スキンケア＆内服：普段は2件まで。押すと全項目と価格を出す */
function SkincareCell({ items, priceOf }: { items: string[]; priceOf: Map<string, number | null> }) {
  const [open, setOpen] = useState(false);
  if (items.length === 0) return <span className={styles.muted}>—</span>;
  const shown = open ? items : items.slice(0, 2);
  const prices = items.map((x) => priceOf.get(x) ?? null);
  const total = prices.reduce<number>((s, n) => s + (n ?? 0), 0);
  return (
    <button type="button" className={styles.skinCell} onClick={() => setOpen((o) => !o)} aria-expanded={open} title={open ? "たたむ" : "すべて表示"}>
      <span className={styles.chips}>
        {shown.map((x) => (
          <span key={x} className={styles.chip}>
            {x}
            {open && priceOf.get(x) != null && <small className={styles.price}>{yen(priceOf.get(x)!)}</small>}
          </span>
        ))}
      </span>
      {!open && items.length > 2 && <span className={styles.more}>＋{items.length - 2}件（すべて表示）</span>}
      {open && total > 0 && <span className={styles.total}>合計 {yen(total)}</span>}
    </button>
  );
}

function FilesCell(props: { files: PatientFile[]; patientId: string; date: string; readOnly?: boolean; canManage?: boolean; onChanged: () => void }) {
  return (
    <div className={styles.filesCell}>
      <FileThumbs files={props.files} canDelete={props.canManage} onDeleted={props.onChanged} />
      {props.files.length === 0 && props.readOnly && <span className={styles.muted}>—</span>}
      {!props.readOnly && <FileUploader compact patientId={props.patientId} date={props.date} onUploaded={props.onChanged} />}
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

function EditRow(props: { visit: VisitRow; products: Product[]; previous: string[]; onCancel: () => void; onSave: (body: VisitSave) => Promise<void> }) {
  const { visit } = props;
  const [note, setNote] = useState(visit.note);
  const [skincare, setSkincare] = useState<string[]>(visit.skincare);
  const [item, setItem] = useState("");
  const [saving, setSaving] = useState(false);
  const listId = useId();

  const add = (x: string) => {
    const v = x.trim().replace(/\s+/g, " ");
    if (v && !skincare.includes(v)) setSkincare((s) => [...s, v]);
    setItem("");
  };
  const toggle = (name: string) => setSkincare((s) => (s.includes(name) ? s.filter((y) => y !== name) : [...s, name]));

  return (
    <tr className={styles.editRow}>
      <td colSpan={5}>
        <div className={styles.editHead}>
          <strong>{formatDateFull(visit.date)}</strong>
          {visit.reservations.length > 0 && <span className={styles.muted}>{visit.reservations.flatMap((r) => r.menuNames).join("、")}</span>}
        </div>
        <label className={styles.field}>
          <span className={styles.label}>メモ（簡易カルテ・自由記載）</span>
          <textarea
            className={styles.textarea}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={4}
            maxLength={4000}
            placeholder="例：全顔HIFU 300ショット。頬下部に痛み。次回3か月後"
            autoFocus
          />
        </label>
        <div className={styles.field}>
          <span className={styles.label}>スキンケア＆内服（タップで追加・もう一度で外す）</span>
          {(["skincare", "oral"] as const).map((cat) => {
            const list = props.products.filter((p) => p.category === cat);
            if (list.length === 0) return null;
            return (
              <div key={cat} className={styles.presetGroup}>
                <span className={styles.presetLabel}>{PRODUCT_CATEGORY_LABEL[cat]}</span>
                <div className={styles.presets}>
                  {list.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      className={styles.preset}
                      data-on={skincare.includes(p.name) || undefined}
                      aria-pressed={skincare.includes(p.name)}
                      onClick={() => toggle(p.name)}
                    >
                      {p.name}
                      {p.priceYen !== null && <small>{yen(p.priceYen)}</small>}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
          <div className={styles.chips}>
            {skincare.map((x) => (
              <span key={x} className={styles.chip}>
                {x}
                <button type="button" onClick={() => setSkincare((s) => s.filter((y) => y !== x))} aria-label={`${x}を外す`}>
                  ×
                </button>
              </span>
            ))}
            {skincare.length === 0 && <span className={styles.muted}>未選択</span>}
          </div>
          <div className={styles.inlineForm}>
            <input
              className={styles.input}
              value={item}
              onChange={(e) => setItem(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  add(item);
                }
              }}
              list={listId}
              maxLength={60}
              placeholder="一覧にないものは名前を入力して追加"
              aria-label="スキンケア・内服を追加"
            />
            <datalist id={listId}>
              {props.products
                .filter((p) => !skincare.includes(p.name))
                .map((p) => (
                  <option key={p.id} value={p.name} />
                ))}
            </datalist>
            <button type="button" className={styles.smallBtn} onClick={() => add(item)} disabled={!item.trim()}>
              追加
            </button>
            {props.previous.length > 0 && (
              <button
                type="button"
                className={styles.smallBtn}
                onClick={() => setSkincare((s) => [...new Set([...s, ...props.previous])])}
                title={props.previous.join("、")}
              >
                前回と同じ内容を入れる
              </button>
            )}
          </div>
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
              const pending = item.trim() && !skincare.includes(item.trim()) ? [...skincare, item.trim()] : skincare;
              await props.onSave({ note, skincare: pending, version: visit.noteVersion });
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

function UpcomingTable({ items, detail, nth }: { items: Res[]; detail: PatientDetail; nth: (r: Res, m: string) => number | null }) {
  if (items.length === 0) return <p className={styles.muted}>今後の予約はありません</p>;
  return (
    <table className={styles.visitTable}>
      <thead>
        <tr>
          <th className={styles.colDate}>日付</th>
          <th className={styles.colTime}>時間</th>
          <th className={styles.colMenu}>メニュー</th>
          <th>レーン</th>
          <th>状態</th>
          <th>予約メモ・申請ID</th>
        </tr>
      </thead>
      <tbody>
        {items.map((r) => {
          const date = clinicDateOf(r.startAt);
          return (
            <tr key={r.id} data-inactive={INACTIVE_STATUSES.has(r.status) || undefined}>
              <td className={styles.colDate} data-label="日付">
                <a href={withBase(calendarPath(date))} className={styles.dateLink}>
                  {formatDateFull(date)}
                </a>
              </td>
              <td data-label="時間" className={styles.time}>
                {formatHm(minutesOfDay(r.startAt))}–{formatHm(minutesOfDay(r.endAt))}
              </td>
              <td className={styles.colMenu} data-label="メニュー">
                <MenuChips r={r} detail={detail} nth={nth} />
              </td>
              <td data-label="レーン">{r.laneName}</td>
              <td data-label="状態">{r.stageLabel ?? STATUS_LABEL[r.status]}</td>
              <td data-label="予約メモ・申請ID">
                {r.memo ?? (r.requestId ? null : <span className={styles.muted}>—</span>)}
                {r.requestId && <div className={styles.reqId}>申請ID：{r.requestId}</div>}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

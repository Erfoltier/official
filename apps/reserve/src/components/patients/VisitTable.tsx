"use client";

import { useId, useState } from "react";
import type { VisitRow } from "@/lib/domain/types";
import { INACTIVE_STATUSES, STATUS_LABEL } from "@/lib/domain/types";
import { formatHm, minutesOfDay, nowInClinic } from "@/lib/domain/time";
import styles from "./patients.module.css";

export interface VisitSave {
  note: string;
  skincare: string[];
  version: number;
}

interface Props {
  visits: VisitRow[];
  suggestions: string[];
  onSave: (date: string, body: VisitSave) => Promise<boolean>;
}

const PAGE = 15;

/** "2026-10-07" → "2026/10/7(水)" */
export function formatDateFull(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  const w = ["日", "月", "火", "水", "木", "金", "土"][d.getUTCDay()];
  return `${d.getUTCFullYear()}/${d.getUTCMonth() + 1}/${d.getUTCDate()}(${w})`;
}

/**
 * 施術歴の表。1行＝1日で、施術内容・メモ（簡易カルテ）・その時点のスキンケアを並べる。
 * 行の「記入／編集」でその場で書き換えられる。
 */
export function VisitTable({ visits, suggestions, onSave }: Props) {
  const [editing, setEditing] = useState<string | null>(null);
  const [extraDate, setExtraDate] = useState<string | null>(null);
  const [limit, setLimit] = useState(PAGE);
  const today = nowInClinic().date;

  // 予約のない日に記録を追加するとき、その日の空の行を差し込む
  const rows: VisitRow[] =
    extraDate && !visits.some((v) => v.date === extraDate)
      ? [...visits, { date: extraDate, reservations: [], note: "", skincare: [], noteVersion: 0 }].sort((a, b) =>
          b.date.localeCompare(a.date),
        )
      : visits;

  /** その日より前で、スキンケアが記録されている直近の内容 */
  const previousSkincare = (date: string) => rows.find((v) => v.date < date && v.skincare.length > 0)?.skincare ?? [];

  return (
    <div>
      <div className={styles.tableTools}>
        <AddRecord
          today={today}
          onPick={(d) => {
            setExtraDate(d);
            setEditing(d);
          }}
        />
      </div>
      {rows.length === 0 ? (
        <p className={styles.muted}>施術歴はまだありません</p>
      ) : (
        <table className={styles.visitTable}>
          <thead>
            <tr>
              <th className={styles.colDate}>日付</th>
              <th className={styles.colMenu}>施術内容</th>
              <th className={styles.colNote}>メモ（簡易カルテ）</th>
              <th className={styles.colSkin}>使用中のスキンケア</th>
              <th className={styles.colAct} aria-label="操作" />
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, limit).map((v) =>
              editing === v.date ? (
                <EditRow
                  key={v.date}
                  visit={v}
                  suggestions={suggestions}
                  previous={previousSkincare(v.date)}
                  onCancel={() => {
                    setEditing(null);
                    if (extraDate === v.date) setExtraDate(null);
                  }}
                  onSave={async (body) => {
                    const ok = await onSave(v.date, body);
                    if (ok) {
                      setEditing(null);
                      setExtraDate(null);
                    }
                  }}
                />
              ) : (
                <tr key={v.date} data-today={v.date === today || undefined}>
                  <td className={styles.colDate} data-label="日付">
                    <a href={`/?date=${v.date}`} className={styles.dateLink}>
                      {formatDateFull(v.date)}
                    </a>
                    {v.date === today && <span className={styles.todayChip}>今日</span>}
                  </td>
                  <td className={styles.colMenu} data-label="施術内容">
                    {v.reservations.length === 0 && <span className={styles.muted}>（予約なしの記録）</span>}
                    {v.reservations.map((r) => (
                      <div key={r.id} className={styles.resLine} data-inactive={INACTIVE_STATUSES.has(r.status) || undefined}>
                        <span className={styles.time}>{formatHm(minutesOfDay(r.startAt))}</span>
                        <span>{r.menuNames.join("、")}</span>
                        {r.status !== "done" && <span className={styles.status}>{STATUS_LABEL[r.status]}</span>}
                        {r.memo && <div className={styles.resMemo}>予約メモ：{r.memo}</div>}
                      </div>
                    ))}
                  </td>
                  <td className={styles.colNote} data-label="メモ">
                    {v.note ? <div className={styles.noteText}>{v.note}</div> : <span className={styles.muted}>—</span>}
                  </td>
                  <td className={styles.colSkin} data-label="スキンケア">
                    {v.skincare.length === 0 ? (
                      <span className={styles.muted}>—</span>
                    ) : (
                      <div className={styles.chips}>
                        {v.skincare.map((x) => (
                          <span key={x} className={styles.chip}>
                            {x}
                          </span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className={styles.colAct}>
                    <button type="button" className={styles.smallBtn} onClick={() => setEditing(v.date)} disabled={editing !== null}>
                      {v.noteVersion > 0 ? "編集" : "記入"}
                    </button>
                  </td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      )}
      {rows.length > limit && (
        <button type="button" className={styles.moreBtn} onClick={() => setLimit((n) => n + PAGE)}>
          さらに表示（残り{rows.length - limit}日）
        </button>
      )}
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

function EditRow(props: {
  visit: VisitRow;
  suggestions: string[];
  previous: string[];
  onCancel: () => void;
  onSave: (body: VisitSave) => Promise<void>;
}) {
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

  return (
    <tr className={styles.editRow}>
      <td colSpan={5}>
        <div className={styles.editHead}>
          <strong>{formatDateFull(visit.date)}</strong>
          {visit.reservations.length > 0 && (
            <span className={styles.muted}>{visit.reservations.flatMap((r) => r.menuNames).join("、")}</span>
          )}
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
          <span className={styles.label}>この日に使っているスキンケア</span>
          <div className={styles.chips}>
            {skincare.map((x) => (
              <span key={x} className={styles.chip}>
                {x}
                <button type="button" onClick={() => setSkincare((s) => s.filter((y) => y !== x))} aria-label={`${x}を外す`}>
                  ×
                </button>
              </span>
            ))}
            {skincare.length === 0 && <span className={styles.muted}>未入力</span>}
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
              placeholder="アイテム名（候補から選ぶか自由に入力）"
              aria-label="スキンケアアイテムを追加"
            />
            <datalist id={listId}>
              {props.suggestions
                .filter((x) => !skincare.includes(x))
                .map((x) => (
                  <option key={x} value={x} />
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
          <span className={styles.muted}>メモとスキンケアを両方空にして保存すると、この日の記録を消します</span>
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

export function UpcomingTable({ items }: { items: VisitRow["reservations"] }) {
  if (items.length === 0) return <p className={styles.muted}>今後の予約はありません</p>;
  return (
    <table className={styles.visitTable}>
      <thead>
        <tr>
          <th className={styles.colDate}>日付</th>
          <th>時間</th>
          <th className={styles.colMenu}>メニュー</th>
          <th>レーン</th>
          <th>状態</th>
          <th>予約メモ</th>
        </tr>
      </thead>
      <tbody>
        {items.map((r) => {
          const date = r.startAt.slice(0, 10);
          return (
            <tr key={r.id} data-inactive={INACTIVE_STATUSES.has(r.status) || undefined}>
              <td className={styles.colDate} data-label="日付">
                <a href={`/?date=${date}`} className={styles.dateLink}>
                  {formatDateFull(date)}
                </a>
              </td>
              <td data-label="時間" className={styles.time}>
                {formatHm(minutesOfDay(r.startAt))}–{formatHm(minutesOfDay(r.endAt))}
              </td>
              <td className={styles.colMenu} data-label="メニュー">
                {r.menuNames.join("、")}
              </td>
              <td data-label="レーン">{r.laneName}</td>
              <td data-label="状態">{STATUS_LABEL[r.status]}</td>
              <td data-label="予約メモ">{r.memo ?? <span className={styles.muted}>—</span>}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

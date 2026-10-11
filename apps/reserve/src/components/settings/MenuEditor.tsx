"use client";

import { useEffect, useRef, useState } from "react";
import type { Lane, Menu, MenuDuration } from "@/lib/domain/types";
import { saveMenu } from "@/components/calendar/api";
import styles from "./settings.module.css";

const START_STEPS = [5, 10, 15, 20, 30, 60];
const MINUTE_OPTIONS = Array.from({ length: 144 }, (_, i) => (i + 1) * 5); // 5〜720分

interface Props {
  menu: Menu | null;
  lanes: Lane[];
  onClose: () => void;
  onSaved: (m: Menu) => void;
  /** 既存のメニューの削除（新しいメニューのときはなし） */
  onDelete?: () => void;
  fail: (err: unknown) => void;
}

export function MenuEditor({ menu, lanes, onClose, onSaved, onDelete, fail }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState(menu?.name ?? "");
  const [abbr, setAbbr] = useState(menu?.abbr ?? "");
  const [publicName, setPublicName] = useState(menu?.publicName ?? "");
  const [preVisitNote, setPreVisitNote] = useState(menu?.preVisitNote ?? "");
  const [color, setColor] = useState(menu?.color ?? "#64748b");
  const [kind, setKind] = useState<MenuDuration["kind"]>(menu?.duration.kind ?? "fixed");
  const [fixedMin, setFixedMin] = useState(menu?.duration.kind === "fixed" ? menu.duration.minutes : 15);
  const [rangeMin, setRangeMin] = useState(menu?.duration.kind === "range" ? menu.duration.min : 5);
  const [rangeMax, setRangeMax] = useState(menu?.duration.kind === "range" ? menu.duration.max : 60);
  const [rangeStep, setRangeStep] = useState(menu?.duration.kind === "range" ? menu.duration.step : 5);
  const [defaultMinutes, setDefaultMinutes] = useState(menu?.defaultMinutes ?? 15);
  const [startStepMin, setStartStepMin] = useState(menu?.startStepMin ?? 5);
  const [price, setPrice] = useState(menu?.priceYen?.toString() ?? "");
  const [capacity, setCapacity] = useState(menu?.capacity?.toString() ?? "");
  const [laneIds, setLaneIds] = useState<string[]>(menu?.laneIds ?? lanes.filter((l) => l.active).map((l) => l.id));
  const [active, setActive] = useState(menu?.active ?? true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  const duration: MenuDuration =
    kind === "fixed" ? { kind, minutes: fixedMin } : { kind, min: rangeMin, max: rangeMax, step: rangeStep };
  const defaultOptions = kind === "fixed" ? [fixedMin] : MINUTE_OPTIONS.filter((m) => m >= rangeMin && m <= rangeMax);

  const save = async () => {
    setSaving(true);
    try {
      const saved = await saveMenu(menu?.id ?? null, {
        name,
        abbr,
        publicName,
        preVisitNote,
        color,
        duration,
        defaultMinutes: kind === "fixed" ? fixedMin : Math.min(rangeMax, Math.max(rangeMin, defaultMinutes)),
        startStepMin,
        priceYen: price.trim() === "" ? null : Number(price.replace(/[,，円\s]/g, "")),
        capacity: capacity.trim() === "" ? null : Number(capacity),
        laneIds,
        active,
      });
      onSaved(saved);
    } catch (err) {
      fail(err);
      setSaving(false);
    }
  };

  const minuteSelect = (value: number, onChange: (v: number) => void, label: string) => (
    <select className={styles.input} value={value} onChange={(e) => onChange(Number(e.target.value))} aria-label={label}>
      {MINUTE_OPTIONS.map((m) => (
        <option key={m} value={m}>
          {m}分
        </option>
      ))}
    </select>
  );

  return (
    <dialog
      ref={ref}
      className={styles.dialog}
      // 予約登録などの画面の上に開いたとき、外側のダイアログまで閉じないようにここで止める
      onClose={(e) => {
        e.stopPropagation();
        onClose();
      }}
      onCancel={(e) => e.stopPropagation()}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          // 予約登録の画面の上に開いたとき、外側の予約の登録まで動かないように止める
          e.stopPropagation();
          save();
        }}
      >
        <h2>{menu ? "メニューを編集" : "新しいメニュー"}</h2>

        <div className={styles.grid}>
          <label>メニュー名</label>
          <input className={styles.input} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required aria-label="メニュー名" />

          <label>略称（短い枠用）</label>
          <div className={styles.inline}>
            <input className={styles.input} value={abbr} onChange={(e) => setAbbr(e.target.value)} maxLength={12} placeholder="例：BTX再" />
            <input type="color" value={color} onChange={(e) => setColor(e.target.value)} aria-label="色" className={styles.color} />
            <span className={styles.preview} style={{ ["--c" as string]: color }}>
              山田 Anna｜{abbr || name.slice(0, 6) || "略称"}
            </span>
          </div>

          <label>患者に見せる名前</label>
          <input className={styles.input} value={publicName} onChange={(e) => setPublicName(e.target.value)} maxLength={40} placeholder={`空欄なら「${name || "メニュー名"}」`} aria-label="患者に見せる名前" />

          <label>来院前の案内</label>
          <textarea className={styles.input} rows={2} value={preVisitNote} onChange={(e) => setPreVisitNote(e.target.value)} maxLength={300} placeholder="例：当日はメイクを落としやすい状態でお越しください（リマインドに入ります）" aria-label="来院前の案内" style={{ fontFamily: "inherit" }} />

          <label>提供時間</label>
          <div>
            <div className={styles.inline}>
              <label className={styles.toggle}>
                <input type="radio" checked={kind === "fixed"} onChange={() => setKind("fixed")} />
                固定
              </label>
              <label className={styles.toggle}>
                <input type="radio" checked={kind === "range"} onChange={() => setKind("range")} />
                最小〜最大（予約ごとに決める）
              </label>
            </div>
            {kind === "fixed" ? (
              <div className={styles.inline}>{minuteSelect(fixedMin, setFixedMin, "提供時間")}</div>
            ) : (
              <div className={styles.inline}>
                {minuteSelect(rangeMin, setRangeMin, "最小時間")}〜{minuteSelect(rangeMax, setRangeMax, "最大時間")}
                <select
                  className={styles.input}
                  value={rangeStep}
                  onChange={(e) => setRangeStep(Number(e.target.value))}
                  aria-label="時間の刻み"
                >
                  {[5, 10, 15, 30].map((m) => (
                    <option key={m} value={m}>
                      {m}分刻み
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {kind === "range" && (
            <>
              <label>予約登録時の初期値</label>
              <select
                className={styles.input}
                value={Math.min(rangeMax, Math.max(rangeMin, defaultMinutes))}
                onChange={(e) => setDefaultMinutes(Number(e.target.value))}
              >
                {defaultOptions.map((m) => (
                  <option key={m} value={m}>
                    {m}分
                  </option>
                ))}
              </select>
            </>
          )}

          <label>開始時間の刻み</label>
          <select className={styles.input} value={startStepMin} onChange={(e) => setStartStepMin(Number(e.target.value))}>
            {START_STEPS.map((m) => (
              <option key={m} value={m}>
                {m}分
              </option>
            ))}
          </select>

          <label>料金（税込）</label>
          <input
            className={styles.input}
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            inputMode="numeric"
            placeholder="空欄＝設定しない"
          />

          <label>同時予約数</label>
          <input
            className={styles.input}
            value={capacity}
            onChange={(e) => setCapacity(e.target.value)}
            inputMode="numeric"
            placeholder="空欄＝設定しない"
          />

          <label>行えるレーン</label>
          <div className={styles.inline}>
            {lanes.map((l) => (
              <label key={l.id} className={styles.toggle}>
                <input
                  type="checkbox"
                  checked={laneIds.includes(l.id)}
                  onChange={(e) =>
                    setLaneIds((ids) => (e.target.checked ? [...ids, l.id] : ids.filter((x) => x !== l.id)))
                  }
                />
                {l.shortName}
              </label>
            ))}
          </div>

          <label>予約の選択肢</label>
          <label className={styles.toggle}>
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
            予約登録の選択肢に出す
          </label>
        </div>

        <div className={styles.actions}>
          {onDelete && (
            <button type="button" className={styles.btn} onClick={onDelete} style={{ marginRight: "auto", color: "var(--danger)" }}>
              このメニューを削除
            </button>
          )}
          <button type="button" className={styles.btn} onClick={onClose}>
            やめる
          </button>
          <button type="submit" className={styles.primary} disabled={saving || !name.trim()}>
            保存
          </button>
        </div>
      </form>
    </dialog>
  );
}

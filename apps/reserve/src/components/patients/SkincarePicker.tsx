"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { recentSkincare, searchSkincare, type SkincareOption } from "@/lib/domain/skincare";
import { usePref } from "@/components/calendar/usePref";
import styles from "./patients.module.css";

const yen = (n: number) => `¥${n.toLocaleString("ja-JP")}`;
const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");
const tidy = (s: string) => s.trim().replace(/\s+/g, " ").slice(0, 60);

/**
 * スキンケア＆内服を選ぶ：最近使ったものだけをボタンで出し、ほかは検索か「すべての商品から選ぶ」の一覧から。
 * 一覧にないものは名前をそのまま入れて追加できる。
 * この端末で最近選んだもの（商品名だけ。患者の情報は入れない）は端末に覚えておく。
 */
export function SkincarePicker({
  value,
  onChange,
  options,
  previous,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  options: SkincareOption[];
  previous: string[];
}) {
  const [deviceRecent, setDeviceRecent] = usePref<string[]>("recentSkincare", [], isStringArray);
  const [q, setQ] = useState("");
  const [allOpen, setAllOpen] = useState(false);
  const priceOf = useMemo(() => new Map(options.map((o) => [o.name, o.priceYen])), [options]);

  const remember = (name: string) => setDeviceRecent((r) => [name, ...r.filter((x) => x !== name)].slice(0, 20));
  const add = (raw: string) => {
    const name = tidy(raw);
    if (!name) return;
    if (!value.includes(name)) onChange([...value, name]);
    remember(name);
    setQ("");
  };
  const toggle = (name: string) => {
    if (value.includes(name)) onChange(value.filter((x) => x !== name));
    else add(name);
  };

  const recent = recentSkincare(previous, deviceRecent);
  const hits = q.trim() ? searchSkincare(options, q).slice(0, 8) : [];
  const exact = hits.some((o) => o.name === tidy(q));

  const chip = (name: string) => (
    <button key={name} type="button" className={styles.preset} data-on={value.includes(name) || undefined} aria-pressed={value.includes(name)} onClick={() => toggle(name)}>
      {name}
      {priceOf.get(name) != null && <small>{yen(priceOf.get(name)!)}</small>}
    </button>
  );

  return (
    <>
      {recent.length > 0 && (
        <div className={styles.presetGroup}>
          <span className={styles.presetLabel}>最近使ったもの</span>
          <div className={styles.presets}>{recent.map(chip)}</div>
        </div>
      )}
      <div className={styles.inlineForm}>
        <input
          className={styles.input}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              // 候補が1つに絞れていればそれを、なければ入れた名前のまま追加
              add(hits.length === 1 ? hits[0].name : q);
            }
          }}
          maxLength={60}
          placeholder="名前で検索（一覧にないものはそのまま追加）"
          aria-label="スキンケア・内服を検索して追加"
        />
        <button type="button" className={styles.smallBtn} onClick={() => setAllOpen(true)}>
          すべての商品から選ぶ
        </button>
        {previous.length > 0 && (
          <button type="button" className={styles.smallBtn} onClick={() => onChange([...new Set([...value, ...previous])])} title={previous.join("、")}>
            前回と同じ内容を入れる
          </button>
        )}
      </div>
      {q.trim() && (
        <div className={styles.presets} style={{ marginTop: 6 }}>
          {hits.map((o) => chip(o.name))}
          {!exact && (
            <button type="button" className={styles.preset} onClick={() => add(q)}>
              「{tidy(q)}」を自由入力で追加
            </button>
          )}
        </div>
      )}
      <div className={styles.chips}>
        {value.map((x) => (
          <span key={x} className={styles.chip}>
            {x}
            <button type="button" onClick={() => onChange(value.filter((y) => y !== x))} aria-label={`${x}を外す`}>
              ×
            </button>
          </span>
        ))}
        {value.length === 0 && <span className={styles.muted}>未選択</span>}
      </div>
      {allOpen && <AllProductsDialog options={options} value={value} onToggle={toggle} onClose={() => setAllOpen(false)} />}
    </>
  );
}

/** 全リスト：分類ごとの一覧と検索。押すたびに追加／外す（閉じるまで続けて選べる） */
function AllProductsDialog({ options, value, onToggle, onClose }: { options: SkincareOption[]; value: string[]; onToggle: (name: string) => void; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [q, setQ] = useState("");
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  const groups = useMemo(() => {
    const m = new Map<string, SkincareOption[]>();
    for (const o of searchSkincare(options, q)) m.set(o.group, [...(m.get(o.group) ?? []), o]);
    return [...m.entries()];
  }, [options, q]);

  return (
    <dialog
      ref={ref}
      className={styles.allDialog}
      // 患者画面（外側のダイアログ）まで閉じないよう、ここで止める
      onClose={(e) => {
        e.stopPropagation();
        onClose();
      }}
      onCancel={(e) => e.stopPropagation()}
      aria-label="すべての商品から選ぶ"
    >
      <div className={styles.allHead}>
        <strong>すべての商品から選ぶ</strong>
        <span className={styles.muted}>{value.length}件選択中</span>
        <button type="button" className={styles.primary} onClick={() => ref.current?.close()}>
          閉じる
        </button>
      </div>
      <input className={styles.input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="名前・分類で検索" aria-label="商品を検索" autoFocus />
      <div className={styles.allBody}>
        {groups.length === 0 && <p className={styles.muted}>見つかりません。閉じて、名前を入れて自由入力で追加できます。</p>}
        {groups.map(([g, list]) => (
          <section key={g}>
            <h4>{g}</h4>
            <div className={styles.presets}>
              {list.map((o) => (
                <button key={o.name} type="button" className={styles.preset} data-on={value.includes(o.name) || undefined} aria-pressed={value.includes(o.name)} onClick={() => onToggle(o.name)}>
                  {o.name}
                  {o.priceYen !== null && <small>{yen(o.priceYen)}</small>}
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
    </dialog>
  );
}

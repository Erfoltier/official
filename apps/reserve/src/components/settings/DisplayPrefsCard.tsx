"use client";

import { usePref } from "@/components/calendar/usePref";
import { BLOCK_INFO, RECEPTION_START, UI_SIZES, applyUiSize, isBlockInfo, isUiSize, type BlockInfo, type UiSize } from "@/lib/displayPrefs";
import styles from "./settings.module.css";

const isReception = (v: unknown): v is string => RECEPTION_START.some((r) => r.id === v);

/** 端末ごとの表示の好み（この端末にだけ覚える。ほかの端末やスタッフには影響しない） */
export function DisplayPrefsCard() {
  const [blockInfo, setBlockInfo] = usePref<BlockInfo>("blockInfo", "all", isBlockInfo);
  const [reception, setReception] = usePref<string>("reception", "auto", isReception);
  const [size, setSize] = usePref<UiSize>("uiSize", "m", isUiSize);

  const rows: { title: string; hint: string; value: string; options: readonly { id: string; label: string }[]; onPick: (id: string) => void }[] = [
    {
      title: "予約枠の表示内容",
      hint: "カレンダーの予約枠に表示する情報です。短い枠では、収まる分だけ表示します。",
      value: blockInfo,
      options: BLOCK_INFO,
      onPick: (id) => setBlockInfo(id as BlockInfo),
    },
    {
      title: "受付一覧",
      hint: "カレンダーを開いたときに、左の受付一覧を表示するかどうかです。「端末に合わせる」では、パソコンでは表示し、スマホ・タブレットでは閉じます。",
      value: reception,
      options: RECEPTION_START,
      onPick: (id) => setReception(id),
    },
    {
      title: "文字の大きさ",
      hint: "画面全体と予約枠の文字の大きさです。カレンダー上部の「文字」ボタンでも切り替えられます。予約枠の高さは、カレンダー上部の「＋」「−」で変更してください。",
      value: size,
      options: UI_SIZES,
      onPick: (id) => {
        setSize(id as UiSize);
        applyUiSize(id as UiSize);
      },
    },
  ];

  return (
    <div className={styles.clinicCard}>
      <h3 className={styles.cardTitle}>この端末の表示</h3>
      <p className={styles.hint}>この端末にだけ保存されます。ほかの端末やスタッフの画面は変わりません。</p>
      {rows.map((r) => (
        <div key={r.title} className={styles.prefRow}>
          <b>{r.title}</b>
          <div className={styles.segment} role="radiogroup" aria-label={r.title}>
            {r.options.map((o) => (
              <button key={o.id} type="button" role="radio" aria-checked={r.value === o.id} onClick={() => r.onPick(o.id)}>
                {o.label}
              </button>
            ))}
          </div>
          <small>{r.hint}</small>
        </div>
      ))}
    </div>
  );
}

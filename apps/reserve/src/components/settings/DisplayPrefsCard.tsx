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
      title: "予約の枠に出す情報",
      hint: "カレンダーの予約の枠に、何を書くか。短い枠では、入る分だけ出します。",
      value: blockInfo,
      options: BLOCK_INFO,
      onPick: (id) => setBlockInfo(id as BlockInfo),
    },
    {
      title: "受付一覧",
      hint: "カレンダーを開いたときに、左の受付一覧を出しておくか。「端末に合わせる」はパソコンでは開き、スマホ・タブレットではたたみます。",
      value: reception,
      options: RECEPTION_START,
      onPick: (id) => setReception(id),
    },
    {
      title: "文字の大きさ",
      hint: "上のバー・受付一覧・予約の詳細・患者画面・設定と、カレンダーの予約の枠の文字を大きくします。カレンダー上部の「文字」ボタンでも切り替えられます。枠の高さは上の「＋」「−」で変えてください。",
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
      <p className={styles.hint}>ここの設定はこの端末にだけ覚えます（ほかの端末やスタッフの画面は変わりません）。</p>
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

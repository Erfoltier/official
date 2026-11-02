"use client";

import { useEffect, useState } from "react";
import { usePref } from "@/components/calendar/usePref";
import { addDays, disableOffline, enableOffline, offlineEnabled, refreshAhead } from "@/lib/offline";
import { fetchDayOnline } from "@/components/calendar/api";
import { nowInClinic } from "@/lib/domain/time";
import { withBase } from "@/lib/paths";
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

/**
 * この端末に予約表をダウンロードしておくか（サーバー・ネットが止まったとき、見るだけで出すため）。許可は院長・管理者だけ、外すのは誰でも。
 * 院内のパソコン・タブレットだけにする（患者名が端末に残るため。中身は暗号化）
 */
export function OfflineDeviceCard({ canAllow }: { canAllow: boolean }) {
  const [on, setOn] = useState(false);
  const [got, setGot] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOn(offlineEnabled());
  }, []);
  return (
    <div className={styles.clinicCard}>
      <h3 className={styles.cardTitle}>この端末に予約表をダウンロード（障害時の閲覧用）</h3>
      <p className={styles.hint}>
        サーバーや院のネットが止まったときも、この端末で<b>今日〜7日先の予約表を見るだけで</b>開けるよう、端末にダウンロードしておきます。押したときに8日分をダウンロードし、そのあとは予約表を開いているあいだ5分ごとに自動で新しくします（暗号化して保存）。
        <b>院内のパソコン・タブレットだけ</b>で使ってください（スマホや院外の端末では使わない）。
      </p>
      <p className={styles.hint}>この端末：{on ? `ダウンロードしています${got ? `（${got}）` : ""}` : "ダウンロードしていません"}</p>
      <div className={styles.actions} style={{ marginTop: 0 }}>
        {on && (
          <a className={styles.primary} style={{ textDecoration: "none", display: "inline-flex", alignItems: "center" }} href={withBase("/?offline=1")}>
            ダウンロードした予約表を見る
          </a>
        )}
        {on ? (
          <button
            type="button"
            className={styles.btn}
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await disableOffline();
              setOn(false);
              setBusy(false);
            }}
          >
            ダウンロードを解除（端末内の予約表を削除）
          </button>
        ) : (
          <button
            type="button"
            className={styles.primary}
            disabled={busy || !canAllow}
            title={canAllow ? undefined : "院長・管理者が許可します"}
            onClick={async () => {
              if (!window.confirm("この端末に予約表（患者名を含む）をダウンロードします。院内の端末ですか？")) return;
              setBusy(true);
              await enableOffline(withBase(""));
              const today = nowInClinic().date;
              await refreshAhead(today, fetchDayOnline);
              setGot(`${today.slice(5).replace("-", "/")}〜${addDays(today, 7).slice(5).replace("-", "/")} の8日分`);
              setOn(true);
              setBusy(false);
            }}
          >
            この端末に予約表をダウンロード
          </button>
        )}
      </div>
      {!canAllow && !on && <p className={styles.hint}>許可できるのは院長・管理者です。</p>}
    </div>
  );
}

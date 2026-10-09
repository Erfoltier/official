"use client";

import { useCallback, useEffect, useState } from "react";
import { createBackup, fetchRestorePoints, restoreSettings, type RestorePoints, type RestoreSummary } from "@/components/calendar/api";
import styles from "./settings.module.css";

function stamp(iso: string): string {
  return new Date(iso).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function Summary({ s }: { s: RestoreSummary }) {
  return (
    <span className={styles.muted}>
      {s.clinic}・レーン{s.lanes}・メニュー{s.menus}・状態{s.stages}・スキンケア/内服{s.products}
    </span>
  );
}

/**
 * 設定の復元。設定を変えるたびに自動で記録しているので、誤って変えたときに前の状態へ戻せる。
 * 対象：診療時間・レーン・メニュー・状態・スキンケア＆内服（予約・患者・記録は対象外）
 */
/** 保存データ全体（予約・患者・記録・設定）の控えを、サーバーの中に今すぐ作る（院長・管理者） */
function BackupCard({ notify, fail }: { notify: (t: string) => void; fail: (e: unknown) => void }) {
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<{ file: string; bytes: number; integrity: string; at: string } | null>(null);
  return (
    <div className={styles.clinicCard} style={{ marginBottom: 16 }}>
      <h3 className={styles.cardTitle}>データの控え（バックアップ）</h3>
      <p className={styles.hint}>
        予約・患者・記録・設定をまとめた控えを、サーバーの中に今すぐ作ります。大きな変更（取り込み・統合・一括の直し）の前に押してください。控えは外に送らず、サーバーの中にだけ置きます。
      </p>
      <div className={styles.actions} style={{ marginTop: 0 }}>
        <button
          type="button"
          className={styles.primary}
          disabled={busy}
          onClick={async () => {
            if (!window.confirm("いまのデータの控えを作ります。少し時間がかかることがあります。よろしいですか？")) return;
            setBusy(true);
            try {
              const r = await createBackup();
              setLast({ ...r, at: new Date().toISOString() });
              notify(`控えを作りました（${(r.bytes / 1024 / 1024).toFixed(1)}MB・確認 ${r.integrity}）`);
            } catch (e) {
              fail(e);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "控えを作っています…" : "今すぐ控えを取る"}
        </button>
      </div>
      {last && (
        <p className={styles.hint}>
          {stamp(last.at)} に作成：{last.file}（{(last.bytes / 1024 / 1024).toFixed(1)}MB・データの確認 {last.integrity}）
        </p>
      )}
    </div>
  );
}

export function RestoreTab({ onChanged, notify, fail }: { onChanged: () => Promise<void>; notify: (t: string) => void; fail: (e: unknown) => void }) {
  const [data, setData] = useState<RestorePoints | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    fetchRestorePoints().then(setData, fail);
  }, [fail]);

  useEffect(() => {
    load();
  }, [load]);

  if (!data) return <p className={styles.muted}>読み込み中…</p>;

  return (
    <section>
      <BackupCard notify={notify} fail={fail} />
      <p className={styles.lead}>
        誤って設定を変えてしまったときに、前の状態へ戻せます。設定を変えるたびに自動で記録しています。
        対象は 診療時間・レーン・メニュー・状態・スキンケア＆内服 です（予約・患者・施術歴は変わりません）。
        あとから作ったレーンやメニューは消さずに隠すので、それを使った予約もそのまま残ります。
        戻す直前の状態も記録されるので、戻したあとで「1日前」などからやり直すこともできます。
      </p>
      <p>
        いまの設定：<Summary s={data.current} />
      </p>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>戻す時点</th>
            <th>その時点で有効だった設定</th>
            <th>内容</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {data.points.map((p) => (
            <tr key={p.key}>
              <td>
                <strong>{p.label}</strong>
              </td>
              <td>
                {!p.available ? (
                  <span className={styles.muted}>記録なし</span>
                ) : p.at ? (
                  <>
                    {stamp(p.at)} の変更後
                    {p.oldest && <div className={styles.muted}>（これより前の記録はありません）</div>}
                  </>
                ) : (
                  <span>記録を始めた時点の設定（これより前の記録はありません）</span>
                )}
              </td>
              <td>{p.summary && <Summary s={p.summary} />}</td>
              <td>
                <button
                  className={styles.btn}
                  disabled={!p.available || busy !== null}
                  onClick={async () => {
                    if (!window.confirm(`設定を「${p.label}」の状態に戻しますか？\n（いまの設定も記録されるので、あとで戻し直せます）`)) return;
                    setBusy(p.key);
                    try {
                      setData(await restoreSettings(p.key));
                      await onChanged();
                      notify(`設定を${p.label}の状態に戻しました`);
                    } catch (err) {
                      fail(err);
                    } finally {
                      setBusy(null);
                    }
                  }}
                >
                  {busy === p.key ? "戻しています…" : "この時点に戻す"}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

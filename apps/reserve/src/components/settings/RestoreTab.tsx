"use client";

import { useCallback, useEffect, useState } from "react";
import { compactStorage, createBackup, fetchRestorePoints, fetchStorage, moveStorage, type StorageStats, restoreSettings, type RestorePoints, type RestoreSummary } from "@/components/calendar/api";
import styles from "./settings.module.css";

function stamp(iso: string): string {
  return new Date(iso).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function Summary({ s }: { s: RestoreSummary }) {
  return (
    <span className={styles.muted}>
      {s.clinic}・レーン{s.lanes}・メニュー{s.menus}・状態{s.stages}・スキンケア・内服{s.products}
    </span>
  );
}

/**
 * 設定の復元。設定を変えるたびに自動で記録しているので、誤って変えたときに前の状態へ戻せる。
 * 対象：診療時間・レーン・メニュー・状態・スキンケア・内服（予約・患者・記録は対象外）
 */
const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)}MB`;

/**
 * 写真などの置き場所。これまでは DB の中にあり、控えを作るたびに写真まで丸ごと複製していた。
 * 新しい写真は DB の外（サーバーの data/blobs/）に置く。前からある分は、ここで押したときだけ少しずつ移す
 */
function StorageCard({ notify, fail }: { notify: (t: string) => void; fail: (e: unknown) => void }) {
  const [st, setSt] = useState<StorageStats | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    fetchStorage().then(setSt, () => setSt(null));
  }, []);
  if (!st || !st.external) return null;
  const move = async () => {
    if (!window.confirm(`データベース内の写真など ${st.inDb}件（${mb(st.inDbBytes)}）を、サーバー内の別の場所へ移動します。\n暗号化したまま移動し、外部には送信しません。移動中も利用できます。よろしいですか？`)) return;
    setBusy("move");
    let total = 0;
    try {
      for (;;) {
        const r = await moveStorage();
        total += r.moved;
        setSt(r.stats);
        setBusy(`move:${r.left}`);
        if (r.left === 0 || r.moved === 0) break;
      }
      notify(`写真など ${total}件を移動しました`);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };
  const compact = async () => {
    if (!window.confirm("データベースの空き領域を詰めて容量を減らします。数十秒かかることがあり、その間は保存が待機状態になります。よろしいですか？")) return;
    setBusy("compact");
    try {
      const r = await compactStorage();
      setSt(r.stats);
      notify(`データベースを ${mb(r.before)} → ${mb(r.after)} に縮小しました`);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className={styles.clinicCard} style={{ marginBottom: 16 }}>
      <h3 className={styles.cardTitle}>写真などの保存場所</h3>
      <p className={styles.hint}>
        写真・PDF などはデータベースの外（サーバー内の別の場所）に暗号化して保存し、控えを軽くしています。上の「データの控え」には写真などは含まれません（写真は削除しない限り残ります）。
      </p>
      <p className={styles.hint}>
        データベース外：{st.files}件（{mb(st.fileBytes)}）／ データベース内：{st.inDb}件（{mb(st.inDbBytes)}）
        {st.dbBytes !== null && `／ データベースの容量 ${mb(st.dbBytes)}`}
      </p>
      <div className={styles.actions} style={{ marginTop: 0 }}>
        {st.inDb > 0 && (
          <button type="button" className={styles.primary} disabled={!!busy} onClick={() => void move()}>
            {busy?.startsWith("move") ? `移動中…（残り ${busy.split(":")[1] ?? st.inDb}件）` : `既存の写真など ${st.inDb}件をデータベース外へ移動`}
          </button>
        )}
        {st.inDb === 0 && st.dbBytes !== null && (
          <button type="button" className={styles.btn} disabled={!!busy} onClick={() => void compact()}>
            {busy === "compact" ? "縮小中…" : "データベースを縮小"}
          </button>
        )}
      </div>
    </div>
  );
}

/** 保存データ全体（予約・患者・記録・設定）の控えを、サーバーの中に今すぐ作る（院長・管理者） */
function BackupCard({ notify, fail }: { notify: (t: string) => void; fail: (e: unknown) => void }) {
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<{ file: string; bytes: number; integrity: string; at: string } | null>(null);
  return (
    <div className={styles.clinicCard} style={{ marginBottom: 16 }}>
      <h3 className={styles.cardTitle}>データの控え（バックアップ）</h3>
      <p className={styles.hint}>
        予約・患者・記録・設定をまとめた控えを、サーバー内に作成します。取り込み・統合・一括修正などの大きな変更の前に作成してください。控えは外部に送信しません。
      </p>
      <div className={styles.actions} style={{ marginTop: 0 }}>
        <button
          type="button"
          className={styles.primary}
          disabled={busy}
          onClick={async () => {
            if (!window.confirm("現在のデータの控えを作成します。少し時間がかかることがあります。よろしいですか？")) return;
            setBusy(true);
            try {
              const r = await createBackup();
              setLast({ ...r, at: new Date().toISOString() });
              notify(`控えを作成しました（${(r.bytes / 1024 / 1024).toFixed(1)}MB・整合性チェック ${r.integrity}）`);
            } catch (e) {
              fail(e);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "作成中…" : "今すぐ控えを作成"}
        </button>
      </div>
      {last && (
        <p className={styles.hint}>
          {stamp(last.at)} に作成：{last.file}（{(last.bytes / 1024 / 1024).toFixed(1)}MB・整合性チェック {last.integrity}）
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
      <h3 className={styles.cardTitle}>設定の復元</h3>
      <p className={styles.lead}>
        誤って設定を変更した場合に、以前の状態へ戻せます。設定は変更のたびに自動で記録されます。
        対象は診療時間・レーン・メニュー・状態・スキンケア・内服で、予約・患者・施術歴は変わりません。
        戻した時点より後に作成したレーンやメニューは削除せず非表示にするため、それを使った予約も残ります。戻す直前の状態も記録されるので、やり直しもできます。
      </p>
      <p>
        現在の設定：<Summary s={data.current} />
      </p>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>戻す時点</th>
            <th>その時点の設定</th>
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
                    {p.oldest && <div className={styles.muted}>これより前の記録はありません</div>}
                  </>
                ) : (
                  <span>記録開始時点の設定（これより前の記録はありません）</span>
                )}
              </td>
              <td>{p.summary && <Summary s={p.summary} />}</td>
              <td>
                <button
                  className={styles.btn}
                  disabled={!p.available || busy !== null}
                  onClick={async () => {
                    if (!window.confirm(`設定を「${p.label}」の状態に戻します。よろしいですか？\n現在の設定も記録されるため、後から元に戻せます。`)) return;
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
                  {busy === p.key ? "復元中…" : "この時点に戻す"}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ marginTop: 16 }}>
        <StorageCard notify={notify} fail={fail} />
      </div>
    </section>
  );
}

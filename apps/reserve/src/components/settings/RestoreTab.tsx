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
      {s.clinic}・レーン{s.lanes}・メニュー{s.menus}・状態{s.stages}・スキンケア/内服{s.products}
    </span>
  );
}

/**
 * 設定の復元。設定を変えるたびに自動で記録しているので、誤って変えたときに前の状態へ戻せる。
 * 対象：診療時間・レーン・メニュー・状態・スキンケア＆内服（予約・患者・記録は対象外）
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
    if (!window.confirm(`データベースの中にある写真など ${st.inDb}件（${mb(st.inDbBytes)}）を、サーバーの中の別の場所へ移します。\n中身は暗号化したままで、外には送りません。移している間も使えます。始めますか？`)) return;
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
      notify(`写真など ${total}件を移しました`);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };
  const compact = async () => {
    if (!window.confirm("データベースの空いた場所を詰めて小さくします。数十秒かかることがあり、その間は保存が待たされます。よろしいですか？")) return;
    setBusy("compact");
    try {
      const r = await compactStorage();
      setSt(r.stats);
      notify(`データベースを ${mb(r.before)} → ${mb(r.after)} にしました`);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className={styles.clinicCard} style={{ marginBottom: 16 }}>
      <h3 className={styles.cardTitle}>写真などの置き場所</h3>
      <p className={styles.hint}>
        写真・PDF などはデータベースの外（サーバーの中の別の場所）に置き、控えを軽く速くしています。中身は暗号化したままです。上の「控え」には写真などは入りません（写真は消さない限り、そのまま残ります）。
      </p>
      <p className={styles.hint}>
        データベースの外：{st.files}件（{mb(st.fileBytes)}）／ データベースの中：{st.inDb}件（{mb(st.inDbBytes)}）
        {st.dbBytes !== null && `／ データベースの大きさ ${mb(st.dbBytes)}`}
      </p>
      <div className={styles.actions} style={{ marginTop: 0 }}>
        {st.inDb > 0 && (
          <button type="button" className={styles.primary} disabled={!!busy} onClick={() => void move()}>
            {busy?.startsWith("move") ? `移しています…（残り ${busy.split(":")[1] ?? st.inDb}件）` : `前からある写真など ${st.inDb}件を外へ移す`}
          </button>
        )}
        {st.inDb === 0 && st.dbBytes !== null && (
          <button type="button" className={styles.btn} disabled={!!busy} onClick={() => void compact()}>
            {busy === "compact" ? "小さくしています…" : "データベースを小さくする"}
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
      <StorageCard notify={notify} fail={fail} />
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

"use client";

import { useCallback, useEffect, useState } from "react";
import { compactStorage, createBackup, fetchBackupStatus, type BackupStatus, downloadLocalBackup, fetchDayPdf, saveDayPdf, testDayPdf, type DayPdfSettings, fetchLocalBackup, localPhotosUrl, type LocalBackupStatus, fetchRestorePoints, fetchStorage, moveStorage, type StorageStats, restoreSettings, type RestorePoints, type RestoreSummary } from "@/components/calendar/api";
import { OfflineDeviceCard } from "./DisplayPrefsCard";
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
function BackupCard({ notify, fail, onDone }: { notify: (t: string) => void; fail: (e: unknown) => void; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<{ file: string; bytes: number; integrity: string; at: string } | null>(null);
  return (
    <div className={styles.clinicCard} style={{ marginBottom: 16 }}>
      <h3 className={styles.cardTitle}>サーバー内の控えを今すぐ作成</h3>
      <p className={styles.hint}>
        予約・患者・記録・設定をまとめた控えを、サーバー内に作成します。取り込み・統合・一括修正などの大きな変更の前に作成してください。新しい版の反映の前にも自動で同じ控えを作ります（あわせて新しい40件を残します）。控えは外部に送信しません。
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
              onDone();
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
  const [tick, setTick] = useState(0);
  const bump = useCallback(() => setTick((t) => t + 1), []);

  const load = useCallback(() => {
    fetchRestorePoints().then(setData, fail);
  }, [fail]);

  useEffect(() => {
    load();
  }, [load]);

  if (!data) return <p className={styles.muted}>読み込み中…</p>;

  return (
    <section>
      <BackupStatusCard fail={fail} tick={tick} />
      <BackupCard notify={notify} fail={fail} onDone={bump} />
      <LocalBackupCard notify={notify} fail={fail} onDone={bump} />
      <OfflineDeviceCard canAllow />
      <DayPdfCard notify={notify} fail={fail} />
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


/** 院のパソコンに控えを保存する（院長・管理者）。データは合言葉で暗号化、写真は鍵で暗号化されたまま */
function LocalBackupCard({ notify, fail, onDone }: { notify: (t: string) => void; fail: (e: unknown) => void; onDone: () => void }) {
  const [st, setSt] = useState<LocalBackupStatus | null>(null);
  const [pass, setPass] = useState("");
  const [pass2, setPass2] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => fetchLocalBackup().then(setSt).catch(fail), [fail]);
  useEffect(() => {
    void load();
  }, [load]);
  const days = st?.dataDays ?? null;
  const ok = pass.length >= 10 && pass === pass2;
  return (
    <div className={styles.clinicCard} style={{ marginBottom: 16 }}>
      <h3 className={styles.cardTitle}>院のパソコンに控えを保存</h3>
      <p className={styles.hint}>
        サーバーの控え（毎日・東京と大阪）とは別に、院内のパソコンにも控えを残せます。週に1回ほど、院長のパソコンなど決まった1台に保存し、外付けの記憶装置にも写しておくと安心です。
      </p>
      <p className={styles.hint} data-invalid={days !== null && days >= 7 ? true : undefined}>
        最後に保存：{st?.dataAt ? `${stamp(st.dataAt)}（${days}日前）` : "まだ保存していません"}
      </p>
      <h4 className={styles.subTitle}>1. 予約・患者・記録・設定（{st ? "データベース丸ごと" : "…"}）</h4>
      <p className={styles.hint}>
        院長が決めた<b>合言葉</b>で暗号化した1つのファイル（.lrbk）になります。合言葉がないと誰も開けません（なくすと院長も戻せません）。合言葉は紙などに控え、パソコンとは別の安全な場所に保管してください。
      </p>
      <div className={styles.timeRow}>
        <label className={styles.field}>
          <span>合言葉（10文字以上）</span>
          <input className={styles.input} type="password" value={pass} onChange={(e) => setPass(e.target.value)} autoComplete="new-password" />
        </label>
        <label className={styles.field}>
          <span>合言葉（確認のためもう一度）</span>
          <input className={styles.input} type="password" value={pass2} onChange={(e) => setPass2(e.target.value)} autoComplete="new-password" />
        </label>
      </div>
      <div className={styles.actions} style={{ marginTop: 0 }}>
        <button
          type="button"
          className={styles.primary}
          disabled={!ok || busy}
          onClick={async () => {
            setBusy(true);
            try {
              await downloadLocalBackup(pass);
              setPass("");
              setPass2("");
              notify("控えのファイルをダウンロードしました（ブラウザの「ダウンロード」フォルダ）");
              await load();
              onDone();
            } catch (e) {
              fail(e);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "作成中…" : "暗号化した控えを保存"}
        </button>
      </div>
      <h4 className={styles.subTitle}>2. 写真・同意書などのファイル</h4>
      <p className={styles.hint}>
        {st
          ? `全部で ${st.photos.count}件（${mb(st.photos.bytes)}）。前回の保存（${st.photosAt ? stamp(st.photosAt) : "まだ"}）から増えたのは ${st.photos.newCount}件（${mb(st.photos.newBytes)}）。`
          : "読み込み中…"}
        ファイルはサーバーの鍵で暗号化されたままなので、そのままでは開けません（戻すときに使います）。最初に1回「全部」を保存し、以後は「増えた分だけ」を保存してください。
      </p>
      <div className={styles.actions} style={{ marginTop: 0 }}>
        <a className={styles.btn} style={{ textDecoration: "none" }} href={localPhotosUrl(true)} onClick={() => window.setTimeout(() => (load(), onDone()), 5000)}>
          増えた分だけ保存
        </a>
        <a className={styles.btn} style={{ textDecoration: "none" }} href={localPhotosUrl(false)} onClick={() => window.setTimeout(() => (load(), onDone()), 5000)}>
          全部を保存
        </a>
      </div>
    </div>
  );
}

/** 診療日（水曜・祝日・特別診療日）の朝、その日の予約表をパスワード付き PDF でメールに送る（止まったときの紙の控え） */
function DayPdfCard({ notify, fail }: { notify: (t: string) => void; fail: (e: unknown) => void }) {
  const [st, setSt] = useState<DayPdfSettings | null>(null);
  const [to, setTo] = useState("");
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    fetchDayPdf()
      .then((s) => {
        setSt(s);
        setTo(s.to);
      })
      .catch(fail);
  }, [fail]);
  const save = async (body: { enabled?: boolean; to?: string; password?: string }, msg: string) => {
    setBusy(true);
    try {
      const s = await saveDayPdf(body);
      setSt(s);
      setPw("");
      notify(msg);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={styles.clinicCard} style={{ marginBottom: 16 }}>
      <h3 className={styles.cardTitle}>診療日の予約表 PDF（止まったときの紙の控え）</h3>
      <p className={styles.hint}>
        <b>水曜・祝日（と予約申請フォームの特別診療日）</b>の朝7時ごろ、その日の予約表を<b>パスワード付きの PDF</b> にして、下のアドレスへメールで送ります（リマインドと同じ院のメールサーバーから）。サーバーや院のネットが止まったら、印刷して使ってください。パスワードは PDF を開くときに要ります。
      </p>
      {st && !st.qpdf && <p className={styles.hint} data-invalid>サーバーに PDF のパスワードを掛ける部品（qpdf）がありません。</p>}
      <div className={styles.timeRow}>
        <label className={styles.field}>
          <span>送り先のメールアドレス（院長）</span>
          <input className={styles.input} type="email" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <label className={styles.field}>
          <span>PDF のパスワード（8文字以上。{st?.passwordSet ? "設定済み・変えるときだけ入力" : "未設定"}）</span>
          <input className={styles.input} type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" />
        </label>
      </div>
      <p className={styles.hint}>
        今の状態：{st ? (st.enabled ? "送る" : "送らない") : "…"}
        {st?.lastSent && `　最後に送った日：${st.lastSent.date}（${st.lastSent.count}件）`}
      </p>
      <div className={styles.actions} style={{ marginTop: 0 }}>
        <button type="button" className={styles.btn} disabled={busy} onClick={() => save({ to, ...(pw && { password: pw }) }, "保存しました")}>
          保存
        </button>
        <button
          type="button"
          className={styles.btn}
          disabled={busy || !st?.passwordSet || !to}
          onClick={async () => {
            setBusy(true);
            try {
              const r = await testDayPdf();
              if (r.sent) notify(`今日の予約表（${r.count}件）を送りました。メールを確かめてください`);
              else fail(new Error(`送れませんでした（${r.reason ?? "不明"}）`));
            } catch (e) {
              fail(e);
            } finally {
              setBusy(false);
            }
          }}
        >
          今日の分をテスト送信
        </button>
        <button
          type="button"
          className={styles.primary}
          disabled={busy || !st}
          onClick={() => save({ enabled: !st?.enabled, to, ...(pw && { password: pw }) }, st?.enabled ? "送るのをやめました" : "水曜・祝日の朝に送ります")}
        >
          {st?.enabled ? "送るのをやめる" : "送るようにする"}
        </button>
      </div>
    </div>
  );
}

const day = (iso?: string | null) => (iso ? new Date(iso).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");

/** 現在のバックアップ状況：AWS の毎日の控え（東京・大阪）と、サーバー内の控え */
function BackupStatusCard({ fail, tick }: { fail: (e: unknown) => void; tick: number }) {
  const [st, setSt] = useState<BackupStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(
    (refresh = false) => {
      setBusy(true);
      fetchBackupStatus(refresh)
        .then(setSt, fail)
        .finally(() => setBusy(false));
    },
    [fail],
  );
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load, tick]);
  return (
    <div className={styles.clinicCard} style={{ marginBottom: 16 }}>
      <h3 className={styles.cardTitle}>現在のバックアップ状況</h3>
      <p className={styles.hint}>
        サーバー丸ごとの控えを<b>毎日午前3時ごろ</b>に東京で取り、大阪にも写します（どちらも30日分。期限までは誰も消せない設定）。
      </p>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>場所</th>
              <th>件数</th>
              <th>いちばん新しい控え</th>
              <th>いちばん古い控え</th>
            </tr>
          </thead>
          <tbody>
            {st?.aws === null && (
              <tr>
                <td colSpan={4}>AWS の控えの状況を読めませんでした（AWS の外で動いているか、読む権限がありません）</td>
              </tr>
            )}
            {st?.aws?.map((v) => (
              <tr key={v.label}>
                <td>AWS {v.label}（毎日）</td>
                {v.error ? (
                  <td colSpan={3}>読めませんでした</td>
                ) : (
                  <>
                    <td>{v.count}件</td>
                    <td>
                      {day(v.latest)}
                      {v.latestStatus && v.latestStatus !== "COMPLETED" ? `（${v.latestStatus === "PARTIAL" ? "一部" : "作成中"}）` : ""}
                    </td>
                    <td>{day(v.oldest)}</td>
                  </>
                )}
              </tr>
            ))}
            {st && (
              <tr>
                <td>サーバー内（反映の前・下の「今すぐ作成」）</td>
                <td>{st.server.count}件</td>
                <td>{day(st.server.latest)}</td>
                <td>{day(st.server.oldest)}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <h4 className={styles.subTitle}>手動で作ったバックアップの履歴</h4>
      {st && st.manual.length === 0 ? (
        <p className={styles.hint}>まだありません（下の「今すぐ控えを作成」「院のパソコンに控えを保存」で作ると、ここに出ます）</p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>日時</th>
                <th>保存先</th>
                <th>内容</th>
                <th>作った人</th>
              </tr>
            </thead>
            <tbody>
              {st?.manual.slice(0, 10).map((m) => (
                <tr key={m.at + m.detail}>
                  <td>{stamp(m.at)}</td>
                  <td>{m.kind === "server" ? "サーバー内" : "院のパソコン"}</td>
                  <td>{m.detail}</td>
                  <td>{m.by}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className={styles.actions}>
        <button type="button" className={styles.btn} disabled={busy} onClick={() => load(true)}>
          {busy ? "確かめています…" : "最新の状況を確かめる"}
        </button>
      </div>
    </div>
  );
}

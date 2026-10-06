"use client";

import { useCallback, useEffect, useState } from "react";
import type { DeviceLink, DeviceLinksStatus, DeviceOptions, NeovoirLight, Patient, PhotoInboxItem } from "@/lib/domain/types";
import { DEFAULT_DEVICE_OPTIONS, NEOVOIR_LIGHTS } from "@/lib/domain/types";
import {
  assignPhotoInbox,
  createDeviceLink,
  deletePhotoInbox,
  fetchDeviceLinks,
  fetchPhotoInbox,
  photoInboxUrl,
  rematchPhotoInbox,
  revokeDeviceLink,
  saveDeviceOptions,
  searchPatients,
} from "@/components/calendar/api";
import { withBase } from "@/lib/paths";
import styles from "./settings.module.css";

const stamp = (iso?: string) =>
  iso ? new Date(iso).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";

/**
 * 外部機器の連携。いまはネオボワール（肌診断機）の写真の取り込み。
 * 院のパソコンに置く「取り込み係」が写真フォルダを見張って送り、氏名で患者に結びつける。
 */
export function DevicesTab({ isAdmin, canEdit, notify, fail }: { isAdmin: boolean; canEdit: boolean; notify: (t: string) => void; fail: (e: unknown) => void }) {
  const [status, setStatus] = useState<DeviceLinksStatus | null>(null);
  const [inbox, setInbox] = useState<PhotoInboxItem[] | null>(null);
  const [newToken, setNewToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      if (isAdmin) setStatus(await fetchDeviceLinks());
      setInbox(await fetchPhotoInbox());
    } catch (err) {
      fail(err);
    }
  }, [isAdmin, fail]);
  useEffect(() => {
    // 開いたときに読む
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const run = async (fn: () => Promise<unknown>, message?: string) => {
    setBusy(true);
    try {
      await fn();
      if (message) notify(message);
      await load();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const active = status?.links.filter((l) => !l.revoked) ?? [];
  const serverUrl = typeof window === "undefined" ? "" : `${window.location.origin}${withBase("")}`.replace(/\/$/, "");

  return (
    <section className={styles.clinic}>
      <p className={styles.lead}>
        院で使っている機器と予約カレンダーをつなぎます。つないだ機器のデータは、患者の施術歴（その日の写真）に自動で入ります。
      </p>

      <div className={styles.clinicCard}>
        <h3 className={styles.cardTitle}>
          ネオボワール（肌診断機）の写真 <span className={styles.optionBadge}>オプション</span>
        </h3>
        <p className={styles.hint}>
          ネオボワールの写真が見られるパソコン（親機または子機）に「取り込み係」を置くと、撮った写真を5分ごとに予約カレンダーへ送ります。
          写真のファイル名の<b>氏名</b>で患者を探し、1人に決まればその日の施術歴に入ります。ファイル名の<b>顧客番号</b>は一度結びつくと覚えるので、次からは同姓同名でも確実です。
          同じ名前の人が2人以上いる・見つからないときは、下の「照合待ちの写真」に入ります（送るのは撮影したままの写真だけで、解析の画像は送りません）。
        </p>

        {isAdmin && status && (
          <>
            <div className={styles.priceStatus}>
              {active.length === 0 ? (
                <span>まだつながっていません</span>
              ) : (
                <span>
                  つながっています：受け取り {status.received}枚・最後に受け取った日時 {stamp(status.lastReceivedAt)}
                </span>
              )}
            </div>
            {active.map((l) => (
              <div key={l.id} className={styles.prefRow}>
                <b>{l.name}</b>
                <small>
                  鍵を作った日 {stamp(l.createdAt)}（{l.createdBy.name}）・受け取り {l.received}枚・最後 {stamp(l.lastUsedAt)}
                </small>
                <OptionsEditor key={JSON.stringify(l.options ?? null)} link={l} busy={busy} onSave={(o) => run(() => saveDeviceOptions(l.id, o), "取り込み方を保存しました（取り込み係は5分以内に従います）")} />
                <div>
                  <button
                    className={styles.btn}
                    disabled={busy}
                    onClick={() => {
                      if (window.confirm(`「${l.name}」の鍵を使えなくしますか？（取り込み係は写真を送れなくなります）`)) run(() => revokeDeviceLink(l.id), "連携を止めました");
                    }}
                  >
                    この鍵を止める
                  </button>
                </div>
              </div>
            ))}

            {newToken ? (
              <div className={styles.importBox}>
                <b>接続用の鍵（この画面を閉じると二度と表示されません）</b>
                <code className={styles.tokenBox}>{newToken}</code>
                <div className={styles.actions}>
                  <button className={styles.btn} onClick={() => navigator.clipboard?.writeText(newToken).then(() => notify("鍵をコピーしました"), () => {})}>
                    コピー
                  </button>
                  <button className={styles.btn} onClick={() => setNewToken(null)}>
                    閉じる
                  </button>
                </div>
                <p className={styles.hint}>取り込み係の準備（下の手順の 3）で、この鍵を貼り付けてください。チャットやメールには貼らないでください。</p>
              </div>
            ) : (
              <div className={styles.actions}>
                <button
                  className={styles.primary}
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      const r = await createDeviceLink("ネオボワール（受付のパソコン）");
                      setNewToken(r.token);
                    })
                  }
                >
                  接続用の鍵を作る
                </button>
              </div>
            )}

            <details className={styles.priceUrls}>
              <summary>つなぎ方（ネオボワールの写真が見られるパソコンで行います。親機・子機のどちらでも可）</summary>
              <ol className={styles.steps}>
                <li>
                  上の「接続用の鍵を作る」を押し、表示された鍵を控えます。
                </li>
                <li>
                  ネオボワールの写真が見られるパソコン（親機でも子機でも。診療中に電源が入っている時間が長いほうがおすすめ）で{" "}
                  <a href={withBase("/integrations/neovoir-agent.ps1")} download>
                    取り込み係（neovoir-agent.ps1）
                  </a>{" "}
                  をダウンロードし、分かりやすい場所（例：ドキュメント）に置きます。
                </li>
                <li>
                  スタートメニューで「PowerShell」を<b>普通に</b>開き（「管理者として実行」では親機の共有フォルダが見えないことがあります）、次を入力します（ファイルの場所に合わせて）。
                  <code className={styles.tokenBox}>powershell -ExecutionPolicy Bypass -File &quot;$env:USERPROFILE\Documents\neovoir-agent.ps1&quot; -Setup</code>
                  聞かれた順に、予約カレンダーのアドレス <code>{serverUrl}</code>、鍵、入口のID・パスワード（予約カレンダーをブラウザで開くときに聞かれるもの。聞かれないなら Enter）、写真のフォルダ（いしだ皮フ科では <code>\\NEOVOIR\NeoVoirI\Image</code>。そのまま Enter でこれになります）、氏名を読む場所（そのまま Enter で「ネオボワールのファイル名」）、何日前の写真から送るかを入れます。
                </li>
                <li>
                  <code>-Setup</code> を <code>-Preview</code> に変えて実行すると、送らずに「どの写真から、どんな氏名・顧客番号を読むか」をそのパソコンの画面で確かめられます（患者さんの名前が出るので、チャットなどには貼らないでください）。正しく読めていれば準備完了です（あとは5分ごとに自動で送ります）。
                </li>
                <li>
                  過去に撮った写真も入れるときは、<b>Airリザーブからの患者の移行が終わってから</b>、<code>-Setup</code> を <code>-Backfill</code> に変えて実行し、何日前の分から送るかを入れます（そのまま Enter で全部）。上の「取り込む写真」の設定のとおりに、5分ごとの自動送信で順に送ります。
                </li>
              </ol>
              <p className={styles.hint}>
                入口のID・パスワードを変えたときは、<code>-Setup</code> を <code>-SetBasic</code> に変えて実行し、入れ直してください。
              </p>
              <p className={styles.hint}>
                鍵はそのパソコンのWindowsユーザーだけが読める形で保存されます。パソコンを入れ替えるときや鍵が漏れたかもしれないときは、上の「この鍵を止める」で止めて、新しい鍵を作り直してください。
              </p>
            </details>
          </>
        )}
        {!isAdmin && <p className={styles.muted}>つなぐ設定は院長・管理者ができます。</p>}
      </div>

      <div className={styles.clinicCard}>
        <h3 className={styles.cardTitle}>照合待ちの写真{inbox ? `（${inbox.length}枚）` : ""}</h3>
        <p className={styles.hint}>
          氏名で患者が1人に決まらなかった写真です。患者を選んで結びつけてください。Airリザーブから患者を移したあとなどは「もう一度名前で照合」でまとめて結びつけられます。
        </p>
        {canEdit && (
          <div className={styles.actions}>
            <button
              className={styles.btn}
              disabled={busy || !inbox?.length}
              onClick={() =>
                run(async () => {
                  const r = await rematchPhotoInbox();
                  notify(`${r.matched}枚を患者に結びつけました（残り${r.remaining}枚）`);
                })
              }
            >
              もう一度名前で照合
            </button>
          </div>
        )}
        {!inbox ? (
          <p className={styles.muted}>読み込み中…</p>
        ) : inbox.length === 0 ? (
          <p className={styles.muted}>ありません</p>
        ) : (
          <div className={styles.inboxGrid}>
            {inbox.map((item) => (
              <InboxCard key={item.id} item={item} canDelete={canEdit} busy={busy} run={run} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function InboxCard({ item, canDelete, busy, run }: { item: PhotoInboxItem; canDelete: boolean; busy: boolean; run: (fn: () => Promise<unknown>, message?: string) => Promise<void> }) {
  const [q, setQ] = useState(item.patientName);
  const [hits, setHits] = useState<Patient[] | null>(null);
  return (
    <div className={styles.inboxCard}>
      <a href={photoInboxUrl(item.id)} target="_blank" rel="noopener">
        {/* 照合待ちの写真（ログインしたスタッフだけが見られる） */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={photoInboxUrl(item.id)} alt={item.name} loading="lazy" />
      </a>
      <div>
        <b>{item.patientName || "（氏名なし）"}</b>
        <small>
          {item.date}・{item.reason === "ambiguous" ? "同じ名前が2人以上" : "その名前の患者がいない"}
        </small>
      </div>
      <form
        className={styles.inline}
        onSubmit={(e) => {
          e.preventDefault();
          searchPatients(q).then(setHits, () => setHits([]));
        }}
      >
        <input className={styles.input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="氏名・フリガナ・診察券番号" aria-label="患者をさがす" />
        <button className={styles.btn} type="submit">
          さがす
        </button>
      </form>
      {hits && (
        <ul className={styles.hitList}>
          {hits.length === 0 && <li className={styles.muted}>見つかりません</li>}
          {hits.slice(0, 6).map((p) => (
            <li key={p.id}>
              <button className={styles.btn} disabled={busy} onClick={() => run(() => assignPhotoInbox(item.id, p.id), `${p.name} さんの写真にしました`)}>
                {p.name}
                {p.chartNo && <small>（{p.chartNo}）</small>}
                {p.birthDate && <small> {p.birthDate}</small>}
              </button>
            </li>
          ))}
        </ul>
      )}
      {canDelete && (
        <button
          className={styles.linkDanger}
          disabled={busy}
          onClick={() => {
            if (window.confirm("この写真を削除しますか？（元に戻せません）")) run(() => deletePhotoInbox(item.id), "削除しました");
          }}
        >
          削除
        </button>
      )}
    </div>
  );
}

const LIGHT_LABEL: Record<NeovoirLight, string> = { NL: "NL（通常光）", PL: "PL（偏光）", SL: "SL", UV: "UV（紫外線）" };
const SIZES = [
  { v: 2000, label: "縮小（長い辺 2000px まで・1枚 約1MB 以内）" },
  { v: 3000, label: "やや縮小（長い辺 3000px まで・1枚 約1MB 以内）" },
  { v: 0, label: "原寸のまま（1枚1.5〜2MB）" },
];

/** 取り込み方：どの光源を取り込むか・縮小するか（取り込み係が毎回読みにくる） */
function OptionsEditor({ link, busy, onSave }: { link: DeviceLink; busy: boolean; onSave: (o: DeviceOptions) => void }) {
  const cur = link.options ?? DEFAULT_DEVICE_OPTIONS;
  const [lights, setLights] = useState<NeovoirLight[]>(cur.lights);
  const [maxSide, setMaxSide] = useState(cur.maxSide);
  const dirty = lights.join() !== cur.lights.join() || maxSide !== cur.maxSide;
  const perShot = (lights.length * 3 * (maxSide === 0 ? 1.8 : 0.8)).toFixed(1);
  return (
    <div className={styles.optionsBox}>
      <b>取り込む写真</b>
      <div className={styles.segment}>
        {NEOVOIR_LIGHTS.map((x) => (
          <label key={x} className={styles.toggle}>
            <input
              type="checkbox"
              checked={lights.includes(x)}
              onChange={(e) => setLights((ls) => (e.target.checked ? NEOVOIR_LIGHTS.filter((y) => y === x || ls.includes(y)) : ls.filter((y) => y !== x)))}
            />
            {LIGHT_LABEL[x]}
          </label>
        ))}
      </div>
      <select className={styles.input} value={maxSide} onChange={(e) => setMaxSide(Number(e.target.value))} aria-label="写真の大きさ">
        {SIZES.map((s) => (
          <option key={s.v} value={s.v}>
            {s.label}
          </option>
        ))}
      </select>
      <small>
        1回の撮影で {lights.length * 3}枚（正面・左・右 × {lights.length}種類）、およそ {perShot}MB。
      </small>
      <div>
        <button className={styles.primary} disabled={busy || !dirty || lights.length === 0} onClick={() => onSave({ lights, maxSide })}>
          取り込み方を保存
        </button>
      </div>
    </div>
  );
}

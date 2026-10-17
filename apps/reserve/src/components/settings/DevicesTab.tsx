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
 * 院のパソコンに置く「取り込みツール」が写真フォルダを見張って送り、氏名で患者に結びつける。
 */
export function DevicesTab({ isAdmin, canEdit, notify, fail }: { isAdmin: boolean; canEdit: boolean; notify: (t: string) => void; fail: (e: unknown) => void }) {
  const [status, setStatus] = useState<DeviceLinksStatus | null>(null);
  const [inbox, setInbox] = useState<PhotoInboxItem[] | null>(null);
  const [newToken, setNewToken] = useState<string | null>(null);
  const [newGoogleKey, setNewGoogleKey] = useState<string | null>(null);
  const [newBookingKey, setNewBookingKey] = useState<string | null>(null);
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

  const active = status?.links.filter((l) => !l.revoked && l.source === "neovoir") ?? [];
  const googleKeys = status?.links.filter((l) => !l.revoked && l.source === "google") ?? [];
  const bookingKeys = status?.links.filter((l) => !l.revoked && l.source === "booking") ?? [];
  const serverUrl = typeof window === "undefined" ? "" : `${window.location.origin}${withBase("")}`.replace(/\/$/, "");

  return (
    <section className={`${styles.clinic} ${styles.devices}`}>
      <p className={styles.lead}>
        院内の機器と LANE RESERVE を連携します。連携した機器のデータは、患者の施術歴（その日の写真）に自動で登録されます。
      </p>

      <div className={styles.clinicCard}>
        <h3 className={styles.cardTitle}>
          ネオボワール（肌診断機）の写真 <span className={styles.optionBadge}>オプション</span>
        </h3>
        <p className={styles.hint}>
          ネオボワールの写真を閲覧できるパソコン（親機または子機）に「取り込みツール」を設置すると、撮影した写真を5分ごとに LANE RESERVE へ送信します。
          写真のファイル名の<b>氏名</b>で患者を検索し、1人に絞れればその日の施術歴に登録します。ファイル名の<b>顧客番号</b>は一度紐付くと記憶するため、次回からは同姓同名でも確実に照合できます。
          同じ名前の患者が2人以上いる場合や該当者がいない場合は、下の「照合待ちの写真」に入ります。送信するのは撮影した写真のみで、解析画像は送信しません。
        </p>

        {isAdmin && status && (
          <>
            <div className={styles.priceStatus}>
              {active.length === 0 ? (
                <span>未連携</span>
              ) : (
                <span>
                  連携済：受信 {status.received}枚・最終受信 {stamp(status.lastReceivedAt)}
                </span>
              )}
            </div>
            {active.map((l) => (
              <div key={l.id} className={styles.prefRow}>
                <b>{l.name}</b>
                <small>
                  作成日 {stamp(l.createdAt)}（{l.createdBy.name}）・受信 {l.received}枚・最終受信 {stamp(l.lastUsedAt)}
                </small>
                <OptionsEditor key={JSON.stringify(l.options ?? null)} link={l} busy={busy} onSave={(o) => run(() => saveDeviceOptions(l.id, o), "取り込み設定を保存しました（5分以内に取り込みツールへ反映されます）")} />
                <div>
                  <button
                    className={styles.btn}
                    disabled={busy}
                    onClick={() => {
                      if (window.confirm(`「${l.name}」の接続キーを無効にします。取り込みツールから写真を送信できなくなります。よろしいですか？`)) run(() => revokeDeviceLink(l.id), "連携を停止しました");
                    }}
                  >
                    このキーを無効化
                  </button>
                </div>
              </div>
            ))}

            {newToken ? (
              <div className={styles.importBox}>
                <b>接続キー（この画面を閉じると再表示できません）</b>
                <code className={styles.tokenBox}>{newToken}</code>
                <div className={styles.actions}>
                  <button className={styles.btn} onClick={() => navigator.clipboard?.writeText(newToken).then(() => notify("接続キーをコピーしました"), () => {})}>
                    コピー
                  </button>
                  <button className={styles.btn} onClick={() => setNewToken(null)}>
                    閉じる
                  </button>
                </div>
                <p className={styles.hint}>下の「連携手順」の 3 で、この接続キーを貼り付けてください。チャットやメールには貼り付けないでください。</p>
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
                  接続キーを発行
                </button>
              </div>
            )}

            <details className={styles.priceUrls}>
              <summary>連携手順（ネオボワールの写真を閲覧できるパソコンで行います）</summary>
              <ol className={styles.steps}>
                <li>
                  上の「接続キーを発行」を押し、表示された接続キーを控えます。
                </li>
                <li>
                  ネオボワールの写真を閲覧できるパソコン（親機・子機のどちらでも可。診療中に電源が入っている時間が長いほうがおすすめ）で{" "}
                  <a href={withBase("/integrations/neovoir-agent.ps1")} download>
                    取り込みツール（neovoir-agent.ps1）
                  </a>{" "}
                  をダウンロードし、分かりやすい場所（例：ドキュメント）に保存します。
                </li>
                <li>
                  スタートメニューから「PowerShell」を<b>通常どおり</b>開き、次のコマンドを入力します（パスはファイルの保存場所に合わせてください）。「管理者として実行」で開くと、親機の共有フォルダが見えないことがあります。
                  <code className={styles.tokenBox}>powershell -ExecutionPolicy Bypass -File &quot;$env:USERPROFILE\Documents\neovoir-agent.ps1&quot; -Setup</code>
                  画面の案内に従い、LANE RESERVE のアドレス <code>{serverUrl}</code>、接続キー、入口の ID・パスワード（LANE RESERVE をブラウザで開くときに求められるもの。求められない場合は Enter）、写真のフォルダ（いしだ皮フ科では <code>\\NEOVOIR\NeoVoirI\Image</code>。Enter のみでこの値になります）、氏名の読み取り元（Enter のみで「ネオボワールのファイル名」）、何日前の写真から送信するかを入力します。
                </li>
                <li>
                  <code>-Setup</code> を <code>-Preview</code> に変えて実行すると、送信せずに、どの写真からどの氏名・顧客番号を読み取るかをそのパソコンで確認できます（患者名が表示されるため、チャットなどには貼り付けないでください）。正しく読み取れていれば準備完了です。以降は5分ごとに自動で送信します。
                </li>
                <li>
                  過去の写真も取り込む場合は、<b>Airリザーブからの患者の移行が完了してから</b>、<code>-Setup</code> を <code>-Backfill</code> に変えて実行し、何日前の写真から送信するかを入力します（Enter のみで全期間）。上の「取り込む写真」の設定に従い、5分ごとの自動送信で順に送ります。
                </li>
              </ol>
              <p className={styles.hint}>
                入口の ID・パスワードを変更した場合は、<code>-Setup</code> を <code>-SetBasic</code> に変えて実行し、入力し直してください。
              </p>
              <p className={styles.hint}>
                接続キーは、そのパソコンの Windows ユーザーだけが読める形で保存されます。パソコンを入れ替える場合や接続キーが漏れた可能性がある場合は、「このキーを無効化」を押して、新しい接続キーを発行してください。
              </p>
            </details>
          </>
        )}
        {!isAdmin && <p className={styles.muted}>連携の設定は院長・管理者のみ行えます。</p>}
      </div>

      {isAdmin && status && (
        <GoogleKeysCard
          keys={googleKeys}
          serverUrl={serverUrl}
          busy={busy}
          onCreate={() =>
            run(async () => {
              const r = await createDeviceLink("Google連携（問診票・同意書・料金表）", "google");
              setNewGoogleKey(r.token);
            })
          }
          onRevoke={(l) => {
            if (window.confirm(`「${l.name}」の接続キーを無効にします。このキーを設定したスクリプトから送信できなくなります。よろしいですか？`)) run(() => revokeDeviceLink(l.id), "接続キーを無効にしました");
          }}
          newKey={newGoogleKey}
          onCloseKey={() => setNewGoogleKey(null)}
          notify={notify}
        />
      )}

      {isAdmin && status && (
        <BookingKeysCard
          keys={bookingKeys}
          serverUrl={serverUrl}
          busy={busy}
          onCreate={(name) =>
            run(async () => {
              const r = await createDeviceLink(name, "booking");
              setNewBookingKey(r.token);
            })
          }
          onRevoke={(l) => {
            if (window.confirm(`「${l.name}」の接続キーを無効にします。このキーを使っている自動予約プログラムは、予約を入れられなくなります。よろしいですか？`)) run(() => revokeDeviceLink(l.id), "接続キーを無効にしました");
          }}
          newKey={newBookingKey}
          onCloseKey={() => setNewBookingKey(null)}
          notify={notify}
        />
      )}

      <div className={styles.clinicCard}>
        <h3 className={styles.cardTitle}>照合待ちの写真{inbox ? `（${inbox.length}枚）` : ""}</h3>
        <p className={styles.hint}>
          氏名で患者を1人に絞れなかった写真です。患者を選んで紐付けてください。Airリザーブから患者を移行した後などは、「名前で再照合」でまとめて紐付けられます。
        </p>
        {canEdit && (
          <div className={styles.actions}>
            <button
              className={styles.btn}
              disabled={busy || !inbox?.length}
              onClick={() =>
                run(async () => {
                  const r = await rematchPhotoInbox();
                  notify(`${r.matched}枚を患者に紐付けました（残り${r.remaining}枚）`);
                })
              }
            >
              名前で再照合
            </button>
          </div>
        )}
        {!inbox ? (
          <p className={styles.muted}>読み込み中…</p>
        ) : inbox.length === 0 ? (
          <p className={styles.muted}>照合待ちの写真はありません</p>
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
          {item.date}・{item.reason === "ambiguous" ? "同じ名前の患者が2人以上" : "該当する患者なし"}
        </small>
      </div>
      <form
        className={styles.inline}
        onSubmit={(e) => {
          e.preventDefault();
          searchPatients(q).then(setHits, () => setHits([]));
        }}
      >
        <input className={styles.input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="氏名・フリガナ・診察券番号" aria-label="患者を検索" />
        <button className={styles.btn} type="submit">
          検索
        </button>
      </form>
      {hits && (
        <ul className={styles.hitList}>
          {hits.length === 0 && <li className={styles.muted}>該当する患者はいません</li>}
          {hits.slice(0, 6).map((p) => (
            <li key={p.id}>
              <button className={styles.btn} disabled={busy} onClick={() => run(() => assignPhotoInbox(item.id, p.id), `${p.name} さんに紐付けました`)}>
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
            if (window.confirm("この写真を削除します。元に戻せません。よろしいですか？")) run(() => deletePhotoInbox(item.id), "削除しました");
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
  { v: 2000, label: "縮小（長辺 2000px まで・1枚 約1MB 以内）" },
  { v: 3000, label: "やや縮小（長辺 3000px まで・1枚 約1MB 以内）" },
  { v: 0, label: "原寸（1枚 1.5〜2MB）" },
];

/** 取り込み方：どの光源を取り込むか・縮小するか（取り込みツールが毎回読みにくる） */
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
        1回の撮影で {lights.length * 3}枚（正面・左・右 × {lights.length}種類）、約 {perShot}MB です。
      </small>
      <div>
        <button className={styles.primary} disabled={busy || !dirty || lights.length === 0} onClick={() => onSave({ lights, maxSide })}>
          取り込み設定を保存
        </button>
      </div>
    </div>
  );
}

/** Google連携の鍵：問診票・同意書・料金表の Apps Script がLANE RESERVEへ送るときの TOKEN */
function GoogleKeysCard(props: {
  keys: DeviceLink[];
  serverUrl: string;
  busy: boolean;
  newKey: string | null;
  onCreate: () => void;
  onRevoke: (l: DeviceLink) => void;
  onCloseKey: () => void;
  notify: (t: string) => void;
}) {
  const { keys, serverUrl, busy, newKey, onCreate, onRevoke, onCloseKey, notify } = props;
  const api = `${serverUrl}/api/v1/integration`;
  return (
    <div className={styles.clinicCard}>
      <h3 className={styles.cardTitle}>Google 連携の接続キー（問診票・同意書・料金表）</h3>
      <p className={styles.hint}>
        問診票（Google フォーム）・同意書のひな形・料金表（スプレッドシート）の Apps Script が、LANE RESERVE へ送信するときに使う接続キーです。
        各スクリプトの「プロジェクトの設定 → スクリプト プロパティ」の <code>TOKEN</code> に設定してください。
      </p>
      {keys.map((l) => (
        <div key={l.id} className={styles.prefRow}>
          <b>{l.name}</b>
          <small>
            作成日 {stamp(l.createdAt)}（{l.createdBy.name}）・最終利用 {stamp(l.lastUsedAt)}
          </small>
          <div>
            <button className={styles.btn} disabled={busy} onClick={() => onRevoke(l)}>
              このキーを無効化
            </button>
          </div>
        </div>
      ))}
      {newKey ? (
        <div className={styles.importBox}>
          <b>接続キー（この画面を閉じると再表示できません）</b>
          <code className={styles.tokenBox}>{newKey}</code>
          <div className={styles.actions}>
            <button className={styles.btn} onClick={() => navigator.clipboard?.writeText(newKey).then(() => notify("接続キーをコピーしました"), () => {})}>
              コピー
            </button>
            <button className={styles.btn} onClick={onCloseKey}>
              閉じる
            </button>
          </div>
          <p className={styles.hint}>各スクリプトの TOKEN に貼り付けてください。チャットやメールには貼り付けないでください。</p>
        </div>
      ) : (
        <div className={styles.actions}>
          <button className={styles.primary} disabled={busy} onClick={onCreate}>
            {keys.length ? "接続キーを追加発行" : "接続キーを発行"}
          </button>
        </div>
      )}
      <details className={styles.priceUrls}>
        <summary>スクリプト プロパティの設定内容</summary>
        <ul className={styles.steps}>
          <li>
            <code>TOKEN</code>：上で発行した接続キー（3つのスクリプトで同じキーを使えます）
          </li>
          <li>
            <code>RESERVE_URL</code>：問診票は <code>{api}/questionnaires</code>、同意書は <code>{api}/consent-templates</code>、料金表は <code>{api}/prices</code>
          </li>
          <li>
            <code>BASIC_USER</code>・<code>BASIC_PASS</code>：LANE RESERVE をブラウザで開くときに求められる ID・パスワード
          </li>
          <li>設定後、エディタで <code>setup</code> を1回実行します（自動送信の時刻が登録されます）。</li>
        </ul>
        <p className={styles.hint}>接続キーが漏れた可能性がある場合は「このキーを無効化」を押し、新しい接続キーを発行して各スクリプトに設定し直してください。</p>
      </details>
    </div>
  );
}

/** 自動予約プログラム（ChatGPT など）の接続キー。予約の入力・変更・取り消しだけができる */
function BookingKeysCard(props: {
  keys: DeviceLink[];
  serverUrl: string;
  busy: boolean;
  newKey: string | null;
  onCreate: (name: string) => void;
  onRevoke: (l: DeviceLink) => void;
  onCloseKey: () => void;
  notify: (t: string) => void;
}) {
  const { keys, serverUrl, busy, newKey, onCreate, onRevoke, onCloseKey, notify } = props;
  const [name, setName] = useState("ChatGPT 自動予約");
  const api = `${serverUrl}/api/v1/integration/booking`;
  return (
    <div className={styles.clinicCard}>
      <h3 className={styles.cardTitle}>自動予約プログラムの接続キー（ChatGPT など）</h3>
      <p className={styles.hint}>
        外部の自動予約プログラムが、予約の入力・変更・取り消しをするときに使う接続キーです。このキーでは、院長と同じようにカルテ・メモ・写真・問診票・同意書・見積・設定も見て変えられます（スタッフ・PIN・二要素認証・接続キーの操作と、控えからの復元はできません）。
        プログラムが入れた予約は、カレンダーの変更履歴に「自動予約（キーの名前）」と残ります。
      </p>
      <p className={styles.hint}>
        使い方は{" "}
        <a href={withBase("/integrations/booking-api.html")} target="_blank" rel="noreferrer">
          自動予約プログラムの接続マニュアル
        </a>{" "}
        を見てください。入口のアドレス：<code>{api}</code>
      </p>
      {keys.map((l) => (
        <div key={l.id} className={styles.prefRow}>
          <b>{l.name}</b>
          <small>
            作成日 {stamp(l.createdAt)}（{l.createdBy.name}）・最終利用 {stamp(l.lastUsedAt)}
          </small>
          <div>
            <button className={styles.btn} disabled={busy} onClick={() => onRevoke(l)}>
              このキーを無効化
            </button>
          </div>
        </div>
      ))}
      {newKey ? (
        <div className={styles.importBox}>
          <b>接続キー（この画面を閉じると再表示できません）</b>
          <code className={styles.tokenBox}>{newKey}</code>
          <div className={styles.actions}>
            <button className={styles.btn} onClick={() => navigator.clipboard?.writeText(newKey).then(() => notify("接続キーをコピーしました"), () => {})}>
              コピー
            </button>
            <button className={styles.btn} onClick={onCloseKey}>
              閉じる
            </button>
          </div>
          <p className={styles.hint}>自動予約プログラムの設定（ChatGPT の GPT なら「アクション」の認証 → API キー）に貼り付けてください。チャットの本文やメールには貼り付けないでください。</p>
        </div>
      ) : (
        <div className={styles.actions} style={{ alignItems: "center" }}>
          <input className={styles.input} style={{ width: "auto", flex: "1 1 200px" }} value={name} maxLength={40} onChange={(e) => setName(e.target.value)} aria-label="接続キーの名前" />
          <button className={styles.primary} disabled={busy || !name.trim()} onClick={() => onCreate(name.trim())}>
            接続キーを発行
          </button>
        </div>
      )}
    </div>
  );
}

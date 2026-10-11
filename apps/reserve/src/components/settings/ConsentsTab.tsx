"use client";

import { useCallback, useEffect, useState } from "react";
import type { Menu } from "@/lib/domain/types";
import { fetchConsentSource, saveConsentSource, saveConsentTemplateMenus } from "@/components/calendar/api";
import { useConsentTemplates } from "@/components/consents/consentCache";
import styles from "./settings.module.css";

const stamp = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "まだ";

/** 同意書のひな形（Google ドキュメントが正本）と、候補の先頭に出すメニュー */
export function ConsentsTab({
  menus,
  canEdit,
  isAdmin,
  notify,
  fail,
}: {
  menus: Menu[];
  canEdit: boolean;
  isAdmin: boolean;
  notify: (t: string) => void;
  fail: (e: unknown) => void;
}) {
  // 前回の内容をすぐ出し、ドライブの最新はあとから確かめる
  const { data, checking, error, reload } = useConsentTemplates();
  const [src, setSrc] = useState<{ url: string; hasKey: boolean } | null>(null);
  const [srcUrl, setSrcUrl] = useState("");
  const [srcKey, setSrcKey] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [sel, setSel] = useState<string[]>([]);
  const menuName = (id: string) => menus.find((m) => m.id === id)?.name ?? "（削除されたメニュー）";

  useEffect(() => {
    if (error) fail(error);
  }, [error, fail]);
  const load = useCallback(async () => {
    try {
      if (isAdmin) {
        const s = await fetchConsentSource();
        setSrc(s);
        setSrcUrl(s.url);
      }
    } catch (err) {
      fail(err);
    }
  }, [fail, isAdmin]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  if (!data) return <p className={styles.muted}>読み込み中…</p>;
  return (
    <section>
      <p className={styles.lead}>
        同意書は <b>Google ドライブの「同意書、承諾書、問診票」フォルダの Google ドキュメントが正本</b>です。
        同意書を開く・発行するたびに、ドライブから<b>その時の最新の文面</b>を読み込んで印刷します（ドライブで直せば次から反映。発行済みの控えは発行時の文面のまま）。
        患者の名前などは Google に送らず、このソフトの中で差し込みます。「令和　年　月　日　患者氏名」の行に日付と署名が入ります。
      </p>
      <p className={styles.hint} data-invalid={(data.source && !data.live && !checking) || !data.source || undefined}>
        {!data.source
          ? "読み込み元（ドライブのウェブアプリ）がまだ設定されていません。下で設定するまでは、送られてきた文面を使います。"
          : checking
            ? `前回読み込んだ内容です（${data.items.length}件）。ドライブの最新を確認しています…`
            : data.live
            ? `✓ ドライブとつながっています（${data.items.length}件）`
            : "⚠ ドライブにつながりませんでした。前回読み込んだ文面を使っています。"}
      </p>
      {isAdmin && src && (
        <details className={styles.priceUrls} open={!src.url || undefined}>
          <summary>読み込み元（院長・管理者のみ）</summary>
          <p className={styles.muted} style={{ fontSize: 12 }}>
            同意書フォルダの Apps Script（integrations/consent-templates.gs）を「ウェブアプリ」としてデプロイした URL と、その合言葉（KEY）を入れます。
          </p>
          <input className={styles.input} value={srcUrl} onChange={(e) => setSrcUrl(e.target.value)} placeholder="https://script.google.com/macros/s/…/exec" aria-label="読み込み元のURL" style={{ maxWidth: 640 }} />
          <input
            className={styles.input}
            type="password"
            value={srcKey}
            onChange={(e) => setSrcKey(e.target.value)}
            placeholder={src.hasKey ? "合言葉（変えるときだけ入力）" : "合言葉（KEY）"}
            aria-label="合言葉"
            autoComplete="off"
            style={{ maxWidth: 320, marginTop: 6 }}
          />
          <div>
            <button
              className={styles.primary}
              style={{ marginTop: 6 }}
              onClick={async () => {
                try {
                  await saveConsentSource({ url: srcUrl, ...(srcKey && { key: srcKey }) });
                  setSrcKey("");
                  await load();
                  await reload();
                  notify("読み込み元を保存しました");
                } catch (err) {
                  fail(err);
                }
              }}
            >
              保存してつなぐ
            </button>
          </div>
        </details>
      )}
      {data.items.length === 0 && <p className={styles.muted}>まだひな形が届いていません。手順は integrations/consent-templates.gs の先頭に書いてあります。</p>}
      <table className={styles.table}>
        <tbody>
          {data.items.map((t) => (
            <tr key={t.id}>
              <td>
                <b>{t.title}</b>
                <div className={styles.muted} style={{ fontSize: 12 }}>
                  前回読み込んだ文面：{stamp(t.modifiedTime)} 更新
                </div>
              </td>
              <td>
                {editing === t.id ? (
                  <div className={styles.menuPick}>
                    {menus
                      .filter((m) => m.active || sel.includes(m.id))
                      .map((m) => (
                        <label key={m.id} className={styles.menuPickItem} data-on={sel.includes(m.id) || undefined}>
                          <input
                            type="checkbox"
                            checked={sel.includes(m.id)}
                            onChange={(e) => setSel((xs) => (e.target.checked ? [...xs, m.id] : xs.filter((x) => x !== m.id)))}
                          />
                          {m.name}
                        </label>
                      ))}
                    <div>
                      <button className={styles.btn} onClick={() => setEditing(null)}>
                        やめる
                      </button>
                      <button
                        className={styles.primary}
                        onClick={async () => {
                          try {
                            await saveConsentTemplateMenus(t.id, sel);
                            setEditing(null);
                            await reload();
                            notify("保存しました");
                          } catch (err) {
                            fail(err);
                          }
                        }}
                      >
                        保存
                      </button>
                    </div>
                  </div>
                ) : (
                  <span className={styles.muted}>{t.menuIds.length ? t.menuIds.map(menuName).join("、") : "（メニュー未設定）"}</span>
                )}
              </td>
              <td>
                {canEdit && editing !== t.id && (
                  <button
                    className={styles.btn}
                    onClick={() => {
                      setEditing(t.id);
                      setSel(t.menuIds);
                    }}
                  >
                    メニューを選ぶ
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

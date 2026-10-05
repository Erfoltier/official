"use client";

import { useCallback, useEffect, useState } from "react";
import type { ConsentTemplate, Menu } from "@/lib/domain/types";
import { fetchConsentTemplates, saveConsentTemplateMenus } from "@/components/calendar/api";
import styles from "./settings.module.css";

const stamp = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "まだ";

/** 同意書のひな形（Google ドキュメントが正本）と、候補の先頭に出すメニュー */
export function ConsentsTab({ menus, canEdit, notify, fail }: { menus: Menu[]; canEdit: boolean; notify: (t: string) => void; fail: (e: unknown) => void }) {
  const [data, setData] = useState<{ items: ConsentTemplate[]; receivedAt: string | null } | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [sel, setSel] = useState<string[]>([]);
  const menuName = (id: string) => menus.find((m) => m.id === id)?.name ?? "（削除されたメニュー）";

  const load = useCallback(async () => {
    try {
      setData(await fetchConsentTemplates());
    } catch (err) {
      fail(err);
    }
  }, [fail]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  if (!data) return <p className={styles.muted}>読み込み中…</p>;
  return (
    <section>
      <p className={styles.lead}>
        同意書は <b>Google ドライブの「同意書、承諾書、問診票」フォルダの Google ドキュメントが正本</b>です。フォルダの自動処理（Apps Script）が毎朝と手動で送ってきます
        （最終受け取り {stamp(data.receivedAt)}）。文面を直すときは Google ドキュメントを直してください。
        患者の名前などは Google に送らず、このソフトの中で差し込みます。「令和　年　月　日　患者氏名」の行に日付と署名が入ります。
      </p>
      {data.items.length === 0 && <p className={styles.muted}>まだひな形が届いていません。手順は integrations/consent-templates.gs の先頭に書いてあります。</p>}
      <table className={styles.table}>
        <tbody>
          {data.items.map((t) => (
            <tr key={t.id}>
              <td>
                <b>{t.title}</b>
                <div className={styles.muted} style={{ fontSize: 12 }}>
                  Google ドキュメント更新 {stamp(t.modifiedTime)}
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
                            await load();
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

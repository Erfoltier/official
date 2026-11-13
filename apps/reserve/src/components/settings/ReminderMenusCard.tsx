"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Menu } from "@/lib/domain/types";
import { searchKey } from "@/lib/domain/text";
import { saveMenu } from "@/components/calendar/api";
import styles from "./settings.module.css";

/**
 * リマインドの {メニュー} に表示するメニュー名を、メニューごとにまとめて編集する画面（リマインドの設定から開く）。
 * 院内の略称（【再診】など）を患者に出さないため。空欄ならメニュー名をそのまま使う
 */
export function ReminderMenusDialog(props: { menus: Menu[]; onChanged: () => void; notify: (m: string) => void; fail: (e: unknown) => void; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return createPortal(
    <dialog ref={ref} className={styles.dialog} style={{ width: "min(1100px, calc(100vw - 24px))" }} onClose={props.onClose} aria-label="{メニュー} に表示するメニュー名を編集">
      <div className={styles.managerHead}>
        <h2>{"{メニュー}"} に表示するメニュー名を編集</h2>
        <button type="button" className={styles.btn} onClick={() => ref.current?.close()}>
          閉じる
        </button>
      </div>
      <ReminderMenusCard menus={props.menus} canEdit onChanged={props.onChanged} notify={props.notify} fail={props.fail} />
    </dialog>,
    document.body,
  );
}

function ReminderMenusCard(props: { menus: Menu[]; canEdit: boolean; onChanged: () => void; notify: (m: string) => void; fail: (e: unknown) => void }) {
  const [q, setQ] = useState("");
  const [onlyEmpty, setOnlyEmpty] = useState(false);
  const [draft, setDraft] = useState<Record<string, { publicName: string }>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const list = useMemo(() => {
    const k = searchKey(q);
    return props.menus
      .filter((m) => !m.deleted && m.active)
      .filter((m) => !k || searchKey(`${m.name} ${m.publicName ?? ""}`).includes(k))
      .filter((m) => !onlyEmpty || !m.publicName);
  }, [props.menus, q, onlyEmpty]);

  const value = (m: Menu) => draft[m.id] ?? { publicName: m.publicName ?? "" };
  const dirty = (m: Menu) => {
    const v = draft[m.id];
    return !!v && v.publicName !== (m.publicName ?? "");
  };
  const set = (m: Menu, patch: Partial<{ publicName: string }>) => setDraft((d) => ({ ...d, [m.id]: { ...value(m), ...patch } }));

  const save = async (m: Menu) => {
    setBusy(m.id);
    try {
      await saveMenu(m.id, value(m));
      setDraft((d) => {
        const next = { ...d };
        delete next[m.id];
        return next;
      });
      props.notify(`「${m.name}」を保存しました`);
      props.onChanged();
    } catch (e) {
      props.fail(e);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className={styles.reminderMenus}>
      <p className={styles.hint}>
        リマインドの文面に {"{メニュー}"} を入れたとき、予約カレンダー上のメニュー名と患者に送信したいメニュー名が異なる場合にご使用ください。空欄のメニューは、予約カレンダー上のメニュー名をそのまま送ります。
      </p>
      <div className={styles.actions} style={{ marginTop: 0 }}>
        <input className={styles.input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="メニューを絞り込む" aria-label="メニューを絞り込む" style={{ flex: 1, minWidth: 160 }} />
        <label style={{ display: "inline-flex", gap: 6, alignItems: "center", whiteSpace: "nowrap" }}>
          <input type="checkbox" checked={onlyEmpty} onChange={(e) => setOnlyEmpty(e.target.checked)} />
          未入力のメニューのみ表示
        </label>
      </div>
      <div className={styles.rmList}>
        <div className={styles.rmHead} aria-hidden>
          <span>予約カレンダー上のメニュー名</span>
          <span>{"{メニュー}"} に表示する名前</span>
          <span />
        </div>
        {list.map((m) => {
          const v = value(m);
          return (
            <div key={m.id} className={styles.rmRow}>
              <span className={styles.rmName} style={{ ["--c" as string]: m.color }}>
                {m.name}
              </span>
              <label className={styles.rmField}>
                <span>{"{メニュー}"} に表示する名前</span>
                <input className={styles.input} value={v.publicName} maxLength={40} placeholder={m.name} onChange={(e) => set(m, { publicName: e.target.value })} disabled={!props.canEdit} />
              </label>
              {props.canEdit && (
                <button type="button" className={dirty(m) ? styles.primary : styles.btn} disabled={!dirty(m) || busy === m.id} onClick={() => void save(m)}>
                  保存
                </button>
              )}
            </div>
          );
        })}
        {list.length === 0 && <p className={styles.hint}>該当するメニューはありません</p>}
      </div>
    </div>
  );
}

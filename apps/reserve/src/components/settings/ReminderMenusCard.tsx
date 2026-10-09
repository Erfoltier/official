"use client";

import { useMemo, useState } from "react";
import type { Menu } from "@/lib/domain/types";
import { searchKey } from "@/lib/domain/text";
import { saveMenu } from "@/components/calendar/api";
import styles from "./settings.module.css";

/**
 * リマインドで患者に見せるメニュー名と来院前の案内を、メニューごとにまとめて直す。
 * 院内の略称（【再診】など）を患者に出さないため。空欄ならメニュー名をそのまま使う
 */
export function ReminderMenusCard(props: { menus: Menu[]; canEdit: boolean; onChanged: () => void; notify: (m: string) => void; fail: (e: unknown) => void }) {
  const [q, setQ] = useState("");
  const [onlyEmpty, setOnlyEmpty] = useState(false);
  const [draft, setDraft] = useState<Record<string, { publicName: string; preVisitNote: string }>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const list = useMemo(() => {
    const k = searchKey(q);
    return props.menus
      .filter((m) => !m.deleted && m.active)
      .filter((m) => !k || searchKey(`${m.name} ${m.publicName ?? ""}`).includes(k))
      .filter((m) => !onlyEmpty || (!m.publicName && !m.preVisitNote));
  }, [props.menus, q, onlyEmpty]);

  const value = (m: Menu) => draft[m.id] ?? { publicName: m.publicName ?? "", preVisitNote: m.preVisitNote ?? "" };
  const dirty = (m: Menu) => {
    const v = draft[m.id];
    return !!v && (v.publicName !== (m.publicName ?? "") || v.preVisitNote !== (m.preVisitNote ?? ""));
  };
  const set = (m: Menu, patch: Partial<{ publicName: string; preVisitNote: string }>) => setDraft((d) => ({ ...d, [m.id]: { ...value(m), ...patch } }));

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
    <div className={`${styles.clinicCard} ${styles.reminderMenus}`}>
      <h3 className={styles.cardTitle}>リマインドで見せるメニュー</h3>
      <p className={styles.hint}>
        「患者に見せる名前」はリマインドの {"{メニュー}"} に入ります（空欄ならメニュー名）。「来院前の案内」は本文の最後（または {"{来院前のご案内}"} の場所）に入ります。1回の来院に複数のメニューがあるときは、まとめて1回だけ入れます。
      </p>
      <div className={styles.actions} style={{ marginTop: 0 }}>
        <input className={styles.input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="メニューを絞り込む" aria-label="メニューを絞り込む" style={{ flex: 1, minWidth: 160 }} />
        <label style={{ display: "inline-flex", gap: 6, alignItems: "center", whiteSpace: "nowrap" }}>
          <input type="checkbox" checked={onlyEmpty} onChange={(e) => setOnlyEmpty(e.target.checked)} />
          まだ入れていないものだけ
        </label>
      </div>
      <div className={styles.rmList}>
        <div className={styles.rmHead} aria-hidden>
          <span>メニュー（院内の名前）</span>
          <span>患者に見せる名前</span>
          <span>来院前の案内</span>
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
                <span>患者に見せる名前</span>
                <input className={styles.input} value={v.publicName} maxLength={40} placeholder={m.name} onChange={(e) => set(m, { publicName: e.target.value })} disabled={!props.canEdit} />
              </label>
              <label className={styles.rmField}>
                <span>来院前の案内</span>
                <textarea className={styles.input} rows={1} value={v.preVisitNote} maxLength={300} placeholder="例：当日はメイクを落としやすい状態でお越しください" onChange={(e) => set(m, { preVisitNote: e.target.value })} disabled={!props.canEdit} style={{ fontFamily: "inherit", resize: "vertical", minHeight: 38, height: 38 }} />
              </label>
              {props.canEdit && (
                <button type="button" className={dirty(m) ? styles.primary : styles.btn} disabled={!dirty(m) || busy === m.id} onClick={() => void save(m)}>
                  保存
                </button>
              )}
            </div>
          );
        })}
        {list.length === 0 && <p className={styles.hint}>当てはまるメニューはありません</p>}
      </div>
    </div>
  );
}

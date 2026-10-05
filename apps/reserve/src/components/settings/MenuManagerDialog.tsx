"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Lane, Menu } from "@/lib/domain/types";
import { ApiError, deleteMenu, fetchSettings } from "@/components/calendar/api";
import { durationLabel } from "@/components/calendar/menuFormat";
import { searchKey } from "@/lib/domain/text";
import { withBase } from "@/lib/paths";
import { MenuEditor } from "./MenuEditor";
import styles from "./settings.module.css";

/**
 * 予約登録・予約変更の画面から開くメニューの追加・変更・削除。
 * 並べ替えなどは設定画面（メニュー）で行う。閉じると呼び出し元が予約の候補を読み直す。
 */
export function MenuManagerDialog({ onClose, onChanged }: { onClose: () => void; onChanged: (created?: Menu) => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [menus, setMenus] = useState<Menu[] | null>(null);
  const [lanes, setLanes] = useState<Lane[]>([]);
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<Menu | "new" | null>(null);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);

  const load = useCallback(async () => {
    try {
      const s = await fetchSettings();
      setMenus(s.menus.filter((m) => !m.deleted));
      setLanes(s.lanes);
    } catch {
      setMessage({ text: "メニューを読み込めませんでした", error: true });
    }
  }, []);

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const fail = useCallback((err: unknown) => setMessage({ text: err instanceof ApiError ? err.message : "保存できませんでした", error: true }), []);
  const laneName = useMemo(() => new Map(lanes.map((l) => [l.id, l.shortName])), [lanes]);
  const key = searchKey(q);
  const list = (menus ?? []).filter((m) => !key || searchKey(`${m.name}${m.abbr}`).includes(key));

  const remove = async (m: Menu) => {
    if (!window.confirm(`「${m.name}」を削除しますか？\n予約登録の選択肢から消えます（これまでの予約の表示はそのまま残ります）`)) return;
    try {
      await deleteMenu(m.id);
      setMessage({ text: `「${m.name}」を削除しました` });
      setEditing(null);
      await load();
      onChanged();
    } catch (err) {
      fail(err);
    }
  };

  // 予約登録の入力フォームの中に入れ子にならないよう、ページ直下に出す
  return createPortal(
    <dialog
      ref={ref}
      className={styles.dialog}
      onClose={(e) => {
        e.stopPropagation();
        onClose();
      }}
      onCancel={(e) => e.stopPropagation()}
      aria-label="メニューの追加・削除"
    >
      <div className={styles.managerHead}>
        <h2>メニューの追加・削除</h2>
        <button type="button" className={styles.btn} onClick={() => ref.current?.close()}>
          閉じる
        </button>
      </div>
      <div className={styles.toolbar}>
        <input className={styles.input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="メニューを絞り込む" aria-label="メニューを絞り込む" />
        <button type="button" className={styles.primary} onClick={() => setEditing("new")}>
          ＋ 新しいメニュー
        </button>
      </div>
      {message && (
        <p className={styles.message} data-kind={message.error ? "error" : "info"}>
          {message.text}
        </p>
      )}
      <div className={styles.managerList}>
        {menus === null && <p className={styles.muted}>読み込み中…</p>}
        {list.map((m) => (
          <div key={m.id} className={styles.managerRow} data-inactive={!m.active || undefined}>
            <button type="button" className={styles.nameBtn} onClick={() => setEditing(m)} title="押すと変更">
              <span className={styles.swatch} style={{ background: m.color }} />
              {m.name}
              <small className={styles.muted}>
                {" "}
                {durationLabel(m.duration)}・{m.laneIds.length === 0 ? "すべてのレーン" : m.laneIds.map((id) => laneName.get(id) ?? "?").join("・")}
                {!m.active && "・選択肢に出さない"}
              </small>
            </button>
            <button type="button" className={styles.btn} onClick={() => remove(m)} aria-label={`${m.name}を削除`}>
              削除
            </button>
          </div>
        ))}
      </div>
      <p className={styles.muted}>
        並べ替えは
        <a href={withBase("/settings/?tab=menus")} target="_blank" rel="noopener">
          設定 → メニュー
        </a>
        で行えます。
      </p>
      {editing && (
        <MenuEditor
          menu={editing === "new" ? null : editing}
          lanes={lanes}
          onClose={() => setEditing(null)}
          onDelete={editing === "new" ? undefined : () => remove(editing)}
          onSaved={async (saved) => {
            const isNew = editing === "new";
            setEditing(null);
            setMessage({ text: isNew ? `「${saved.name}」を追加しました` : "メニューを保存しました" });
            await load();
            onChanged(isNew ? saved : undefined);
          }}
          fail={fail}
        />
      )}
    </dialog>,
    document.body,
  );
}

"use client";

import { useState } from "react";
import styles from "./caution.module.css";

/**
 * 名前の横の注意事項（アレルギー・アルコール綿禁止など）。押すとその場で書き足し・直しができる。
 * 患者の基本情報の「注意事項」と同じ欄なので、どちらで直しても両方に反映される
 */
export function CautionInline({ note, onSave }: { note?: string; onSave?: (text: string) => Promise<boolean> }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  if (!onSave) return note ? <span className={styles.text}>{note}</span> : null;
  if (editing) {
    const save = async () => {
      setSaving(true);
      const ok = await onSave(draft.trim());
      setSaving(false);
      if (ok) setEditing(false);
    };
    return (
      <span className={styles.edit}>
        <textarea
          className={styles.input}
          value={draft}
          autoFocus
          rows={2}
          maxLength={500}
          disabled={saving}
          placeholder="例：アルコール綿禁止、ペニシリンで薬疹"
          aria-label="注意事項"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setEditing(false);
            else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              void save();
            }
          }}
        />
        <span className={styles.actions}>
          <button type="button" className={styles.save} disabled={saving} onClick={save}>
            保存
          </button>
          <button type="button" className={styles.cancel} disabled={saving} onClick={() => setEditing(false)}>
            やめる
          </button>
        </span>
      </span>
    );
  }
  return (
    <button
      type="button"
      className={note ? styles.textBtn : styles.add}
      title="押すと注意事項を書き足し・直しできます"
      onClick={() => {
        setDraft(note ?? "");
        setEditing(true);
      }}
    >
      {note || "＋注意事項"}
    </button>
  );
}

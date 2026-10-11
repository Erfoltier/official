"use client";

import { useState } from "react";
import styles from "./calendar.module.css";

/** Todaysメモの1マス（タップで書く。枠の外に出るか Ctrl+Enter で保存、Esc で取り消し） */
export function DayNoteCell({ laneName, text, onSave }: { laneName: string; text: string; onSave?: (text: string) => Promise<boolean> }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(text);
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (!onSave || draft.trim() === text.trim()) {
      setEditing(false);
      return;
    }
    setSaving(true);
    const ok = await onSave(draft);
    setSaving(false);
    if (ok) setEditing(false);
  };
  if (editing) {
    return (
      <div className={styles.noteCell}>
        <textarea
          className={styles.noteInput}
          value={draft}
          autoFocus
          disabled={saving}
          maxLength={1000}
          rows={3}
          aria-label={`${laneName}のTodaysメモ`}
          placeholder="担当スタッフ・今日の注意点など"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setDraft(text);
              setEditing(false);
            } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              void save();
            }
          }}
        />
      </div>
    );
  }
  return (
    <div className={styles.noteCell}>
      <button
        type="button"
        className={styles.noteText}
        data-empty={!text || undefined}
        disabled={!onSave}
        title={text || undefined}
        aria-label={`${laneName}のTodaysメモ${text ? "を直す" : "を書く"}`}
        onClick={() => {
          setDraft(text);
          setEditing(true);
        }}
      >
        {text || "＋"}
      </button>
    </div>
  );
}

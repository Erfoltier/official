"use client";

import { useState } from "react";
import type { Stage, StagePhase } from "@/lib/domain/types";
import { STAGE_PHASES, STAGE_PHASE_LABEL } from "@/lib/domain/types";
import { reorder, saveStage } from "@/components/calendar/api";
import styles from "./settings.module.css";

/** 状態（予約・来院済・医師待ち…）。院ごとに名前・色・並び順を変え、増やしたり非表示にしたりできる */
export function StagesTab({
  stages,
  canEdit,
  onChanged,
  notify,
  fail,
}: {
  stages: Stage[];
  canEdit: boolean;
  onChanged: () => Promise<void>;
  notify: (text: string) => void;
  fail: (err: unknown) => void;
}) {
  const [label, setLabel] = useState("");
  const [color, setColor] = useState("#6366f1");
  const [phase, setPhase] = useState<StagePhase>("arrived");

  const run = async (fn: () => Promise<unknown>, message?: string) => {
    try {
      await fn();
      await onChanged();
      if (message) notify(message);
    } catch (err) {
      fail(err);
      await onChanged();
    }
  };
  const move = (i: number, d: number) => {
    const ids = stages.map((s) => s.id);
    const j = i + d;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    run(() => reorder("stages", ids));
  };

  return (
    <section>
      <p className={styles.lead}>
        予約の詳細に並ぶ「状態」のボタンです。押すと、カレンダーの予約枠の右端に色と文字で出ます。
        「段階」は大まかな進み具合で、前日リマインドの対象や施術の回数の数え方に使います。
        「自由入力」にした状態は、押したときに文字を入れられます。使わない状態は「表示」を外してください。
      </p>
      <table className={styles.table}>
        <thead>
          <tr>
            <th className={styles.orderCol}>順番</th>
            <th>名前</th>
            <th>色</th>
            <th>段階</th>
            <th>自由入力</th>
            <th>表示</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {stages.map((s, i) => (
            <StageRow
              key={`${s.id}:${s.label}:${s.color}:${s.phase}:${s.free}:${s.active}`}
              stage={s}
              canEdit={canEdit}
              first={i === 0}
              last={i === stages.length - 1}
              onUp={() => move(i, -1)}
              onDown={() => move(i, 1)}
              onSave={(body) => run(() => saveStage(s.id, body), "保存しました")}
            />
          ))}
          {canEdit && (
            <tr className={styles.addRow}>
              <td />
              <td>
                <input className={styles.input} value={label} onChange={(e) => setLabel(e.target.value)} maxLength={12} placeholder="例：パッチ待ち" aria-label="新しい状態の名前" />
              </td>
              <td>
                <input className={styles.color} type="color" value={color} onChange={(e) => setColor(e.target.value)} aria-label="新しい状態の色" />
              </td>
              <td>
                <PhaseSelect value={phase} onChange={setPhase} />
              </td>
              <td />
              <td />
              <td>
                <button
                  className={styles.primary}
                  disabled={!label.trim()}
                  onClick={() =>
                    run(async () => {
                      await saveStage(null, { label, color, phase });
                      setLabel("");
                    }, "追加しました")
                  }
                >
                  追加
                </button>
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  );
}

function PhaseSelect({ value, onChange, disabled }: { value: StagePhase; onChange: (v: StagePhase) => void; disabled?: boolean }) {
  return (
    <select className={styles.input} value={value} onChange={(e) => onChange(e.target.value as StagePhase)} disabled={disabled} aria-label="段階">
      {STAGE_PHASES.map((p) => (
        <option key={p} value={p}>
          {STAGE_PHASE_LABEL[p]}
        </option>
      ))}
    </select>
  );
}

function StageRow(props: {
  stage: Stage;
  canEdit: boolean;
  first: boolean;
  last: boolean;
  onUp: () => void;
  onDown: () => void;
  onSave: (body: Partial<Pick<Stage, "label" | "color" | "phase" | "free" | "active">>) => void;
}) {
  const { stage: s, canEdit } = props;
  const [label, setLabel] = useState(s.label);
  const [color, setColor] = useState(s.color);
  const [phase, setPhase] = useState<StagePhase>(s.phase);
  const dirty = label !== s.label || color !== s.color || phase !== s.phase;
  return (
    <tr data-inactive={!s.active || undefined}>
      <td className={styles.orderCol}>
        {canEdit && (
          <>
            <button className={styles.arrow} onClick={props.onUp} disabled={props.first} aria-label="上へ">
              ▲
            </button>
            <button className={styles.arrow} onClick={props.onDown} disabled={props.last} aria-label="下へ">
              ▼
            </button>
          </>
        )}
      </td>
      <td>
        <input className={styles.input} value={label} onChange={(e) => setLabel(e.target.value)} maxLength={12} disabled={!canEdit} aria-label="名前" />
      </td>
      <td>
        <input className={styles.color} type="color" value={color} onChange={(e) => setColor(e.target.value)} disabled={!canEdit} aria-label="色" />
        <span className={styles.stagePreview} style={{ background: color }}>
          {label || "—"}
        </span>
      </td>
      <td>
        <PhaseSelect value={phase} onChange={setPhase} disabled={!canEdit} />
      </td>
      <td>
        <label className={styles.toggle}>
          <input type="checkbox" checked={s.free} disabled={!canEdit} onChange={(e) => props.onSave({ free: e.target.checked })} />
          {s.free ? "あり" : "なし"}
        </label>
      </td>
      <td>
        <label className={styles.toggle}>
          <input type="checkbox" checked={s.active} disabled={!canEdit} onChange={(e) => props.onSave({ active: e.target.checked })} />
          {s.active ? "表示" : "非表示"}
        </label>
      </td>
      <td>
        {canEdit && (
          <button className={styles.btn} disabled={!dirty || !label.trim()} onClick={() => props.onSave({ label, color, phase })}>
            保存
          </button>
        )}
      </td>
    </tr>
  );
}

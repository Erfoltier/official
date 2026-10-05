"use client";

import { Fragment, useMemo, type CSSProperties } from "react";
import { parseRich, type Run } from "@/lib/domain/richtext";
import styles from "./richtext.module.css";

function RunView({ r }: { r: Run }) {
  let el: React.ReactNode = r.t;
  if (r.u) el = <u>{el}</u>;
  if (r.i) el = <i>{el}</i>;
  if (r.b) el = <b>{el}</b>;
  if (r.c) el = <span style={{ color: r.c } as CSSProperties}>{el}</span>;
  return <>{el}</>;
}

/**
 * 装飾つきのメモを表示する（ただの文字のメモもそのまま出る）。
 * 文字は React の文字として出すので、保存内容から命令が動くことはない
 */
export function RichText({ value, className, inline }: { value: string | undefined | null; className?: string; inline?: boolean }) {
  const lines = useMemo(() => parseRich(value), [value]);
  if (inline) {
    return (
      <span className={className}>
        {lines.map((l, i) => (
          <Fragment key={i}>
            {i > 0 && <br />}
            {l.map((r, j) => (
              <RunView key={j} r={r} />
            ))}
          </Fragment>
        ))}
      </span>
    );
  }
  return (
    <div className={`${styles.view} ${className ?? ""}`}>
      {lines.map((l, i) => (
        <div key={i}>{l.length === 0 ? <br /> : l.map((r, j) => <RunView key={j} r={r} />)}</div>
      ))}
    </div>
  );
}

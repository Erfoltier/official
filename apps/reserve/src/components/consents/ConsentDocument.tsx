"use client";

import { Fragment, useMemo, type CSSProperties } from "react";
import type { ClinicSettings, Patient } from "@/lib/domain/types";
import type { Run } from "@/lib/domain/richtext";
import { isSignLine, parseDocHtml, toWareki, type DocBlock, type Para } from "@/lib/domain/docHtml";
import styles from "./consents.module.css";

function Runs({ runs }: { runs: Run[] }) {
  return (
    <>
      {runs.map((r, i) => {
        let el: React.ReactNode = r.t.split("\n").map((t, j) => (
          <Fragment key={j}>
            {j > 0 && <br />}
            {t}
          </Fragment>
        ));
        if (r.u) el = <u>{el}</u>;
        if (r.i) el = <i>{el}</i>;
        if (r.b) el = <b>{el}</b>;
        if (r.c) el = <span style={{ color: r.c } as CSSProperties}>{el}</span>;
        return <Fragment key={i}>{el}</Fragment>;
      })}
    </>
  );
}

function ParaView({ p }: { p: Para }) {
  const empty = p.runs.every((r) => !r.t.trim());
  const cls = [styles.para, p.size === "xl" ? styles.xl : p.size === "l" ? styles.l : "", p.list ? styles.li : ""].join(" ");
  return (
    <p className={cls} style={p.align ? { textAlign: p.align } : undefined}>
      {empty ? <br /> : <Runs runs={p.runs} />}
    </p>
  );
}

function Blocks({ blocks, signLine }: { blocks: DocBlock[]; signLine: React.ReactNode }) {
  return (
    <>
      {blocks.map((b, i) =>
        b.kind === "table" ? (
          <table key={i} className={styles.table}>
            <tbody>
              {b.rows.map((row, r) => (
                <tr key={r}>
                  {row.map((cell, c) => (
                    <td key={c}>
                      {cell.map((p, k) => (
                        <ParaView key={k} p={p} />
                      ))}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        ) : isSignLine(b) ? (
          <Fragment key={i}>{signLine}</Fragment>
        ) : (
          <ParaView key={i} p={b} />
        ),
      )}
    </>
  );
}

interface Props {
  html: string;
  patient: Pick<Patient, "name" | "kana" | "chartNo" | "birthDate">;
  clinic: ClinicSettings;
  date: string;
  treatment?: string;
  /** 画面で書いた署名（なければ紙に署名する欄を空けておく） */
  signature?: string;
}

/** 同意書の本文に、患者の情報・日付・署名を差し込んだもの（画面・印刷とも同じ見た目） */
export function ConsentDocument({ html, patient, clinic, date, treatment, signature }: Props) {
  const blocks = useMemo(() => parseDocHtml(html), [html]);
  const hasSignLine = blocks.some((b) => b.kind === "p" && isSignLine(b));
  const signLine = (
    <div className={styles.sign}>
      <span className={styles.signDate}>{toWareki(date)}</span>
      <span className={styles.signLabel}>患者氏名（署名）</span>
      <span className={styles.signBox}>
        {/* 署名は data URL の画像（外部から読み込まない） */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {signature ? <img src={signature} alt="署名" /> : null}
      </span>
    </div>
  );
  return (
    <div className={styles.doc}>
      <table className={styles.head}>
        <tbody>
          <tr>
            <th>患者氏名</th>
            <td>
              {patient.name}
              {patient.kana && <small>（{patient.kana}）</small>}
            </td>
            <th>診察券番号</th>
            <td>{patient.chartNo}</td>
          </tr>
          <tr>
            <th>生年月日</th>
            <td>{patient.birthDate ? `${patient.birthDate.replaceAll("-", "/")}` : ""}</td>
            <th>同意日</th>
            <td>{toWareki(date)}</td>
          </tr>
          {treatment && (
            <tr>
              <th>施術</th>
              <td colSpan={3}>{treatment}</td>
            </tr>
          )}
        </tbody>
      </table>
      <Blocks blocks={blocks} signLine={signLine} />
      {!hasSignLine && signLine}
      <p className={styles.clinicFoot}>{clinic.docName || clinic.name}</p>
    </div>
  );
}

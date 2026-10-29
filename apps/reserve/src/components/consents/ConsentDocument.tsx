"use client";

import { Fragment, useMemo, type CSSProperties } from "react";
import type { ClinicSettings, Patient } from "@/lib/domain/types";
import type { Run } from "@/lib/domain/richtext";
import { fontStack, isSignLine, lineHeightFactor, mainFont, paraText, parseDocHtml, toWareki, type DocBlock, type Para } from "@/lib/domain/docHtml";
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
        if (r.c || r.f) el = <span style={{ color: r.c, fontFamily: fontStack(r.f) } as CSSProperties}>{el}</span>;
        return <Fragment key={i}>{el}</Fragment>;
      })}
    </>
  );
}

/** 元の文書の文字の大きさ・行間・段落の間隔をそのまま使う（ページの改行の位置を変えないため） */
function paraStyle(p: Para, docFont: string | undefined): CSSProperties | undefined {
  const st: CSSProperties = {};
  if (p.align) st.textAlign = p.align;
  if (p.pt) st.fontSize = `${p.pt}pt`;
  // 段落の書体（いちばん長く使われているもの）の本来の行の高さに、文書の行間を掛ける
  if (p.lh) st.lineHeight = Math.round(p.lh * lineHeightFactor(paraFont(p, docFont)) * 1000) / 1000;
  if (p.before) st.paddingTop = `${p.before}pt`;
  if (p.after) st.paddingBottom = `${p.after}pt`;
  return Object.keys(st).length ? st : undefined;
}

/** 段落の書体：文字がいちばん多いもの（空の段落は文書の本文の書体） */
function paraFont(p: Para, docFont: string | undefined): string | undefined {
  let best: string | undefined;
  let n = 0;
  for (const r of p.runs) if (r.f && r.t.trim().length > n) [best, n] = [r.f, r.t.trim().length];
  return best ?? docFont;
}

function ParaView({ p, font }: { p: Para; font?: string }) {
  const empty = p.runs.every((r) => !r.t.trim());
  // 元の文字の大きさがわかるときは、見出しの大きさ（l・xl）を足さない
  const size = p.pt ? "" : p.size === "xl" ? styles.xl : p.size === "l" ? styles.l : "";
  const cls = [styles.para, size, p.list ? styles.li : ""].join(" ");
  return (
    <p className={cls} style={paraStyle(p, font)}>
      {empty ? <br /> : <Runs runs={p.runs} />}
    </p>
  );
}

/** 「令和　年　月　日」の空欄。年・月・日の前の空白をそれぞれ取り出す */
const DATE_BLANK = /(令和|平成|西暦)?([\s　]*)年([\s　]*)月([\s　]*)日/;

/** 空白の真ん中に数字を入れる（数字の分だけ空白を減らし、行の長さをなるべく変えない） */
function inGap(gap: string, num: string): string {
  const room = gap.length - num.length * 2;
  if (room <= 0) return num;
  const left = Math.floor(room / 2);
  return gap.slice(0, left) + num + gap.slice(gap.length - (room - left));
}

/** 「令和　年　月　日」の空欄に同意日を入れる（空白の並びはそのまま） */
function fillDateText(text: string, date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return text.replace(DATE_BLANK, (_all, era: string | undefined, g1: string, g2: string, g3: string) => {
    const west = era === "西暦";
    const r = y - 2018;
    const year = west ? String(y) : r === 1 ? "元" : String(r);
    return `${west ? "西暦" : "令和"}${inGap(g1, year)}年${inGap(g2, String(m))}月${inGap(g3, String(d))}日`;
  });
}

/** 日付の空欄に同意日を入れる。空欄が文字のかたまりをまたぐときは、その行を1つのかたまりにまとめて入れる */
function fillDate(runs: Run[], date: string): Run[] {
  const i = runs.findIndex((r) => DATE_BLANK.test(r.t));
  if (i >= 0) return runs.map((r, j) => (j === i ? { ...r, t: fillDateText(r.t, date) } : r));
  const all = runs.map((r) => r.t).join("");
  return DATE_BLANK.test(all) ? [{ ...runs[0], t: fillDateText(all, date) }] : runs;
}

/** 署名の行：元の行のまま、日付を入れ、署名の画像は行の高さを変えずに重ねる */
function SignLineView({ p, date, signature, font }: { p: Para; date: string; signature?: string; font?: string }) {
  const runs = fillDate(p.runs, date);
  return (
    <p className={[styles.para, styles.signLine].join(" ")} style={paraStyle(p, font)}>
      <Runs runs={runs} />
      {signature && (
        <span className={styles.signInline}>
          {/* 署名は data URL の画像（外部から読み込まない） */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={signature} alt="署名" />
        </span>
      )}
    </p>
  );
}

/** 表の空欄：左のマスが「氏名」「生年月日」などで、そのマスが空なら書き込む（行は増やさない） */
function fillFor(label: string, f: Fill): string | null {
  const t = label.replace(/[\s　：:]/g, "");
  if (/^(患者)?(氏名|お名前|名前)$/.test(t)) return f.name;
  if (/^(フリガナ|ふりがな|カナ)$/.test(t)) return f.kana ?? null;
  if (/^生年月日$/.test(t)) return f.birthDate ? f.birthDate.replaceAll("-", "/") : null;
  if (/^(診察券番号|カルテ番号|診察券No\.?)$/i.test(t)) return f.chartNo;
  if (/^(同意日|記入日|日付)$/.test(t)) return toWareki(f.date);
  if (/^(施術|施術名|治療名|施術内容)$/.test(t)) return f.treatment ?? null;
  return null;
}

interface Fill {
  name: string;
  kana?: string;
  birthDate?: string;
  chartNo: string;
  date: string;
  treatment?: string;
}

const cellText = (cell: Para[]) => cell.map(paraText).join("").trim();

function Blocks({ blocks, date, signature, fill, font }: { blocks: DocBlock[]; date: string; signature?: string; fill: Fill; font?: string }) {
  return (
    <>
      {blocks.map((b, i) =>
        b.kind === "table" ? (
          <table key={i} className={styles.table}>
            <tbody>
              {b.rows.map((row, r) => (
                <tr key={r}>
                  {row.map((cell, c) => {
                    const value = c > 0 && cellText(cell) === "" ? fillFor(cellText(row[c - 1]), fill) : null;
                    return (
                      <td key={c}>
                        {value !== null && cell.length > 0 ? (
                          <p className={styles.para} style={paraStyle(cell[0], font)}>
                            {value}
                          </p>
                        ) : value !== null ? (
                          value
                        ) : (
                          cell.map((p, k) =>
                            isSignLine(p) ? <SignLineView key={k} p={p} date={date} signature={signature} font={font} /> : <ParaView key={k} p={p} font={font} />,
                          )
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        ) : isSignLine(b) ? (
          <SignLineView key={i} p={b} date={date} signature={signature} font={font} />
        ) : (
          <ParaView key={i} p={b} font={font} />
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

/**
 * 同意書：Googleドキュメントの配置をそのまま（文頭や途中に行を足さない）。
 * 日付・署名は文書の「令和　年　月　日　氏名」の行に、氏名などは表の空欄に入れる。
 * 署名の行がない文書だけ、最後に署名の欄を足す
 */
export function ConsentDocument({ html, patient, date, treatment, signature }: Props) {
  const blocks = useMemo(() => parseDocHtml(html), [html]);
  const hasSignLine = blocks.some((b) => (b.kind === "p" ? isSignLine(b) : b.rows.some((row) => row.some((cell) => cell.some(isSignLine)))));
  const fill: Fill = { name: patient.name, kana: patient.kana, birthDate: patient.birthDate, chartNo: patient.chartNo, date, treatment };
  // 本文の書体は元の文書のまま（文字の幅が変わると、改行・改ページの位置がずれるため）
  const main = useMemo(() => mainFont(blocks), [blocks]);
  const font = fontStack(main);
  return (
    <div className={styles.doc} style={font ? { fontFamily: font } : undefined}>
      <Blocks blocks={blocks} date={date} signature={signature} fill={fill} font={main} />
      {!hasSignLine && (
        <div className={styles.sign}>
          <span className={styles.signDate}>{toWareki(date)}</span>
          <span className={styles.signLabel}>患者氏名（署名）</span>
          <span className={styles.signBox}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {signature ? <img src={signature} alt="署名" /> : null}
          </span>
        </div>
      )}
    </div>
  );
}

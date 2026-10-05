/**
 * 設定の「取り込み」：CSV・Excel（.xlsx）・Word（.docx）・HTML を読む（画面の中で読み、サーバーへは結果だけ送る）。
 * Excel・Word は中身が zip の XML なので、zip を開いて必要なところだけ読む。
 */
import { strFromU8, unzipSync } from "fflate";

export type Table = string[][];

/** 文字コード：UTF-8 で読めなければ Shift_JIS（Excel で保存した CSV） */
export function decodeText(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^﻿/, "");
  } catch {
    return new TextDecoder("shift_jis").decode(bytes);
  }
}

/** CSV（ダブルクォート・改行入りのセル・カンマ／タブ区切り） */
export function parseCsv(text: string): Table {
  const src = text.replace(/^﻿/, "");
  const firstLine = src.split(/\r?\n/, 1)[0] ?? "";
  const sep = (firstLine.match(/\t/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? "\t" : ",";
  const rows: Table = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"' && cell === "") quoted = true;
    else if (c === sep) {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.map((r) => r.map((x) => x.trim())).filter((r) => r.some((x) => x !== ""));
}

const XML_ENT: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const unxml = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, n: string) =>
    n[0] === "#" ? String.fromCodePoint(n[1] === "x" || n[1] === "X" ? parseInt(n.slice(2), 16) : Number(n.slice(1))) : (XML_ENT[n] ?? m),
  );

/** "B3" → 1（列の番号、0から） */
function colIndex(ref: string): number {
  const letters = /^[A-Z]+/.exec(ref)?.[0] ?? "A";
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** Excel（.xlsx）の最初のシートを表にする */
export function parseXlsx(bytes: Uint8Array): Table {
  const files = unzipSync(bytes, { filter: (f) => f.name === "xl/sharedStrings.xml" || f.name === "xl/workbook.xml" || /^xl\/worksheets\/sheet\d+\.xml$/.test(f.name) });
  const shared: string[] = [];
  const ss = files["xl/sharedStrings.xml"];
  if (ss) {
    for (const m of strFromU8(ss).matchAll(/<si>([\s\S]*?)<\/si>/g)) {
      shared.push([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => unxml(t[1])).join(""));
    }
  }
  const sheetName = Object.keys(files)
    .filter((n) => n.startsWith("xl/worksheets/"))
    .sort((a, b) => Number(/\d+/.exec(a.slice(14))?.[0]) - Number(/\d+/.exec(b.slice(14))?.[0]))[0];
  if (!sheetName) return [];
  const xml = strFromU8(files[sheetName]);
  const rows: Table = [];
  for (const rm of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const row: string[] = [];
    for (const cm of rm[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1];
      const inner = cm[2] ?? "";
      const ref = /\br="([A-Z]+\d+)"/.exec(attrs)?.[1];
      const type = /\bt="(\w+)"/.exec(attrs)?.[1];
      const v = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1];
      let text = "";
      if (type === "s" && v !== undefined) text = shared[Number(v)] ?? "";
      else if (type === "inlineStr") text = [...inner.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => unxml(t[1])).join("");
      else if (v !== undefined) text = unxml(v);
      const idx = ref ? colIndex(ref) : row.length;
      while (row.length < idx) row.push("");
      row[idx] = text.trim();
    }
    if (row.some((x) => x !== "")) rows.push(row);
  }
  return rows;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Word（.docx）を、同意書のひな形として読める簡単な HTML にする（段落・太字・斜体・下線・色・大きさ・中央寄せ・表・箇条書き） */
export function docxToHtml(bytes: Uint8Array): string {
  const files = unzipSync(bytes, { filter: (f) => f.name === "word/document.xml" });
  const doc = files["word/document.xml"];
  if (!doc) throw new Error("Word のファイルとして読めませんでした");
  const xml = strFromU8(doc);
  const body = /<w:body>([\s\S]*)<\/w:body>/.exec(xml)?.[1] ?? xml;

  const para = (p: string): string => {
    const pPr = /<w:pPr>([\s\S]*?)<\/w:pPr>/.exec(p)?.[1] ?? "";
    const jc = /<w:jc w:val="(\w+)"/.exec(pPr)?.[1];
    const align = jc === "center" ? "center" : jc === "right" || jc === "end" ? "right" : "";
    const list = /<w:numPr>/.test(pPr);
    let inner = "";
    for (const r of p.matchAll(/<w:r\b[^>]*>([\s\S]*?)<\/w:r>/g)) {
      const rPr = /<w:rPr>([\s\S]*?)<\/w:rPr>/.exec(r[1])?.[1] ?? "";
      const style: string[] = [];
      if (/<w:b(?:\s+w:val="(?:true|1|on)")?\s*\/>/.test(rPr)) style.push("font-weight:700");
      if (/<w:i(?:\s+w:val="(?:true|1|on)")?\s*\/>/.test(rPr)) style.push("font-style:italic");
      if (/<w:u\s+w:val="(?!none)/.test(rPr)) style.push("text-decoration:underline");
      const color = /<w:color w:val="([0-9A-Fa-f]{6})"/.exec(rPr)?.[1];
      if (color) style.push(`color:#${color.toLowerCase()}`);
      const sz = /<w:sz w:val="(\d+)"/.exec(rPr)?.[1];
      if (sz) style.push(`font-size:${Number(sz) / 2}pt`);
      let text = "";
      for (const t of r[1].matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:(br|tab|cr)\b[^>]*\/>/g)) {
        if (t[2] === "br" || t[2] === "cr") text += "<br>";
        else if (t[2] === "tab") text += "　";
        else text += esc(unxml(t[1]));
      }
      if (text) inner += style.length ? `<span style="${style.join(";")}">${text}</span>` : text;
    }
    const tag = list ? "li" : "p";
    return `<${tag}${align ? ` style="text-align:${align}"` : ""}>${inner}</${tag}>`;
  };

  let html = "";
  // 段落と表を順に
  for (const m of body.matchAll(/<w:tbl>([\s\S]*?)<\/w:tbl>|<w:p\b[^>]*\/>|<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g)) {
    if (m[1] !== undefined) {
      html += "<table>";
      for (const tr of m[1].matchAll(/<w:tr\b[^>]*>([\s\S]*?)<\/w:tr>/g)) {
        html += "<tr>";
        for (const tc of tr[1].matchAll(/<w:tc>([\s\S]*?)<\/w:tc>/g)) {
          html += `<td>${[...tc[1].matchAll(/<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g)].map((p) => para(p[1])).join("")}</td>`;
        }
        html += "</tr>";
      }
      html += "</table>";
    } else html += para(m[2] ?? "");
  }
  return `<html><body>${html.replace(/(<li[^>]*>[\s\S]*?<\/li>)+/g, (x) => `<ul>${x}</ul>`)}</body></html>`;
}

/** 見出しの行を探して、言葉に合う列の番号を返す（見つからない項目は -1） */
export function findHeader<K extends string>(table: Table, words: Record<K, RegExp>): { row: number; cols: Record<K, number> } | null {
  for (let r = 0; r < Math.min(table.length, 10); r++) {
    const cols = {} as Record<K, number>;
    let hit = 0;
    for (const k of Object.keys(words) as K[]) {
      cols[k] = table[r].findIndex((h) => words[k].test(h.replace(/\s/g, "")));
      if (cols[k] >= 0) hit++;
    }
    if (hit >= 2) return { row: r, cols };
  }
  return null;
}

/** "5,500" "¥5500" "5500円" "５５００" → 5500。空は null、読めなければ undefined */
export function parseYenCell(s: string): number | null | undefined {
  const t = s.normalize("NFKC").replace(/[,，円¥￥\s]/g, "").replace(/^[−ー–]/, "-");
  if (t === "") return null;
  return /^-?\d{1,8}$/.test(t) ? Number(t) : undefined;
}

/** "30" "30分" → 30。読めなければ null */
export function parseMinutes(s: string): number | null {
  const t = s.normalize("NFKC").replace(/[分\s]/g, "");
  return /^\d{1,3}$/.test(t) ? Number(t) : null;
}

/** 表をCSVにする（Excel で開けるよう UTF-8 の BOM 付き） */
export function toCsv(rows: string[][]): string {
  return "﻿" + rows.map((r) => r.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(",")).join("\r\n") + "\r\n";
}

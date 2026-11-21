/**
 * Google ドキュメントの書き出し HTML から、同意書の本文を決まった形（段落・表・箇条書き）で取り出す。
 * 太字・斜体・下線・文字色・中央寄せ・文字の大きさだけを読み、それ以外（スクリプト・画像・リンク先など）は捨てる。
 * 表示は React の文字として出すので、ひな形の中身から命令が動くことはない。
 */
import { normalizeColor, type Run } from "./richtext";

export type Align = "left" | "center" | "right";

export interface Para {
  kind: "p";
  runs: Run[];
  align?: Align;
  /** 文字の大きさ（標準より大きい見出しなど） */
  size?: "l" | "xl";
  /** 箇条書き */
  list?: "ul" | "ol";
  /** 元の文書の文字の大きさ（pt。段落でいちばん大きいもの）・行間・段落の前後の間隔（pt） */
  pt?: number;
  lh?: number;
  before?: number;
  after?: number;
}

export interface Table {
  kind: "table";
  rows: Para[][][];
}

export type DocBlock = Para | Table;

interface Style {
  b?: boolean;
  i?: boolean;
  u?: boolean;
  c?: string;
  align?: Align;
  pt?: number;
  /** 行間（倍率） */
  lh?: number;
  /** 段落の前後の間隔（pt） */
  before?: number;
  after?: number;
  /** 余白（pt。上・右・下・左）。body の余白＝ページの余白 */
  pad?: [number, number, number, number];
  /** 書体の名前（1つ目） */
  ff?: string;
}

/** "72pt" "96px" "1in" "2.54cm" → pt */
function toPt(v: string): number | undefined {
  const m = /^(-?[\d.]+)(pt|px|in|cm|mm)?$/.exec(v.trim());
  if (!m) return undefined;
  const n = Number(m[1]);
  const unit = m[2] ?? "px";
  const pt = unit === "pt" ? n : unit === "px" ? n * 0.75 : unit === "in" ? n * 72 : unit === "cm" ? (n * 72) / 2.54 : (n * 72) / 25.4;
  return Number.isFinite(pt) ? Math.round(pt * 100) / 100 : undefined;
}

/** &nbsp; は詰めない空白（\u00a0）のまま残す。Googleドキュメントは空白の数で字下げ・寄せをしているため */
const ENT: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", "#39": "'", nbsp: "\u00a0" };
const decode = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, n: string) => {
    if (n[0] === "#") {
      const code = n[1] === "x" || n[1] === "X" ? parseInt(n.slice(2), 16) : Number(n.slice(1));
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : "";
    }
    return ENT[n.toLowerCase()] ?? m;
  });

function parseDecls(css: string): Style {
  const out: Style = {};
  for (const decl of css.split(";")) {
    const i = decl.indexOf(":");
    if (i < 0) continue;
    const k = decl.slice(0, i).trim().toLowerCase();
    const v = decl.slice(i + 1).trim().toLowerCase();
    if (k === "font-weight") out.b = v === "bold" || v === "bolder" || Number(v) >= 600;
    else if (k === "font-style") out.i = v === "italic" || v === "oblique";
    else if (k === "text-decoration" || k === "text-decoration-line") out.u = v.includes("underline");
    else if (k === "color") out.c = normalizeColor(v);
    else if (k === "text-align") out.align = v === "center" ? "center" : v === "right" || v === "end" ? "right" : "left";
    else if (k === "font-size") {
      const m = /^([\d.]+)(pt|px)$/.exec(v);
      if (m) out.pt = m[2] === "px" ? Number(m[1]) * 0.75 : Number(m[1]);
    } else if (k === "font-family") {
      // 1つ目の書体名だけ。文字・数字・空白・ハイフンと日本語の名前だけを通す
      const name = decl.slice(i + 1).split(",")[0].trim().replace(/^["']|["']$/g, "");
      if (/^[A-Za-z0-9 \-ぁ-んァ-ヶー一-龠Ａ-Ｚａ-ｚ０-９　]{1,60}$/.test(name)) out.ff = name;
    } else if (k === "line-height") {
      const n = /^([\d.]+)(%)?$/.exec(v);
      if (n) out.lh = n[2] ? Number(n[1]) / 100 : Number(n[1]);
    } else if (k === "padding-top" || k === "margin-top") {
      const n = toPt(v);
      if (n !== undefined && n >= 0) out.before = n;
    } else if (k === "padding-bottom" || k === "margin-bottom") {
      const n = toPt(v);
      if (n !== undefined && n >= 0) out.after = n;
    } else if (k === "padding") {
      const parts = v.split(/\s+/).map(toPt);
      if (parts.every((x) => x !== undefined)) {
        const [t, r = t, b = t, l = r] = parts as number[];
        out.pad = [t, r, b, l];
      }
    }
  }
  return out;
}

/** <style> の「.c1{...}」を読む */
function classStyles(html: string): Map<string, Style> {
  const map = new Map<string, Style>();
  const styleRe = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
  for (let m = styleRe.exec(html); m; m = styleRe.exec(html)) {
    const css = m[1].replace(/\/\*[\s\S]*?\*\//g, "");
    const ruleRe = /([^{}]+)\{([^{}]*)\}/g;
    for (let r = ruleRe.exec(css); r; r = ruleRe.exec(css)) {
      const decl = parseDecls(r[2]);
      for (const sel of r[1].split(",")) {
        const cm = /^\s*\.([A-Za-z0-9_-]+)\s*$/.exec(sel);
        if (cm) map.set(cm[1], { ...map.get(cm[1]), ...decl });
      }
    }
  }
  return map;
}

function attr(attrs: string, name: string): string | undefined {
  const m = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(attrs);
  return m ? decode(m[2] ?? m[3] ?? m[4] ?? "") : undefined;
}

const DROP = new Set(["script", "style", "head", "title", "template", "iframe", "object", "noscript", "svg"]);
const PARA = new Set(["p", "h1", "h2", "h3", "h4", "h5", "h6", "li", "div", "blockquote"]);
/** 黒は「色なし」として扱う */
const PLAIN_COLORS = new Set(["#000000", "#241f30"]);

export function parseDocHtml(html: string): DocBlock[] {
  const classes = classStyles(html);
  const body = /<body\b[^>]*>([\s\S]*)<\/body>/i.exec(html)?.[1] ?? html;
  const out: DocBlock[] = [];
  /** 表の中にいるとき：行・マス */
  const tables: { rows: Para[][][] }[] = [];
  const listStack: ("ul" | "ol")[] = [];
  let para: Para | null = null;
  const stack: { tag: string; st: Style }[] = [];
  let drop = 0;

  const cur = (): Style => (stack.length ? stack[stack.length - 1].st : {});
  const target = (): Para[] | DocBlock[] => {
    const t = tables[tables.length - 1];
    if (!t) return out;
    if (t.rows.length === 0) t.rows.push([]);
    const row = t.rows[t.rows.length - 1];
    if (row.length === 0) row.push([]);
    return row[row.length - 1];
  };
  const openPara = (st: Style, list?: "ul" | "ol") => {
    closePara();
    para = { kind: "p", runs: [] };
    if (st.align && st.align !== "left") para.align = st.align;
    if (list) para.list = list;
    if (st.lh && st.lh > 0 && st.lh < 5) para.lh = st.lh;
    if (st.before) para.before = st.before;
    if (st.after) para.after = st.after;
  };
  const closePara = () => {
    if (!para) return;
    const p: Para = para;
    // 段落のいちばん大きい文字で見出しかどうかを決める
    (target() as Para[]).push(p);
    para = null;
  };
  const addText = (t: string) => {
    if (!t) return;
    if (!para) openPara(cur());
    const st = cur();
    const run: Run = { t };
    if (st.b) run.b = true;
    if (st.i) run.i = true;
    if (st.u) run.u = true;
    if (st.c && !PLAIN_COLORS.has(st.c)) run.c = st.c;
    if (st.ff) run.f = st.ff;
    const last = para!.runs[para!.runs.length - 1];
    if (last && !!last.b === !!run.b && !!last.i === !!run.i && !!last.u === !!run.u && (last.c ?? "") === (run.c ?? "") && (last.f ?? "") === (run.f ?? "")) last.t += t;
    else para!.runs.push(run);
    if (st.pt && st.pt > 0 && st.pt < 100) para!.pt = Math.max(para!.pt ?? 0, st.pt);
    if (st.pt && st.pt >= 13) {
      const size = st.pt >= 17 ? "xl" : "l";
      if (para!.size !== "xl") para!.size = size;
    }
  };

  const re = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)([^>]*)>|<!--[\s\S]*?-->|([^<]+)|</g;
  for (let m = re.exec(body); m; m = re.exec(body)) {
    if (m[4] !== undefined || m[0] === "<") {
      // 書き出しの改行・タブ・続く空白は1つの空白に（&nbsp; の空白はそのまま）
      if (!drop) addText(decode(m[4] ?? "<").replace(/[\r\n\t ]+/g, " "));
      continue;
    }
    if (!m[2]) continue;
    const closing = m[1] === "/";
    const tag = m[2].toLowerCase();
    const attrs = m[3] ?? "";
    if (DROP.has(tag)) {
      if (closing) drop = Math.max(0, drop - 1);
      else if (!attrs.trim().endsWith("/")) drop++;
      continue;
    }
    if (drop) continue;
    if (tag === "br") {
      if (!closing) addText("\n");
      continue;
    }
    if (tag === "img" || tag === "hr" || tag === "meta" || tag === "link" || tag === "col") continue;

    if (closing) {
      if (PARA.has(tag)) closePara();
      if (tag === "ul" || tag === "ol") listStack.pop();
      if (tag === "table") {
        closePara();
        const t = tables.pop();
        if (t) (target() as DocBlock[]).push({ kind: "table", rows: t.rows.filter((r) => r.length > 0) });
      }
      const idx = stack.map((x) => x.tag).lastIndexOf(tag);
      if (idx >= 0) stack.length = idx;
      continue;
    }

    // 書式：親の書式＋クラス＋style 属性＋タグ
    const st: Style = { ...cur() };
    // 寄せ・段落の間隔・余白は、その要素だけのもの（子には引き継がない）
    delete st.align;
    delete st.before;
    delete st.after;
    delete st.pad;
    for (const cls of (attr(attrs, "class") ?? "").split(/\s+/)) {
      const cs = classes.get(cls);
      if (cs) Object.assign(st, Object.fromEntries(Object.entries(cs).filter(([, v]) => v !== undefined)));
    }
    Object.assign(st, Object.fromEntries(Object.entries(parseDecls(attr(attrs, "style") ?? "")).filter(([, v]) => v !== undefined)));
    if (tag === "b" || tag === "strong") st.b = true;
    if (tag === "i" || tag === "em") st.i = true;
    if (tag === "u") st.u = true;
    if (/^h[1-6]$/.test(tag)) {
      st.b = true;
      st.pt = Math.max(st.pt ?? 0, tag === "h1" ? 20 : tag === "h2" ? 16 : 14);
    }
    stack.push({ tag, st });

    if (tag === "table") {
      closePara();
      tables.push({ rows: [] });
    } else if (tag === "tr") {
      closePara();
      tables[tables.length - 1]?.rows.push([]);
    } else if (tag === "td" || tag === "th") {
      closePara();
      const t = tables[tables.length - 1];
      if (t) {
        if (t.rows.length === 0) t.rows.push([]);
        t.rows[t.rows.length - 1].push([]);
      }
    } else if (tag === "ul" || tag === "ol") {
      closePara();
      listStack.push(tag);
    } else if (PARA.has(tag)) {
      openPara(st, tag === "li" ? listStack[listStack.length - 1] ?? "ul" : undefined);
      if (st.pt) (para as Para | null)!.pt = st.pt;
    } else {
      // 文字のない段落（空行）でも、中の文字の大きさで高さを決める
      const open = para as Para | null;
      if (open && st.pt && st.pt > 0 && st.pt < 100) open.pt = Math.max(open.pt ?? 0, st.pt);
    }
  }
  closePara();
  while (tables.length) {
    const t = tables.pop()!;
    (target() as DocBlock[]).push({ kind: "table", rows: t.rows });
  }
  // 前後の空の段落は落とす
  const isEmpty = (b: DocBlock) => b.kind === "p" && b.runs.every((r) => !r.t.trim());
  while (out.length && isEmpty(out[0])) out.shift();
  while (out.length && isEmpty(out[out.length - 1])) out.pop();
  return out;
}

export const paraText = (p: Para) => p.runs.map((r) => r.t).join("");

/** 「令和　年　月　日　患者氏名」の行（日付と氏名を差し込む行）か */
export function isSignLine(p: Para): boolean {
  const t = paraText(p).replace(/\s|　/g, "");
  return /年月日/.test(t) && (/令和|平成|西暦/.test(t) || /氏名|署名|サイン/.test(t));
}

/** "2026-10-05" → "令和8年10月5日" */
export function toWareki(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const r = y - 2018;
  return `令和${r === 1 ? "元" : r}年${m}月${d}日`;
}

/** 文書の余白（＝印刷のページの余白、pt）。Googleドキュメントの書き出しは body の余白に入っている。なければ null */
export function docPageMargins(html: string): [number, number, number, number] | null {
  const classes = classStyles(html);
  const attrs = /<body\b([^>]*)>/i.exec(html)?.[1] ?? "";
  let pad: Style["pad"];
  for (const cls of (attr(attrs, "class") ?? "").split(/\s+/)) {
    const cs = classes.get(cls);
    if (cs?.pad) pad = cs.pad;
  }
  const inline = parseDecls(attr(attrs, "style") ?? "").pad;
  if (inline) pad = inline;
  if (!pad || pad.some((x) => x < 0 || x > 200)) return null;
  return pad;
}

/** 書体の名前 → 印刷で使う書体の並び（その端末にない書体は近いものに） */
export function fontStack(name: string | undefined): string | undefined {
  if (!name) return undefined;
  const n = name.toLowerCase().replace(/\s+/g, " ");
  const mincho = '"Yu Mincho", YuMincho, "Hiragino Mincho ProN", "Noto Serif JP", "Noto Serif CJK JP", serif';
  const gothic = '"Yu Gothic", YuGothic, "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans JP", "Noto Sans CJK JP", sans-serif';
  if (/ms pmincho|ｍｓ ｐ明朝|ms p明朝/.test(n)) return `"MS PMincho", "ＭＳ Ｐ明朝", "MS Mincho", "ＭＳ 明朝", ${mincho}`;
  if (/ms mincho|ｍｓ 明朝|ms 明朝/.test(n)) return `"MS Mincho", "ＭＳ 明朝", ${mincho}`;
  if (/mincho|明朝|serif/.test(n)) return `"${name}", ${mincho}`;
  if (/ms pgothic|ｍｓ ｐゴシック/.test(n)) return `"MS PGothic", "ＭＳ Ｐゴシック", "MS Gothic", ${gothic}`;
  if (/ms gothic|ｍｓ ゴシック/.test(n)) return `"MS Gothic", "ＭＳ ゴシック", ${gothic}`;
  if (/gothic|ゴシック|meiryo|メイリオ|sans/.test(n)) return `"${name}", ${gothic}`;
  return `"${name}"`;
}

/** 文書でいちばん多く使われている書体（本文の書体） */
export function mainFont(blocks: DocBlock[]): string | undefined {
  const count = new Map<string, number>();
  const add = (p: Para) => {
    for (const r of p.runs) if (r.f) count.set(r.f, (count.get(r.f) ?? 0) + r.t.length);
  };
  for (const b of blocks) {
    if (b.kind === "p") add(b);
    else for (const row of b.rows) for (const cell of row) cell.forEach(add);
  }
  return [...count.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
}

/**
 * Googleドキュメントの行間（1.15 など）は「書体本来の1行の高さ」に掛ける。CSS は文字の大きさに掛けるので、その分を足す。
 * （MS明朝・MSゴシックなど日本語の書体は文字の大きさの約1.3倍、Arial などは約1.15倍。Googleが書き出したPDFで測った値）
 */
export function lineHeightFactor(font: string | undefined): number {
  if (!font) return 1.3;
  const n = font.toLowerCase();
  if (/arial|helvetica|roboto|times|georgia|verdana|calibri/.test(n)) return 1.15;
  return 1.3;
}

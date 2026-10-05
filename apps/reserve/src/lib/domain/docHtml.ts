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
}

const ENT: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", "#39": "'", nbsp: " " };
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
    const last = para!.runs[para!.runs.length - 1];
    if (last && !!last.b === !!run.b && !!last.i === !!run.i && !!last.u === !!run.u && (last.c ?? "") === (run.c ?? "")) last.t += t;
    else para!.runs.push(run);
    if (st.pt && st.pt >= 13) {
      const size = st.pt >= 17 ? "xl" : "l";
      if (para!.size !== "xl") para!.size = size;
    }
  };

  const re = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)([^>]*)>|<!--[\s\S]*?-->|([^<]+)|</g;
  for (let m = re.exec(body); m; m = re.exec(body)) {
    if (m[4] !== undefined || m[0] === "<") {
      if (!drop) addText(decode(m[4] ?? "<").replace(/[\r\n\t]+/g, " "));
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
    delete st.align;
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

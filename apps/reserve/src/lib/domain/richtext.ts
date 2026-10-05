/**
 * メモ・カルテの文字装飾（太字・斜体・下線・文字色）。
 *
 * 保存する形は決まった小さな HTML だけ：
 *   <p><span style="color:#dc2626"><b><i><u>文字</u></i></b></span></p>
 * 読み取りはタグを1つずつ見て「行・文字のかたまり（書式つき）」に直す。知らないタグ・属性は捨て、
 * 表示は React の文字として出すので、保存された文字から命令（スクリプト）が動くことはない。
 * 装飾のない昔のメモ（ただの文字）はそのまま読める。
 */

export interface Run {
  t: string;
  b?: boolean;
  i?: boolean;
  u?: boolean;
  /** 文字色（#rrggbb）。なしは標準の色 */
  c?: string;
}

export type Line = Run[];

/** 標準の文字色（この色は「色なし」として扱う） */
export const DEFAULT_TEXT_COLOR = "#241f30";

/** 文字色のプリセット（12色。最初は標準の色） */
export const TEXT_COLORS: { color: string; label: string }[] = [
  { color: DEFAULT_TEXT_COLOR, label: "標準" },
  { color: "#dc2626", label: "赤" },
  { color: "#ea580c", label: "朱" },
  { color: "#ca8a04", label: "山吹" },
  { color: "#65a30d", label: "黄緑" },
  { color: "#16a34a", label: "緑" },
  { color: "#0d9488", label: "青緑" },
  { color: "#0284c7", label: "水色" },
  { color: "#2563eb", label: "青" },
  { color: "#7c3aed", label: "紫" },
  { color: "#db2777", label: "ピンク" },
  { color: "#6b7280", label: "灰" },
];

/** 装飾つきの形で保存された文字か（先頭が決まったタグで始まる） */
export function isRich(s: string | undefined | null): boolean {
  return !!s && /^\s*<(p|div|br|b|i|u|span|strong|em|font)\b/i.test(s);
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", "#39": "'", nbsp: " " };

function decode(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, n: string) => {
    if (n[0] === "#") {
      const code = n[1] === "x" || n[1] === "X" ? parseInt(n.slice(2), 16) : Number(n.slice(1));
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : "";
    }
    return ENTITIES[n.toLowerCase()] ?? m;
  });
}

function escapeText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** "#abc" "#aabbcc" "rgb(1, 2, 3)" → "#aabbcc"。読めなければ undefined */
export function normalizeColor(v: string | undefined | null): string | undefined {
  if (!v) return undefined;
  const s = v.trim().toLowerCase();
  let m = /^#([0-9a-f]{6})$/.exec(s);
  if (m) return `#${m[1]}`;
  m = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(s);
  if (m) return `#${m[1]}${m[1]}${m[2]}${m[2]}${m[3]}${m[3]}`;
  m = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*[\d.]+\s*)?\)$/.exec(s);
  if (m) {
    const hex = [m[1], m[2], m[3]].map((x) => Math.min(255, Number(x)).toString(16).padStart(2, "0")).join("");
    return `#${hex}`;
  }
  return undefined;
}

type Fmt = Omit<Run, "t">;

function attr(attrs: string, name: string): string | undefined {
  const m = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(attrs);
  return m ? decode(m[2] ?? m[3] ?? m[4] ?? "") : undefined;
}

function styleOf(attrs: string): Fmt {
  const style = attr(attrs, "style") ?? "";
  const out: Fmt = {};
  for (const decl of style.split(";")) {
    const idx = decl.indexOf(":");
    if (idx < 0) continue;
    const k = decl.slice(0, idx).trim().toLowerCase();
    const v = decl.slice(idx + 1).trim().toLowerCase();
    if (k === "color") out.c = normalizeColor(v);
    else if (k === "font-weight") out.b = v === "bold" || v === "bolder" || Number(v) >= 600;
    else if (k === "font-style") out.i = v === "italic" || v === "oblique";
    else if ((k === "text-decoration" || k === "text-decoration-line") && v.includes("underline")) out.u = true;
  }
  return out;
}

const BLOCK = new Set(["p", "div", "li", "ul", "ol", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "pre"]);
const VOID = new Set(["br", "img", "hr", "input", "meta", "link", "wbr"]);
/** 中身ごと捨てるタグ */
const DROP = new Set(["script", "style", "template", "iframe", "object", "noscript", "title", "head"]);

/** 保存された文字（装飾つき／ただの文字のどちらでも）を行に直す */
export function parseRich(src: string | undefined | null): Line[] {
  const s = src ?? "";
  if (!isRich(s)) return s.split(/\r\n?|\n/).map((t) => (t ? [{ t }] : []));
  const lines: Line[] = [[]];
  const stack: { tag: string; fmt: Fmt }[] = [];
  let dropDepth = 0;
  const cur = (): Fmt => (stack.length ? stack[stack.length - 1].fmt : {});
  const newLine = () => lines.push([]);
  const lineEmpty = () => lines[lines.length - 1].length === 0;
  const re = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)([^>]*)>|<!--[\s\S]*?-->|([^<]+)|</g;
  for (let m = re.exec(s); m; m = re.exec(s)) {
    if (m[4] !== undefined || m[0] === "<") {
      if (dropDepth) continue;
      const text = decode(m[4] ?? "<").replace(/[\r\n\t]+/g, "");
      if (text) lines[lines.length - 1].push({ t: text, ...cur() });
      continue;
    }
    if (!m[2]) continue; // コメント
    const closing = m[1] === "/";
    const tag = m[2].toLowerCase();
    const attrs = m[3] ?? "";
    if (DROP.has(tag)) {
      if (closing) dropDepth = Math.max(0, dropDepth - 1);
      else if (!attrs.trim().endsWith("/")) dropDepth++;
      continue;
    }
    if (dropDepth) continue;
    if (tag === "br") {
      if (!closing) newLine();
      continue;
    }
    if (VOID.has(tag)) continue;
    if (closing) {
      const idx = stack.map((x) => x.tag).lastIndexOf(tag);
      if (idx >= 0) stack.length = idx;
      if (BLOCK.has(tag) && !lineEmpty()) newLine();
      continue;
    }
    if (BLOCK.has(tag) && !lineEmpty()) newLine();
    const f: Fmt = { ...cur() };
    if (tag === "b" || tag === "strong") f.b = true;
    if (tag === "i" || tag === "em") f.i = true;
    if (tag === "u") f.u = true;
    if (tag === "font") {
      const c = normalizeColor(attr(attrs, "color"));
      if (c) f.c = c;
    }
    const st = styleOf(attrs);
    if (st.c) f.c = st.c;
    if (st.b !== undefined) f.b = st.b;
    if (st.i !== undefined) f.i = st.i;
    if (st.u) f.u = true;
    stack.push({ tag, fmt: f });
  }
  // 最後の空行（ブロックの閉じタグで足したもの）は除く
  while (lines.length > 1 && lineEmpty()) lines.pop();
  return lines.map(mergeRuns);
}

function clean(r: Run): Run {
  const out: Run = { t: r.t };
  if (r.b) out.b = true;
  if (r.i) out.i = true;
  if (r.u) out.u = true;
  const c = normalizeColor(r.c);
  if (c && c !== DEFAULT_TEXT_COLOR) out.c = c;
  return out;
}

function sameFmt(a: Run, b: Run): boolean {
  return !!a.b === !!b.b && !!a.i === !!b.i && !!a.u === !!b.u && (a.c ?? "") === (b.c ?? "");
}

function mergeRuns(line: Line): Line {
  const out: Line = [];
  for (const r0 of line) {
    const r = clean(r0);
    if (!r.t) continue;
    const last = out[out.length - 1];
    if (last && sameFmt(last, r)) last.t += r.t;
    else out.push(r);
  }
  return out;
}

/** 行を保存する形にする。装飾が1つもなければただの文字で返す（昔の形のまま読める） */
export function serializeRich(lines: Line[]): string {
  const clean = lines.map(mergeRuns);
  // 末尾の空行は落とす
  while (clean.length > 0 && clean[clean.length - 1].length === 0) clean.pop();
  const plain = clean.every((l) => l.every((r) => !r.b && !r.i && !r.u && !r.c));
  if (plain) {
    const text = clean.map((l) => l.map((r) => r.t).join("")).join("\n");
    // ただの文字でも、先頭がタグに見えるときは装飾つきの形で保存する（読み違えないように）
    if (!isRich(text)) return text;
  }
  return clean
    .map((l) => {
      if (l.length === 0) return "<p><br></p>";
      const inner = l
        .map((r) => {
          let h = escapeText(r.t);
          if (r.u) h = `<u>${h}</u>`;
          if (r.i) h = `<i>${h}</i>`;
          if (r.b) h = `<b>${h}</b>`;
          if (r.c) h = `<span style="color:${r.c}">${h}</span>`;
          return h;
        })
        .join("");
      return `<p>${inner}</p>`;
    })
    .join("");
}

/** 決まった形にそろえる（エディタが出した HTML・貼り付けた HTML など） */
export function normalizeRich(src: string): string {
  return serializeRich(parseRich(src));
}

/** 装飾を外した文字（一覧の短い表示・検索用） */
export function richToPlain(src: string | undefined | null): string {
  return parseRich(src)
    .map((l) => l.map((r) => r.t).join(""))
    .join("\n");
}

/** 編集欄に入れる形（装飾がなくても行ごとの <p> にする） */
export function toEditableHtml(src: string | undefined | null): string {
  const lines = parseRich(src).map(mergeRuns);
  if (lines.length === 0) return "";
  return lines
    .map((l) => {
      if (l.length === 0) return "<p><br></p>";
      return `<p>${l
        .map((r) => {
          let h = escapeText(r.t);
          if (r.u) h = `<u>${h}</u>`;
          if (r.i) h = `<i>${h}</i>`;
          if (r.b) h = `<b>${h}</b>`;
          if (r.c) h = `<span style="color:${r.c}">${h}</span>`;
          return h;
        })
        .join("")}</p>`;
    })
    .join("");
}

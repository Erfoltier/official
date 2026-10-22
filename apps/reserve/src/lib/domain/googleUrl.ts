/**
 * Google スプレッドシート・ドキュメントの共有リンク → 書き出しのアドレス。
 * 「リンクを知っている全員が閲覧可」か「ウェブに公開」にしたものだけ読める（ログインは使わない）。
 * スプレッドシートは CSV、ドキュメントは HTML で読む。それ以外のアドレスは null
 */
export function googleExportUrl(input: string): { kind: "sheet" | "doc"; url: string } | null {
  let u: URL;
  try {
    u = new URL(input.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.hostname !== "docs.google.com") return null;
  const gidMatch = /(?:^|[#&?])gid=(\d{1,12})/.exec(`${u.search}${u.hash}`);
  const gid = gidMatch ? gidMatch[1] : "0";
  let m = /^\/spreadsheets\/d\/e\/([A-Za-z0-9_-]{10,200})\//.exec(u.pathname + "/");
  if (m) return { kind: "sheet", url: `https://docs.google.com/spreadsheets/d/e/${m[1]}/pub?output=csv&gid=${gid}` };
  m = /^\/spreadsheets\/d\/([A-Za-z0-9_-]{10,200})\//.exec(u.pathname + "/");
  if (m) return { kind: "sheet", url: `https://docs.google.com/spreadsheets/d/${m[1]}/export?format=csv&gid=${gid}` };
  m = /^\/document\/d\/e\/([A-Za-z0-9_-]{10,200})\//.exec(u.pathname + "/");
  if (m) return { kind: "doc", url: `https://docs.google.com/document/d/e/${m[1]}/pub` };
  m = /^\/document\/d\/([A-Za-z0-9_-]{10,200})\//.exec(u.pathname + "/");
  if (m) return { kind: "doc", url: `https://docs.google.com/document/d/${m[1]}/export?format=html` };
  return null;
}

/** 読み込んでよい行き先（Googleの書き出しは googleusercontent.com へ転送される） */
export function allowedGoogleHost(host: string): boolean {
  return host === "docs.google.com" || /^[a-z0-9-]+\.googleusercontent\.com$/.test(host);
}

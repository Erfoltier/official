import "server-only";
import { z } from "zod";
import { applyConsentDoc, applyConsentList, consentSource, getConsentTemplate } from "@/lib/server/store";
import type { ConsentTemplateWithHtml } from "@/lib/domain/types";

/**
 * 同意書の読み込み元（同意書フォルダの Apps Script ウェブアプリ）から、その時々に最新を読む。
 *   一覧：GET {url}?key=...&action=list → [{driveId,title,modifiedTime}]
 *   本文：GET {url}?key=...&action=doc&id={driveId} → {driveId,title,modifiedTime,html}
 */

const listSchema = z.array(z.object({ driveId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/), title: z.string().min(1).max(200), modifiedTime: z.string().max(40) }));
const docSchema = z.object({
  driveId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  title: z.string().min(1).max(200),
  modifiedTime: z.string().max(40),
  html: z.string().max(400_000),
});

async function call(params: Record<string, string>): Promise<unknown> {
  const src = consentSource();
  if (!src) throw new Error("no source");
  const u = new URL(src.url);
  u.searchParams.set("key", src.key);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  const res = await fetch(u, { signal: AbortSignal.timeout(params.action === "list" ? 10_000 : 20_000), redirect: "follow" });
  if (!res.ok) throw new Error(`status ${res.status}`);
  const text = await res.text();
  if (text.length > 2_000_000) throw new Error("too large");
  return JSON.parse(text);
}

/** 一覧をドライブとそろえる。読めなければ前回のまま。読めたら true */
export async function refreshConsentList(): Promise<boolean> {
  if (!consentSource()) return false;
  try {
    applyConsentList(listSchema.parse(await call({ action: "list" })));
    return true;
  } catch {
    return false;
  }
}

/** 本文をドライブから読む。読めなければ前回読めた本文（stale: true） */
export async function loadConsentTemplate(id: string): Promise<ConsentTemplateWithHtml & { stale?: boolean }> {
  const cached = getConsentTemplate(id);
  if (!consentSource()) return cached;
  try {
    const doc = docSchema.parse(await call({ action: "doc", id: cached.driveId }));
    if (doc.driveId !== cached.driveId) throw new Error("mismatch");
    return applyConsentDoc(doc);
  } catch {
    return { ...cached, stale: true };
  }
}

import "server-only";
import { parsePriceTables } from "@/lib/domain/priceParse";
import type { Actor, PriceList } from "@/lib/domain/types";
import { integrationPricesSchema } from "@/lib/domain/schemas";
import { applyPriceSync, notePriceSheetPull, priceSheetSource, priceSyncDue, priceUrls, receiveSheetPrices, type FetchedPricePage } from "@/lib/server/store";

const MAX_BYTES = 3 * 1024 * 1024;

async function fetchPage(url: string): Promise<FetchedPricePage> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000), redirect: "follow", headers: { "User-Agent": "reserve-price-sync" } });
    if (!res.ok) return { url, error: `読み込めませんでした（${res.status}）` };
    const buf = await res.arrayBuffer();
    if (buf.byteLength > MAX_BYTES) return { url, error: "ページが大きすぎます" };
    const items = parsePriceTables(new TextDecoder("utf-8").decode(buf));
    if (items.length === 0) return { url, error: "料金表が見つかりませんでした" };
    return { url, items };
  } catch {
    return { url, error: "読み込めませんでした（通信エラー）" };
  }
}

/** ホームページから料金表を取り込む */
export async function syncPrices(by?: Actor): Promise<PriceList> {
  const [pages] = await Promise.all([Promise.all(priceUrls().map(fetchPage)), pullSheet()]);
  return applyPriceSync(pages, by);
}

/** スプレッドシート（Apps Script のウェブアプリ）から料金を読みに行く。読み込み元が無ければ何もしない */
async function pullSheet(): Promise<void> {
  const src = priceSheetSource();
  if (!src) return;
  try {
    const u = new URL(src.url);
    u.searchParams.set("key", src.key);
    u.searchParams.set("action", "prices");
    const res = await fetch(u, { signal: AbortSignal.timeout(30_000), redirect: "follow" });
    if (!res.ok) return notePriceSheetPull({ ok: false, count: 0, error: `読み込めませんでした（${res.status}）` });
    const text = await res.text();
    if (text.length > MAX_BYTES) return notePriceSheetPull({ ok: false, count: 0, error: "大きすぎます" });
    const parsed = integrationPricesSchema.safeParse(JSON.parse(text));
    if (!parsed.success) return notePriceSheetPull({ ok: false, count: 0, error: "合言葉が違うか、形が正しくありません" });
    const r = receiveSheetPrices(parsed.data.sheet, parsed.data.items);
    notePriceSheetPull({ ok: true, count: parsed.data.items.length });
    void r;
  } catch {
    notePriceSheetPull({ ok: false, count: 0, error: "読み込めませんでした（通信エラー）" });
  }
}

/** 前回から時間が経っていれば取り込み直す */
export async function syncPricesIfDue(): Promise<void> {
  if (priceSyncDue()) await syncPrices();
}

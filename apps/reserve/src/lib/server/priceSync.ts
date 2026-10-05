import "server-only";
import { parsePriceTables } from "@/lib/domain/priceParse";
import type { Actor, PriceList } from "@/lib/domain/types";
import { applyPriceSync, priceSyncDue, priceUrls, type FetchedPricePage } from "@/lib/server/store";

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
  const pages = await Promise.all(priceUrls().map(fetchPage));
  return applyPriceSync(pages, by);
}

/** 前回から時間が経っていれば取り込み直す */
export async function syncPricesIfDue(): Promise<void> {
  if (priceSyncDue()) await syncPrices();
}

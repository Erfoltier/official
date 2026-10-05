import "server-only";

import { allowedGoogleHost, googleExportUrl } from "@/lib/domain/googleUrl";
import { StoreError } from "@/lib/server/store";

const MAX_BYTES = 5_000_000;

/** 共有されたGoogleスプレッドシート（CSV）・ドキュメント（HTML）を読む。患者の情報は送らない */
export async function fetchGoogleExport(input: string): Promise<{ kind: "sheet" | "doc"; text: string }> {
  const target = googleExportUrl(input);
  if (!target) throw new StoreError("invalid", "Googleスプレッドシートかドキュメントの共有リンクを入れてください");
  let url = target.url;
  for (let i = 0; i < 6; i++) {
    const host = new URL(url).hostname;
    if (!allowedGoogleHost(host)) {
      throw new StoreError("invalid", "読み込めませんでした。共有の設定を「リンクを知っている全員（閲覧者）」にしてください");
    }
    const res = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(15_000) });
    if (res.status >= 300 && res.status < 400) {
      const next = res.headers.get("location");
      if (!next) break;
      url = new URL(next, url).toString();
      continue;
    }
    if (!res.ok) throw new StoreError("invalid", "読み込めませんでした。共有の設定を「リンクを知っている全員（閲覧者）」にしてください");
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.length > MAX_BYTES) throw new StoreError("invalid", "大きすぎて読み込めません（5MBまで）");
    return { kind: target.kind, text: new TextDecoder("utf-8").decode(buf) };
  }
  throw new StoreError("invalid", "読み込めませんでした（転送が多すぎます）");
}

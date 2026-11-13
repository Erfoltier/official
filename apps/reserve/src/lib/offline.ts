/**
 * サーバー（AWS）や院のネットが止まったときに、予約表を「見るだけ」で出すための、端末の中の控え。
 * - 院長・管理者が 設定 → 画面の表示 で許可した端末だけ（localStorage の lr-offline）。院内のパソコン・タブレットに限る
 * - 今日〜7日先の予約表（GET /api/v1/day の中身）を IndexedDB に暗号化して置く。鍵は WebCrypto の取り出せない鍵（その端末のその Chrome だけで開ける）
 * - 画面の部品は public/sw.js（サービスワーカー）が端末に持つ。患者の情報はサービスワーカーには置かない
 */
import type { DayBundle } from "@/lib/domain/types";

const FLAG = "lr-offline";
const DB_NAME = "lane-reserve-offline";
const DAYS_AHEAD = 7;

export type OfflineBundle = DayBundle & { offlineSavedAt?: string; offlinePreview?: boolean };

export function offlineEnabled(): boolean {
  try {
    return typeof window !== "undefined" && window.localStorage.getItem(FLAG) === "1";
  } catch {
    return false;
  }
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore("keys");
      r.result.createObjectStore("days");
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

async function key(db: IDBDatabase): Promise<CryptoKey> {
  const have = await req(db.transaction("keys").objectStore("keys").get("k") as IDBRequest<CryptoKey | undefined>);
  if (have) return have;
  // 取り出せない鍵（extractable: false）。IndexedDB にそのまま置けるが、中身の値は外に出せない
  const k = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  await req(db.transaction("keys", "readwrite").objectStore("keys").put(k, "k"));
  return k;
}

/** 読めた予約表を端末に置く（許可された端末だけ） */
export async function saveDay(b: DayBundle): Promise<void> {
  if (!offlineEnabled()) return;
  const db = await open();
  const k = await key(db);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, k, new TextEncoder().encode(JSON.stringify({ ...b, offlineSavedAt: new Date().toISOString() })));
  await req(db.transaction("days", "readwrite").objectStore("days").put({ iv, data }, b.date));
  db.close();
}

/** 端末に置いた予約表（なければ null） */
export async function loadDay(date: string): Promise<OfflineBundle | null> {
  if (!offlineEnabled()) return null;
  const db = await open();
  const row = await req(db.transaction("days").objectStore("days").get(date) as IDBRequest<{ iv: Uint8Array<ArrayBuffer>; data: ArrayBuffer } | undefined>);
  if (!row) {
    db.close();
    return null;
  }
  const k = await key(db);
  db.close();
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: row.iv }, k, row.data);
  return JSON.parse(new TextDecoder().decode(plain)) as OfflineBundle;
}

/** 昨日より前の控えを消す */
async function prune(today: string): Promise<void> {
  const db = await open();
  const store = db.transaction("days", "readwrite").objectStore("days");
  const keys = (await req(store.getAllKeys())) as string[];
  const tx = db.transaction("days", "readwrite").objectStore("days");
  for (const d of keys) if (d < addDays(today, -1)) tx.delete(d);
  db.close();
}

export function addDays(date: string, n: number): string {
  const t = new Date(`${date}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

/** 今日〜7日先を読み直して置く（つながっているあいだ、数分ごと） */
export async function refreshAhead(today: string, fetchOne: (date: string) => Promise<DayBundle>): Promise<void> {
  if (!offlineEnabled()) return;
  for (let i = 0; i <= DAYS_AHEAD; i++) {
    try {
      await saveDay(await fetchOne(addDays(today, i)));
    } catch {
      return; // つながらなければ、今ある控えを残す
    }
  }
  await prune(today).catch(() => {});
}

/** この端末の控えを消し、許可を外す */
export async function disableOffline(): Promise<void> {
  try {
    window.localStorage.removeItem(FLAG);
  } catch {
    /* 端末の保存が使えないときは何もしない */
  }
  await new Promise<void>((resolve) => {
    const r = indexedDB.deleteDatabase(DB_NAME);
    r.onsuccess = r.onerror = r.onblocked = () => resolve();
  });
  const regs = (await navigator.serviceWorker?.getRegistrations?.()) ?? [];
  await Promise.all(regs.map((r) => r.unregister()));
}

export async function enableOffline(base: string): Promise<void> {
  window.localStorage.setItem(FLAG, "1");
  await registerOfflineWorker(base);
}

/** 画面の部品を端末に持たせるサービスワーカーを入れる（許可された端末だけ） */
export async function registerOfflineWorker(base: string): Promise<void> {
  if (!offlineEnabled() || !("serviceWorker" in navigator)) return;
  await navigator.serviceWorker.register(`${base}/sw.js`, { scope: `${base}/` }).catch(() => {});
}

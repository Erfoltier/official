import { beforeEach } from "vitest";

// テストは毎回まっさらなメモリ上のデータベースで行う（ファイルには書かない）
process.env.RESERVE_DB = ":memory:";
process.env.DATA_ENCRYPTION_KEY = "ab".repeat(32);
process.env.RESERVE_DEMO = "1";

type G = {
  __reserveStore?: unknown;
  __reserveStaff?: unknown;
  __reserveDb?: { db: { close(): void } };
};

/** ストア・スタッフ・データベースをすべて作り直す */
function resetStores(): void {
  const g = globalThis as G;
  g.__reserveDb?.db.close();
  g.__reserveDb = undefined;
  g.__reserveStore = undefined;
  g.__reserveStaff = undefined;
}

declare global {
  var resetStores: () => void;
}
globalThis.resetStores = resetStores;

beforeEach(resetStores);

// LANE RESERVE → デジカルの写し（docs/M3-SYNC.md）。
// 2分ごとに：札を取れたら（どれか1台だけ）、写す予約の一覧を読み、1件ずつデジカルで登録・変更・取消して結果を返す。
const LANE = "https://reserve.ishidahihuka.jp";
const DIGIKAR = "https://digikar.jp";
const MAX_PER_RUN = 5;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

chrome.runtime.onInstalled.addListener(() => chrome.alarms.create("m3sync", { periodInMinutes: 2 }));
chrome.runtime.onStartup.addListener(() => chrome.alarms.create("m3sync", { periodInMinutes: 2 }));
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === "m3sync") run(false);
});
chrome.runtime.onMessage.addListener((msg, _s, reply) => {
  if (msg?.type === "run-now") {
    run(true).then(() => reply({ ok: true }));
    return true;
  }
  return false;
});

async function settings() {
  const s = await chrome.storage.local.get(["enabled", "clientId", "label"]);
  if (!s.clientId) {
    s.clientId = "pc-" + crypto.randomUUID().replace(/-/g, "").slice(0, 20);
    await chrome.storage.local.set({ clientId: s.clientId });
  }
  return { enabled: !!s.enabled, clientId: s.clientId, label: s.label || "パソコン" };
}

async function setStatus(st) {
  await chrome.storage.local.set({ status: { ...st, at: new Date().toISOString() } });
}

/**
 * LANE RESERVE の開いているタブ（ログイン中のスタッフとして API を呼ぶ）。
 * 眠っているタブ（メモリの節約で止められたもの）は話せないので飛ばし、答えたタブを使う
 */
async function laneTab() {
  const tabs = (await chrome.tabs.query({ url: LANE + "/*" })).filter((t) => !t.discarded && t.status === "complete");
  tabs.sort((a, b) => Number(b.active) - Number(a.active) || (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0));
  for (const t of tabs) {
    const r = await lane(t.id, "GET", "/api/v1/auth/me").catch(() => null);
    if (r && r.status !== 0) return t;
  }
  return null;
}

/** 拡張機能を入れる前から開いていたタブには、画面のスクリプトが入っていない。そのときは入れてから話す */
async function send(tabId, msg, file) {
  try {
    const r = await chrome.tabs.sendMessage(tabId, msg);
    if (r) return r;
  } catch {
    /* 下で入れ直す */
  }
  await chrome.scripting.executeScript({ target: { tabId }, files: [file] });
  await sleep(300);
  return chrome.tabs.sendMessage(tabId, msg);
}

async function lane(tabId, method, path, body) {
  const r = await send(tabId, { type: "lane-api", method, path, body }, "lane.js");
  if (!r) throw new Error("LANE RESERVE の画面と話せません");
  return r;
}

/** 写し専用のデジカルのタブ（なければ裏で開く） */
async function digikarTab(url) {
  const { digikarTabId } = await chrome.storage.session.get("digikarTabId");
  let tab = digikarTabId ? await chrome.tabs.get(digikarTabId).catch(() => null) : null;
  if (!tab || !tab.url?.startsWith(DIGIKAR)) {
    tab = await chrome.tabs.create({ url, active: false, pinned: true });
    await chrome.storage.session.set({ digikarTabId: tab.id });
  } else {
    await chrome.tabs.update(tab.id, { url });
  }
  await waitComplete(tab.id);
  await sleep(1500);
  return tab.id;
}

function waitComplete(tabId) {
  return new Promise((resolve) => {
    const done = () => {
      chrome.tabs.onUpdated.removeListener(on);
      resolve();
    };
    const on = (id, info) => {
      if (id === tabId && info.status === "complete") done();
    };
    chrome.tabs.onUpdated.addListener(on);
    chrome.tabs.get(tabId).then((t) => t.status === "complete" && done());
    setTimeout(done, 20000);
  });
}

async function digikar(tabId, op, args) {
  for (let i = 0; i < 3; i++) {
    const r = await send(tabId, { type: "digikar", op, args }, "digikar.js").catch(() => null);
    if (r) return r;
    await sleep(1500);
  }
  return { result: "not-ready", state: "no-script" };
}

const receptionUrl = (date) => `${DIGIKAR}/reception/${date.replace(/-/g, "")}`;

/** 1件を写す。返り値は LANE RESERVE に記録する結果、または not-ready（デジカルが使えない＝止める） */
async function syncOne(laneId, item) {
  const r = item.reservation;
  const p = item.patient || {};
  const no = p.m3ChartNo || "";
  const prev = item.previous?.digikar || null;
  if (!no) return { result: "review", reason: "カルテ番号（M3）がありません（完全初診の新規患者登録は次の段階で対応）" };
  if (!/^\d{1,12}$/.test(no)) return { result: "review", reason: `カルテ番号 ${no} はデジカルの患者番号の形ではありません` };

  if (item.action === "cancel") {
    const date = item.reservation.preexisting || !prev ? r.date : prev.date;
    const time = item.reservation.preexisting || !prev ? r.time : prev.time;
    const tab = await digikarTab(receptionUrl(date));
    const res = await digikar(tab, "cancel", { patientNo: no, time, requireMemoTime: !r.preexisting });
    if (res.result === "cancelled") return { result: "cancelled", digikar: { patientNo: no, date, time } };
    return res;
  }

  // 受付メモの1行（LANE RESERVE のサーバーで Claude が作る）
  const m = await lane(laneId, "POST", `/api/v1/m3-sync/reservations/${encodeURIComponent(r.id)}/memo`, {});
  if (!m.ok) return { result: "review", reason: m.data?.message || "受付メモを作れませんでした" };
  if (m.data.fingerprint !== r.fingerprint) return { result: "skip" }; // 途中で予約が変わった（次の回に写す）
  const memoLine = m.data.memoLine;
  const target = { patientNo: no, date: r.date, time: r.time, memoLine };

  let res;
  if (item.action === "update") {
    if (!prev) return { result: "review", reason: "前に写した予約の記録がありません" };
    const tab = await digikarTab(receptionUrl(prev.date));
    res = await digikar(tab, "edit", { patientNo: no, oldDate: prev.date, oldTime: prev.time, date: r.date, time: r.time, memoLine });
  } else {
    // create・restore（取消を写すと一覧から消えるので、戻すときは登録し直す）
    const tab = await digikarTab(receptionUrl(r.date));
    res = await digikar(tab, "create", { patientNo: no, kana: p.kana || "", date: r.date, time: r.time, memoLine });
  }
  if (res.result !== "pending-verify") return res;
  const tab = await digikarTab(receptionUrl(r.date));
  const v = await digikar(tab, "verify", target);
  if (v.result === "synced") return { result: "synced", digikar: target };
  return v;
}

let running = false;
async function run(manual) {
  if (running) return;
  running = true;
  try {
    const s = await settings();
    if (!s.enabled && !manual) return;
    const lt = await laneTab();
    if (!lt) return setStatus({ state: "idle", message: "LANE RESERVE を開いていないため待っています" });
    const lock = await lane(lt.id, "POST", "/api/v1/m3-sync/lock", { clientId: s.clientId, label: s.label });
    if (!lock.ok) return setStatus({ state: "error", message: lock.status === 401 || lock.status === 403 ? "LANE RESERVE にログインしてください" : lock.data?.message || "LANE RESERVE につながりません" });
    if (!lock.data.ok) return setStatus({ state: "idle", message: `${lock.data.holder} が写しています` });
    const q = await lane(lt.id, "GET", "/api/v1/m3-sync");
    if (!q.ok) return setStatus({ state: "error", message: q.data?.message || "写す予約の一覧を読めません" });
    if (!q.data.startAt) return setStatus({ state: "idle", message: "写し始めの前です（LANE RESERVE の設定で始めます）" });
    const items = q.data.items.slice(0, MAX_PER_RUN);
    let done = 0;
    for (const item of items) {
      await lane(lt.id, "POST", "/api/v1/m3-sync/lock", { clientId: s.clientId, label: s.label });
      let res;
      try {
        res = await syncOne(lt.id, item);
      } catch (e) {
        res = { result: "review", reason: String(e?.message || e) };
      }
      if (res.result === "not-ready") {
        await setStatus({ state: "error", message: res.state === "no-cert" ? "デジカルの証明書が選ばれていません" : res.state === "login" ? "デジカルにログインしてください" : "デジカルの画面を読めません" });
        return;
      }
      if (res.result === "skip") continue;
      const body = { result: res.result, fingerprint: item.reservation.fingerprint, ...(res.reason && { reason: res.reason }), ...(res.digikar && { digikar: res.digikar }) };
      await lane(lt.id, "POST", `/api/v1/m3-sync/reservations/${encodeURIComponent(item.reservation.id)}`, body);
      done++;
      if (res.result === "review") {
        // 想定外のことが起きたら、続けずに止める（次の回にやり直す）
        await setStatus({ state: "review", message: `要確認：${res.reason}`, done });
        return;
      }
    }
    await setStatus({ state: "ok", message: items.length ? `${done}件を写しました（残り${q.data.items.length - done}件）` : "写す予約はありません", done });
  } catch (e) {
    await setStatus({ state: "error", message: String(e?.message || e) });
  } finally {
    running = false;
  }
}

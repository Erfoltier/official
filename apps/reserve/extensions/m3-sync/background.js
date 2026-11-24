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

async function lane(tabId, method, path, body, headers) {
  const r = await send(tabId, { type: "lane-api", method, path, body, headers }, "lane.js");
  if (!r) throw new Error("LANE RESERVE の画面と話せません");
  return r;
}

// 固定（ピン留め）はしない。写す予約があるときだけ裏で開き、その回が終わったら閉じる（院長 11/21：勝手に固定しない）。
// 開いたタブの番号は storage.local に覚える（拡張機能を読み込み直しても忘れない）。
// ※アドレスに # の印を付けると、デジカルが日付を無視して今日の一覧を出したので使わない（11/21 確認）

/** 拡張機能が開いた写し専用のタブ（デジカルのページのままのものだけ） */
async function ownDigikarTabs() {
  const { ownTabIds = [] } = await chrome.storage.local.get("ownTabIds");
  const tabs = [];
  for (const id of ownTabIds) {
    const t = await chrome.tabs.get(id).catch(() => null);
    if (t && (t.url || t.pendingUrl || "").startsWith(DIGIKAR)) tabs.push(t);
  }
  return tabs;
}

/** その回の終わりに閉じる */
async function closeDigikarTabs() {
  const tabs = await ownDigikarTabs();
  if (tabs.length) await chrome.tabs.remove(tabs.map((t) => t.id)).catch(() => {});
  await chrome.storage.local.set({ ownTabIds: [] });
}

/** 写し専用のデジカルのタブ（なければ裏で開く。固定しない） */
async function digikarTab(url) {
  const [own, ...extra] = await ownDigikarTabs();
  if (extra.length) await chrome.tabs.remove(extra.map((t) => t.id)).catch(() => {});
  let tab = own || null;
  if (!tab) {
    const loaded = loadedAfterStart(null);
    tab = await chrome.tabs.create({ url, active: false, pinned: false });
    await chrome.storage.local.set({ ownTabIds: [tab.id] });
    await loaded(tab.id);
  } else {
    // 開き直したページを必ず待つ（直後の「読み込み済み」は前のページのことがあるため、読み込みが始まってから終わるまで）
    const loaded = loadedAfterStart(tab.id);
    await chrome.tabs.update(tab.id, { url });
    await loaded(tab.id);
  }
  await sleep(1500);
  return tab.id;
}

/** 読み込みが始まり（loading）、終わる（complete）のを待つ。先に待ち受けてから開く */
function loadedAfterStart(knownId) {
  let started = false;
  let resolveFn = null;
  let target = knownId;
  let finished = false;
  const on = (id, info) => {
    if (target !== null && id !== target) return;
    if (info.status === "loading") started = true;
    if (info.status === "complete" && started) {
      finished = true;
      resolveFn?.();
    }
  };
  chrome.tabs.onUpdated.addListener(on);
  return (tabId) =>
    new Promise((resolve) => {
      target = tabId;
      const done = () => {
        chrome.tabs.onUpdated.removeListener(on);
        resolve();
      };
      resolveFn = done;
      if (finished) done();
      setTimeout(done, 25000);
    });
}

/** デジカルの操作はページ自身の世界（MAIN）で動かす（digikar.js の説明を参照） */
async function digikar(tabId, op, args) {
  for (let i = 0; i < 3; i++) {
    try {
      await chrome.scripting.executeScript({ target: { tabId }, world: "MAIN", files: ["digikar.js"] });
      const [res] = await chrome.scripting.executeScript({
        target: { tabId },
        world: "MAIN",
        func: (o, a) => globalThis.__laneM3Run(o, a),
        // 写し専用のタブだけ（裏で止まるアニメーションを切る。digikar.js の wakeHiddenTab）
        args: [op, { ...args, dedicated: true }],
      });
      if (res?.result) return res.result;
    } catch {
      /* ページの読み込み中など。少し待ってやり直す */
    }
    await sleep(1500);
  }
  return { result: "not-ready", state: "no-script" };
}

/**
 * 取消：裏のタブではページの中から送った操作ではステータスのメニューが効かなかったため（11/21 試運転）、
 * Chrome のデバッグの仕組みで本物のマウス操作を送る。写し専用のタブにだけ、取消の数秒の間だけつなぐ
 */
async function cancelByDebugger(tabId, args) {
  const at = await digikar(tabId, "locateCancel", args);
  if (at.result === "gone") return { result: "cancelled", note: "デジカルにはすでにありませんでした" };
  if (at.result !== "at") return at;
  const target = { tabId };
  const trail = [`vis=${at.vis}`];
  const click = async (p) => {
    const base = { x: p.x, y: p.y, button: "left", clickCount: 1, pointerType: "mouse" };
    await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", { type: "mouseMoved", x: p.x, y: p.y, button: "none", pointerType: "mouse" });
    await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", { ...base, type: "mousePressed", buttons: 1 });
    await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", { ...base, type: "mouseReleased", buttons: 0 });
  };
  try {
    await chrome.debugger.attach(target, "1.3");
  } catch (e) {
    return { result: "review", reason: `デバッグの仕組みにつなげません（${String(e?.message || e)}）` };
  }
  try {
    // 裏のタブでも、フォーカスのあるページとして動かす
    await chrome.debugger.sendCommand(target, "Emulation.setFocusEmulationEnabled", { enabled: true }).catch(() => trail.push("focus不可"));
    await click(at.point);
    const item = await digikar(tabId, "locateCancelItem", { pageDate: args.pageDate });
    if (item.result !== "at") {
      trail.push("メニューが開かない");
      return { result: "review", reason: `取消にできません（${trail.join("、")}）` };
    }
    await click(item.point);
    const done = await digikar(tabId, "checkGone", { patientNo: args.patientNo, time: args.time, before: at.count, pageDate: args.pageDate });
    trail.push(`debugger:${done.result === "cancelled" ? "減った" : "変わらず"}`);
    if (done.result === "cancelled") return { result: "cancelled", note: trail.join("、") };
    return { result: "review", reason: `取消にしたあとも一覧に残っています（${trail.join("、")}）` };
  } finally {
    await chrome.debugger.detach(target).catch(() => {});
  }
}

const receptionUrl = (date) =>`${DIGIKAR}/reception/${date.replace(/-/g, "")}`;

/**
 * 完全初診の方をデジカルに新規患者登録し、付いた患者番号を LANE RESERVE のカルテ番号（M3）に書き戻す。
 * 氏名・フリガナ・性別（男性か女性）・生年月日のどれかがなければ登録しない（デジカルの性別の初期値は男性のため）
 */
async function registerNewPatient(laneId, item) {
  const p = item.patient || {};
  const missing = [
    !p.name && "氏名",
    !p.kana && "フリガナ",
    !(p.sex === "male" || p.sex === "female") && "性別（男性か女性）",
    !/^\d{4}-\d{2}-\d{2}$/.test(p.birthDate || "") && "生年月日",
  ].filter(Boolean);
  if (missing.length) return { result: "review", reason: `カルテ番号がなく、デジカルに新規患者登録するための ${missing.join("・")} が LANE RESERVE にありません` };
  const tab = await digikarTab(receptionUrl(item.reservation.date));
  const reg = await digikar(tab, "registerPatient", {
    pageDate: item.reservation.date,
    name: p.name,
    kana: p.kana,
    sex: p.sex,
    birthDate: p.birthDate,
    phone: (p.phone || "").replace(/[^\d-]/g, ""),
    // デジカルの郵便番号は半角数字7文字だけ（ハイフンがあると「郵便番号は半角数字7文字で入力して下さい」で登録できない。11/24 練習患者で確認）
    postalCode: ((p.postalCode || "").normalize("NFKC").replace(/\D/g, "").match(/^\d{7}$/) || [""])[0],
  });
  if (reg.result !== "registered") return reg;
  // LANE RESERVE に番号を書き戻す（版をそろえてから）
  const cur = await lane(laneId, "GET", `/api/v1/patients/${encodeURIComponent(p.id)}`);
  const version = cur.data?.patient?.version;
  const put = version
    ? await lane(laneId, "POST", `/api/v1/patients/${encodeURIComponent(p.id)}`, { version, m3ChartNo: reg.patientNo }, { "X-HTTP-Method-Override": "PATCH" })
    : { ok: false };
  if (!put.ok) return { result: "review", reason: `デジカルに患者番号 ${reg.patientNo} で新規患者登録しましたが、LANE RESERVE にカルテ番号を書き戻せませんでした。手で ${reg.patientNo} を入れてください` };
  return reg;
}

/** 1件を写す。返り値は LANE RESERVE に記録する結果、または not-ready（デジカルが使えない＝止める） */
async function syncOne(laneId, item) {
  const r = item.reservation;
  const p = item.patient || {};
  let no = p.m3ChartNo || "";
  const prev = item.previous?.digikar || null;
  // 同じ日の2件目以降は、最初の予約が新規患者登録・書き戻しを済ませてから（患者を二重に登録しないため）
  if (!no && r.firstOfDay === false && (item.action === "create" || item.action === "restore")) return { result: "skip" };
  if (!no) {
    // 完全初診：LANE RESERVE の情報でデジカルに新規患者登録し、付いた番号を LANE RESERVE に書き戻す（院長 11/21）
    // カルテ番号のない患者の取消：デジカルにまだ患者がいない（新患）ので、デジカルには何もない（院長 11/24）
    if (item.action === "cancel") return { result: "cancelled", note: "カルテ番号がない（デジカルに患者がいない）ため、デジカルは何もしない" };
    if (item.action !== "create" && item.action !== "restore") return { result: "review", reason: "カルテ番号（M3）がありません" };
    const reg = await registerNewPatient(laneId, item);
    if (reg.result !== "registered") return reg;
    no = reg.patientNo;
  }
  if (!/^\d{1,12}$/.test(no)) return { result: "review", reason: `カルテ番号 ${no} はデジカルの患者番号の形ではありません` };

  // デジカルは同じ患者の同じ日の予約を1件にまとめて持つ（11/24 院長の指摘・12/09 の受付一覧で確認）
  const sameDay = r.sameDay || [];
  if (item.action === "cancel" && sameDay.length) {
    // 同じ日のほかの予約が残るので、デジカルの1件はそのまま（来院はある）
    return { result: "cancelled", note: `同じ日のほかの予約（${sameDay.map((t) => `${t.slice(0, 2)}:${t.slice(2)}`).join("・")}）が残るため、デジカルの予約はそのまま`, ...(prev && { digikar: prev }) };
  }
  if (item.action === "update" && !prev && r.firstOfDay === false) {
    // 同じ日の2件目以降で行の記録がない（「対応済み」など）：デジカルの1件は最初の予約のもの。動かさず、まとめた予約として記録する（Claude は呼ばない）
    return { result: "synced", note: "同じ日の予約にまとめているため、デジカルはそのまま", digikar: { patientNo: no, date: r.date, time: [r.time, ...sameDay].sort()[0], merged: true } };
  }
  if (item.action === "update" && prev?.merged) {
    // まとめた予約：デジカルの1件は最初の予約のもの。日が変わったときだけ確かめる
    if (r.date !== prev.date) return { result: "review", reason: `同じ日の予約にまとめていた予約の日が変わりました（${prev.date} → ${r.date}）` };
    return { result: "synced", note: "同じ日の予約にまとめているため、デジカルはそのまま", digikar: prev };
  }
  if ((item.action === "create" || item.action === "restore") && r.firstOfDay === false) {
    // その日の最初の予約ではない：最初の予約のデジカルの1件にまとめる（Claude は呼ばない）
    const tab = await digikarTab(receptionUrl(r.date));
    const res = await digikar(tab, "create", { pageDate: r.date, patientNo: no, kana: p.kana || "", date: r.date, time: r.time, memoLine: "", sameDay, merge: true });
    if (res.result === "synced") return { ...res, digikar: { patientNo: no, date: r.date, time: res.rowTime || r.time, merged: true } };
    return res;
  }

  if (item.action === "cancel") {
    const date = item.reservation.preexisting || !prev ? r.date : prev.date;
    const time = item.reservation.preexisting || !prev ? r.time : prev.time;
    const tab = await digikarTab(receptionUrl(date));
    const res = await cancelByDebugger(tab, { pageDate: date, patientNo: no, time, requireMemoTime: !r.preexisting });
    if (res.result === "cancelled") return { result: "cancelled", note: res.note, digikar: { patientNo: no, date, time } };
    return res;
  }

  // 受付メモの1行（LANE RESERVE のサーバーで Claude が作る）
  const m = await lane(laneId, "POST", `/api/v1/m3-sync/reservations/${encodeURIComponent(r.id)}/memo`, {});
  if (!m.ok) return { result: "review", reason: m.data?.message || "受付メモを作れませんでした" };
  if (m.data.fingerprint !== r.fingerprint) return { result: "skip" }; // 途中で予約が変わった（次の回に写す）
  const memoLine = m.data.memoLine;
  // 今月の Claude の利用（見積もり）。1,000円ごとの警告はポップアップに出す
  if (m.data.usage) await chrome.storage.local.set({ usage: m.data.usage });
  const target = { patientNo: no, date: r.date, time: r.time, memoLine };

  let res;
  if (item.action === "update") {
    if (!prev) {
      // 前に写した行の記録がない（「対応済み」にした予約など）：その日のデジカルのこの患者の1件を探して直す。なければ新しく入れる
      const tab = await digikarTab(receptionUrl(r.date));
      res = await digikar(tab, "create", { pageDate: r.date, patientNo: no, kana: p.kana || "", date: r.date, time: r.time, memoLine, sameDay, rewrite: true });
    } else {
      const tab = await digikarTab(receptionUrl(prev.date));
      res = await digikar(tab, "edit", { pageDate: prev.date, patientNo: no, oldDate: prev.date, oldTime: prev.time, date: r.date, time: r.time, memoLine });
    }
  } else {
    // create・restore（取消を写すと一覧から消えるので、戻すときは登録し直す）
    const tab = await digikarTab(receptionUrl(r.date));
    res = await digikar(tab, "create", { pageDate: r.date, patientNo: no, kana: p.kana || "", date: r.date, time: r.time, memoLine, sameDay });
  }
  // すでにデジカルに同じ患者・時刻の予約があった（create が synced を返す）
  if (res.result === "synced") return { ...res, digikar: res.merged ? { patientNo: no, date: r.date, time: res.rowTime, merged: true } : target };
  if (res.result === "move") {
    // デジカルの同じ患者の予約が違う時刻：LANE RESERVE の時刻・受付メモに直す（院長 11/24：時刻は LANE RESERVE 優先）
    const from = res.rowTime;
    const tab = await digikarTab(receptionUrl(r.date));
    res = await digikar(tab, "edit", { pageDate: r.date, patientNo: no, oldDate: r.date, oldTime: from, date: r.date, time: r.time, memoLine });
    if (res.result === "pending-verify") res.note = from === r.time ? "デジカルの予約の受付メモを直しました" : `デジカルの ${from.slice(0, 2)}:${from.slice(2)} の予約を LANE RESERVE の時刻に直しました`;
  }
  if (res.result !== "pending-verify") return res;
  const note = res.note;
  // 写した直後は一覧にまだ出ないことがある。ページを開き直して3回まで確かめる（12/30 の要確認の原因）
  for (let i = 0; i < 3; i++) {
    if (i > 0) await sleep(5000);
    const tab = await digikarTab(receptionUrl(r.date));
    const v = await digikar(tab, "verify", { ...target, pageDate: r.date });
    if (v.result === "synced") return { ...v, note: [note, v.note].filter(Boolean).join("・") || undefined, digikar: target };
    if (v.result !== "not-found") return v;
  }
  return { result: "review", reason: "写したあと一覧で見つかりません（開き直して3回確かめました）" };
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
    // 同じ日の最初の予約がまだ写っていない（写す列・要確認にある）患者の2件目以降は、デジカルを開かずに次の回へ
    const key = (x) => `${x.patient?.id || ""}|${x.reservation.date}`;
    const firstPending = new Set([...q.data.items, ...(q.data.review || [])].filter((x) => x.reservation.firstOfDay !== false && x.action !== "cancel").map(key));
    const items = q.data.items.filter((x) => !(x.reservation.firstOfDay === false && (x.action === "create" || x.action === "restore") && firstPending.has(key(x))));
    let done = 0;
    let tried = 0;
    const listMiss = [];
    for (const item of items) {
      if (tried >= MAX_PER_RUN) break;
      tried++;
      await lane(lt.id, "POST", "/api/v1/m3-sync/lock", { clientId: s.clientId, label: s.label });
      let res;
      try {
        res = await syncOne(lt.id, item);
      } catch (e) {
        res = { result: "review", reason: String(e?.message || e) };
      }
      if (res.result === "not-ready" && res.state === "list") {
        // その日の一覧が一時的に読めないだけ：要確認にせず、この予約は次の回に回して、ほかの予約を続ける
        listMiss.push(`${item.reservation.date}（${res.detail || "?"}）`);
        continue;
      }
      if (res.result === "not-ready") {
        await setStatus({ state: "error", message: res.state === "no-cert" ? "デジカルの証明書が選ばれていません" : res.state === "login" ? "デジカルにログインしてください" : "デジカルの画面を読めません" });
        return;
      }
      if (res.result === "skip") continue;
      const body = { result: res.result, fingerprint: item.reservation.fingerprint, ...((res.reason || res.note) && { reason: String(res.reason || res.note).slice(0, 480) }), ...(res.digikar && { digikar: res.digikar }) };
      await lane(lt.id, "POST", `/api/v1/m3-sync/reservations/${encodeURIComponent(item.reservation.id)}`, body);
      done++;
      if (res.result === "review") {
        // 想定外のことが起きたら、続けずに止める（次の回にやり直す）
        await setStatus({ state: "review", message: `要確認：${res.reason}`, done });
        return;
      }
    }
    const miss = listMiss.length ? `\nデジカルの受付一覧を読めず次の回に回した日：${listMiss.join("・")}` : "";
    await setStatus({ state: "ok", message: (items.length ? `${done}件を写しました（残り${q.data.items.length - done}件）` : "写す予約はありません") + miss, done });
  } catch (e) {
    await setStatus({ state: "error", message: String(e?.message || e) });
  } finally {
    await closeDigikarTabs();
    running = false;
  }
}

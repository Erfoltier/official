// デジカルの受付画面を操作する（院内パソコンで確かめた手順。docs/M3-SYNC.md「練習用の患者で試した結果」）
// 1件ごとに画面を読み直して確かめ、確かめられなければ review（要確認）で返す。推測で押さない。
(() => {
  // 2回入れられても1回分だけ動く（拡張機能を入れる前から開いていたタブに後から入れるため）
  if (globalThis.__laneM3Digikar) return;
  globalThis.__laneM3Digikar = true;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const visible = (el) => !!el && el.offsetParent !== null;
  const text = (el) => (el?.innerText ?? "").trim();

  async function waitFor(fn, timeout = 10000, step = 200) {
    const end = Date.now() + timeout;
    for (;;) {
      const v = fn();
      if (v) return v;
      if (Date.now() > end) return null;
      await sleep(step);
    }
  }

  function setValue(el, v) {
    const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, v);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  /** カナを比べる形に（ひらがな→カタカナ、小さい字→大きい字、空白を除く） */
  function kanaKey(s) {
    const small = { ァ: "ア", ィ: "イ", ゥ: "ウ", ェ: "エ", ォ: "オ", ャ: "ヤ", ュ: "ユ", ョ: "ヨ", ッ: "ツ", ヮ: "ワ" };
    return (s || "")
      .normalize("NFKC")
      .replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60))
      .replace(/[ァィゥェォャュョッヮ]/g, (c) => small[c])
      .replace(/[\s　・･]/g, "");
  }

  const hhmm = (t) => `${t.slice(0, 2)}:${t.slice(2)}`; // "1020" → "10:20"
  const slashDate = (d) => d.replace(/-/g, "/"); // "2026-11-24" → "2026/11/24"

  /** 画面の状態：デジカルを使えるか */
  function pageState() {
    const body = text(document.body);
    if (body.includes("有効な証明書が選択されていない")) return "no-cert";
    if (/ログイン/.test(document.title) || document.querySelector("input[type=password]")) return "login";
    if (!location.pathname.startsWith("/reception/")) return "other";
    return "ok";
  }

  /** 受付一覧（患者検索の表ではないもの）の行 */
  function receptionRows() {
    const table = [...document.querySelectorAll("table")].find((t) => {
      const hs = [...t.querySelectorAll("th")].map(text);
      return hs.includes("患者番号") && hs.includes("受付メモ") && !hs.includes("生年月日") && !t.closest("[data-m3sync-panel]");
    });
    if (!table) return null;
    const hs = [...table.querySelectorAll("th")].map(text);
    const col = (r, h) => text(r.querySelectorAll("td")[hs.indexOf(h)]);
    return [...table.querySelectorAll("tr")]
      .filter((r) => r.querySelectorAll("td").length > 3)
      .map((r) => ({ el: r, patientNo: col(r, "患者番号"), time: col(r, "予約"), status: col(r, "ステータス"), memo: col(r, "受付メモ"), statusCell: r.querySelectorAll("td")[hs.indexOf("ステータス")] }));
  }

  /** 見出しの「全 N 件」 */
  function listCount() {
    const m = text(document.body).match(/全\s*(\d+)\s*件/);
    return m ? Number(m[1]) : null;
  }

  /** 今見えている一覧（読み込み中なら null） */
  function snapshot() {
    if (text(document.body).includes("loading...")) return null;
    const rows = receptionRows() ?? [];
    const n = listCount();
    if (n === null) return null;
    if (n === 0 && !text(document.body).includes("受付が登録されていません")) return null;
    if (rows.length !== n) return null;
    return rows;
  }

  /**
   * 一覧が読み終わるのを待つ。開いた直後は前の日の表示や「受付が登録されていません」が先に出ることがあるので、
   * 「全 N 件」と行の数が合い、1.5秒おいても同じになってから使う（同じ日の予約を見落とさないため）
   */
  async function waitList() {
    const end = Date.now() + 20000;
    while (Date.now() < end) {
      const a = snapshot();
      if (a) {
        await sleep(1500);
        const b = snapshot();
        if (b && b.length === a.length) return b;
      } else {
        await sleep(300);
      }
    }
    return null;
  }

  /** 見出しの文字でパネル（患者検索・予約登録など）を探す */
  function panelByTitle(title) {
    const h = [...document.querySelectorAll("*")].find((e) => e.childElementCount === 0 && e.textContent.trim() === title && visible(e));
    return h || null;
  }

  function closeSearchPanel() {
    const t = panelByTitle("患者検索");
    if (!t) return;
    let bar = t;
    while (bar && !bar.querySelector("button")) bar = bar.parentElement;
    bar?.querySelector("button")?.click();
  }

  async function openSearch() {
    const btn = [...document.querySelectorAll("button")].find((b) => (b.querySelector("path")?.getAttribute("d") || "").startsWith("M15.357 6.33a6.383"));
    if (!btn) throw new Error("検索のボタンが見つかりません");
    btn.click();
    const box = await waitFor(() => [...document.querySelectorAll('input[placeholder^="患者番号"]')].find(visible));
    if (!box) throw new Error("患者検索が開きません");
    return box;
  }

  /** 患者番号がちょうど同じ行（部分一致の検索なので、番号を必ず照合する） */
  async function findPatientRow(patientNo) {
    const box = await openSearch();
    box.focus();
    setValue(box, patientNo);
    box.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, bubbles: true }));
    return waitFor(() => {
      const rows = [...document.querySelectorAll("tr")].filter((r) => visible(r) && r.querySelector("td") && [...(r.closest("table")?.querySelectorAll("th") ?? [])].some((th) => text(th) === "生年月日"));
      return rows.find((r) => text(r.querySelector("td")) === patientNo) || null;
    }, 10000);
  }

  function formFields() {
    const date = [...document.querySelectorAll('input[placeholder="yyyy/mm/dd"]')].find(visible);
    const time = [...document.querySelectorAll("input")].find((i) => visible(i) && /^\d{1,2}:\d{2}$/.test(i.placeholder || ""));
    const memo = [...document.querySelectorAll("textarea")].find(visible);
    return { date, time, memo };
  }

  /** 予約日・予約時間・受付メモを入れ、入ったことを確かめる */
  async function fillForm({ date, time, memoLine }) {
    const f = await waitFor(() => {
      const x = formFields();
      return x.date && x.time && x.memo ? x : null;
    });
    if (!f) throw new Error("予約の画面が開きません");
    f.date.focus();
    setValue(f.date, slashDate(date));
    f.date.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", keyCode: 13, bubbles: true }));
    f.date.blur();
    await sleep(300);
    f.time.focus();
    f.time.click();
    await sleep(200);
    setValue(f.time, hhmm(time));
    await sleep(200);
    f.time.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", keyCode: 9, bubbles: true }));
    f.time.blur();
    await sleep(300);
    f.memo.focus();
    setValue(f.memo, memoLine);
    f.memo.blur();
    await sleep(500);
    const g = formFields();
    if (g.date?.value !== slashDate(date) || g.time?.value !== hhmm(time) || g.memo?.value !== memoLine) {
      throw new Error(`入力を確かめられません（予約日 ${g.date?.value}・予約時間 ${g.time?.value}）`);
    }
  }

  async function pressAndWaitClose(label) {
    const btn = [...document.querySelectorAll("button")].filter((b) => visible(b) && text(b) === label).pop();
    if (!btn) throw new Error(`「${label}」のボタンが見つかりません`);
    btn.click();
    const closed = await waitFor(() => !formFields().date, 10000);
    if (!closed) throw new Error(`「${label}」の後に画面が閉じません（デジカルの画面のメッセージを確かめてください）`);
  }

  const review = (reason) => ({ result: "review", reason });

  // ---- 登録（新しい予約） ----
  async function create({ patientNo, kana, date, time, memoLine }) {
    const rows = await waitList();
    if (rows === null) return review("デジカルの受付一覧を読めません");
    const same = rows.filter((r) => r.patientNo === patientNo);
    if (same.length) return review(`この日にこの患者の予約がデジカルにすでにあります（${same.map((r) => r.time).join("・")}）`);
    const row = await findPatientRow(patientNo);
    if (!row) {
      closeSearchPanel();
      return review(`デジカルに患者番号 ${patientNo} の患者が見つかりません`);
    }
    const dkKana = text(row.querySelectorAll("td")[1]);
    if (kana && kanaKey(kana) !== kanaKey(dkKana)) {
      closeSearchPanel();
      return review(`患者番号 ${patientNo} のフリガナがデジカルと違います（デジカル：${dkKana}）`);
    }
    const yoyaku = [...row.querySelectorAll("button")].find((b) => text(b) === "予約");
    if (!yoyaku) {
      closeSearchPanel();
      return review("患者検索の「予約」ボタンが見つかりません");
    }
    yoyaku.click();
    await fillForm({ date, time, memoLine });
    await pressAndWaitClose("登録");
    closeSearchPanel();
    return { result: "pending-verify" };
  }

  // ---- 変更（前に写した予約を直す） ----
  async function edit({ patientNo, oldDate, oldTime, date, time, memoLine }) {
    const rows = await waitList();
    if (rows === null) return review("デジカルの受付一覧を読めません");
    const hits = rows.filter((r) => r.patientNo === patientNo && r.time === hhmm(oldTime));
    if (hits.length !== 1) return review(`変更する予約をデジカルで1件に決められません（${hits.length}件）`);
    const btns = [...hits[0].el.querySelectorAll("button")];
    btns[btns.length - 1].click(); // 行の右端（予約の画面）
    const want = `${slashDate(oldDate)}(`;
    const entry = await waitFor(() =>
      [...document.querySelectorAll("*")].find((e) => e.childElementCount === 0 && visible(e) && e.textContent.includes(want) && e.textContent.includes(hhmm(oldTime))),
    );
    if (!entry) return review("予約一覧に変更する予約が見つかりません");
    let box = entry;
    while (box && box.querySelectorAll("button").length < 2) box = box.parentElement;
    const editBtn = box?.querySelectorAll("button")[0];
    if (!editBtn) return review("予約一覧の「編集」ボタンが見つかりません");
    editBtn.click();
    const titled = await waitFor(() => panelByTitle("予約編集"));
    if (!titled) return review("「予約編集」の画面になりません");
    await fillForm({ date, time, memoLine });
    await pressAndWaitClose("更新");
    return { result: "pending-verify" };
  }

  // ---- 取消（ステータスを「取消」に。一覧から消え、受付編集履歴に残る） ----
  async function cancel({ patientNo, time, requireMemoTime }) {
    const rows = await waitList();
    if (rows === null) return review("デジカルの受付一覧を読めません");
    let hits = rows.filter((r) => r.patientNo === patientNo && r.time === hhmm(time));
    if (requireMemoTime) hits = hits.filter((r) => r.memo.startsWith(time));
    if (hits.length === 0) return { result: "cancelled", note: "デジカルにはすでにありませんでした" };
    if (hits.length !== 1) return review(`取り消す予約をデジカルで1件に決められません（${hits.length}件）`);
    const sbtn = hits[0].statusCell?.querySelector("button");
    if (!sbtn) return review("ステータスのボタンが見つかりません");
    sbtn.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerType: "mouse" }));
    const item = await waitFor(() => [...document.querySelectorAll("[role=menuitem]")].find((i) => text(i) === "取消"), 5000);
    if (!item) return review("ステータスの「取消」が見つかりません");
    item.focus();
    item.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, bubbles: true }));
    await sleep(2000);
    const after = (await waitList()) || [];
    const still = after.filter((r) => r.patientNo === patientNo && r.time === hhmm(time));
    if (still.length >= hits.length) return review("取消にしたあとも一覧に残っています");
    return { result: "cancelled" };
  }

  /** 写したあと：その日の一覧に、患者番号・時刻・受付メモの行がちょうど1件あるか */
  async function verify({ patientNo, time, memoLine }) {
    const match = (rows) => rows.filter((r) => r.patientNo === patientNo && r.time === hhmm(time) && r.memo.replace(/\s+/g, "") === memoLine.replace(/\s+/g, ""));
    // 写した直後は一覧の更新が遅れることがあるので、15秒まで見直す
    const end = Date.now() + 15000;
    let hits = [];
    while (Date.now() < end) {
      const rows = await waitList();
      if (rows === null) return review("デジカルの受付一覧を読めません");
      hits = match(rows);
      if (hits.length >= 1) break;
      await sleep(1500);
    }
    if (hits.length !== 1) return review(`写したあと一覧で確かめられません（${hits.length}件）`);
    return { result: "synced" };
  }

  chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
    if (msg?.type !== "digikar") return false;
    (async () => {
      try {
        const state = pageState();
        if (msg.op === "state") return reply({ state });
        if (state !== "ok") return reply({ result: "not-ready", state });
        const fn = { create, edit, cancel, verify }[msg.op];
        if (!fn) return reply(review("知らない操作です"));
        reply(await fn(msg.args));
      } catch (e) {
        try {
          // 途中で止まったら、保存せずに閉じる（キャンセル）
          [...document.querySelectorAll("button")].filter((b) => visible(b) && text(b) === "キャンセル").pop()?.click();
          await sleep(500);
          closeSearchPanel();
        } catch {
          /* 閉じられなくても続けない */
        }
        reply(review(String(e?.message || e)));
      }
    })();
    return true;
  });
})();

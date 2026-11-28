// デジカルの受付画面を操作する（院内パソコンで確かめた手順。docs/M3-SYNC.md「練習用の患者で試した結果」）
// 1件ごとに画面を読み直して確かめ、確かめられなければ review（要確認）で返す。推測で押さない。
(() => {
  // 2回入れられても1回分だけ動く（拡張機能を入れる前から開いていたタブに後から入れるため）
  if (globalThis.__laneM3Digikar) return;
  globalThis.__laneM3Digikar = true;

  /**
   * 裏のタブ（写し専用のタブ）では Chrome がアニメーションと requestAnimationFrame を止める。
   * デジカルのステータスのメニューは閉じるアニメーションの後に動くらしく、裏では「取消」が効かなかった（11/21 試運転：
   * vis=hidden・Enter/クリック/押して離す のどれも変わらず）。写し専用のタブの中だけ、アニメーションを切り、
   * requestAnimationFrame をふつうのタイマーで動かす（スタッフが使うタブには入れない）
   */
  function wakeHiddenTab() {
    if (document.getElementById("lane-m3-noanim")) return;
    const st = document.createElement("style");
    st.id = "lane-m3-noanim";
    st.textContent = "*,*::before,*::after{animation:none!important;animation-duration:0s!important;transition:none!important}";
    document.head.appendChild(st);
    const raf = window.requestAnimationFrame.bind(window);
    const caf = window.cancelAnimationFrame.bind(window);
    const timers = new Map();
    let n = 1e9;
    window.requestAnimationFrame = (cb) => {
      if (document.visibilityState !== "hidden") return raf(cb);
      const id = ++n;
      timers.set(id, setTimeout(() => {
        timers.delete(id);
        cb(performance.now());
      }, 16));
      return id;
    };
    window.cancelAnimationFrame = (id) => {
      if (timers.has(id)) {
        clearTimeout(timers.get(id));
        timers.delete(id);
      } else caf(id);
    };
  }
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
  let lastList = "";
  async function waitList() {
    const end = Date.now() + 40000;
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
    // 読めなかったときの様子（原因を調べるため。患者の情報は入れない）
    const body = text(document.body);
    lastList = `全${listCount() ?? "?"}件・行${receptionRows()?.length ?? "?"}${body.includes("loading...") ? "・読み込み中" : ""}・${document.visibilityState}`;
    return null;
  }
  const listNotReady = () => ({ result: "not-ready", state: "list", detail: lastList });

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
  async function create({ patientNo, kana, date, time, memoLine, sameDay = [], merge = false, rewrite = false }) {
    const rows = await waitList();
    if (rows === null) return listNotReady();
    const same = rows.filter((r) => r.patientNo === patientNo);
    // 変更なのに前に写した行の記録がない（スタッフが「対応済み」にした予約など）：その日のこの患者の1件を直す
    if (rewrite && same.length === 1) return { result: "move", rowTime: same[0].time.replace(":", "") };
    if (rewrite && same.length > 1) return review(`変更する予約をデジカルで1件に決められません（この日にこの患者の予約が${same.length}件）`);
    // 同じ患者・同じ時刻の予約が1件あれば、すでに入っているものとする（前の回で確かめが間に合わなかった・手で入れた）
    const sameTime = same.filter((r) => r.time === hhmm(time));
    // 2件以上（二重）でも、すでにあるときは LANE RESERVE からは何もしない（院長 11/24）
    if (sameTime.length >= 1) {
      const memoSame = sameTime.some((r) => r.memo.replace(/\s+/g, "") === memoLine.replace(/\s+/g, ""));
      return { result: "synced", note: sameTime.length > 1 ? `デジカルにすでに同じ時刻の予約が${sameTime.length}件あります（何もしない）` : memoSame ? "デジカルにすでに同じ予約がありました" : "デジカルにすでに同じ時刻の予約がありました（受付メモはデジカルのまま）" };
    }
    // デジカルは同じ患者の同じ日の予約を1件にまとめて持つ。その日のほかの予約（LANE RESERVE）の時刻の行が1件あれば、そこにまとめる
    if (same.length === 1 && (merge || sameDay.some((t) => hhmm(t) === same[0].time))) {
      return { result: "synced", merged: true, rowTime: same[0].time.replace(":", ""), note: `同じ日の ${same[0].time} の予約にまとめました` };
    }
    if (merge && same.length === 0) return { result: "skip" };
    // 同じ患者の予約が1件だけ違う時刻である：時刻は LANE RESERVE を優先し、その1件を LANE RESERVE の時刻・受付メモに直す（院長 11/24）
    if (same.length === 1 && !merge) return { result: "move", rowTime: same[0].time.replace(":", "") };
    if (same.length) return review(`この日にこの患者の予約がデジカルにすでにあります（${same.map((r) => r.time).join("・")}）`);
    const row = await findPatientRow(patientNo);
    if (!row) {
      closeSearchPanel();
      return review(`デジカルに患者番号 ${patientNo} の患者が見つかりません`);
    }
    // フリガナが違っても、デジカルを優先してそのまま写す（院長 11/24）。違ったことだけ記録に残す
    const dkKana = text(row.querySelectorAll("td")[1]);
    const kanaNote = kana && kanaKey(kana) !== kanaKey(dkKana) ? "フリガナが LANE RESERVE と違います（デジカルを優先）" : null;
    const yoyaku = [...row.querySelectorAll("button")].find((b) => text(b) === "予約");
    if (!yoyaku) {
      closeSearchPanel();
      return review("患者検索の「予約」ボタンが見つかりません");
    }
    yoyaku.click();
    await fillForm({ date, time, memoLine });
    await pressAndWaitClose("登録");
    closeSearchPanel();
    return { result: "pending-verify", ...(kanaNote && { note: kanaNote }) };
  }

  // ---- 変更（前に写した予約を直す） ----
  async function edit({ patientNo, oldDate, oldTime, date, time, memoLine }) {
    const rows = await waitList();
    if (rows === null) return listNotReady();
    const hits = rows.filter((r) => r.patientNo === patientNo && r.time === hhmm(oldTime));
    if (hits.length !== 1) return review(`変更する予約をデジカルで1件に決められません（${hits.length}件）`);
    const btns = [...hits[0].el.querySelectorAll("button")];
    btns[btns.length - 1].click(); // 行の右端（予約の画面）
    // 予約一覧の1件は「2026/11/24(火)」と「10:00」が別々の要素で、同じ箱に 編集・削除・カルテ表示 のボタンがある
    // 予約一覧の日付は月・日に0を付けない（「2026/12/9(水)」。11/24 の 12/09 で見つからなかった）。どちらの形でも探す
    const [oy, om, od] = oldDate.split("-");
    const wants = [`${slashDate(oldDate)}(`, `${oy}/${Number(om)}/${Number(od)}(`];
    const entry = await waitFor(() => {
      const hits = [...document.querySelectorAll("div,li")].filter((e) => visible(e) && wants.some((w) => (e.innerText || "").includes(w)) && (e.innerText || "").includes(hhmm(oldTime)) && e.querySelectorAll("button").length >= 2);
      return hits.sort((a, b) => a.innerText.length - b.innerText.length)[0] || null;
    });
    if (!entry) return review("予約一覧に変更する予約が見つかりません");
    // 「編集」は鉛筆の印のボタン（並び順では選ばない＝「削除」を押さないため）
    const editBtn = [...entry.querySelectorAll("button")].find((b) => (b.querySelector("path")?.getAttribute("d") || "").startsWith("M19.575 9.326"));
    if (!editBtn) return review("予約一覧の「編集」ボタンが見つかりません");
    editBtn.click();
    const titled = await waitFor(() => panelByTitle("予約編集"));
    if (!titled) return review("「予約編集」の画面になりません");
    await fillForm({ date, time, memoLine });
    await pressAndWaitClose("更新");
    return { result: "pending-verify" };
  }

  // ---- 取消（ステータスを「取消」に。一覧から消え、受付編集履歴に残る） ----
  // ---- 完全初診の新規患者登録（docs/M3-SYNC.md「完全初診の方」） ----

  /** 全角カナに（ひらがな→カタカナ、半角→全角、空白は全角の空白1つ） */
  function toZenKana(s) {
    return (s || "")
      .normalize("NFKC")
      .replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60))
      .trim()
      .replace(/[\s　]+/g, "　");
  }

  /** 患者検索の結果の行（番号・フリガナ・生年月日） */
  async function searchRows(keyword) {
    const box = [...document.querySelectorAll('input[placeholder^="患者番号"]')].find(visible) || (await openSearch());
    box.focus();
    setValue(box, keyword);
    box.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, bubbles: true }));
    await sleep(2500);
    const table = [...document.querySelectorAll("table")].find((t) => visible(t) && [...t.querySelectorAll("th")].some((th) => text(th) === "生年月日"));
    if (!table) return [];
    const hs = [...table.querySelectorAll("th")].map(text);
    return [...table.querySelectorAll("tr")]
      .filter((r) => r.querySelector("td"))
      .map((r) => {
        const c = [...r.querySelectorAll("td")].map(text);
        return { no: c[hs.indexOf("患者番号")], kana: c[hs.indexOf("フリガナ")], birth: c[hs.indexOf("生年月日")], el: r };
      });
  }

  /** "1943(S18)/04/20" → "1943-04-20" */
  const birthKey = (s) => {
    const m = (s || "").match(/(\d{4})\D*?\/(\d{1,2})\/(\d{1,2})/);
    return m ? `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}` : "";
  };

  async function registerPatient({ name, kana, sex, birthDate, phone, postalCode }) {
    const zen = toZenKana(kana);
    const family = kanaKey(zen.split("　")[0]);
    // 二重登録を防ぐ：同じフリガナ、または同じ生年月日で同じ姓（カナ）の方がいれば登録しない
    await openSearch();
    const byKana = (await searchRows(zen.replace("　", " "))).filter((r) => kanaKey(r.kana) === kanaKey(zen));
    if (byKana.length) {
      closeSearchPanel();
      return review(`同じフリガナの患者がデジカルにいます（患者番号 ${byKana.map((r) => r.no).join("・")}）。同じ方ならカルテ番号を LANE RESERVE に入れてください`);
    }
    const [y, m, d] = birthDate.split("-");
    const byBirth = (await searchRows(`${y}/${Number(m)}/${Number(d)}`)).filter((r) => birthKey(r.birth) === birthDate && kanaKey(r.kana).startsWith(family));
    if (byBirth.length) {
      closeSearchPanel();
      return review(`同じ生年月日・同じ姓の患者がデジカルにいます（患者番号 ${byBirth.map((r) => r.no).join("・")}）`);
    }
    const nb = [...document.querySelectorAll("button")].find((b) => visible(b) && text(b) === "新規患者登録");
    if (!nb) throw new Error("「新規患者登録」のボタンが見つかりません");
    nb.click();
    const f = await waitFor(() => {
      const no = document.querySelector('input[name="orca-patient-id"]');
      const kanji = document.querySelector('input[name="kanji-name"]');
      const kanaIn = document.querySelector('input[name="kana-name"]');
      return no && kanji && kanaIn && visible(kanji) ? { no, kanji, kanaIn } : null;
    });
    if (!f) throw new Error("患者情報登録の画面が開きません");
    // 患者番号は画面が開いた少し後に入る（11/21 試運転：開いた直後は空だった）
    const newNo = (await waitFor(() => (/^\d{1,12}$/.test(f.no.value.trim()) ? f.no.value.trim() : null), 10000)) || f.no.value.trim();
    if (!/^\d{1,12}$/.test(newNo)) throw new Error(`新しい患者番号を読めません（${newNo}）`);
    setValue(f.kanji, name);
    setValue(f.kanaIn, zen);
    const radio = document.querySelector(`input[name="性別"][value="${sex === "male" ? "1" : "2"}"]`);
    radio.click();
    const inputs = [...document.querySelectorAll("input")].filter(visible);
    const i = inputs.indexOf(document.querySelector('input[name="性別"][value="2"]'));
    const [yi, mi, di] = inputs.slice(i + 1, i + 4);
    for (const [el, v] of [[yi, y], [mi, String(Number(m))], [di, String(Number(d))]]) {
      el.focus();
      setValue(el, v);
      el.blur();
    }
    if (postalCode) {
      // 郵便番号は半角数字7文字（ハイフンなし）。入れて欄を離れると住所（市区町村）が自動で入る
      const zip = document.querySelector('input[name="zip-code"]');
      zip.focus();
      setValue(zip, postalCode.replace(/\D/g, ""));
      zip.blur();
      await sleep(1000);
    }
    if (phone) setValue(document.querySelector('input[name="phone-number"]'), phone);
    await sleep(600);
    // 入ったことを確かめる（性別は選ばれたか、生年月日の年は「1990(平成2)」の形になる）
    const okSex = document.querySelector(`input[name="性別"][value="${sex === "male" ? "1" : "2"}"]`)?.checked;
    if (f.kanji.value !== name || f.kanaIn.value !== zen || !okSex || !yi.value.startsWith(y) || mi.value !== String(Number(m)) || di.value !== String(Number(d))) {
      throw new Error("患者情報の入力を確かめられません");
    }
    const save = [...document.querySelectorAll("button")].filter((b) => visible(b) && text(b) === "登録").pop();
    if (!save) throw new Error("「登録」のボタンが見つかりません");
    save.click();
    const closed = await waitFor(() => !document.querySelector('input[name="kanji-name"]'), 10000);
    if (!closed) {
      // 閉じない理由を残す（12/02 の要確認。入力欄の段階ではデジカルは何もはじかないので、「登録」の後に出るメッセージを読む）
      const form = document.querySelector('input[name="kanji-name"]')?.closest("[role=dialog]");
      const msgs = [
        ...[...document.querySelectorAll("[role=dialog],[role=alertdialog],[role=alert]")].filter((d) => visible(d) && d !== form && !d.contains(form)).map((d) => text(d)),
        ...(form ? text(form).split("\n").filter((l) => /です|ください|できません|エラー|既に|すでに|重複|正しく/.test(l)) : []),
      ]
        .join("／")
        .replace(/\s+/g, " ")
        .slice(0, 200);
      throw new Error(`患者情報登録の画面が閉じません（デジカル：${msgs || "メッセージなし"}）`);
    }
    // 登録できたか：新しい番号で探し、フリガナが同じこと
    const after = (await searchRows(newNo)).filter((r) => r.no === newNo);
    closeSearchPanel();
    if (after.length !== 1 || kanaKey(after[0].kana) !== kanaKey(zen)) {
      return review(`デジカルに患者番号 ${newNo} で登録したかもしれませんが確かめられません。デジカルで確かめてください`);
    }
    return { result: "registered", patientNo: newNo };
  }

  // ---- 取消（デバッグの仕組みで本物のクリックを送るための位置を返す。background.js の cancelByDebugger） ----
  const center = (el) => {
    el.scrollIntoView({ block: "center", inline: "center" });
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  };

  /** 取り消す行のステータスのボタンの位置。なければ gone、1件に決まらなければ review */
  async function locateCancel({ patientNo, time, requireMemoTime }) {
    const rows = await waitList();
    if (rows === null) return listNotReady();
    let hits = rows.filter((r) => r.patientNo === patientNo && r.time === hhmm(time));
    if (requireMemoTime) hits = hits.filter((r) => r.memo.startsWith(time));
    if (hits.length === 0) return { result: "gone", count: listCount() };
    if (hits.length !== 1) return review(`取り消す予約をデジカルで1件に決められません（${hits.length}件）`);
    const sbtn = hits[0].statusCell?.querySelector("button");
    if (!sbtn) return review("ステータスのボタンが見つかりません");
    return { result: "at", point: center(sbtn), count: listCount(), vis: document.visibilityState };
  }

  /** 開いたメニューの「取消」の位置 */
  async function locateCancelItem() {
    const item = await waitFor(() => [...document.querySelectorAll("[role=menuitem]")].find((i) => text(i) === "取消"), 5000);
    if (!item) return { result: "none" };
    return { result: "at", point: center(item) };
  }

  /** 取消のあと：その行が消えたか */
  async function checkGone({ patientNo, time, before }) {
    const ok = await waitFor(() => {
      const n = listCount();
      return n !== null && n < before ? true : null;
    }, 8000, 300);
    const rows = (await waitList()) || [];
    const still = rows.filter((r) => r.patientNo === patientNo && r.time === hhmm(time)).length;
    return { result: ok && still === 0 ? "cancelled" : "still", count: listCount() };
  }

  async function cancel({ patientNo, time, requireMemoTime }) {
    const rows = await waitList();
    if (rows === null) return listNotReady();
    let hits = rows.filter((r) => r.patientNo === patientNo && r.time === hhmm(time));
    if (requireMemoTime) hits = hits.filter((r) => r.memo.startsWith(time));
    if (hits.length === 0) return { result: "cancelled", note: "デジカルにはすでにありませんでした" };
    if (hits.length !== 1) return review(`取り消す予約をデジカルで1件に決められません（${hits.length}件）`);
    const sbtn = hits[0].statusCell?.querySelector("button");
    if (!sbtn) return review("ステータスのボタンが見つかりません");
    const n0 = listCount();
    const gone = () => {
      const n = listCount();
      return n !== null && n0 !== null && n < n0;
    };
    const trail = [`vis=${document.visibilityState}`];
    // 「取消」の選び方を順に試し、一覧の件数が減ったらやめる（裏のタブでも通る方法を探すため、何をしたかを残す）
    const ways = [
      ["enter", (item) => {
        item.focus();
        item.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true }));
      }],
      ["click", (item) => item.click()],
      ["pointer", (item) => {
        const o = { bubbles: true, cancelable: true, button: 0, buttons: 1, pointerType: "mouse", isPrimary: true };
        item.dispatchEvent(new PointerEvent("pointermove", o));
        item.dispatchEvent(new PointerEvent("pointerdown", o));
        item.dispatchEvent(new MouseEvent("mousedown", o));
        item.dispatchEvent(new PointerEvent("pointerup", { ...o, buttons: 0 }));
        item.dispatchEvent(new MouseEvent("mouseup", { ...o, buttons: 0 }));
        item.dispatchEvent(new MouseEvent("click", { ...o, buttons: 0 }));
      }],
    ];
    for (const [name, act] of ways) {
      if (sbtn.getAttribute("aria-expanded") !== "true" && sbtn.parentElement?.getAttribute("aria-expanded") !== "true") {
        sbtn.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, button: 0, pointerType: "mouse", isPrimary: true }));
      }
      const item = await waitFor(() => [...document.querySelectorAll("[role=menuitem]")].find((i) => text(i) === "取消"), 5000);
      if (!item) {
        trail.push(`${name}:メニューが開かない`);
        continue;
      }
      act(item);
      const ok = await waitFor(gone, 6000, 300);
      trail.push(`${name}:${ok ? "減った" : "変わらず"}`);
      if (ok) break;
    }
    await sleep(1000);
    const after = (await waitList()) || [];
    const still = after.filter((r) => r.patientNo === patientNo && r.time === hhmm(time));
    if (still.length >= hits.length) return review(`取消にしたあとも一覧に残っています（${trail.join("、")}）`);
    return { result: "cancelled", note: trail.join("、") };
  }

  /**
   * 写したあと：その日の一覧に、患者番号・時刻の行がちょうど1件あるか。
   * 0件のときは not-found を返し、background.js がページを開き直して確かめ直す（開いたままのページの一覧は新しくならないため）
   */
  async function verify({ patientNo, time, memoLine }) {
    const rows = await waitList();
    if (rows === null) return listNotReady();
    const hits = rows.filter((r) => r.patientNo === patientNo && r.time === hhmm(time));
    if (hits.length === 0) return { result: "not-found" };
    if (hits.length !== 1) return review(`写したあと一覧で確かめられません（同じ時刻に${hits.length}件）`);
    const memoSame = hits[0].memo.replace(/\s+/g, "") === memoLine.replace(/\s+/g, "");
    return { result: "synced", ...(memoSame ? {} : { note: "受付メモがデジカルの表示と違います" }) };
  }

  // ページ自身の世界（MAIN）で動かす。拡張機能の別世界（isolated）から送った操作では、
  // ステータスのメニューの「取消」が選ばれなかったため（11/21 の試運転）。background.js が executeScript で呼ぶ
  let busy = false;
  globalThis.__laneM3Run = async (op, args) => {
    if (busy) return review("前の操作がまだ終わっていません");
    busy = true;
    try {
      if (args?.dedicated) wakeHiddenTab();
      const state = pageState();
      // 開いている受付一覧の日付が、操作する日と同じか（違う日の一覧を読んで判断しないため）
      if (state === "ok" && args?.pageDate) {
        const shown = await waitFor(() => {
          const b = [...document.querySelectorAll("button")].find((x) => visible(x) && /^\d{4}\/\d{2}\/\d{2}\s*\(.\)$/.test(text(x)));
          return b ? text(b).slice(0, 10) : null;
        }, 10000);
        if (shown !== slashDate(args.pageDate)) return review(`デジカルの受付一覧の日付が違います（画面 ${shown ?? "不明"}・予約 ${slashDate(args.pageDate)}）`);
      }
      if (op === "state") return { state };
      if (state !== "ok") return { result: "not-ready", state };
      const fn = { create, edit, cancel, verify, locateCancel, locateCancelItem, checkGone, registerPatient }[op];
      if (!fn) return review("知らない操作です");
      return await fn(args);
    } catch (e) {
      try {
        // 途中で止まったら、保存せずに閉じる（キャンセル）
        [...document.querySelectorAll("button")].filter((b) => visible(b) && text(b) === "キャンセル").pop()?.click();
        await sleep(500);
        closeSearchPanel();
      } catch {
        /* 閉じられなくても続けない */
      }
      return review(String(e?.message || e));
    } finally {
      busy = false;
    }
  };
})();

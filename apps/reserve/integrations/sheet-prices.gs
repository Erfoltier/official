/**
 * 「自費商品、メニュー外値段表」→ 予約カレンダーの料金表 へ値段を送る（Google Apps Script）
 *
 * 置き方：スプレッドシートの［拡張機能］→［Apps Script］にこのファイルの中身をすべて貼り付けて保存。
 * 初回だけ：
 *   1. ［プロジェクトの設定］→［スクリプト プロパティ］に次の4つを入れる（コードには書かない）
 *        RESERVE_URL   https://（ドメイン）/reserve/api/v1/integration/prices
 *        TOKEN         予約カレンダーの「設定 → 外部機器の連携 → Googleの問診票・同意書・料金表の鍵」で作った鍵（config.php の integration_token でも可）
 *        BASIC_USER    ロリポップのアクセス制限の ID
 *        BASIC_PASS    ロリポップのアクセス制限の パスワード
 *   2. 関数「setup」を1回実行（毎朝6時と、シートを変えたときに自動で送るようになる）
 * 以後はシートの値段を直すだけで、ソフトの料金表が入れ替わる。手動で送るときはメニュー［料金表］→［ソフトに送る］。
 *
 * 取り込む表（スタッフ用シートと旧価格の列は送らない）
 *   - ゼオなど値段：左列の内服・外用など（C列に改定後の値段があればそちら）
 *   - ゼオなど値段：右の「その他」（オゼンピック・マンジャロ・汗止めなど）
 *   - ゼオなど値段：下の「2026.4- 定価／約3％引き修正」の表の「約3％引き修正」（ゼオ単品）
 *   - 特殊メニュー：「税込｜回数｜備考」の表（「現行無」の行は除く）
 */

var SHEET_LABEL = "自費商品、メニュー外値段表";

function onOpen() {
  SpreadsheetApp.getUi().createMenu("料金表").addItem("ソフトに送る", "sendPrices").addToUi();
}

/** 自動で送るきっかけ（毎朝6時・シートの変更時）を作る。何度実行しても重複しない */
function setup() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === "sendPrices" || t.getHandlerFunction() === "onSheetChange") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("sendPrices").timeBased().everyDays(1).atHour(6).create();
  ScriptApp.newTrigger("onSheetChange").forSpreadsheet(SpreadsheetApp.getActive()).onChange().create();
  ScriptApp.newTrigger("onSheetChange").forSpreadsheet(SpreadsheetApp.getActive()).onEdit().create();
  sendPrices();
}

/** 編集のたびに送らないよう、最後の変更から1分待ってから送る */
function onSheetChange() {
  var props = PropertiesService.getScriptProperties();
  props.setProperty("CHANGED_AT", String(Date.now()));
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === "sendIfQuiet") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("sendIfQuiet").timeBased().after(60 * 1000).create();
}

function sendIfQuiet() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === "sendIfQuiet") ScriptApp.deleteTrigger(t);
  });
  var at = Number(PropertiesService.getScriptProperties().getProperty("CHANGED_AT") || 0);
  if (Date.now() - at < 55 * 1000) return onSheetChange();
  sendPrices();
}

function sendPrices() {
  var props = PropertiesService.getScriptProperties();
  var url = props.getProperty("RESERVE_URL");
  var token = props.getProperty("TOKEN");
  if (!url || !token) throw new Error("スクリプト プロパティ RESERVE_URL と TOKEN を設定してください");
  var ss = SpreadsheetApp.getActive();
  var main = ss.getSheetByName("ゼオなど値段");
  var special = ss.getSheetByName("特殊メニュー");
  var items = collectPrices(main ? main.getDataRange().getValues() : [], special ? special.getDataRange().getValues() : []);
  if (items.length === 0) throw new Error("料金が1件も見つかりませんでした。シートの形が変わっていないか確認してください");
  var headers = { "X-Integration-Token": token };
  var user = props.getProperty("BASIC_USER");
  if (user) headers.Authorization = "Basic " + Utilities.base64Encode(user + ":" + (props.getProperty("BASIC_PASS") || ""));
  var res = UrlFetchApp.fetch(url, {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify({ sheet: SHEET_LABEL, items: items }),
    headers: headers,
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() !== 200) throw new Error("送れませんでした（" + res.getResponseCode() + "）：" + res.getContentText().slice(0, 200));
  console.log("送りました：" + items.length + "件");
}

// ---- ここから下は表の読み取り（シートの形が変わったらここを直す） ----

/** 数字だけ取り出す（"5200(定価は5832円)" → 5200）。数字がなければ null */
function toYen(v) {
  if (typeof v === "number") return isFinite(v) ? Math.round(v) : null;
  var m = String(v === null || v === undefined ? "" : v)
    .replace(/[,，\s]/g, "")
    .replace(/[０-９]/g, function (c) {
      return String.fromCharCode(c.charCodeAt(0) - 0xfee0);
    })
    .match(/^(\d+)/);
  return m ? Number(m[1]) : null;
}

function clean(v) {
  return String(v === null || v === undefined ? "" : v)
    .replace(/[\s　]+/g, " ")
    .trim();
}

function yenText(n) {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",") + "円";
}

/**
 * @param main    「ゼオなど値段」シートの値（2次元配列）
 * @param special 「特殊メニュー」シートの値（2次元配列）
 */
function collectPrices(main, special) {
  var items = [];
  var seen = {};
  function add(category, name, price, note) {
    name = clean(name);
    if (!name || price === null) return;
    var key = category + "\n" + name;
    if (seen[key]) return;
    seen[key] = true;
    var item = { category: category, name: name, priceYen: price };
    note = clean(note).replace(/^[。、・,，\s]+/, "");
    if (note) item.priceText = yenText(price) + "（" + note + "）";
    items.push(item);
  }
  function cell(rows, r, c) {
    return rows[r] && rows[r][c] !== undefined ? rows[r][c] : "";
  }

  // 「～ゼオセット内容～」より上が単品の一覧
  var setRow = main.length;
  for (var i = 0; i < main.length; i++) {
    if (clean(cell(main, i, 0)).indexOf("ゼオセット") >= 0) {
      setRow = i;
      break;
    }
  }
  // 左列：A=名前、B=値段（税込）、C=改定後の値段（あればこちら）、D=メモ
  for (var r = 0; r < setRow; r++) {
    var revised = toYen(cell(main, r, 2));
    var base = toYen(cell(main, r, 1));
    add("内服・外用など", cell(main, r, 0), revised !== null ? revised : base, "");
  }
  // 右の「その他」：M=名前、N=値段、O=メモ
  for (var r2 = 0; r2 < setRow; r2++) {
    add("その他", cell(main, r2, 12), toYen(cell(main, r2, 13)), cell(main, r2, 14));
  }
  // ゼオ単品：D列が「約3％引き修正」の見出し行より下。B=名前、D=値段、A=区分（限定入荷品など）
  var zeoHead = -1;
  for (var z = 0; z < main.length; z++) {
    if (clean(cell(main, z, 3)).indexOf("3％引き") >= 0 || clean(cell(main, z, 3)).indexOf("3%引き") >= 0) {
      zeoHead = z;
      break;
    }
  }
  if (zeoHead >= 0) {
    for (var r3 = zeoHead + 1; r3 < main.length; r3++) {
      var group = clean(cell(main, r3, 0));
      add(group ? "ゼオスキンヘルス（" + group + "）" : "ゼオスキンヘルス", cell(main, r3, 1), toYen(cell(main, r3, 3)), "");
    }
  }
  // 特殊メニュー：「税込｜回数｜備考」の見出し行より下。B=名前、C=値段、D=回数、E=備考
  var head = -1;
  for (var s = 0; s < special.length; s++) {
    if (clean(cell(special, s, 2)) === "税込" && clean(cell(special, s, 3)) === "回数") {
      head = s;
      break;
    }
  }
  if (head >= 0) {
    for (var r4 = head + 1; r4 < special.length; r4++) {
      if (clean(cell(special, r4, 4)) === "税込") break; // 下の別の表（リトゥオ等はホームページにある）
      if (clean(cell(special, r4, 0)) === "現行無") continue;
      var name = clean(cell(special, r4, 1));
      var count = toYen(cell(special, r4, 3));
      if (name && count !== null && count > 1 && name.indexOf("回") < 0 && name.indexOf("セット") < 0) name += " " + count + "回";
      add("特殊メニュー", name, toYen(cell(special, r4, 2)), cell(special, r4, 4));
    }
  }
  return items;
}

// Node.js でのテスト用（Apps Script では使われない）
if (typeof module !== "undefined") module.exports = { collectPrices: collectPrices, toYen: toYen };

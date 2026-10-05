/**
 * 標準書式のスプレッドシート（料金表・自費商品）→ 予約カレンダー（Google Apps Script）
 *
 * 他院向けの汎用版。予約カレンダーの「設定 → 取り込み」の「書式のひな形」と同じ形の表を、
 * 直すたび（と毎朝）に自動で送る。送った分は「取り込み：（名前）」として、前回の分とまるごと入れ替わる。
 * （いしだ皮フ科の「自費商品、メニュー外値段表」は形が違うので sheet-prices.gs を使う）
 *
 * 表の形（1行目が見出し。列の順番は自由。見出しの言葉で見分ける）
 *   料金表   ： 種類（施術／商品）・分類・項目名・料金（税込）・表示（任意）
 *   自費商品 ： 分類・商品名・料金（税込）・表示（任意）     ← 種類の列がなければ DEFAULT_KIND に従う
 *   ・分類が空の行は、上の行と同じ分類
 *   ・値段が1つに決まらないものは料金を空にして、表示に「要相談」「5,500円〜」などと書く
 *
 * 置き方：スプレッドシートの［拡張機能］→［Apps Script］に、このファイルの中身をすべて貼り付けて保存。
 * ［プロジェクトの設定］→［スクリプト プロパティ］に次を入れて、関数「setup」を1回実行する（許可を求められたら許可）。
 *   RESERVE_URL   https://（ドメイン）/reserve/api/v1/integration/prices
 *   TOKEN         config.php の integration_token の値
 *   LABEL         取り込みの名前（例：自費商品）。予約カレンダーの料金表の見出しになる。省くとスプレッドシートの名前
 *   DEFAULT_KIND  種類の列がないときの種類：「商品」か「施術」。省くと分類の言葉で見分ける（商品・スキンケア・内服・外用など → 商品）
 *   SHEET_NAME    読むシートの名前（省くといちばん左のシート）
 *   BASIC_USER / BASIC_PASS   入口の鍵（Basic認証）を掛けている場合のID・パスワード
 *
 * 送るのは料金表だけ。患者の情報はやりとりしない。
 */

var WORDS = {
  kind: /^種類/,
  category: /分類|カテゴリ|区分/,
  name: /項目|商品名|施術名|メニュー|^名前$/,
  price: /料金|値段|価格/,
  text: /表示|備考/,
};
var PRODUCT_CATEGORY = /外用|内服|スキンケア|サプリ|ゼオ|化粧品|商品|物販/;

function setup() {
  var ss = SpreadsheetApp.getActive();
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === "sendPrices") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("sendPrices").forSpreadsheet(ss).onChange().create();
  ScriptApp.newTrigger("sendPrices").timeBased().everyDays(1).atHour(6).nearMinute(20).create();
  sendPrices();
}

function sendPrices() {
  var props = PropertiesService.getScriptProperties();
  var url = props.getProperty("RESERVE_URL");
  var token = props.getProperty("TOKEN");
  if (!url || !token) throw new Error("スクリプト プロパティ RESERVE_URL と TOKEN を設定してください");
  var ss = SpreadsheetApp.getActive();
  var sheetName = props.getProperty("SHEET_NAME");
  var sheet = sheetName ? ss.getSheetByName(sheetName) : ss.getSheets()[0];
  if (!sheet) throw new Error("シート「" + sheetName + "」が見つかりません");
  var defaultKind = kindOf(props.getProperty("DEFAULT_KIND") || "");
  var items = collectStandard(sheet.getDataRange().getDisplayValues(), defaultKind === undefined ? null : defaultKind);
  if (items.length === 0) throw new Error("料金が1件も見つかりませんでした。1行目の見出し（分類・項目名・料金）を確かめてください");
  var label = (props.getProperty("LABEL") || ss.getName()).trim().slice(0, 50);
  var headers = { "X-Integration-Token": token };
  var user = props.getProperty("BASIC_USER");
  if (user) headers.Authorization = "Basic " + Utilities.base64Encode(user + ":" + (props.getProperty("BASIC_PASS") || ""));
  var res = UrlFetchApp.fetch(url, {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify({ sheet: "取り込み：" + label, items: items }),
    headers: headers,
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() !== 200) throw new Error("送れませんでした（" + res.getResponseCode() + "）：" + res.getContentText().slice(0, 200));
  console.log("送りました：" + items.length + "件");
}

// ---- ここから下は表の読み取り（予約カレンダーの「取り込み」と同じ決まり） ----

/** 種類の欄の言葉 → "product" / "treatment"。空は null、読めなければ undefined */
function kindOf(word) {
  var w = String(word || "").trim();
  if (!w) return null;
  if (/商品|物販|スキンケア|内服|外用|化粧品|サプリ/.test(w)) return "product";
  if (/施術|治療|メニュー|処置|手術/.test(w)) return "treatment";
  return undefined;
}

/** "5,500" "¥5500" "5500円" → 5500。空は null、読めなければ undefined */
function toYen(s) {
  var t = String(s || "")
    .replace(/[０-９]/g, function (c) {
      return String.fromCharCode(c.charCodeAt(0) - 0xfee0);
    })
    .replace(/[,，円¥￥\s]/g, "");
  if (t === "") return null;
  return /^-?\d{1,8}$/.test(t) ? Number(t) : undefined;
}

function collectStandard(values, defaultKind) {
  var head = -1;
  var cols = {};
  for (var r = 0; r < Math.min(values.length, 10) && head < 0; r++) {
    var found = {};
    var hit = 0;
    for (var k in WORDS) {
      found[k] = -1;
      for (var c = 0; c < values[r].length; c++) {
        if (WORDS[k].test(String(values[r][c]).replace(/\s/g, ""))) {
          found[k] = c;
          hit++;
          break;
        }
      }
    }
    if (hit >= 2 && found.name >= 0) {
      head = r;
      cols = found;
    }
  }
  if (head < 0) return [];
  var cell = function (row, i) {
    return i >= 0 ? String(row[i] === undefined ? "" : row[i]).trim() : "";
  };
  var out = [];
  var category = "";
  for (var i = head + 1; i < values.length; i++) {
    var row = values[i];
    category = cell(row, cols.category) || category;
    var name = cell(row, cols.name);
    if (!name) continue;
    var price = toYen(cell(row, cols.price));
    var kind = kindOf(cell(row, cols.kind));
    if (price === undefined || kind === undefined) {
      console.log((i + 1) + "行目は飛ばしました（料金か種類が読めません）：" + name);
      continue;
    }
    if (kind === null) kind = defaultKind || (PRODUCT_CATEGORY.test(category) ? "product" : "treatment");
    var item = { category: (category || "その他").slice(0, 100), name: name.slice(0, 200), priceYen: price, kind: kind };
    var text = cell(row, cols.text);
    if (text) item.priceText = text.slice(0, 100);
    out.push(item);
  }
  return out;
}

// Node.js でのテスト用（Apps Script では使われない）
if (typeof module !== "undefined") module.exports = { collectStandard: collectStandard, kindOf: kindOf, toYen: toYen };

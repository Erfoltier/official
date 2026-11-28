/**
 * 「予約枠時間一覧」→ LANE RESERVE の日曜の予約（レーザー脱毛の部位ごとの時間）へ送る（Google Apps Script）
 *
 * 置き方：スプレッドシート「予約枠時間一覧」の［拡張機能］→［Apps Script］にこのファイルの中身をすべて貼り付けて保存。
 * 初回だけ：
 *   1. ［プロジェクトの設定］→［スクリプト プロパティ］に次を入れる（コードには書かない）
 *        RESERVE_URL   https://（LANE RESERVE のドメイン）/api/v1/integration/time-sheet
 *        TOKEN         LANE RESERVE の「設定 → 外部機器の連携 → Google 連携の接続キー」で発行した鍵（料金表と同じ鍵でよい）
 *        BASIC_USER    （ブラウザで開くときに ID・パスワードを求められる場合だけ）その ID
 *        BASIC_PASS    （同上）そのパスワード
 *   2. 関数「setup」を1回実行（シートを直したときと毎朝6時に、自動で送るようになる）
 * 以後はシートの時間を直すだけで、日曜の予約のレーザー脱毛の時間が入れ替わる。手動で送るときはメニュー［予約の時間］→［予約アプリに送る］。
 *
 * 送るもの：「シート1」の表示中の値（時間の表だけ。患者の情報は扱わない）。
 *
 * 読むもの（院長 11/28）：予約アプリにまとめた予約のルールを、このスプレッドシートの「LANE RESERVE｜…」のシートに書き出す
 * （毎朝6時台と、メニュー［予約の時間］→［予約のルールを読み込む］。シートは毎回まるごと書き直すので、そこには書き込まないでください）。
 * 予約アプリは A列・B列の「男」「女」の下の 部位 → 分 と「初診説明」を読む。「鼻下+顎」などのまとめの行は、その部位をまとめて選んだときの時間になる。
 */

var SHEET_NAME = "シート1";

function onOpen() {
  SpreadsheetApp.getUi().createMenu("予約の時間").addItem("予約アプリに送る", "sendTimes").addItem("予約のルールを読み込む", "pullRules").addToUi();
}

/** 自動で送るきっかけ（毎朝6時・シートの変更時）を作る。何度実行しても重複しない */
function setup() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    var f = t.getHandlerFunction();
    if (f === "sendTimes" || f === "onSheetChange" || f === "sendIfQuiet" || f === "pullRules") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("sendTimes").timeBased().everyDays(1).atHour(6).create();
  ScriptApp.newTrigger("pullRules").timeBased().everyDays(1).atHour(6).nearMinute(30).create();
  ScriptApp.newTrigger("onSheetChange").forSpreadsheet(SpreadsheetApp.getActive()).onChange().create();
  ScriptApp.newTrigger("onSheetChange").forSpreadsheet(SpreadsheetApp.getActive()).onEdit().create();
  sendTimes();
  pullRules();
}

/** 編集のたびに送らないよう、最後の変更から1分待ってから送る */
function onSheetChange() {
  PropertiesService.getScriptProperties().setProperty("CHANGED_AT", String(Date.now()));
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
  sendTimes();
}

function sendTimes() {
  var props = PropertiesService.getScriptProperties();
  var url = props.getProperty("RESERVE_URL");
  var token = props.getProperty("TOKEN");
  if (!url || !token) throw new Error("スクリプト プロパティ RESERVE_URL と TOKEN を設定してください");
  var sheet = SpreadsheetApp.getActive().getSheetByName(SHEET_NAME);
  if (!sheet) throw new Error("シート「" + SHEET_NAME + "」が見つかりません");
  var last = Math.min(sheet.getLastRow(), 300);
  var rows = sheet.getRange(1, 1, last, Math.min(sheet.getLastColumn(), 20)).getDisplayValues();
  var headers = { "X-Integration-Token": token };
  var user = props.getProperty("BASIC_USER");
  if (user) headers.Authorization = "Basic " + Utilities.base64Encode(user + ":" + (props.getProperty("BASIC_PASS") || ""));
  var res = UrlFetchApp.fetch(url, {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify({ rows: rows }),
    headers: headers,
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() !== 200) throw new Error("送れませんでした（" + res.getResponseCode() + "）：" + res.getContentText().slice(0, 200));
  console.log("送りました：" + res.getContentText());
}

/** 予約アプリの予約のルールを「LANE RESERVE｜…」のシートに書き出す（患者の情報は来ない） */
function pullRules() {
  var props = PropertiesService.getScriptProperties();
  var url = props.getProperty("RESERVE_URL");
  var token = props.getProperty("TOKEN");
  if (!url || !token) throw new Error("スクリプト プロパティ RESERVE_URL と TOKEN を設定してください");
  var headers = { "X-Integration-Token": token };
  var user = props.getProperty("BASIC_USER");
  if (user) headers.Authorization = "Basic " + Utilities.base64Encode(user + ":" + (props.getProperty("BASIC_PASS") || ""));
  var res = UrlFetchApp.fetch(url.replace(/\/time-sheet\/?$/, "/rules"), { method: "get", headers: headers, muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) throw new Error("読み込めませんでした（" + res.getResponseCode() + "）：" + res.getContentText().slice(0, 200));
  var data = JSON.parse(res.getContentText());
  var book = SpreadsheetApp.getActive();
  data.sheets.forEach(function (s) {
    var sheet = book.getSheetByName(s.name) || book.insertSheet(s.name);
    sheet.clear();
    var width = s.rows.reduce(function (w, r) { return Math.max(w, r.length); }, 1);
    var rows = s.rows.map(function (r) { var x = r.slice(); while (x.length < width) x.push(""); return x; });
    if (rows.length) sheet.getRange(1, 1, rows.length, width).setValues(rows).setWrap(true).setVerticalAlignment("top");
    sheet.getRange(1, 1, 1, width).setFontWeight("bold");
    sheet.setFrozenRows(1);
    sheet.getRange(rows.length + 2, 1).setValue("予約アプリから読み込んだ日時：" + new Date(data.at).toLocaleString("ja-JP") + "（このシートは毎回書き直されます。直したいときは院長から Claude へ）");
  });
  console.log("読み込みました：" + data.sheets.length + "シート");
}

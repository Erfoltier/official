/**
 * Googleフォームの問診票 → 予約カレンダー（Google Apps Script）
 *
 * 問診票の回答が入るスプレッドシート（フォームの「回答」→「スプレッドシートにリンク」で作られるもの）に置く。
 * 回答が届くたび（と1時間ごと）に、予約カレンダーへ送る。予約カレンダーは
 * 「氏名（またはフリガナ）＋生年月日か電話番号」が合う患者に結びつけ、カルテの「既往歴・内服歴」に出す。
 * 合う患者がいない回答は「設定 → 問診票」で診察券番号を入れて結びつける。
 *
 * 送るのは問診票の回答だけ。予約カレンダーの患者情報をGoogleへ送ることはない。
 * 同じ回答を何度送っても、予約カレンダーの側で二重には取り込まない。
 *
 * 置き方：
 *   1. 回答のスプレッドシートを開き、［拡張機能］→［Apps Script］に、このファイルの中身をすべて貼り付けて保存
 *   2. ［プロジェクトの設定］→［スクリプト プロパティ］に次を入れる（コードには書かない）
 *        RESERVE_URL   https://（ドメイン）/reserve/api/v1/integration/questionnaires
 *        TOKEN         予約カレンダーの「設定 → 外部機器の連携 → Googleの問診票・同意書・料金表の鍵」で作った鍵（config.php の integration_token でも可）
 *        BASIC_USER / BASIC_PASS   入口の鍵（Basic認証）を掛けている場合のID・パスワード
 *   3. 関数「setup」を1回実行して、許可を求められたら許可する（以後は自動）
 *
 * 列は見出しの言葉で見分ける（下の COLUMNS）。見出しを変えたときはここを直す。
 */

var COLUMNS = {
  submittedAt: /タイムスタンプ|timestamp|回答日時/i,
  name: /^(?!.*(フリガナ|ふりがな|カナ)).*(お名前|氏名|名前)/,
  kana: /フリガナ|ふりがな|カナ/,
  birthDate: /生年月日/,
  phone: /電話/,
  history: /既往|病歴|治療中の病気|かかっている病気/,
  medications: /内服|服用|飲んでいる薬|お薬/,
  allergies: /アレルギー/,
};

/** 何日前までの回答を送るか（毎回送っても二重にはならない。送る量を抑えるため） */
var DAYS = 60;

function setup() {
  var ss = SpreadsheetApp.getActive();
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === "sendQuestionnaires") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("sendQuestionnaires").forSpreadsheet(ss).onFormSubmit().create();
  ScriptApp.newTrigger("sendQuestionnaires").timeBased().everyHours(1).create();
  sendQuestionnaires();
}

function sendQuestionnaires() {
  var props = PropertiesService.getScriptProperties();
  var url = props.getProperty("RESERVE_URL");
  var token = props.getProperty("TOKEN");
  if (!url || !token) throw new Error("スクリプト プロパティ RESERVE_URL と TOKEN を設定してください");
  var sheet = SpreadsheetApp.getActive().getSheets()[0];
  var values = sheet.getDataRange().getValues();
  var responses = collectResponses(values, new Date(Date.now() - DAYS * 86400000), Session.getScriptTimeZone());
  var headers = { "X-Integration-Token": token };
  var user = props.getProperty("BASIC_USER");
  if (user) headers.Authorization = "Basic " + Utilities.base64Encode(user + ":" + (props.getProperty("BASIC_PASS") || ""));
  var total = { received: 0, matched: 0, unmatched: 0, duplicates: 0 };
  for (var i = 0; i < responses.length; i += 100) {
    var res = UrlFetchApp.fetch(url, {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify({ responses: responses.slice(i, i + 100) }),
      headers: headers,
      muteHttpExceptions: true,
    });
    if (res.getResponseCode() !== 200) throw new Error("送れませんでした（" + res.getResponseCode() + "）：" + res.getContentText().slice(0, 200));
    var r = JSON.parse(res.getContentText());
    for (var k in total) total[k] += r[k] || 0;
  }
  console.log("新しい回答 " + total.received + "件（結びついた " + total.matched + "件・要確認 " + total.unmatched + "件）");
}

// ---- ここから下は表の読み取り ----

function text(v, tz) {
  if (v instanceof Date) return Utilities.formatDate(v, tz, "yyyy/MM/dd HH:mm:ss");
  return String(v === null || v === undefined ? "" : v).trim();
}

/** "1990/1/2" "1990-01-02" "19900102" や日付の値 → "1990-01-02"。読めなければ空 */
function toDate(v, tz) {
  if (v instanceof Date) return Utilities.formatDate(v, tz, "yyyy-MM-dd");
  var s = String(v || "")
    .replace(/[０-９]/g, function (c) {
      return String.fromCharCode(c.charCodeAt(0) - 0xfee0);
    })
    .trim();
  var m = s.match(/^(\d{4})[\/\-年.](\d{1,2})[\/\-月.](\d{1,2})/) || s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (!m) return "";
  return m[1] + "-" + ("0" + m[2]).slice(-2) + "-" + ("0" + m[3]).slice(-2);
}

/** 見出しの行から、各項目が何列目かを探す */
function findColumns(header) {
  var cols = {};
  for (var key in COLUMNS) {
    for (var c = 0; c < header.length; c++) {
      if (COLUMNS[key].test(String(header[c]))) {
        cols[key] = c;
        break;
      }
    }
  }
  return cols;
}

/**
 * @param values シートの値（1行目が見出し）
 * @param since  この日時より前の回答は送らない
 */
function collectResponses(values, since, tz) {
  if (values.length < 2) return [];
  var header = values[0].map(function (h) {
    return String(h).trim();
  });
  var cols = findColumns(header);
  var out = [];
  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    var ts = cols.submittedAt !== undefined ? row[cols.submittedAt] : "";
    if (ts instanceof Date && ts < since) continue;
    var get = function (k) {
      return cols[k] !== undefined ? text(row[cols[k]], tz) : "";
    };
    var name = get("name");
    if (!name && !get("kana")) continue;
    var answers = [];
    for (var c = 0; c < header.length; c++) {
      if (c === cols.submittedAt) continue;
      var a = text(row[c], tz);
      if (a) answers.push({ q: header[c].slice(0, 200), a: a.slice(0, 2000) });
    }
    var submittedAt = text(ts, tz);
    var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, submittedAt + "\n" + name + "\n" + get("phone"));
    var key = digest
      .map(function (b) {
        return ("0" + (b & 0xff).toString(16)).slice(-2);
      })
      .join("")
      .slice(0, 40);
    var item = { key: key, submittedAt: submittedAt, name: name.slice(0, 60), answers: answers.slice(0, 80) };
    var kana = get("kana");
    if (kana) item.kana = kana.slice(0, 60);
    var birth = cols.birthDate !== undefined ? toDate(row[cols.birthDate], tz) : "";
    if (birth) item.birthDate = birth;
    var phone = get("phone");
    if (phone) item.phone = phone.slice(0, 30);
    ["history", "medications", "allergies"].forEach(function (k) {
      var v = get(k);
      if (v) item[k] = v.slice(0, 2000);
    });
    out.push(item);
  }
  return out;
}

// Node.js でのテスト用（Apps Script では使われない）
if (typeof module !== "undefined") module.exports = { collectResponses: collectResponses, toDate: toDate, findColumns: findColumns };

/**
 * Google ドライブの同意書フォルダ ⇄ 予約カレンダーの同意書（Google Apps Script）
 *
 * 予約カレンダーは、同意書を開く・発行するたびに、このウェブアプリからドライブの最新の文書を読み込む。
 * ドライブで文面を直せば、次に開いたときからその文面で印刷される（発行済みの控えは発行時の文面のまま）。
 *
 * 置き方：https://script.google.com で［新しいプロジェクト］を作り、このファイルの中身をすべて貼り付けて保存。
 * 初回だけ：
 *   1. ［プロジェクトの設定］→［スクリプト プロパティ］に次を入れる（コードには書かない）
 *        FOLDER_ID     同意書フォルダのID（「同意書、承諾書、問診票」なら 1hMre7okfwmnWkIfYZ5gxWg9fNPeu7CwV）
 *        KEY           合言葉（長めの英数字。予約カレンダーの設定にも同じものを入れる）
 *   2. ［デプロイ］→［新しいデプロイ］→ 種類「ウェブアプリ」、実行するユーザー「自分」、アクセスできるユーザー「全員」でデプロイし、
 *      出てきた URL（https://script.google.com/macros/s/…/exec）を、予約カレンダーの「設定 → 同意書 → 読み込み元」に KEY と一緒に入れる。
 *      （合言葉を知らない人には何も返さない。患者の情報はやりとりしない）
 *
 * 予備：ウェブアプリが止まっていても使えるよう、毎朝ソフトへ送っておく場合は、さらに次を入れて「setup」を1回実行する。
 *        RESERVE_URL   https://（ドメイン）/reserve/api/v1/integration/consent-templates
 *        TOKEN         予約カレンダーの「設定 → 外部機器の連携 → Googleの問診票・同意書・料金表の鍵」で作った鍵（config.php の integration_token でも可）
 *        BASIC_USER / BASIC_PASS   ロリポップのアクセス制限の ID・パスワード
 *
 * 送るのは Google ドキュメントだけ（Word・PDF は送らない。使うときは Google ドキュメントに変換してフォルダに置く）。
 * 患者の情報はこちらからは何も送らない・受け取らない（ひな形の文面だけを送る）。
 */

/** ウェブアプリ：?key=合言葉&action=list で一覧、&action=doc&id=ファイルID で本文 */
function doGet(e) {
  var p = (e && e.parameter) || {};
  var props = PropertiesService.getScriptProperties();
  var out = function (obj) {
    return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
  };
  if (!props.getProperty("KEY") || p.key !== props.getProperty("KEY")) return out({ error: "forbidden" });
  var folder = DriveApp.getFolderById(props.getProperty("FOLDER_ID"));
  if (p.action === "list") {
    var list = [];
    var files = folder.getFilesByType(MimeType.GOOGLE_DOCS);
    while (files.hasNext()) {
      var f = files.next();
      if (!f.isTrashed()) list.push({ driveId: f.getId(), title: f.getName().slice(0, 200), modifiedTime: f.getLastUpdated().toISOString() });
    }
    return out(list);
  }
  if (p.action === "doc" && p.id) {
    var file = DriveApp.getFileById(p.id);
    // このフォルダの Google ドキュメントだけを返す
    var inFolder = false;
    var parents = file.getParents();
    while (parents.hasNext()) if (parents.next().getId() === folder.getId()) inFolder = true;
    if (!inFolder || file.getMimeType() !== MimeType.GOOGLE_DOCS || file.isTrashed()) return out({ error: "not found" });
    return out({ driveId: file.getId(), title: file.getName().slice(0, 200), modifiedTime: file.getLastUpdated().toISOString(), html: exportHtml(file.getId()) });
  }
  return out({ error: "bad request" });
}

/** Google ドキュメントを HTML にする（画像は外す。ソフト側でも画像は使わない） */
function exportHtml(id) {
  var res = UrlFetchApp.fetch("https://www.googleapis.com/drive/v3/files/" + id + "/export?mimeType=text%2Fhtml", {
    headers: { Authorization: "Bearer " + ScriptApp.getOAuthToken() },
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() !== 200) throw new Error("書き出せませんでした：" + id);
  return res.getContentText("UTF-8").replace(/<img\b[^>]*>/gi, "").slice(0, 400000);
}

function setup() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === "sendConsentTemplates") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("sendConsentTemplates").timeBased().everyDays(1).atHour(6).nearMinute(10).create();
  sendConsentTemplates();
}

function sendConsentTemplates() {
  var props = PropertiesService.getScriptProperties();
  var url = props.getProperty("RESERVE_URL");
  var token = props.getProperty("TOKEN");
  var folderId = props.getProperty("FOLDER_ID");
  if (!url || !token || !folderId) throw new Error("スクリプト プロパティ RESERVE_URL・TOKEN・FOLDER_ID を設定してください");

  var folder = DriveApp.getFolderById(folderId);
  var files = folder.getFilesByType(MimeType.GOOGLE_DOCS);
  var templates = [];
  var skipped = [];
  while (files.hasNext()) {
    var f = files.next();
    if (f.isTrashed()) continue;
    var res = UrlFetchApp.fetch("https://www.googleapis.com/drive/v3/files/" + f.getId() + "/export?mimeType=text%2Fhtml", {
      headers: { Authorization: "Bearer " + ScriptApp.getOAuthToken() },
      muteHttpExceptions: true,
    });
    if (res.getResponseCode() !== 200) {
      skipped.push(f.getName());
      continue;
    }
    var html = res.getContentText("UTF-8");
    if (html.length > 400000) {
      // 画像が多い文書は大きくなるので、画像を外して送る（ソフト側でも画像は使わない）
      html = html.replace(/<img\b[^>]*>/gi, "");
    }
    if (html.length > 400000) {
      skipped.push(f.getName() + "（大きすぎる）");
      continue;
    }
    templates.push({
      driveId: f.getId(),
      title: f.getName().slice(0, 200),
      modifiedTime: f.getLastUpdated().toISOString(),
      html: html,
    });
  }

  var headers = { "X-Integration-Token": token };
  var user = props.getProperty("BASIC_USER");
  if (user) headers.Authorization = "Basic " + Utilities.base64Encode(user + ":" + (props.getProperty("BASIC_PASS") || ""));
  var post = UrlFetchApp.fetch(url, {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify({ templates: templates }),
    headers: headers,
    muteHttpExceptions: true,
  });
  if (post.getResponseCode() !== 200) throw new Error("送れませんでした（" + post.getResponseCode() + "）：" + post.getContentText().slice(0, 200));
  console.log("送りました：" + templates.length + "件" + (skipped.length ? "／送れなかったもの：" + skipped.join("、") : ""));
}

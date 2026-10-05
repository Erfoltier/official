/**
 * Google ドライブの同意書フォルダ → 予約カレンダーの同意書ひな形 へ送る（Google Apps Script）
 *
 * 置き方：https://script.google.com で［新しいプロジェクト］を作り、このファイルの中身をすべて貼り付けて保存。
 * 初回だけ：
 *   1. ［プロジェクトの設定］→［スクリプト プロパティ］に次を入れる（コードには書かない）
 *        RESERVE_URL   https://（ドメイン）/reserve/api/v1/integration/consent-templates
 *        TOKEN         config.php の integration_token の値
 *        BASIC_USER    ロリポップのアクセス制限の ID
 *        BASIC_PASS    ロリポップのアクセス制限の パスワード
 *        FOLDER_ID     同意書フォルダのID（「同意書、承諾書、問診票」なら 1hMre7okfwmnWkIfYZ5gxWg9fNPeu7CwV）
 *   2. 関数「setup」を1回実行（Google の確認画面で許可する。以後、毎朝6時10分に自動で送る）
 * 文面を直したら、関数「sendConsentTemplates」を実行するとすぐ反映される（実行しなくても翌朝に反映）。
 *
 * 送るのは Google ドキュメントだけ（Word・PDF は送らない。使うときは Google ドキュメントに変換してフォルダに置く）。
 * 患者の情報はこちらからは何も送らない・受け取らない（ひな形の文面だけを送る）。
 */

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

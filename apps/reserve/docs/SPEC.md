# LANE RESERVE 仕様と約束事（いしだ皮フ科／美容皮膚科）

直すとき・足すときは、まずこの文書を読む。仕様を変えたら、同じコミットでこの文書も直す。
経緯と院長の決定は [HISTORY.md](HISTORY.md)、今の状態と残りの作業は [STATUS.md](STATUS.md)。
販売向けの設計の構想は [saas-plan.md](saas-plan.md)（こちらは「今どう動いているか」の記録）。

## 0. 構造の約束（煩雑にしないために）

### 10/29 A39複数悩み初診の限定候補（未配備）

固定試験太郎の別申請 `R20261029LaneA39I0106Main1300`、2027-01-06、`menu-x017`（初診 その他（お悩み2種類以上））医師main30分。ニキビ＋ニキビ跡の両方を明示し、初診・当日施術希望あり・顔の診察だけを対象とする。13:00〜13:30版1→14:00〜14:30版2→取消版3に限定し、別施術枠を推測しない。カタログのfixed30/default30/mainを完全照合し、最大120秒承認・本人・所有者・m3証拠・DB排他・通知抑止・backup/復元を維持。既存M11/M12/A36の完了済み申請は再利用しない。

### 10/29 A36完全初診の限定実装（一巡完了）

既存安全APIとRPAの同じ一巡機構へ、固定試験太郎の別申請 `R20261029LaneA36I0106Main1300`、2027-01-06、`menu-s0000BB7B7`・完全初診・医師main20分の診察だけを追加。登録13:00〜13:20（版1）→14:00〜14:20（版2）→取消（版3）だけ。カタログはrange10〜360/step5、default10、main/1/3を全文照合するが、試験はmain20分だけに限定し、他レーン・任意時間・別施術を許可しない。本人/所有者/原文/期限/m3新鮮証拠・DBロック内占有・通知抑止・独立読戻し・操作ごとのbackup/一時設定/復元を維持。配布policyは無効。M11/M12の完了済み申請を再利用しない。

### 10/29 M12-Rの限定実装（実機は修正介入あり）

既存安全APIに固定試験太郎の別申請 `R20261029LaneM12R0106Main1300`、2027-01-06、`menu-x103`・医師main15分を追加。登録13:00〜13:15（版1）→14:00〜14:15（版2）→取消（版3）だけを許可する。現行メニューのrange 5〜60/step5、default15、mainのみを全文照合し、カタログの可変時間から任意の時間を許可しない。M11と同様にDBロック内占有・本人・所有者・原文・期限・m3証拠を照合し、一般保守と患者自動通知を抑止する。配布policyは元値と無効を保持し、操作ごとのbackup・一時設定・復元と独立読戻しを必須とする。M11とM12の申請・版・メニュー・15/10分の証拠を混用しない。

### 10/28 M11-Rの1月への日時変更（本番未反映）

既存 `LaneBookingSafety` / `LaneMutationSafety` に、試験太郎の固定申請 `R20261028LaneM11R0106Main1300`・2027-01-06・医師main・`menu-x021`（再診 色素レーザー）10分の限定分岐を1月用の新revisionへ更新。12/30の旧申請は登録前に空きなしで停止し、再実行しない。登録は13:00〜13:10、変更は版1から14:00〜14:10の版2、取消はその版2から版3だけ。最大120秒の操作承認、DBロック内再照合、受付証拠・原文メモ・通知抑止・不明結果の再送禁止を維持する。登録時は花子と同じ保守抑止を利用し、一般患者や初期データに触れない。

設定復元後の読取りは、固定本人/申請/メニューと上記3状態だけに限定し、既存の資格情報所有者照合を維持する。読取り対応は書込みの再有効化ではない。配布する予約policyは従来値、変更/患者policyは無効のまま。ローカル試験の成功だけでは配備・有効化・通常運用を許可しない。

- **1つの仕事に、仕組みは1つ。** 同じことをする口を2つ作らない。作り直したら古い方は消す
  - 例：リマインドの送信はサーバー内の `Reminder` だけ。外部の送信プログラム用の口（`integration/reminders` の一覧・書き戻し・実行）は使われておらず二重だったため 2026-10-21 に削除
- **裏側（API・保存・照合などの処理）は PHP だけ。** 画面（TypeScript）には表示と入力の補助だけを置き、同じ処理を TypeScript でもう一度書かない（2026-10-26 に、使われていなかった TypeScript 側の検証・料金表の読み取り・初期データ・ロリポップ用の一式を削除）
- 処理の本体は `php/lib/<担当>.php` に置く。`php/api/index.php` は経路と権限の確認だけで、処理を書かない
- 本番データを一括で直す作業は `php/tools/<名前>.php`（何度流しても同じ結果になる作り。件数だけを出し、患者情報は出さない）
- 画面は `src/components/<画面>/`、API の呼び出しは `src/components/calendar/api.ts` に集める
- テストは `src/lib/__tests__/`（`withPhp` で本物の PHP を起動して API を叩く）。直したら `npx vitest run` が全部通ること
- 実在の患者情報・鍵・パスワードは、ログ・テスト・コミット・画面のどこにも出さない

## 1. 動かしている場所

| 項目 | 内容 |
|---|---|
| サーバー | AWS EC2 `i-080e478ee9bffc889`（東京、Amazon Linux 2023、Apache、PHP 8.3、SQLite） |
| 予約画面 | `https://reserve.ishidahihuka.jp/`（Basic認証＋スタッフPIN） |
| 問診票 | `https://monshin.ishidahihuka.jp/`（LINE の Webhook・LIFF もここ）。LINE 以外（メールのリンクなど）からはトップの `index.php` の入力画面。送れなかったときは、上と送信ボタンのすぐ上の両方に直す所を出し、理由を Apache の error_log に `monshin-diag`（入力の中身は残さず、どの質問が空か・どこで止まったかだけ。PHP-FPM の `/var/log/php-fpm/www-error.log`）で残す。Referrer-Policy は same-origin（no-referrer だと Safari が送り元を null にして送れなくなる） |
| プログラム | `/srv/reserve/releases/<コミット>/app`、`/srv/reserve/app` がその時の版へのリンク |
| 設定 | `/srv/reserve/private/config.php`（暗号鍵・連携トークンなど。リポジトリに入れない） |
| データ | `/srv/reserve/private/data/reserve.db`、バックアップは同じ場所の `backups/` |
| 定期実行 | systemd `reserve-reminders.timer`（10分ごと）→ `php/cron/reminders.php`（apache ユーザー）。リマインド（Air の取り込みは 10/22 に終了） |
| 入口 | Apache（`/etc/httpd/conf.d/20-ishida-https.conf`）。Basic認証 `/etc/httpd/ishida.htpasswd`。Basic認証を省くのは、連携API（合言葉の見出しつき）・自動予約の入口・`GET /integrations/line-chat-privacy.html`（Chrome ウェブストアの審査用。10/27 追加）だけ。証明書は certbot（自動更新） |
| 控え | 反映・データ操作ごと：`/srv/reserve/private/data/backups/`（新しい40件）。毎日：AWS Backup `ishida-daily`（3時ごろ、サーバー丸ごとのスナップショット） |
| S3 | `ishida-deploy-…`（反映する一式）・`ishida-audit-logs-…`・`ishida-ops-logs-…`・`ishida-web-backup-…` |
| PHP の拡張 | pdo_sqlite・openssl・curl・gd（gd は 10/27 に追加。LINE の画像の指紋に使う） |
| 操作の入口 | AWS SSM（AWS-RunShellScript）。SSH は閉じている。IAM：Claude Code は claude-ops、ChatGPT／Codex は chatgpt-ops |
| 旧ロリポップ | 予約システム・データは削除済み（10/16）。残るのは ishidahihuka.jp/reserve/ → reserve.ishidahihuka.jp の転送、ホームページ（WordPress）、メール（SMTP 送信に使う）、ネオボワール配布用スクリプト |

### 反映（デプロイ）の手順

**だれが反映しても（Claude Code・Codex・人）、必ずサーバーの `release` を使う。予約データの控えを取れなければ反映されない。**

1. テストを通し、`claude/admiring-wozniak-kikcrr` にコミット・プッシュ
2. `php php/tools/check-fixed-trial-package.php` で固定試験拡張6ファイル・API経路・無効設定を確認する。一式（静的書き出し＋PHP）を固め、別の一時ディレクトリに展開した `app/tools/check-fixed-trial-package.php` でも同じチェックを通してから、S3 `ishida-deploy-965825500741` に `app-<コミット>.tgz` で置く。実機試験中の有効policy・承認・鍵を配布へコピーしない
3. サーバーで `sudo /srv/reserve/bin/release <コミット> <claude か codex>`（SSM の AWS-RunShellScript から）
   - 中身：控え（`backup before-<コミット>`）→ 展開 → `php -l` → 切り替え → 応答の確認（Basic認証のため 401 が正常）。記録は `/srv/reserve/releases/RELEASES.log`
   - 戻すとき：`sudo /srv/reserve/bin/release <前のコミット>`
4. **本番データの一括操作・サーバー上のファイルの直接修正の前も、必ず `sudo /srv/reserve/bin/backup <理由>`**（例：`backup before-relink`）
   - 控えは `/srv/reserve/private/data/backups/reserve-<日時>-<理由>.db`。SQLite のバックアップ機能で写し、壊れていないか確かめる。新しい40件を残す（毎日3時の自動の控えとは別）
5. 道具を流すとき：`sudo -u apache RESERVE_CONFIG=/srv/reserve/private/config.php php /srv/reserve/app/tools/<名前>.php`
6. 2つのスクリプトの元はリポジトリの `ops/backup.sh`・`ops/release.sh`。直したら `/srv/reserve/bin/` に置き直す

サーバーの初期設定以外の作業（反映・本番データの操作を含む）は、この開発の会話で行う。

### 操作マニュアル

画面の操作マニュアルは `public/manual/index.html`（設定 →「操作マニュアル」、本番は /manual/）。**このファイルを直接直す**（以前の `scripts/update-manual.sh` は別ブランチから取り込む古いやり方）。画面を変えたら同じコミットでマニュアルも直す。

## 2. データ

花子の限定試験APIは `Store::withoutMaintenance` で囲み、初期化済みDB以外は拒否する。このスコープ中だけ `Store::init` と予約保存時のLINE自動連携を実行しない。既存予約検証・保存・独立読戻しは保持し、スコープは例外時にも復元する。通常受付および太郎の既存経路は変更しない。

`docs` 表に「種類・ID・暗号化した JSON・索引列 k1/k2」を1件ずつ（`Db::put(kind, id, value)`）。設定類は `meta`。

| 種類 | 中身 |
|---|---|
| `reservation` | 予約。`requestId`（LINE の予約申請ID）、`reminder`（`pending`/`sent`/`skipped`/`failed`）、`lineUserId`（あれば） |
| `patient` | 患者。`lineUserId`、`m3ChartNo`、`contactPref`（auto/line/email など）、`needsReview`（要確認の印） |
| `reminderLog` | 送った記録。キー＝sha256(来院キー\|回\|来院時刻)。本文は残さない |
| `lineContact` | 公式アカウントの友だち・やりとりした LINE（userId・初回/最終日時・表示名・患者が送った文の新しい30件／各200字）。送った文は手動連携の検索だけに使い、一覧には出さない |
| intake（申請） | LINE 予約フォームの申請。申請者の LINE ID を含む（画面には出さない） |
| meta `reminderSettings` / `reminderSecrets` | リマインドの設定／LINE のトークン・SMTP パスワード（画面に出さない） |
| meta `airSyncSettings` / `airSyncSecrets` / `airRetired` | Air の取り込み設定／ログイン情報／Air 終了の記録 |

## 3. リマインド（`php/lib/Reminder.php`）

- 送るのは **サーバー内のこの仕組みだけ**。`Reminder::tick` が定期実行から呼ばれ、回（既定：前日18時）の時刻が来たら `runRound` → `visitsOn`（その日の来院）→ `deliver`
- 来院ごとに1通。同じ来院・同じ回・同じ時刻には二度送らない（`reminderLog`）。予約の時刻を変えると予約の `reminder` は `pending` に戻る
- 院の設定で「有効」にするまで自動では送らない。手動送信（予約詳細の「送る」）・テストメールは監査ログに残る
- **LINE の送り先の決め方（上から順）**
  1. 予約の `lineUserId`
  2. 予約の申請ID（欄、またはメモ中の `R` ＋14桁＋16進8桁）から申請の LINE
  3. 患者の `lineUserId`（いったん申請から特定できた人は、ここに入れて「連携済」にする）
  4. どれもなければメール（患者にメールがあれば）、それもなければ `no_contact`
- **申請IDからの LINE 連携は即時・自動**（履歴「LINE紐付け（予約申請から自動）」）。仕組みは `Store::linkLineFromReservation` の1つだけで、呼び口は3つ
  - 予約の保存（`putReservation`）：入力・変更・Air の取り込み・自動予約・外部連携のすべてがここを通る
  - 申請が後から届いたとき（`Intake::store` → `Store::linkLineForRequest`）
  - 取りこぼしの拾い直し：リマインドの最初の回の前に `Store::autoLinkLines()`（一括は `tools/link-lines.php`）
- 「LINE未連携 → 連携する」（手動）は、申請IDがない・申請の LINE と別の LINE を使っているなどのイレギュラーのときだけ使う
- LINE は今月の残り通数が「残しておく通数」を下回るならメールに回す
- **メール**：SMTP で送る（AWS SES は使わない＝院長の方針）。ロリポップのメールなら `smtp.lolipop.jp`・465（SSL）、ユーザー名は送信元アドレス。証明書の確認は必ず行う。設定画面の「テスト送信」で確かめる
- 自動予約の試験予約（`safePilotRevision` 付き）には送らない

## 4. LINE（`php/lib/LineLink.php`）

- Webhook：予約申請の文面や「問診票」の発言に、無料の返信で問診票の入口を返す。あわせて `lineContact` に「やりとりした LINE」を残す（表示名は7日に1回まで取りに行く）
- 患者画面の「LINEと連携…」：`lineContact` と申請者（申請の氏名）を候補に出し、選ぶと患者の `lineUserId` に入る（`GET patients/{id}/line-candidates`、`POST patients/{id}/link-line`）
  - 探せる言葉：LINE の表示名・申請の氏名・患者が送った文（文で当たったときはその文だけを出す）。院が LINE 公式アカウントの管理画面で付けたチャットの名前は、LINE の API で受け取れないので使えない
  - 友だち全員を候補に入れる：`tools/line-followers.php`（友だち一覧 API。認証済みアカウントで使える。通数は使わない。表示名がまだない人だけ問い合わせる）。新しい友だちは Webhook の友だち追加で入る
  - 送った文は Webhook で受け取った分から（過去のトークは LINE の API で取れない）
- 予約詳細の「LINEで連絡 ↗」：管理画面（chat.line.biz）のその人のチャットを新しいタブで開く（`GET patients/{id}/line-chat` → `LineLink::chatInfo`）
  - LINE は「送る宛先＝利用者ID」と「管理画面のチャットID」を別々に付け、対応を API で教えない。対応表は `lineContact.chatId`、公式アカウントの番号（URL の前半）は meta `lineChatAccount`
  - 対応表にない人は、チャット一覧を開いて LINE の表示名をコピーする（検索欄に貼るだけ）
  - 対応表は Chrome 拡張「LINE チャット連携」（`extensions/line-chat/`。build:static の前に `scripts/zip-extension.mjs` が `public/integrations/line-chat-extension.zip` にまとめる）が自動で作る。スタッフが管理画面でチャットを開くたびに、URL のチャットID・トークに出ている予約申請ID・見出しの名前・プロフィール画像の見た目の指紋（dHash。拡張機能の background.js で作る）を `POST integration/line-chats`（鍵 `lc_`＝設定 → 外部機器の連携 →「LINE チャット連携」）へ送る。トークの本文は送らない。管理画面はチャットを切り替えてもページを読み込み直さない（URL が先に変わり中身が遅れて入れ替わる）ので、1秒ごとに読み、同じ内容が2回続いてから送る。前のチャットで読めたアイコン・申請IDが次のチャットに出ても使わない（入れ替わり前の残り）。チャット一覧（アイコン列を含む枠。ほかの患者の最後のメッセージが出る）の文字は読まず、申請IDは相手のアイコンより右の文字からだけ読む。配布は zip（設定画面）と、院の Google ドライブの「LANE RESERVE LINEチャット連携（Chrome拡張）」フォルダ（フォルダID 1qgLuU-YtaRWlsh6ADEuKZ5b7K2tnJKf_）の2か所。拡張機能を変えたら両方を新しくする。鍵は `chrome.storage.sync`（院の Google アカウントの Chrome 同期）に保存し、同期しているパソコンには1台の入力で入る（1.0.9。1.0.8 までの鍵は自動で移す）。ドライブには入らない。今後の配布の本命は Chrome ウェブストア（限定公開。院の Google アカウントでログインした Chrome に同期で自動で入り、更新も自動）。プライバシーポリシーは `/integrations/line-chat-privacy.html`
  - 結びつけ（`LineLink::learnChat`）：予約申請ID → プロフィール画像の見た目（`lineContact.pictureDhash`。友だち取り込み・Webhook で LINE の画像の小さい版から作る。`LineLink::dhash`。6 ビット以内で、2番目より 8 ビット以上近いときだけ。同じ画像が別のチャットでも出ていれば相手の写真ではないので使わない。拡張機能は相手の画像をトーク欄の見出しの中からだけ読む）→ 表示名（1人だけのとき）。申請IDが別々の人を指すときは、写真が6ビット以内で合う人が1人だけならその人、そうでなければ結びつけない。画像が 16 ビットより離れるときも結びつけない。画像のアドレスの番号は表示する場所ごとに変わるので照合に使えない（10/27 に確認）。同じ写真なら大きさが違っても 0〜4 ビット、別の人は 26 ビット以上離れる（本番の画像で確認）。見出しの名前は `chatName` に残し、手動連携の検索に使う
  - 手動の連携（「LINEと連携…」）も残す。検索欄に管理画面のチャットの URL を貼ると、拡張機能が見たそのチャットの人（決まっていなければ同じ画像・同じ表示名の人）が候補に出て、連携と同時にチャットも覚える（`linkPatientLine` の chatId → `LineLink::bindChat`）。一覧から選んだときも、拡張機能が見て決まらなかったチャットに同じ画像のものが1つだけあればつなぐ（`bindSeenChat`）。手動の連携1回でリマインドと「LINEで連絡」の両方が通じる（院長の指示）。開いたチャットは `lineChat`（チャットID・見出しの名前・画像の番号）に残す
  - 患者ごとの手作業にはしない（院長の指示）。管理画面の作りが変わって読めなくなっても、一覧＋表示名コピーで連絡は続けられる

## 4-2. 予約詳細（カレンダー右列）の操作

- 上部の操作ボタン：患者情報・予約を変更・**予約キャンセル**・カルテ・同意書・見積・会計
- 予約キャンセルの確認で「無断キャンセル」にチェックして確定すると `no_show`、チェックなしは `cancelled`。戻すときは「予約に戻す」
- 確認では「キャンセルの理由」（任意・200字）を書ける。予約に `cancelReason`・`cancelledAt`・`cancelledBy` を残し、患者画面の「キャンセル履歴」（`getPatientDetail` の `cancellations`）に出す。予約に戻すと3つとも消える
- 連絡欄の「LINE未連携 → 連携する」を押すと患者画面が開き、「LINEと連携」の候補がすぐ出る

## 5. 問診票の結びつけ（`Store::matchQuestionnaire`）

上から順に、ひとりに決まったときだけ結びつける。決まらなければ「照合待ち」。

1. カルテ番号（M3）
2. 氏名（読み）＋電話、または氏名＋生年月日（患者の電話・生年月日がなくても、申請の電話・生年月日を使う：`patientContacts`）
3. **案A**：同じ氏名の患者がひとりだけで、回答日の前後14日に予約がある
- Air から取り込んだ後にも結び直す。一括は `tools/relink-questionnaires.php`

## 6. 「要確認」の患者

- 似た名前（同じ読みなど）の別の患者がいるときだけ出す（初診というだけでは出さない）。`similarPatients` / `reviewPatients`
- 似た患者を統合・削除したら外れる。一括の見直しは `tools/recheck-review.php`

## 7. Airリザーブの取り込み（`php/lib/AirSync.php`）

- 日中15分ごとに、今日から120日先までの**診療日だけ**を取り込む。診療日＝水曜・祝日・トップページに載る特別診療日
- 毎朝、翌日分を取り込む（前日18時のリマインドに間に合わせる）
- **Air 終了**：院長の合図で `POST admin/air-sync/retire`（確かめの言葉「Air終了」）または `tools/air-retire.php`。取り込みを止め、ログイン情報を消し、Air から入った予約も自動予約から変えられるようにする。戻す口はない。**2026-10-22 15:30 に院長の合図で終了済み**（終了前の控え：`backups/reserve-20261022-153009-before-air-retire.db`。最後の取り込みは 10/22〜2027/2/19 の診療日23日・310件で、すべて変更なし）

## 8. 外部からの連携（`/api/v1/integration/...`）

| 口 | 鍵 | 用途 |
|---|---|---|
| `booking/...` | `X-Booking-Token`（設定 → 外部機器 →「自動予約」で発行する `bk_` の鍵） | ChatGPT／Codex の自動予約。予約の入力・変更・取り消し・メニュー作成・患者の検索と登録。`booking/api/...` でスタッフ画面と同じ API（スタッフ・鍵・ログイン・復元は不可）。手順書：`public/integrations/booking-api.html` |
| `booking/safe-*` | 同上 | Codexの固定試験。既存の予約作成・読取に加え、`safe-mutations` の変更/取消、`safe-patients` の患者登録/読取を含む。追加2系統は標準では無効 |
| `reservations/{id}/request-id` | 連携トークン | 予約申請IDの書き込み |
| `patients/{id}/m3-chart-no` | 連携トークン | M3 カルテ番号の書き込み |
| `questionnaires` / `consent-templates` / `prices` / `photos` | 連携トークン・機器の鍵 | 問診票・同意書のひな形・料金・写真の受け取り |

- 自動予約の操作は監査に「自動予約（鍵の名前）」で残る。試験中のため回数の制限はかけない（院長の方針）
- 固定試験の追加処理は `LaneMutationSafety` / `LaneMutationReadback` / `LanePatientSafety` に置く。`LaneMutationPolicy` と `LanePatientPolicy` は配布時に無効・承認なし・releaseRootなしとし、通常APIや他患者の処理から使わない。対象本人・操作・版・短い承認期限・新鮮な読取証拠・独立した完了確認が必要。保存ルールの存在やファイルの配布だけを、操作の承認・完了の証拠にしない
- 患者登録は氏名/カナ/電話の既存候補があれば拒否し、結果不明時は再登録しない。予約変更・取消は元の版/所有者/メモ/m3証拠を照合し、固定試験の通知抑止を保持する。サーバー側処理自体はm3やLINEへ送信しない
- 院長指定の既存架空患者「試験 花子」の予約試験は、既存 `LaneBookingSafety` の限定分岐を使う。固定患者ID・診察券番号・氏名/カナ、登録済みの場合の生年月日/電話、指定申請・12/30 11:00〜11:20・main・専用20分項目を照合する。新規患者作成や情報補完はしない。書込みは個別policyの有効化と最大120秒期限が必要で、DB待機後にもpolicy一致/期限を再確認する。配布policyは花子へ変更せず、既存の太郎試験動作は保持する。
- Air で入れた予約は、Air 終了までは自動予約から変えられない

## 9. 院長の決めたこと（変えるときは院長に確認）

- メール送信は AWS ではなく SMTP（ロリポップなど）
- 患者情報を Google に送らない
- ChatGPT 側のプライバシーの取り扱いは OpenAI 側で指示済み。こちらでは扱わない
- 2026-10-21 の朝の時点で「明日分」だった no_contact の36件は、その日には送らない（`reminderLog` で済み）

## 10. 経緯メモ

- 2026-10-13 に info@ から ishidabiyou@gmail.com に届いたテストメール2通は、LANE RESERVE の送信ではない（監査に送信の記録がなく、`reminderLog` のメール送信は0件。当時の本番はロリポップで、メールソフトなど別の経路と考えられる）
- 2026-10-21：使われていなかった外部向けリマインドの口（`integration/reminders`：一覧・書き戻し・実行）を削除。リマインドの仕組みはサーバー内の1つだけになった

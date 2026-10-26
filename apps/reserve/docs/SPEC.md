# LANE RESERVE 仕様と約束事（いしだ皮フ科／美容皮膚科）

直すとき・足すときは、まずこの文書を読む。仕様を変えたら、同じコミットでこの文書も直す。
経緯と院長の決定は [HISTORY.md](HISTORY.md)、今の状態と残りの作業は [STATUS.md](STATUS.md)。
販売向けの設計の構想は [saas-plan.md](saas-plan.md)（こちらは「今どう動いているか」の記録）。

## 0. 構造の約束（煩雑にしないために）

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
| 問診票 | `https://monshin.ishidahihuka.jp/`（LINE の Webhook・LIFF もここ） |
| プログラム | `/srv/reserve/releases/<コミット>/app`、`/srv/reserve/app` がその時の版へのリンク |
| 設定 | `/srv/reserve/private/config.php`（暗号鍵・連携トークンなど。リポジトリに入れない） |
| データ | `/srv/reserve/private/data/reserve.db`、バックアップは同じ場所の `backups/` |
| 定期実行 | systemd `reserve-reminders.timer`（10分ごと）→ `php/cron/reminders.php`（apache ユーザー）。リマインド（Air の取り込みは 10/22 に終了） |
| 入口 | Apache（`/etc/httpd/conf.d/20-ishida-https.conf`）。Basic認証 `/etc/httpd/ishida.htpasswd`。証明書は certbot（自動更新） |
| 控え | 反映・データ操作ごと：`/srv/reserve/private/data/backups/`（新しい40件）。毎日：AWS Backup `ishida-daily`（3時ごろ、サーバー丸ごとのスナップショット） |
| S3 | `ishida-deploy-…`（反映する一式）・`ishida-audit-logs-…`・`ishida-ops-logs-…`・`ishida-web-backup-…` |
| 操作の入口 | AWS SSM（AWS-RunShellScript）。SSH は閉じている。IAM：Claude Code は claude-ops、ChatGPT／Codex は chatgpt-ops |
| 旧ロリポップ | 予約システム・データは削除済み（10/16）。残るのは ishidahihuka.jp/reserve/ → reserve.ishidahihuka.jp の転送、ホームページ（WordPress）、メール（SMTP 送信に使う）、ネオボワール配布用スクリプト |

### 反映（デプロイ）の手順

**だれが反映しても（Claude Code・Codex・人）、必ずサーバーの `release` を使う。予約データの控えを取れなければ反映されない。**

1. テストを通し、`claude/admiring-wozniak-kikcrr` にコミット・プッシュ
2. 一式（静的書き出し＋PHP）を固めて S3 `ishida-deploy-965825500741` に `app-<コミット>.tgz` で置く
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
  - 探せる言葉：LINE の表示名・申請の氏名・患者が送った文（文で当たったときはその文だけを出す）。院が LINE 公式アカウントの管理画面で付けたチャットの名前は LINE の API で受け取れないので、そのチャットの URL（`…/chat/U…`）か LINE の ID を検索欄に貼ると、その人だけを出す（`LineLink::contact`。未登録なら表示名を問い合わせて入れる）
  - 友だち全員を候補に入れる：`tools/line-followers.php`（友だち一覧 API。認証済みアカウントで使える。通数は使わない。表示名がまだない人だけ問い合わせる）。新しい友だちは Webhook の友だち追加で入る
  - 送った文は Webhook で受け取った分から（過去のトークは LINE の API で取れない）

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
| `booking/safe-*` | 同上 | Codex の試験予約（`LaneBookingSafety`）。患者の作成・取り消しはしない |
| `reservations/{id}/request-id` | 連携トークン | 予約申請IDの書き込み |
| `patients/{id}/m3-chart-no` | 連携トークン | M3 カルテ番号の書き込み |
| `questionnaires` / `consent-templates` / `prices` / `photos` | 連携トークン・機器の鍵 | 問診票・同意書のひな形・料金・写真の受け取り |

- 自動予約の操作は監査に「自動予約（鍵の名前）」で残る。試験中のため回数の制限はかけない（院長の方針）
- Air で入れた予約は、Air 終了までは自動予約から変えられない

## 9. 院長の決めたこと（変えるときは院長に確認）

- メール送信は AWS ではなく SMTP（ロリポップなど）
- 患者情報を Google に送らない
- ChatGPT 側のプライバシーの取り扱いは OpenAI 側で指示済み。こちらでは扱わない
- 2026-10-21 の朝の時点で「明日分」だった no_contact の36件は、その日には送らない（`reminderLog` で済み）

## 10. 経緯メモ

- 2026-10-13 に info@ から ishidabiyou@gmail.com に届いたテストメール2通は、LANE RESERVE の送信ではない（監査に送信の記録がなく、`reminderLog` のメール送信は0件。当時の本番はロリポップで、メールソフトなど別の経路と考えられる）
- 2026-10-21：使われていなかった外部向けリマインドの口（`integration/reminders`：一覧・書き戻し・実行）を削除。リマインドの仕組みはサーバー内の1つだけになった

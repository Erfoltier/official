# LANE RESERVE 仕様と約束事（いしだ皮フ科／美容皮膚科）

直すとき・足すときは、まずこの文書を読む。仕様を変えたら、同じコミットでこの文書も直す。
販売向けの設計の構想は [saas-plan.md](saas-plan.md)（こちらは「今どう動いているか」の記録）。

## 0. 構造の約束（煩雑にしないために）

- **1つの仕事に、仕組みは1つ。** 同じことをする口を2つ作らない。作り直したら古い方は消す
  - 例：リマインドの送信はサーバー内の `Reminder` だけ。外部の送信プログラム用の口（`integration/reminders` の一覧・書き戻し・実行）は使われておらず二重だったため 2026-10-21 に削除
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
| 定期実行 | systemd `reserve-reminders.timer` → `php/cron/reminders.php`（apache ユーザー）。Air の取り込み → リマインドの順 |

### 反映（デプロイ）の手順

1. テストを通し、`claude/admiring-wozniak-kikcrr` にコミット・プッシュ
2. 一式（静的書き出し＋PHP）を固めて S3 `ishida-deploy-965825500741` に `app-<コミット>.tgz` で置く
3. SSM（AWS-RunShellScript）でサーバーに：DB をバックアップ → 展開 → `php -l` → リンク切り替え → `/api/v1/health` と連携の ping を確かめる（Basic認証のため 401 が正常）
4. 道具を流すとき：`sudo -u apache RESERVE_CONFIG=/srv/reserve/private/config.php php /srv/reserve/app/tools/<名前>.php`

サーバーの初期設定以外の作業（反映・本番データの操作を含む）は、この開発の会話で行う。

## 2. データ

`docs` 表に「種類・ID・暗号化した JSON・索引列 k1/k2」を1件ずつ（`Db::put(kind, id, value)`）。設定類は `meta`。

| 種類 | 中身 |
|---|---|
| `reservation` | 予約。`requestId`（LINE の予約申請ID）、`reminder`（`pending`/`sent`/`skipped`/`failed`）、`lineUserId`（あれば） |
| `patient` | 患者。`lineUserId`、`m3ChartNo`、`contactPref`（auto/line/email など）、`needsReview`（要確認の印） |
| `reminderLog` | 送った記録。キー＝sha256(来院キー\|回\|来院時刻)。本文は残さない |
| `lineContact` | 公式アカウントとやりとりした LINE（userId・初回/最終日時・表示名）。**発言の中身は残さない** |
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
- 毎回の最初の回の前に `Store::autoLinkLines()` を流し、申請IDから患者の LINE を自動で連携（履歴「LINE紐付け（予約申請から自動）」）。手動は `tools/link-lines.php` と設定の「申請から連携」
- LINE は今月の残り通数が「残しておく通数」を下回るならメールに回す
- **メール**：SMTP で送る（AWS SES は使わない＝院長の方針）。ロリポップのメールなら `smtp.lolipop.jp`・465（SSL）、ユーザー名は送信元アドレス。証明書の確認は必ず行う。設定画面の「テスト送信」で確かめる
- 自動予約の試験予約（`safePilotRevision` 付き）には送らない

## 4. LINE（`php/lib/LineLink.php`）

- Webhook：予約申請の文面や「問診票」の発言に、無料の返信で問診票の入口を返す。あわせて `lineContact` に「やりとりした LINE」を残す（表示名は7日に1回まで取りに行く）
- 患者画面の「LINEと連携…」：`lineContact` と申請者（申請の氏名）を候補に出し、選ぶと患者の `lineUserId` に入る（`GET patients/{id}/line-candidates`、`POST patients/{id}/link-line`）

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
- **Air 終了**：院長の合図で `POST admin/air-sync/retire`（確かめの言葉「Air終了」）または `tools/air-retire.php`。取り込みを止め、ログイン情報を消し、Air から入った予約も自動予約から変えられるようにする。戻す口はない。2026-10-21 時点では**まだ合図なし**

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

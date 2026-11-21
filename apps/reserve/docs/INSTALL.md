# LANE RESERVE ＋ LINE 連携セット　新しい院への入れ方

院ごとにサーバーを1台用意し、そこに予約システム（LANE RESERVE）・LINE の予約申請フォーム・LINE の問診票・リマインドを入れます。
データは院ごとのサーバーの中だけにあり、ほかの院とは混ざりません。患者情報は Google を通りません。

所要時間：LINE の準備 30分、サーバー 20分、画面での設定 30分ほど。

---

## 1. 用意するもの（院側）

| もの | 内容 |
|---|---|
| サーバー | AWS EC2（Amazon Linux 2023、t4g.small 程度、ディスク 30GB）。受け付けるポートは 80・443 だけ。毎日のスナップショット（AWS Backup）を推奨 |
| ドメイン2つ | 例：`reserve.example.jp`（スタッフの予約画面）と `monshin.example.jp`（患者の問診票・LINE の受け口）。どちらも DNS の A レコードをサーバーの IP に向ける |
| LINE 公式アカウント | Messaging API を使う設定にしたもの（LINE Official Account Manager →設定 → Messaging API） |
| メールの送信元 | リマインドのメール用の SMTP（送信サーバー・ポート・ユーザー・パスワード・送信元アドレス） |
| ロゴ | 正方形の画像（予約申請フォーム用 PNG、問診票用 WebP。なければ入れ替えなくても動く） |

## 2. LINE Developers での準備（院の LINE アカウントでしかできない作業）

https://developers.line.biz/console/ に、LINE 公式アカウントの管理者でログインします。

1. **Messaging API チャネル**（公式アカウントと同じプロバイダー）
   - 「チャネル基本設定」の **チャネルシークレット** を控える
   - 「Messaging API 設定」の **チャネルアクセストークン（長期）** を発行して控える
   - 「Webhook URL」に `https://monshin.example.jp/line.php` を入れ、「Webhook の利用」をオン
   - 「応答メッセージ」はオフ（LINE Official Account Manager 側の設定）
2. **LINE ログインチャネル**（同じプロバイダーに新しく作る。種類は「ウェブアプリ」）
   - 「LIFF」タブで LIFF アプリを2つ作る

   | 名前 | サイズ | エンドポイント URL | Scope |
   |---|---|---|---|
   | 予約申請フォーム | Full | `https://monshin.example.jp/intake/` | openid, profile, chat_message.write |
   | 問診票 | Full | `https://monshin.example.jp/liff/` | openid, profile |

   - それぞれの **LIFF ID**（`1234567890-abcdefgh` の形）を控える
   - 「公開」状態にする

## 3. サーバーに入れる

手元（開発用のパソコン）で一式を作ります。

```bash
cd apps/reserve
npm ci
bash scripts/package.sh            # dist/app-<コミット>.tgz ができる
```

一式と `ops/` フォルダをサーバーに送り、root で流します。

```bash
sudo bash ops/install.sh \
  --reserve reserve.example.jp --monshin monshin.example.jp \
  --email admin@example.jp --package app-<コミット>.tgz
```

終わると次が表示されます（**この画面にしか出ないので控える**）。

- 院長の最初のログイン PIN
- 予約画面の入口の鍵（ユーザー `staff` とパスワード。`--no-basic-auth` を付けたときは出ない）

予約申請フォームの LIFF ID を設定ファイルに入れます。

```bash
sudo sed -i "s/'liff_id' => '[^']*'/'liff_id' => '（予約申請フォームの LIFF ID）'/" /srv/reserve/private/config.php
sudo systemctl reload php-fpm
```

ロゴを入れ替える場合：`/srv/reserve/app/monshin/intake/assets/clinic-mark.png` と `/srv/reserve/app/monshin/assets/logo.webp`。
（反映のたびに一式で上書きされるので、恒久的に変えるときは `php/monshin/` の同じファイルを差し替えてから一式を作る）

## 4. 入れたあとに画面で設定すること

`https://reserve.example.jp/` を開き、院長の PIN でログインします。

| 場所 | 入れるもの |
|---|---|
| 設定 → スタッフ | 院長の PIN を変える。スタッフを足す |
| 設定 → 院の情報・診療時間 | 院名・診療時間・予約の刻み。書類に載せる院名・住所・電話 |
| 同 →「患者向けの表示・LINE の予約申請フォーム」 | 正式な院名・英語名・受け付ける診療科・受付日時の案内・**選べる曜日**・特別診療日・**プライバシーポリシーのアドレス**・ホームページ |
| 設定 → レーン／メニュー | 院のレーン（施術室・医師など）とメニュー（最初は汎用の4つだけ入っている） |
| 設定 → 問診票 | 問診票の質問。下の「LINE 連携」に **問診票の LIFF ID** と **チャネルシークレット** |
| 設定 → リマインド | **LINE のチャネルアクセストークン**、メールの SMTP、送る時刻と文面。テスト送信で確かめる |
| 設定 → 外部機器の連携 | （使うときだけ）LINE チャット連携の鍵、自動予約の鍵、ネオボワールなど |

## 5. 動作の確認

1. LINE 公式アカウントを友だち追加したスマホで、予約申請フォームの URL（`https://liff.line.me/（予約申請フォームの LIFF ID）`）を開き、テストの申請を送る → トークに申請の文面が届く
2. 予約画面で、その申請を予約に入れる（予約申請ID を貼る）→ 患者の LINE が自動で連携される
3. LINE で「問診票」と送る → 問診票のリンクが返ってくる → 送ると 設定 → 問診票 の一覧に入る
4. 設定 → リマインド →「テスト送信」→ LINE とメールに届く
5. `https://monshin.example.jp/` を LINE 以外のブラウザ（メールのリンクなど）で開き、問診票を送れる

## 6. 以後の反映・控え

- 新しい版：`bash scripts/package.sh` で一式を作り、サーバーで `sudo /srv/reserve/bin/release <コミット> <だれが> app-<コミット>.tgz`
  （S3 に置く運用にするなら install.sh に `--bucket` を付けるか `/srv/reserve/deploy.conf` の `DEPLOY_BUCKET` を入れる）
- データを直接触る前：`sudo /srv/reserve/bin/backup <理由>`
- 予約データの控えは `/srv/reserve/private/data/backups/`（新しい40件）。サーバー丸ごとは AWS Backup で

## 7. 入れないもの・注意

- 自動予約（ChatGPT など）・Air リザーブの取り込みは試験中・いしだ皮フ科専用の機能。新しい院では使わない（設定で無効のまま）
- LINE チャット連携の Chrome 拡張は、拡張機能の画面で **この院の LANE RESERVE のアドレス**（`https://reserve.example.jp`）と鍵を入れる
- 医療情報を扱うので、サーバーの管理者・控えの保管・アクセスの記録（設定 → 操作ログ）は院の規程に合わせる

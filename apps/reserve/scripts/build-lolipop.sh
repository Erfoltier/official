#!/usr/bin/env bash
# ロリポップ等の共用サーバー（PHP）に置くための一式を作る。
#   使い方: npm run build:lolipop            → dist/lolipop/reserve と dist/reserve-lolipop.zip
#   環境変数: BASE_PATH（既定 /reserve）、DEMO=1 でデモデータ入り（既定 1）
# 作られる config.php には暗号鍵などの秘密の値が入るため、dist/ は Git に入れない。
set -euo pipefail
cd "$(dirname "$0")/.."

BASE_PATH="${BASE_PATH:-/reserve}"
DEMO="${DEMO:-1}"
DIST="dist/lolipop"
APP="$DIST$BASE_PATH"

rm -rf "$DIST" dist/reserve-lolipop.zip
mkdir -p "$APP"

echo "== 画面を静的ファイルに書き出す"
BASE_PATH="$BASE_PATH" npm run build:static >/dev/null
cp -R out/. "$APP/"

echo "== PHP の API をコピー"
cp -R php/api php/lib php/seed php/cron "$APP/"
mkdir -p "$APP/data"
cp php/data/.htaccess "$APP/data/"
cp php/.htaccess php/config.sample.php "$APP/"
cp php/manual/.htaccess "$APP/manual/"

KEY=$(openssl rand -hex 32)
SECRET=$(openssl rand -hex 32)
TOKEN=$(openssl rand -hex 24)

if [ "$DEMO" = "1" ]; then
  ADMIN_PIN=""
else
  ADMIN_PIN=$(php -r 'echo random_int(100000, 999999);')
fi

cat >"$APP/config.php" <<PHP
<?php
// 予約カレンダーの設定（自動で作成）。暗号鍵をなくすとデータが読めなくなるので、このファイルは別の安全な場所にも保管する
defined('RESERVE') || exit;

return [
    'base_path' => '$BASE_PATH',
    'db_dsn' => 'sqlite:' . __DIR__ . '/data/reserve.db',
    'encryption_key' => '$KEY',
    'session_secret' => '$SECRET',
    'initial_admin_pin' => '$ADMIN_PIN',
    'integration_token' => '$TOKEN',
];
PHP

if [ "$DEMO" = "1" ]; then
  echo "== デモデータを作る（架空のスタッフ・患者・予約。PIN は 1234）"
  RESERVE_CONFIG="$PWD/$APP/config.php" php php/tools/demo-seed.php
  rm -rf "$APP/data/blobs" "$APP/data/backups"
fi

# 書き出しの過程で使っただけのファイルを除く
find "$APP" -name '.DS_Store' -delete

cp php/README.md "$DIST/設置手順.md"
(cd "$DIST" && zip -qr ../reserve-lolipop.zip "${BASE_PATH#/}" 設置手順.md)
echo "== 完成: dist/reserve-lolipop.zip（中身: ${BASE_PATH#/}/）"
[ -n "$ADMIN_PIN" ] && echo "   院長アカウントの初期PIN: $ADMIN_PIN（最初にログインして変更してください）"
echo "   外部連携トークン: config.php の integration_token"

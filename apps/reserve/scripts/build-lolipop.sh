#!/usr/bin/env bash
# ロリポップ等の共用サーバー（PHP）に置くための一式を作る。
#   使い方: npm run build:lolipop            → dist/lolipop/reserve と dist/reserve-lolipop.zip
#   環境変数: BASE_PATH（既定 /reserve）、DEMO=1 でデモデータ入り（既定 1）、PORT（作業用 既定 3390）
# 作られる config.php には暗号鍵などの秘密の値が入るため、dist/ は Git に入れない。
set -euo pipefail
cd "$(dirname "$0")/.."

BASE_PATH="${BASE_PATH:-/reserve}"
DEMO="${DEMO:-1}"
PORT="${PORT:-3390}"
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
DB="$PWD/$APP/data/reserve.db"

if [ "$DEMO" = "1" ]; then
  echo "== デモデータを作る（架空の患者・予約）"
  RESERVE_DB="$DB" DATA_ENCRYPTION_KEY="$KEY" SESSION_SECRET="$SECRET" RESERVE_DEMO=1 \
    setsid npx next dev -p "$PORT" >"$DIST/seed.log" 2>&1 &
  PGID=$!
  trap 'kill -- -$PGID 2>/dev/null || true' EXIT
  for _ in $(seq 1 90); do
    curl -s -o /dev/null "http://localhost:$PORT/api/v1/auth/staff" && break
    sleep 1
  done
  JAR="$DIST/.jar"
  curl -s -c "$JAR" -H 'Content-Type: application/json' -d '{"staffId":"staff-admin","pin":"1234"}' \
    "http://localhost:$PORT/api/v1/auth/login" >/dev/null
  # 施術歴（過去半年〜8週先の水曜日）
  curl -s -b "$JAR" "http://localhost:$PORT/api/v1/patients/p-0001" >/dev/null
  # 前後の毎日の予約（2週間前〜90日先）
  node -e '
    const t = new Date(Date.now() + 9 * 3600e3);
    for (let i = -14; i <= 90; i++) console.log(new Date(t.getTime() + i * 864e5).toISOString().slice(0, 10));
  ' | while read -r d; do curl -s -b "$JAR" "http://localhost:$PORT/api/v1/day?date=$d" >/dev/null; done
  kill -- -"$PGID" 2>/dev/null || true
  trap - EXIT
  sleep 2
  rm -f "$JAR"
  # 共用サーバー向けに WAL を解除して1つのファイルにまとめる
  node --no-warnings -e '
    const { DatabaseSync } = require("node:sqlite");
    const db = new DatabaseSync(process.argv[1]);
    db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE; VACUUM;");
    db.close();
  ' "$DB"
  rm -f "$DB-wal" "$DB-shm"
  ADMIN_PIN=""
else
  ADMIN_PIN=$(node -e 'console.log(String(require("node:crypto").randomInt(100000, 1000000)))')
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

# 書き出しの過程で使っただけのファイルを除く
rm -f "$DIST/seed.log"
find "$APP" -name '.DS_Store' -delete

cp php/README.md "$DIST/設置手順.md"
(cd "$DIST" && zip -qr ../reserve-lolipop.zip "${BASE_PATH#/}" 設置手順.md)
echo "== 完成: dist/reserve-lolipop.zip（中身: ${BASE_PATH#/}/）"
[ -n "$ADMIN_PIN" ] && echo "   院長アカウントの初期PIN: $ADMIN_PIN（最初にログインして変更してください）"
echo "   外部連携トークン: config.php の integration_token"

#!/usr/bin/env bash
# 開発用：API は PHP 版（php -S）、画面は next dev。本番（ロリポップ）と同じ API で画面を確かめる。
#   使い方: npm run dev   → http://localhost:3000（デモのスタッフ・PIN 1234）
#   データ: .data/php/（初回にデモデータを作る。作り直すときはこのフォルダを消す）
set -euo pipefail
cd "$(dirname "$0")/.."
command -v php >/dev/null || { echo "PHP 8.1 以上が必要です（php コマンドが見つかりません）"; exit 1; }

DIR="$PWD/.data/php"
API_PORT="${API_PORT:-3401}"
PORT="${PORT:-3000}"
mkdir -p "$DIR"
CONF="$DIR/config.php"
if [ ! -f "$CONF" ]; then
  cat >"$CONF" <<PHP
<?php
// 開発用の設定（自動で作成。Git に入れない）
return [
    'base_path' => '',
    'db_dsn' => 'sqlite:' . __DIR__ . '/reserve.db',
    'encryption_key' => '$(php -r 'echo bin2hex(random_bytes(32));')',
    'session_secret' => '$(php -r 'echo bin2hex(random_bytes(32));')',
    'integration_token' => '$(php -r 'echo bin2hex(random_bytes(24));')',
    'line_intake_dir' => __DIR__ . '/intake-records',
];
PHP
  chmod 600 "$CONF"
fi
export RESERVE_CONFIG="$CONF"
[ -f "$DIR/reserve.db" ] || php php/tools/demo-seed.php

php -S "127.0.0.1:$API_PORT" php/tools/dev-router.php >"$DIR/php.log" 2>&1 &
PHP_PID=$!
trap 'kill $PHP_PID 2>/dev/null || true' EXIT
echo "== API（PHP）: http://127.0.0.1:$API_PORT  ログ: .data/php/php.log"
RESERVE_PHP_API="http://127.0.0.1:$API_PORT" npx next dev -p "$PORT"

#!/usr/bin/env bash
# 本番に置く一式（app-<コミット>.tgz）を作る。中身：画面の静的書き出し（out/）＋ PHP（php/。データ・説明・開発用の入口は除く）
#   使い方：bash scripts/package.sh [出力先フォルダ（既定 ./dist）]
#   できた .tgz は、install.sh（新しい院）または release（反映）に渡す。docs/INSTALL.md・docs/SPEC.md を参照
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=${1:-dist}
R=$(git rev-parse --short HEAD)
BASE_PATH= npm run build:static >/dev/null
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/app"
cp -a out/. "$WORK/app/"
(cd php && tar cf - --exclude=./data --exclude=./README.md --exclude=./config.sample.php --exclude=./tools/dev-router.php .) | tar xf - -C "$WORK/app"
php php/tools/check-fixed-trial-package.php >/dev/null
php "$WORK/app/tools/check-fixed-trial-package.php" >/dev/null
mkdir -p "$OUT"
(cd "$WORK" && tar czf - app) > "$OUT/app-$R.tgz"
echo "$OUT/app-$R.tgz"

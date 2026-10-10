#!/usr/bin/env bash
# 操作マニュアルを取り込み直す（素材は別ブランチの apps/reserve/docs/manual/）。
# 使い方: bash scripts/update-manual.sh [ブランチまたはコミット]（既定 origin/claude/server-setup）
# manual.html → public/manual/index.html、img/ → public/manual/img/。本番では /reserve/manual/ になる
set -euo pipefail
cd "$(dirname "$0")/.."
REF="${1:-origin/claude/server-setup}"
case "$REF" in origin/*) git fetch -q origin "${REF#origin/}" ;; esac
SRC=apps/reserve/docs/manual
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
git -C "$(git rev-parse --show-toplevel)" archive "$REF" "$SRC/manual.html" "$SRC/img" | tar -x -C "$tmp"
rm -rf public/manual
mkdir -p public/manual
cp "$tmp/$SRC/manual.html" public/manual/index.html
cp -R "$tmp/$SRC/img" public/manual/img
echo "取り込みました: $(git rev-parse --short "$REF") / 画像 $(ls public/manual/img | wc -l) 枚"

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
# 画面写真は画質を落とさない WebP にして軽くする（PNG より小さくなったものだけ置き換え、ページ内の参照も直す）
node - <<'JS'
const sharp = require(process.cwd() + "/node_modules/sharp");
const fs = require("fs");
const dir = "public/manual/img", page = "public/manual/index.html";
(async () => {
  let html = fs.readFileSync(page, "utf8"), before = 0, after = 0;
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".png"))) {
    const png = fs.readFileSync(`${dir}/${f}`);
    const webp = await sharp(png).webp({ lossless: true, effort: 6 }).toBuffer();
    before += png.length;
    if (webp.length >= png.length) { after += png.length; continue; }
    const w = f.replace(/\.png$/, ".webp");
    fs.writeFileSync(`${dir}/${w}`, webp);
    fs.unlinkSync(`${dir}/${f}`);
    html = html.split(`img/${f}`).join(`img/${w}`);
    after += webp.length;
  }
  fs.writeFileSync(page, html);
  console.log(`写真 ${(before / 1e6).toFixed(1)}MB → ${(after / 1e6).toFixed(1)}MB`);
})();
JS
echo "取り込みました: $(git rev-parse --short "$REF") / 画像 $(ls public/manual/img | wc -l) 枚"

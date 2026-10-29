#!/bin/bash
# 予約システムの新しい版を本番に反映する（Claude Code・Codex・人のだれが反映しても、これだけを使う）。
# 使い方：sudo /srv/reserve/bin/release <コミット> <だれが（claude / codex など）> [一式の .tgz]
#   .tgz を渡さないときは、/srv/reserve/deploy.conf の DEPLOY_BUCKET（S3）から app-<コミット>.tgz を取る
# 1. 予約データの控え（取れなければ反映しない） 2. 展開 3. PHP の構文確認 4. 切り替え 5. 応答の確認
# 戻すとき：sudo /srv/reserve/bin/release <前のコミット>（releases に残っていれば取り直さない）
set -euo pipefail
R=${1:?コミットを指定してください}
[[ "$R" =~ ^[0-9a-f]{7,40}$ ]] || { echo "コミットの形が正しくありません" >&2; exit 2; }
PKG=${3:-}
# 院ごとの値（install.sh が作る）。PUBLIC_URL：予約画面のアドレス、DEPLOY_BUCKET：一式を置く S3（使わないなら空）
DEPLOY_BUCKET=""
PUBLIC_URL=""
[ -f /srv/reserve/deploy.conf ] && . /srv/reserve/deploy.conf
/srv/reserve/bin/backup "before-$R"
REL=/srv/reserve/releases/$R
if [ ! -d "$REL/app" ]; then
  TMP=$(mktemp)
  if [ -n "$PKG" ]; then
    cp "$PKG" "$TMP"
  elif [ -n "$DEPLOY_BUCKET" ]; then
    aws s3 cp --quiet "s3://$DEPLOY_BUCKET/app-$R.tgz" "$TMP"
  else
    echo "一式（.tgz）を3つめに指定してください" >&2; rm -f "$TMP"; exit 2
  fi
  mkdir -p "$REL" && tar xzf "$TMP" -C "$REL" && rm -f "$TMP"
  chown -R root:root "$REL"
fi
for f in "$REL"/app/lib/*.php "$REL"/app/api/index.php "$REL"/app/cron/*.php; do php -l "$f" >/dev/null; done
echo "lint ok"
ln -sfn "$REL/app" /srv/reserve/app.new && mv -T /srv/reserve/app.new /srv/reserve/app
systemctl reload php-fpm 2>/dev/null || true
echo "$(date -Is) $R ${2:-不明}" >> /srv/reserve/releases/RELEASES.log
readlink -f /srv/reserve/app
sleep 1
[ -n "$PUBLIC_URL" ] && curl -s -o /dev/null -w "health %{http_code}\n" "$PUBLIC_URL/api/v1/health" || true

#!/bin/bash
# 予約データ（reserve.db）の控えを取る。反映・本番データの一括操作・ファイルの直接修正の前に必ず流す。
# 使い方：sudo /srv/reserve/bin/backup <理由（英数字・ハイフン）>
# 控えは /srv/reserve/private/data/backups/reserve-<日時>-<理由>.db（apache のみ読める）。壊れていないか確かめ、だめなら失敗で終わる
set -euo pipefail
LABEL=${1:-manual}
[[ "$LABEL" =~ ^[A-Za-z0-9._-]{1,60}$ ]] || { echo "理由は英数字・ハイフンで指定してください" >&2; exit 2; }
DATA=/srv/reserve/private/data
DIR=$DATA/backups
mkdir -p "$DIR"
OUT="$DIR/reserve-$(date +%Y%m%d-%H%M%S)-$LABEL.db"
# 書き込み中でも整った控えになるよう、SQLite のバックアップ機能で写す（サーバーに sqlite3 コマンドはないので PHP で）
sudo -u apache php -r '
$src = new SQLite3($argv[1], SQLITE3_OPEN_READONLY); $src->busyTimeout(10000);
$dst = new SQLite3($argv[2]);
if (!$src->backup($dst)) { fwrite(STDERR, "backup failed\n"); exit(1); }
$ok = $dst->querySingle("PRAGMA integrity_check");
if ($ok !== "ok") { fwrite(STDERR, "integrity: $ok\n"); exit(1); }
' "$DATA/reserve.db" "$OUT" || { rm -f "$OUT"; echo "控えを取れませんでした" >&2; exit 1; }
chmod 600 "$OUT"
# 反映前などの控えは新しい40件だけ残す（毎日3時の自動の控えは別の場所・別の仕組み）
ls -1t "$DIR"/reserve-*.db 2>/dev/null | tail -n +41 | xargs -r rm -f
echo "backup ok $OUT"

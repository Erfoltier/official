#!/bin/bash
# LANE RESERVE（予約システム）＋ LINE 連携を、新しい院のサーバー1台に入れる。
# 対象：AWS EC2 などの Amazon Linux 2023（root で実行）。手順と前提は docs/INSTALL.md。
#
# 使い方：
#   sudo bash install.sh --reserve reserve.example.jp --monshin monshin.example.jp \
#        --email admin@example.jp --package app-<コミット>.tgz [--bucket <S3 の置き場所>] [--no-basic-auth]
#   --reserve  予約画面のドメイン（スタッフが使う）
#   --monshin  問診票・LINE の受け口のドメイン（患者が使う。ログインなし）
#   --email    証明書（Let's Encrypt）の連絡先
#   --package  一式（静的書き出し＋PHP。docs/SPEC.md「反映の手順」と同じ形の app-<コミット>.tgz）
#   --bucket   以後の反映で一式を取りに行く S3（なければ release に .tgz を渡す）
#   --no-basic-auth  予約画面の入口の鍵（Basic 認証）を掛けない（既定は掛ける。スタッフの PIN の前にもう1枚）
# 2回目以降に流しても、作った鍵・データ・設定は消さない（足りないものだけ作る）。
set -euo pipefail

RESERVE="" MONSHIN="" EMAIL="" PKG="" BUCKET="" BASIC=1
while [ $# -gt 0 ]; do
  case "$1" in
    --reserve) RESERVE=$2; shift 2 ;;
    --monshin) MONSHIN=$2; shift 2 ;;
    --email) EMAIL=$2; shift 2 ;;
    --package) PKG=$2; shift 2 ;;
    --bucket) BUCKET=$2; shift 2 ;;
    --no-basic-auth) BASIC=0; shift ;;
    *) echo "知らない指定です：$1" >&2; exit 2 ;;
  esac
done
for v in RESERVE MONSHIN EMAIL PKG; do [ -n "${!v}" ] || { echo "--${v,,} を指定してください" >&2; exit 2; }; done
[[ "$RESERVE" =~ ^[a-z0-9.-]+$ && "$MONSHIN" =~ ^[a-z0-9.-]+$ ]] || { echo "ドメインの形が正しくありません" >&2; exit 2; }
[ -f "$PKG" ] || { echo "一式が見つかりません：$PKG" >&2; exit 2; }
[ "$(id -u)" = 0 ] || { echo "root で実行してください" >&2; exit 2; }
R=$(basename "$PKG" .tgz); R=${R#app-}
[[ "$R" =~ ^[0-9a-f]{7,40}$ ]] || R=$(date +%Y%m%d%H%M%S | sha1sum | cut -c1-7)
HERE=$(cd "$(dirname "$0")" && pwd)
say() { printf '\n== %s\n' "$1"; }

say "1/8 必要なソフトを入れる"
dnf -y -q install httpd mod_ssl php8.3 php8.3-fpm php8.3-gd php8.3-mbstring php8.3-pdo php8.3-xml php8.3-sodium php8.3-opcache php8.3-process python3 >/dev/null
if [ ! -x /opt/certbot/bin/certbot ]; then
  python3 -m venv /opt/certbot && /opt/certbot/bin/pip -q install --upgrade pip certbot
fi
systemctl enable -q --now php-fpm httpd

say "2/8 置き場所を作る（/srv/reserve）"
install -d -m 755 /srv/reserve /srv/reserve/releases /srv/reserve/bin /var/www/acme
install -d -m 700 -o apache -g apache /srv/reserve/private /srv/reserve/private/data /srv/reserve/private/intake /srv/reserve/private/intake/intake-records
install -m 755 "$HERE/backup.sh" /srv/reserve/bin/backup
install -m 755 "$HERE/release.sh" /srv/reserve/bin/release
cat > /srv/reserve/deploy.conf <<CONF
# release が読む、この院の値（install.sh が作成）
PUBLIC_URL="https://$RESERVE"
DEPLOY_BUCKET="$BUCKET"
CONF

say "3/8 一式を展開する"
REL=/srv/reserve/releases/$R
if [ ! -d "$REL/app" ]; then
  mkdir -p "$REL" && tar xzf "$PKG" -C "$REL" && chown -R root:root "$REL"
fi
ln -sfn "$REL/app" /srv/reserve/app.new && mv -T /srv/reserve/app.new /srv/reserve/app

say "4/8 設定ファイル（鍵は自動で作る。2回目以降は作り直さない）"
CONF=/srv/reserve/private/config.php
if [ ! -f "$CONF" ]; then
  rnd() { php -r "echo bin2hex(random_bytes($1));"; }
  PIN=$(php -r 'echo random_int(100000, 999999);')
  cat > "$CONF" <<PHP
<?php
// この院の設定（install.sh が作成）。鍵は外に出さない
return [
    'seed' => 'standard',
    'base_path' => '',
    'db_dsn' => 'sqlite:/srv/reserve/private/data/reserve.db',
    'encryption_key' => '$(rnd 32)',
    'session_secret' => '$(rnd 32)',
    'initial_admin_pin' => '$PIN',
    'integration_token' => '$(rnd 24)',
    'monshin_url' => 'https://$MONSHIN/',
    'intake' => [
        'queue_dir' => '/srv/reserve/private/intake',
        'token_secret' => '$(rnd 32)',
        'liff_id' => '',
        'special_dates' => [],
    ],
    'line_intake_dir' => '/srv/reserve/private/intake/intake-records',
];
PHP
  chown apache:apache "$CONF" && chmod 600 "$CONF"
  echo "院長の最初のログイン PIN：$PIN（ログイン後に変えてください。この画面以外には残りません）"
else
  echo "設定ファイルはあるので、そのまま使います"
fi
# 予約申請フォームの LIFF ID は、LINE Developers で作ったあと次で入れる：
#   sudo sed -i "s/'liff_id' => '[^']*'/'liff_id' => '（LIFF ID）'/" /srv/reserve/private/config.php

say "5/8 データの用意（初回だけ、汎用の最小限のレーン・メニューを入れる）"
sudo -u apache RESERVE_CONFIG=$CONF php -r 'require "/srv/reserve/app/lib/bootstrap.php"; Store::init(); echo "ok\n";'

say "6/8 証明書（Let's Encrypt）"
cat > /etc/httpd/conf.d/10-reserve-http.conf <<APACHE
<VirtualHost *:80>
  ServerName default.invalid
  <Location />
    Require all denied
  </Location>
</VirtualHost>
<VirtualHost *:80>
  ServerName $RESERVE
  ServerAlias $MONSHIN
  Alias /.well-known/acme-challenge/ /var/www/acme/.well-known/acme-challenge/
  <Directory /var/www/acme>
    Require all granted
  </Directory>
  RewriteEngine On
  RewriteCond %{REQUEST_URI} !^/\.well-known/acme-challenge/
  RewriteRule ^ https://%{HTTP_HOST}%{REQUEST_URI} [R=301,L]
</VirtualHost>
APACHE
rm -f /etc/httpd/conf.d/welcome.conf
systemctl reload httpd
if [ ! -d /etc/letsencrypt/live/reserve ]; then
  /opt/certbot/bin/certbot certonly -n --agree-tos -m "$EMAIL" --webroot -w /var/www/acme --cert-name reserve -d "$RESERVE" -d "$MONSHIN"
fi
cat > /etc/systemd/system/certbot-renew.service <<'UNIT'
[Unit]
Description=Renew Let's Encrypt certificates
[Service]
Type=oneshot
ExecStart=/opt/certbot/bin/certbot renew -q --deploy-hook "systemctl reload httpd"
UNIT
cat > /etc/systemd/system/certbot-renew.timer <<'UNIT'
[Unit]
Description=Renew Let's Encrypt certificates twice a day
[Timer]
OnCalendar=*-*-* 03,15:17:00
RandomizedDelaySec=1h
Persistent=true
[Install]
WantedBy=timers.target
UNIT

say "7/8 予約画面・問診票の入口（HTTPS）"
AUTH=""
if [ "$BASIC" = 1 ]; then
  if [ ! -f /etc/httpd/reserve.htpasswd ]; then
    BPASS=$(php -r 'echo bin2hex(random_bytes(8));')
    htpasswd -bcB /etc/httpd/reserve.htpasswd staff "$BPASS" >/dev/null
    chown root:apache /etc/httpd/reserve.htpasswd && chmod 640 /etc/httpd/reserve.htpasswd
    echo "予約画面の入口の鍵：ユーザー staff ／パスワード $BPASS（院内のブラウザに1回覚えさせる。この画面以外には残りません）"
  fi
  AUTH=$(cat <<'BLOCK'
  <Location />
    AuthType Basic
    AuthName "LANE RESERVE"
    AuthUserFile /etc/httpd/reserve.htpasswd
    <RequireAny>
      Require valid-user
      # 外部連携は合言葉の見出しがあるときだけ入口の鍵を省く（値はアプリが確かめる）
      Require expr "%{THE_REQUEST} =~ m#^[A-Z]+ /api/v1/integration/# && (-n %{HTTP:X-Integration-Token} || -n %{HTTP:X-Device-Token})"
      Require expr "%{THE_REQUEST} =~ m#^[A-Z]+ /api/v1/integration/booking/# && %{THE_REQUEST} !~ m#\.\.|%2e#i"
      Require expr "%{THE_REQUEST} =~ m#^GET /integrations/line-chat-privacy\.html[ ?]#"
    </RequireAny>
  </Location>
BLOCK
)
fi
cat > /etc/httpd/conf.d/20-reserve-https.conf <<APACHE
<VirtualHost *:443>
  ServerName $RESERVE
  DocumentRoot /srv/reserve/app
  SSLEngine on
  SSLProtocol -all +TLSv1.3
  SSLCertificateFile /etc/letsencrypt/live/reserve/fullchain.pem
  SSLCertificateKeyFile /etc/letsencrypt/live/reserve/privkey.pem
  Header always set Strict-Transport-Security "max-age=31536000; includeSubDomains"
  <Directory /srv/reserve/app>
    Options -Indexes +FollowSymLinks
    AllowOverride All
    Require all granted
  </Directory>
  <DirectoryMatch "^/srv/reserve/(releases/[^/]+/)?app/(tools|lib|seed|cron)">
    Require all denied
  </DirectoryMatch>
$AUTH
</VirtualHost>
<VirtualHost *:443>
  ServerName $MONSHIN
  DocumentRoot /srv/reserve/app/monshin
  DirectoryIndex index.php index.html
  SSLEngine on
  SSLProtocol -all +TLSv1.3
  SSLCertificateFile /etc/letsencrypt/live/reserve/fullchain.pem
  SSLCertificateKeyFile /etc/letsencrypt/live/reserve/privkey.pem
  Header always set Strict-Transport-Security "max-age=31536000; includeSubDomains"
  <Directory /srv/reserve/app/monshin>
    Options -Indexes +FollowSymLinks
    AllowOverride None
    Require all granted
  </Directory>
</VirtualHost>
APACHE
grep -q "RESERVE_CONFIG" /etc/php-fpm.d/www.conf || echo "env[RESERVE_CONFIG] = /srv/reserve/private/config.php" >> /etc/php-fpm.d/www.conf
apachectl configtest
systemctl restart php-fpm && systemctl reload httpd

say "8/8 リマインドの自動送信（10分ごと）・証明書の更新"
cat > /etc/systemd/system/reserve-reminders.service <<'UNIT'
[Unit]
Description=LANE RESERVE reminders (cron/reminders.php)
[Service]
Type=oneshot
User=apache
Group=apache
Environment=RESERVE_CONFIG=/srv/reserve/private/config.php
WorkingDirectory=/srv/reserve/app/cron
ExecStart=/usr/bin/php /srv/reserve/app/cron/reminders.php
TimeoutStartSec=540
UNIT
cat > /etc/systemd/system/reserve-reminders.timer <<'UNIT'
[Unit]
Description=Run LANE RESERVE reminders every 10 minutes
[Timer]
OnCalendar=*:0/10
Persistent=true
[Install]
WantedBy=timers.target
UNIT
systemctl daemon-reload
systemctl enable -q --now reserve-reminders.timer certbot-renew.timer
echo "$(date -Is) $R install" >> /srv/reserve/releases/RELEASES.log
/srv/reserve/bin/backup after-install >/dev/null

say "できあがり"
echo "予約画面：https://$RESERVE/   問診票：https://$MONSHIN/"
echo "LINE の Webhook URL：https://$MONSHIN/line.php"
echo "LIFF のエンドポイント URL：予約申請フォーム https://$MONSHIN/intake/ ／ LINE の問診票 https://$MONSHIN/liff/"
echo "続きは docs/INSTALL.md の「入れたあとに画面で設定すること」"

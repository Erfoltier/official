# ロリポップへの反映（ブラウザ版FTPを使う）

- `python3 ops/lolipop/sync.py`：`npm run build:static` の `out/` と `php/`（lib・api・seed・.htaccess）を ishidahihuka.jp/reserve/ に置く。
- ID・パスワードは環境変数 `LOLIPOP_ID` / `LOLIPOP_PASSWORD` からだけ読む（画面やログに出さない）。
- サーバー上の `data/`（患者データ）と `config.php`（鍵）には決して触れない（sync.py の NEVER）。

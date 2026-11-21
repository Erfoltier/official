# 記録（毎回は読まない。前のことを答える・前提にするときだけ開く）

1. [docs/STATUS.md](docs/STATUS.md)：今の状態・残っている作業
2. [docs/HISTORY.md](docs/HISTORY.md)：院長の決定・好み・経緯（会話が長くなって前のことを忘れても、ここが正本）
3. [docs/SPEC.md](docs/SPEC.md)：今の仕様・約束事・反映の手順
4. [docs/INSTALL.md](docs/INSTALL.md)：新しい院（他院・他社販売）への入れ方
5. [docs/RECOVERY.md](docs/RECOVERY.md)：止まったときの手順（院内・立て直し・練習）

- 前のことを答えるときは、記憶で答えず、上の3つ・`git log`・本番で確かめてから答える
- 作業を終えたら、同じコミットで STATUS.md（残りの作業・数字）と HISTORY.md（新しい指示・決定・出来事を1〜3行）を直す。仕様を変えたら SPEC.md も直す
- 同じ仕事をする仕組みを二重に作らない

**Codex は 2026-11-02 から参照のみ（院長の指示）。本番への反映・データ操作・一式の S3 への置き場所への書き込みはできない。反映は Claude が行う。予約の入力・変更・取り消しと新しい患者の登録だけは、自動予約の接続キー（HTTPS の API）でできる。** **本番（EC2）の反映は必ず `sudo /srv/reserve/bin/release <コミット> claude`、本番データの一括操作やサーバー上のファイルの直接修正の前は必ず `sudo /srv/reserve/bin/backup <理由>`。予約データの控えを取らずに本番を変えない。**

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# 作業の前に必ず読む（この順）

1. [docs/STATUS.md](docs/STATUS.md)：今の状態・残っている作業
2. [docs/HISTORY.md](docs/HISTORY.md)：院長の決定・好み・経緯（会話が長くなって前のことを忘れても、ここが正本）
3. [docs/SPEC.md](docs/SPEC.md)：今の仕様・約束事・反映の手順

- 前のことを答えるときは、記憶で答えず、上の3つ・`git log`・本番で確かめてから答える
- 作業を終えたら、同じコミットで STATUS.md（残りの作業・数字）と HISTORY.md（新しい指示・決定・出来事を1〜3行）を直す。仕様を変えたら SPEC.md も直す
- 同じ仕事をする仕組みを二重に作らない

**本番（EC2）の反映は必ず `sudo /srv/reserve/bin/release <コミット> <claude か codex>`、本番データの一括操作やサーバー上のファイルの直接修正の前は必ず `sudo /srv/reserve/bin/backup <理由>`。予約データの控えを取らずに本番を変えない。**

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# 仕様（必ず先に読む）

このアプリの今の仕様・約束事・反映の手順は [docs/SPEC.md](docs/SPEC.md)。直す・足すときは先に読み、仕様を変えたら同じコミットで SPEC.md も直す。同じ仕事をする仕組みを二重に作らない。

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

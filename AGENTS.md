# このリポジトリで作業するとき（Codex など）

主なアプリは LANE RESERVE（`apps/reserve`）。作業の前に必ず次を読む。

1. `apps/reserve/docs/STATUS.md`：今の状態・残っている作業
2. `apps/reserve/docs/HISTORY.md`：院長の決定・好み・経緯
3. `apps/reserve/docs/SPEC.md`：仕様・約束事・反映の手順
4. `apps/reserve/AGENTS.md`：作業の決まり（本番の反映は `release`、データ操作の前は `backup`）

作業を終えたら、同じコミットで STATUS.md・HISTORY.md（仕様を変えたら SPEC.md も）を直す。

# LANE RESERVE（apps/reserve）で作業するとき

- 院長への返事は日本語。結論から短く、トークンを節約する
- 作業は全部この会話で（反映・本番データ操作も）。本番を変える前は必ず控え：反映は `sudo /srv/reserve/bin/release <コミット> claude`、データ操作の前は `sudo /srv/reserve/bin/backup <理由>`
- 患者情報・鍵をログ・チャット・コミットに出さない。患者情報を Google に通さない。メールは SMTP（AWS SES は使わない）
- 同じ働きの仕組みを二重に作らない。裏側の処理は PHP だけ
- Air は 10/22 に終了済み。自動予約（ChatGPT／Codex）は試験中
- **前のこと（経緯・決定・設定・残りの作業）を答える・前提にするときは、記憶で答えず、その時だけ次を開いて確かめる**（毎回は読まない）
  - 残りの作業・今の状態：`apps/reserve/docs/STATUS.md`
  - 院長の決定・好み・経緯：`apps/reserve/docs/HISTORY.md`
  - 仕様・反映の手順：`apps/reserve/docs/SPEC.md`
- 作業を終えたら、同じコミットで STATUS.md と HISTORY.md（新しい決定を1〜3行）を直す

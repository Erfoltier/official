# Airリザーブ → 予約カレンダーの差分の同期（手動）

切り替えの日まで、Airリザーブで入った予約の追加・キャンセル・変更を、予約カレンダーに写す。向きは Air → 予約カレンダーの一方向。

- 試し運転（件数だけ。書き込まない）：`python3 apps/reserve/ops/airsync/airsync.py`
- 書き込む：`python3 apps/reserve/ops/airsync/airsync.py --apply`
- 必要な環境変数：`AIR_ID` `AIR_PASSWORD` `RESERVE_BASIC_USER` `RESERVE_BASIC_PASS` `RESERVE_MIGRATION_PIN`（移行用スタッフ。管理者でなくてよい）
- 画面に出すのは件数だけ。患者の名前・メモは出さない。
- 予約カレンダーで「来院」「完了」などにした予約は触らない。予約カレンダーでキャンセルしたのに Air では確定のものは、件数を出すだけで触らない（院長に確認）。
- 「〇〇看護師出勤」などスタッフの枠は、予約にせず Todaysメモに書き足す。
- Air に「お知らせ」が出ていると読めないので、院長がブラウザで閉じてから実行する。

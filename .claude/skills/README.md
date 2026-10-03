# プロジェクトスキル一覧

このリポジトリでClaude Codeを開くと、ここにあるスキルが自動で読み込まれます。`/スキル名` で直接呼び出すこともできます。

## 自作スキル

| スキル | 内容 |
|---|---|
| `medical-ad-check` | 医療広告ガイドライン・薬機法・ステマ規制のチェックと言い換え案 |
| `clinic-proposal` | AIサービス案を美容クリニック向けの提案資料に整える |
| `counseling-summary` | カウンセリングの書き起こしから、カルテ下書き・患者さま向けサマリー・フォロー文面を作る |

## 外部スキル（コピーして同梱）

| スキル | 取得元 | 取得時のコミット | ライセンス |
|---|---|---|---|
| `remotion-best-practices` | [remotion-dev/skills](https://github.com/remotion-dev/skills)（他のRemotionスキルをすべて内包する入口スキル） | `0b5db9d` | Remotionのライセンスに従う（※） |

※ Remotion本体は、従業員4人以上の企業が使う場合に有料のCompany Licenseが必要です。詳しくは https://www.remotion.dev/license を確認してください。

更新するときは取得元のリポジトリを clone し直して、該当フォルダを上書きコピーし、上の表の「取得時のコミット」も更新します。

## プラグイン（`.claude/settings.json` で有効化）

以前はスキルをコピーして同梱していたもののうち、公式プラグインがあるものはプラグインに切り替えました（スキルが二重に読み込まれるのを避けるため）。プラグイン版は配布元の更新が自動で反映されます。

| プラグイン | 中身 |
|---|---|
| `superpowers` | `brainstorming`、`writing-plans`、`systematic-debugging` など15個のスキル。セッション開始時に `using-superpowers` を自動で読み込む |
| `playwright` | ブラウザ操作の道具（旧 `playwright-cli` スキルの代わり） |
| `claude-code-setup` | `claude-automation-recommender` |
| `frontend-design` | `frontend-design` |
| `skill-creator` | `skill-creator` |
| `canva` | Canvaのデザイン作成・編集（Canvaアカウントとの接続が必要） |

いずれも Anthropic 公式マーケットプレイス（`claude-plugins-official`）から読み込みます。

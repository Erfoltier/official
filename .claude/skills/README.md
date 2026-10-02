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
| superpowers 一式（`brainstorming`、`writing-plans`、`executing-plans`、`test-driven-development`、`systematic-debugging`、`using-superpowers` など15個） | [obra/superpowers](https://github.com/obra/superpowers) | `8ca22db` | MIT（`using-superpowers/LICENSE-superpowers`） |
| `playwright-cli` | [microsoft/playwright-cli](https://github.com/microsoft/playwright-cli) | `b85c7a7` | Apache-2.0 |
| `claude-automation-recommender`（claude-code-setup プラグインのスキル） | [anthropics/claude-plugins-official](https://github.com/anthropics/claude-plugins-official) | `ab024cd` | Apache-2.0 |
| `frontend-design` | 同上 | `ab024cd` | Apache-2.0 |
| `skill-creator` | 同上 | `ab024cd` | Apache-2.0 |

※ Remotion本体は、従業員4人以上の企業が使う場合に有料のCompany Licenseが必要です。詳しくは https://www.remotion.dev/license を確認してください。

### 外部スキルを更新するには

取得元のリポジトリを clone し直して、該当フォルダを上書きコピーしてください。上の表の「取得時のコミット」も更新します。

### 補足

- superpowers は本来プラグインとして配布されていて、プラグイン版ではセッション開始時に `using-superpowers` を自動で読み込むフックが付きます。ここではスキルだけを同梱しているので、必要なら最初に `/using-superpowers` を呼び出してください
- `playwright-cli` は `playwright-cli` コマンド（または `npx playwright`）を使います。初回に `npm install -g @playwright/cli` などのインストールが必要になることがあります

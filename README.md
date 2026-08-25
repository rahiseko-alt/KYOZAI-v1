# KYOZAI v1

資料を、教えられる教材へ変換するCodex Skill群とNext.jsアプリのリポジトリです。資料分析、1スライド1テーマの構成、講師台本、画像生成、検証、納品ZIPまでを同じ工程契約で扱います。

公開サイト: <https://kyozai-v1.vercel.app>

> 公開サイトは現在ポートフォリオ表示のみです。教材生成は安全性、費用上限、長時間処理を認証された環境で再検証しており、Productionでは利用できません。

## 収録Skill

| Skill | 役割 |
| --- | --- |
| [`kyozai-orchestrator`](.agents/skills/kyozai-orchestrator/SKILL.md) | 必要なSkillを選択し、教材パッケージ全体を統括 |
| [`kyozai-slide`](.agents/skills/kyozai-slide/SKILL.md) | 資料からスライド、台本、画像、検証証跡、ZIPを作成する正本 |
| [`kyozai-design`](.agents/skills/kyozai-design/SKILL.md) | 参考資料を分析し、再利用可能なデザインプロファイルを作成 |
| [`kyozai-support`](.agents/skills/kyozai-support/SKILL.md) | 事前資料、登壇用カンペ、事後資料を作成 |
| [`kyozai-movie`](.agents/skills/kyozai-movie/SKILL.md) | スライド要素のモーションと動画絵コンテを設計 |
| [`kyozai-revise`](.agents/skills/kyozai-revise/SKILL.md) | 完成教材へ範囲を限定した修正を安全に適用 |

旧ワークフローとの互換用に [`teaching-slide-package`](.agents/skills/teaching-slide-package/SKILL.md) も収録しています。新規利用では`kyozai-slide`を使用します。

## インストール

Codexへ正本Skillをインストールする場合は、次のGitHubパスを指定します。

```text
https://github.com/rahiseko-alt/KYOZAI-v1/tree/main/.agents/skills/kyozai-slide
```

複数Skillを連携させる場合は、リポジトリをcloneし、`.agents/skills/`にある必要なSkillをCodexのSkillディレクトリへ導入してください。同名Skillがある場合は、既存版を退避してから更新します。

## APP開発

```bash
corepack pnpm install --frozen-lockfile
pnpm --filter web dev
```

環境変数の名前と用途は [`apps/web/.env.example`](apps/web/.env.example) に記載しています。実値はリポジトリ、issue、PR、チャット、ログへ記録せず、ローカル環境またはVercelへ直接設定します。

Productionは生成APIを常に拒否します。生成工程の検証はローカル、E2E、Deployment Protectionを有効にしたPreviewに限定します。

## 検証

```bash
pnpm validate:process
pnpm validate:skills
pnpm --filter web typecheck
pnpm --filter web lint
pnpm --filter web test
pnpm -r build
bash scripts/smoke.sh
bash scripts/e2e.sh
```

mainでは`ci-green`、最新差分への承認1名、未解決会話なしをbranch protectionで必須化します。本番反映後は`prod-smoke`がポートフォリオの到達性、commit SHA、HSTS、生成APIの封鎖を検査します。

Git連携を使わずVercel CLIから本番配備する場合は、`KYOZAI_DEPLOY_COMMIT_SHA`へ配備元の公開commit SHAを渡し、`/api/health`と`prod-smoke`で照合します。

案件固有の字幕、入力資料、生成画像、動画情報はリポジトリへ保存しません。

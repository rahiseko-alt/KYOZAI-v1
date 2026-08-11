# read me

新しい案件を始めるための出発点となるリポジトリ。**このリポジトリ自体でアプリを作らない。**
コピー（または clone）して、コピー先で新しい案件の作業を始める。

## 同梱しているもの

- `AGENTS.md`：開発ルールの唯一の正。エージェント向けの運用規約
  （公開前提・秘密情報の扱い・実装の進め方・CI/PRの運用・完了の証明の作法）
- `.claude/skills/in-out`：セッションの開始（`in`）と終了（`out`）
- `.claude/skills/setup`：新規リポジトリの初期設定を1回だけ行う（雛形作成／既存コードの
  取り込み、CI・lint の疎通確認、引継ぎ先の作成まで）
- `.claude/agents/independent-verifier`：完了報告を、作業した本人以外の立場で独立検証する
- CI 3層（`quality` / `smoke` / `e2e`）＋ それらを1つに集約する `ci-green`
  （`.github/workflows/ci.yml`）。`scripts/setup.sh` はこの `ci-green` を branch protection の
  必須チェックにする
- `apps/web`：**最小の見本**（Next.js + TypeScript + pnpm）。トップページと `/api/health`、
  セキュリティヘッダ（CSP/HSTS 等）、それぞれのテスト・E2Eが1件ずつ入っている。
  「渡し方とチェックが本当に動いていること」を確かめるための取っ掛かりで、
  次の案件のコードそのものではない
- `presets/`：新規案件で使う雛形（`AGENTS.md` の下位版、`prod-smoke.yml` の見本）

## 使い方

1. このリポジトリをコピーする
2. 新しいリポジトリで `in`（`.claude/skills/in-out`）と伝える
3. `AGENTS.md`「コマンド」節が未記入なので `setup` skill が自動的に発火する。
   何を作るかを聞かれるので答える
4. `setup` の手順2で、同梱の見本（`apps/web`）を消してから、その案件の雛形を作る

エンジニアが手動で行う場合は `bash scripts/setup.sh`（branch protection を掛ける。
`gh` CLI の認証が要る）。

## 起動（見本 `apps/web` を触る場合）

必要なソフト: Node.js 22 以上、pnpm 10（`packageManager` で固定）。

```bash
pnpm install
pnpm dev
```

http://localhost:3000 を開く。

## コマンド

コマンドは `AGENTS.md` の「コマンド」節を正とする（現在は未記入。案件が決まったら埋める）。

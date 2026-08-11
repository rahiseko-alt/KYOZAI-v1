# 引継ぎメモ（handoff）

セッションをまたぐ**揮発的な引継ぎメモ**。**このファイルは毎回上書き**（最新1件だけを保持する）。

- 製品の定義（誰が使うか・差別化点・出す書類・調査で確定した事実）→ `docs/design.md`
- 過去の失敗の蓄積 → `docs/failures.md`（append-only・消さない）
- 開発の進め方・規約 → `AGENTS.md`

**恒久的な決定をこのファイルに書かない。** 上書きされて消えるうえ、`docs/design.md` と
食い違ったときに、次のセッションが古い仕様を実装してしまう。

## ①今回実施

**このリポジトリを、リフォーム見積アプリからテンプレートリポジトリに作り直した。**
以前はこのリポジトリ自体が見積アプリの本体だったが、そのコードとスキーマ・固有の検査
（本番URL・画面文言にハードコード結合していたもの）を全部外し、`setup` skill が
そのまま次の案件で使える最小の見本に置き換えた。

やったこと:

- `apps/web` の見積/下請/デモのドメインコードを全削除し、最小の見本（トップページ・
  `/api/health`・セキュリティヘッダ・そのテストとE2E1件ずつ）に作り直した
- `supabase/`（マイグレーション18本）を全削除。ローカル Supabase 起動に依存していた
  `scripts/smoke.sh` / `scripts/e2e.sh` / `.github/workflows/ci.yml` の該当ステップを削除
- `scripts/prod-demo-check.sh`（本番のデモ画面の並びを検査。544行）・`scripts/seed-demo.sh`・
  `.github/workflows/prod-demo-check.yml` を削除
- `.github/workflows/prod-smoke.yml` を削除し、`presets/prod-smoke.yml`（値がプレースホルダの
  見本）として保存。公開URLができたら `.github/workflows/` にコピーして使う
- `AGENTS.md`「コマンド」節を全欄「未記入」に戻した。「公開前提」「業務ドメインを決める
  ときの作法」は骨格を残して汎用化。「実装の進め方」「結合を増やさない」「完了の証明」は
  そのまま維持
- `docs/design.md` を見出しだけの雛形に戻した。`docs/flows.md` / `docs/manual.md` /
  `docs/plan-rebuild.md`（見積アプリ固有）は削除
- `docs/failures.md` は、開発運用一般に効く教訓（ルール設計・squashマージ運用・CI設計・
  秘密情報の扱い・検査基盤の作り方等）だけを残し、リフォーム業務ドメイン固有の項目
  （金額計算・PDF生成・業界様式・競合調査・デモ機能の不具合）を落とした。
  選別したこと自体を同ファイルに日付付きで追記済み
- `.claude/skills/setup/SKILL.md` を実態に合わせた（`packages/ui` は存在しないので記述から
  外し、`prod-smoke.yml` の扱いを `presets/` からのコピー手順に直した）
- `README.md` / ルート `package.json` を書き換えた

## ②今回トラブル

なし

## ③次回やる事

1. **`in` で次のセッションを始めると `AGENTS.md`「コマンド」節が未記入なので `setup` が
   発火する。** そこから手順1（何を作るか聞く）に入り、新しい案件の雛形として使う。
2. 検証（`pnpm -r typecheck` / `lint` / `test` / `build` / `pnpm audit` /
   `bash scripts/smoke.sh` / `bash scripts/e2e.sh`）と push・draft PR 作成はこのセッションの
   続きで行う。まだの場合はそこから再開する。

## ④まだ埋まっていない前提

なし（テンプレート状態のため、`docs/design.md` の各節が意図的に「未記入」のまま）

## ⑤分かっているが直していないこと

- `docs/failures.md` の append-only を機械で止めていない（元の見積アプリの記録から
  引き継いだ未解消事項）。
- **squash マージ後にブランチを作り直す規則を、機械で止めていない**（同上）。

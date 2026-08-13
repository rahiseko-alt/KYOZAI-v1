# Phase 0 工程契約 実装報告

作成日: 2026-08-13  
ブランチ: `codex/phase-0-process-contract`

## 実装範囲

現行`kyozai-slide` Skillを変更せず、APPへSkill同等工程を実装するための契約層を追加した。
Phase 0では公開生成経路を変更しない。

- `shared/kyozai-process-contract.json`: 10工程、モデル方針、成果物、再試行の正本
- `shared/kyozai-skill-baseline.json`: 現在のSkill bundle 3ファイルの正規化SHA-256
- `shared/schemas/kyozai-deck-spec.schema.json`: deck、台本文字数、時間、profile、layoutの契約
- `shared/schemas/kyozai-stage-ledger.schema.json`: 工程の状態、入出力、検証、再試行の契約
- `shared/fixtures/process-parity/fixtures.json`: 工程同等性を評価する5入力種別
- `apps/web/lib/kyozai/process-contract.ts`: 時間計算、状態遷移、deck validator、feature flag
- `scripts/validate-process-contract.mjs`: Skill baseline、工程順、モデル、profile mirrorの検証

## 固定した判断

- 同等性は生成結果の完全一致ではなく、工程、停止条件、検証、納品水準で判定する。
- APP内のプレビューと納品PNGは一致させるが、Skill版PNGとのhash一致は要求しない。
- 講師時間はAI申告値を使わず、台本のUnicode文字数を300文字/分で計算する。
- `compare`だけが2つのlabelsを持ち、それ以外のlabelsは空にする。
- 先頭を`cover`、末尾を`action`とし、同じlayout familyを3枚連続させない。
- 本文モデルは`gpt-5.5`を既定とし、`gpt-5.6-terra`を許可、`gpt-5.6-sol`を禁止する。
- 新pipelineは`PROCESS_PARITY_PIPELINE_ENABLED=1`を明示するまで停止する。

## 公開影響

なし。既存`/api/generate`、`/api/revise`、UI、HTML納品には接続していない。
Phase 1の縦断実装が終わるまで、feature flagを本番で有効にしない。

## 検証

- `pnpm validate:process`: PASS
- `pnpm --filter web test -- tests/process-contract.test.ts`: PASS、既存を含む28件
- `pnpm --filter web typecheck`: PASS

Windowsの制限環境では`node_modules/.pnpm`の読取が`EPERM`になったため、同じコマンドを許可済みの
外側環境で実行した。依存リンクは既知の手順`pnpm 11.16.0`で確認した。最終の全検証結果は、
本報告へ追記せず、CI run URLとcommit SHAを完了証拠として扱う。

## Phase 1開始条件

- Phase 0の全ローカル検証がPASSする。
- 現行Skill baseline検査がPASSする。
- 新pipelineのfeature flagがOFFである。
- Phase 0を1つのPRとしてレビューできる状態にする。

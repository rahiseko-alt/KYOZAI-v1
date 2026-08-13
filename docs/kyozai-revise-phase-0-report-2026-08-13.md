# KYOZAI Revise Phase 0 実装報告書

- 実施日: 2026-08-13
- 対象: KYOZAI Reviseの修正契約・検証基盤
- スライド画像生成・公開APP接続: 実施していない

## 1. 結論

自然言語修正をそのまま全体再生成へ渡さず、対象範囲、変更可能field、維持条件、影響artifact、
再試行、rollback、final昇格条件へ分解するPhase 0基盤を実装した。

局所修正の対象外変更を決定論的に検出できる。検証失敗版はfinalへ昇格せず、旧finalを維持する契約である。

## 2. 実装内容

- `.agents/skills/kyozai-revise/`: Skill正本、UI metadata、revision contract
- `shared/schemas/revision-request.schema.json`: 利用者指示とscope
- `shared/schemas/revision-plan.schema.json`: 型付きoperation、維持条件、最大2回再試行、rollback
- `shared/schemas/revision-validation.schema.json`: 差分・不変条件・昇格・復元の証跡
- `.agents/skills/kyozai-revise/scripts/validate_revision.mjs`: before/after/plan差分validator
- `shared/fixtures/revision-benchmark/benchmark.json`: 5分類、50件の修正評価fixture
- `scripts/validate-revision-benchmark.mjs`: Schema厳格コンパイルとfixture検査
- 共通job・artifact Schemaへ`kyozai-revise`とrevision artifactを追加

## 3. 対応operation

契約上は次の10種類を定義した。

`text.replace`、`text.rewrite`、`visual.replace-image`、`visual.relayout-slide`、
`visual.restyle-deck`、`slide.add`、`slide.remove`、`slide.move`、`source.correct`、`version.restore`。

Phase 0で実動するのは計画・Schema・差分検出までである。画像生成、教材再生成、公開APP操作は行わない。

## 4. 検証結果

| 検証 | 結果 |
|---|---|
| Skill Creator `quick_validate.py` | PASS（UTF-8 mode） |
| `pnpm validate:skills` | PASS、7 Skill |
| `pnpm validate:process` | PASS、10 stage |
| `pnpm validate:revise` | PASS、3 Schema、50 fixture、5 test |
| TypeScript | PASS |
| ESLint | PASS |
| 既存単体テスト | PASS、28件 |
| Production build | PASS |
| `git diff --check` | PASS |
| 起動smoke | 未達。Git Bash経路で無出力timeout |

Ajv 8をstrict modeで使い、JSONとして読めるだけでは見つからなかった条件Schemaの型不足を修正した。

## 5. 次工程

Phase 1では、まず`text.replace`と`text.rewrite`だけを実案件fixtureへ適用する。candidate versionを作り、
対象外hashが1件でも変われば不合格、旧final維持、全検証合格時だけcurrent参照更新という縦断を通す。
スライド画像モデルのAPP接続は別調査のまま停止する。

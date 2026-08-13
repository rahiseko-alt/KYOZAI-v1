---
name: kyozai-revise
description: KYOZAI Revise。完成済みKYOZAI教材へ自然言語の修正指示を適用する前に、対象範囲、型付き操作、維持条件、影響先、検証、復元方法を確定し、対象外変更を防ぐSkill。「この見出しだけ直して」「他を変えずに短くして」「このスライドだけ再配置」「順番を変えて」「前の版へ戻して」「修正計画」「変更差分を検証」等で発火する。
---

# KYOZAI Revise

完成済み教材を上書きせず、新しい検証済み版として局所修正する。自由文を直接生成処理へ渡さず、修正範囲と維持条件を先に機械可読化する。

## 入力

優先順に読む。

1. 現行版の`deck-spec.json`
2. `source-info.json`と根拠参照
3. `design-profile.json`
4. 講師台本、Support資料、画像検証
5. 利用者の修正指示

入力が不足して維持条件を証明できない場合は、finalを変更せず不足項目を返す。

## 手順

1. `references/revision-contract.md`を読む。
2. 修正指示を1個以上の型付きoperationへ分類する。
3. 対象slide、変更可能field、維持するfield、根拠、影響artifactを確定する。
4. `revision-request.json`と`revision-plan.json`をSchemaへ適合させる。
5. 現行finalのhashとversionを記録し、変更先を新しいdraft versionへ固定する。
6. 対象だけを変更し、対象外を前版から引き継ぐ。対象外を再生成しない。
7. 決定論的validatorでbefore、after、planを比較する。
8. 意味・デザインの達成検査を加え、全検証合格時だけ新versionをfinalへ昇格する。
9. 不合格時は最大2回まで同じscopeで修正し、解消しなければ旧finalを維持する。

Phase 0では、修正契約、差分検査、評価fixture、復元可能なversion計画までを扱う。画像生成APIや公開APPへ接続しない。

## 出力

```text
outputs/drafts/{job_id}/revisions/{revision_id}/
├─ revision-request.json
├─ revision-plan.json
├─ patch.json
├─ impact-report.json
├─ before-after.json
├─ revision-validation.json
└─ retry-log.json
```

既存finalを上書きしない。合格版は新しいversionとして保存し、親versionと復元先をmanifestへ記録する。

## 検証

差分validatorを実行する。

```powershell
node .agents/skills/kyozai-revise/scripts/validate_revision.mjs --before path/to/before.json --after path/to/after.json --plan path/to/revision-plan.json --output path/to/revision-validation.json
```

次をすべて満たすまでfinalへ昇格しない。

- 指示したoperationが達成されている。
- 対象外slideの表示文言と講師台本が一致する。
- 許可されていないfieldが変化していない。
- source参照、slide番号、台本、時間、関連artifactが整合する。
- 復元先versionが存在し、旧finalが保持されている。
- Schemaと必須品質検査が合格している。

## 禁止

- 自由文をscope未確定のまま生成処理へ渡す。
- 「このスライドだけ」で全deckを再生成する。
- 検証失敗版をfinalへ入れる。
- 既存finalを上書き、削除する。
- 画像だけ直して台本、時間、Support資料の影響を無視する。
- 高機能な手動編集UIを前提にする。

# KYOZAI 再審議記録帳

このファイルはappend-onlyで運用する。現在のGateの合格を妨げない計画外問題を記録し、
G6完了後に一括して再審議する。既存記録は削除・上書きしない。

## 記録形式

```text
## R-YYYYMMDD-NN 要約
- 発見日:
- 発見Gate:
- 症状:
- 再現方法:
- 放置可能な根拠:
- 想定影響:
- 再審議時の候補対応:
- 状態: goal_after_review
```

## 再審議待ち

なし。

## R-20260826-01 CodeRabbitがリポジトリ条件によりレビューを提供しない

- 発見日: 2026-08-26
- 発見Gate: G0
- 症状: PR #24のCodeRabbit checkが、リポジトリのstar数条件によりreview skippedとなった。
  `@coderabbitai review`を手動投稿してもレビューは開始されなかった。
- 再現方法: PR #24のCodeRabbit checkとbotコメントを確認する。
- 放置可能な根拠: G0の実package通常モード検証、致命的negative 10件、品質、build、smoke、E2E、
  CodeQL、集約`ci-green`は合格し、PRのmerge stateは`CLEAN`である。秘密情報、所有者分離、
  費用上限、データ消失、証拠の正当性を変更しない。
- 想定影響: CodeRabbitによる定性的な自動レビュー結果はG0証拠に含まれない。
- 再審議時の候補対応: CodeRabbitのOSS設定、review trigger条件、別の必須review経路を確認する。
- 状態: goal_after_review

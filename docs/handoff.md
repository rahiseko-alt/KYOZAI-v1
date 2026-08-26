# KYOZAI handoff

更新: 2026-08-26

## 現在のGate

- Gate: G1（直接入力の実縦断）
- ブランチ: `codex/g1-direct-input`
- 親Gate: G1
- ゴールへの寄与: 直接入力を実DB・Storage・Workflow・Providerで完走させ、停止後も
  二重課金なく完了またはterminal状態へ到達させる。
- 合格証拠: Preview実Provider完走、故障注入行列、provider usage突合、PNG／ZIP hash一致。

## 復帰先

- provider checkpoint、キャンセルsweeper、配備Cronのローカル実装と151テストは合格済み。
- 次はG1の故障注入行列を完成させ、disposable Previewでmigration適用と実縦断を行う。
- 寄り道中ではない。

## 外部ブロッカー

- disposable Preview Supabaseが未接続で、migration、private bucket、RLSの実適用証拠がない。
- Previewには必須環境変数が揃っていない。秘密値は運用者がエージェントを経由せず直接登録する。
- 上記が揃うまでPreview実Provider完走、usage突合、物理artifact hash一致は判定できない。

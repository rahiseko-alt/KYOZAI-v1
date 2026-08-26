# KYOZAI handoff

更新: 2026-08-26

## 現在のGate

- `【寄り道中 1/1｜G1-CRON-002｜復帰先Gate G1】`
- Gate: G1（直接入力の実縦断）
- ブランチ: `codex/g1-direct-input`
- 親Gate: G1
- ゴールへの寄与: 直接入力を実DB・Storage・Workflow・Providerで完走させ、停止後も
  二重課金なく完了またはterminal状態へ到達させる。
- 合格証拠: Preview実Provider完走、故障注入行列、provider usage突合、PNG／ZIP hash一致。

## 復帰先

- provider checkpoint、キャンセルsweeper、配備Cronのローカル実装、監査補正、158テストは合格済み。
- `G1-CRON-002`の終了条件: 現行頻度を許容するVercel plan、またはHobbyでも即時dispatchと有限時間retryを
  保証する計画変更のどちらかを利用者が選ぶ。
- 終了後はdisposable Previewでmigration適用と実縦断へ戻る。

## 外部ブロッカー

- disposable Preview Supabaseが未接続で、migration、private bucket、RLSの実適用証拠がない。
- Previewには必須環境変数が揃っていない。秘密値は運用者がエージェントを経由せず直接登録する。
- Vercel Hobbyは5分間隔Cronを拒否するため、現行`apps/web/vercel.json`ではPreview配備自体が失敗する。
- 上記が揃うまでPreview実Provider完走、usage突合、物理artifact hash一致は判定できない。

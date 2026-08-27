# KYOZAI handoff

更新: 2026-08-27

## 現在のGate

- `【寄り道中 1/1｜G1-CRON-002｜復帰先Gate G1】`
- Gate: G1（直接入力の実縦断）
- ブランチ: `codex/g1-resume`
- 親Gate: G1
- ゴールへの寄与: 直接入力を実DB・Storage・Workflow・Providerで完走させ、停止後も
  二重課金なく完了またはterminal状態へ到達させる。
- 合格証拠: Preview実Provider完走、故障注入行列、provider usage突合、PNG／ZIP hash一致。

## 復帰先

- provider checkpoint、キャンセルsweeper、監査補正、158テストは合格済み。
- 利用者決定: 運用費は0円、AI生成API費用だけを利用者ごとの実費とする。有料Vercel planは使わない。
- `G1-CRON-002`の終了条件: Vercel Cronを除去し、無料Supabaseのschedulerから認証済みdispatcher／cleanupを
  起動するmigrationとPreview実行証拠を得る。無料枠で不可能なら受付停止と計画再審議へ戻る。
- operator手順: `docs/zero-cost-scheduler-setup.md`。秘密値はエージェントを経由せず、VercelとSupabase Vaultへ直接登録する。
- 終了後はdisposable Previewでmigration適用と実縦断へ戻る。

## 外部ブロッカー

- disposable Preview Supabaseはこの端末で未ログインのため、project作成／選択、migration、private bucket、RLSの実適用証拠がない。運用者がSupabaseへログイン後に再開する。
- Vercel Previewで確認できた必須設定は`GEMINI_API_KEY`だけだった。`apps/web/.env.example`と`docs/zero-cost-scheduler-setup.md`にある残りの値は、運用者がエージェントを経由せず直接登録する。
- Vercel Hobbyは5分間隔Cronを拒否する。Vercel Cronを無料Supabase schedulerへ移す実装と実証が未完了。
- 上記が揃うまでPreview実Provider完走、usage突合、物理artifact hash一致は判定できない。

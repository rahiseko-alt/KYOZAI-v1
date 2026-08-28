# KYOZAI handoff

更新: 2026-08-28

## 現在のGate

- Gate: G1（直接入力の実縦断）
- ブランチ: `codex/g1-cloudflare-commands`
- 親Gate: G1
- ゴールへの寄与: Cloudflare上の実DB、private artifact、定期実行、認証境界を通して、
  直接入力を実Providerで完走させる。
- 合格証拠: Preview実Provider完走、故障注入行列、provider usage突合、PNG／ZIP hash一致。

## 復帰先

- 利用者決定: Supabase基盤は採用しない。Cloudflare D1、R2、Workersへ変更し、Vercelは画面配備に維持する。
- 運用費は0円、AI生成API費用だけを利用者ごとの実費とする。Free上限超過時は有料化せず、新規受付をfail-closedで停止する。
- G1実装設計: `docs/g1-cloudflare-foundation-plan-2026-08-28.md`。Workers Freeの10ms CPU制約により、
  CloudflareはD1/R2/state gateway/Cron、Vercel Workflowは重い生成工程を担当する。Preview認証は
  Cloudflare Access One-time PINとし、Vercel APIでAccess JWTを検証する。
- 完了: `apps/control-plane`にD1初期schema、private R2 binding、5分dispatch/6時間cleanup Cron、
  内部token境界、fail-closed healthを追加した。control-plane型検査、4境界テスト、local D1 migration、
  local `/health`=200（`acceptingNewJobs:false`）、web typecheck/lint、web 158 testsは合格した。
  Wrangler 4.126.0へ更新し、依存監査は脆弱性0件で合格している。
-  進行中: control-planeに内部token限定の`list/read/cancel/delete` command gatewayを追加した。owner IDを
  必須入力にし、全job読取・更新を`owner_id`条件で限定する。`create`も追加し、受付停止、Cloudflare
  budget、許可model、月次/日次quota、active job、idempotencyを判定してjob/revision/reservation/dispatchを
  D1 batchで作成する。local D1 fixtureで初回作成、同一入力の冪等再送、owner-scoped一覧取得、active job時の
  503拒否、同じ冪等キーで異なる入力の409競合を確認した。
  型検査、8境界テスト、依存監査は合格した。
- 次の着手: create commandのD1実fixture（許可・拒否・競合）を追加し、webのstate I/Oをgateway clientへ
  段階置換する。stage runのclaim commandを追加し、pending／期限切れleaseだけを原子的にrunningへ遷移させる。
  local D1 fixtureでclaim responseとjob/stageの同時running遷移、pass後のstarted_at保持・completed_at設定・lease解除、fail/retryのattempt遷移を確認した。artifactのdraft登録・checksum validation・final昇格command、private R2 streaming upload/downloadを追加した。draft readbackはinternal token限定のVercel Workflowだけに許可する。workflow dispatch schemaへcompleted/started/completed timestampsを追加し、local D1 migrationを合格した。outboxのclaim/record-started/renew/complete/requeue commandと、Preview flag下でそれを呼ぶVercel dispatcher clientを追加した。D1にprovider accountingのinflight列を追加し、期限切れleaseのstageをskipした後、usageをambiguousへ精算してjob/revision/dispatch/quotaを同一D1 batchでcancelledへ収束させる`settlePendingCancellations` commandを追加した。local D1 fixtureで、期限切れworkerは`settled:1`、job/revision/dispatch=`cancelled`、stage=`skipped`、usage/quota=`ambiguous`、inflight image/cost=`0`となることと、有効lease中は`settled:0`のまま`cancelling`を維持することを確認した。Vercel Workflow用のprivate R2 artifact clientを追加し、metadata登録、stream upload、server-only readback SHA-256照合後のvalidate、finalizeを型付きcommandで行えるようにした。readback不一致時はvalidateしない。provider reservation/settlementもD1 triggerでquota更新と同一transactionに移し、local fixtureで初回`shouldCall:true`、同一fingerprint再送`shouldCall:false`、confirmed後の`confirmed image/cost=1/10`と`inflight=0/0`を確認した。次はこれらclientをstate I/O置換と結線する。Webにはserver-onlyのcontrol-plane clientを追加済みで、tokenをブラウザーへ渡さず、
  通信不成立は503へfail-closedにする。Web全160テスト、型検査、lintは合格した。
- Supabase migration、scheduler手順、依存コードはCloudflareの同等実装が実証されるまで削除しない。

## 外部ブロッカー

- Cloudflare account、D1 database、R2 private bucket、Workersの実行設定は未作成。
- Cloudflare Access One-time PINを採用済みだが、Zero Trust organization、許可リスト、Access application、
  Vercel Previewを通す正規hostnameは未設定である。
- Vercel PreviewはReadyだが、Cloudflare基盤の実証に必要な環境変数は未登録。
- Windows/Node 24では`wrangler deploy --dry-run`がbundleとbinding解決後に`0xC0000409`で異常終了する。
  local D1 migrationとlocal Worker起動は合格しているが、Cloudflare実行環境またはCIでdry-runを再検証する。

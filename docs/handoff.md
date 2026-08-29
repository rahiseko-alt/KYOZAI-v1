# KYOZAI handoff

更新: 2026-08-29

## 2026-08-29 個人PWA設定確認

- Vercel Productionの既存設定を再確認し、`PROCESS_PARITY_PIPELINE_ENABLED`、`OPENAI_API_KEY`、`OPENAI_MODEL`、`GEMINI_API_KEY`が登録済みであることを値非表示で確認した。過去に済んでいる設定を再要求した説明は誤りだった。
- 個人PWA用の非秘密フラグ`KYOZAI_PERSONAL_PWA_ENABLED`をProductionへ登録した。個人PWA時のレート制限は追加料金のかかる共有Redisを使わず、プロセス内制限へ切り替えた。
- `KYOZAI_RENDER_GRANT_SECRET`、`KYOZAI_RATE_LIMIT_ID_SECRET`、`UPSTASH_REDIS_REST_URL`、`UPSTASH_REDIS_REST_TOKEN`はProductionの環境変数一覧に無かった。秘密値は受領・生成せず、署名設定が揃うまで画像生成経路はfail-closedとする。
- 個人PWAのProduction入口を`Workspace`へ分岐し、`manifest.webmanifest`、service worker、インストール用アイコンを追加した。PWA分岐テストを含むWebテスト178件、型検査、lint、Web buildは合格している。

## 現在のGate

- Gate: G1（直接入力の実縦断）
- ブランチ: `codex/g1-cloudflare-commands`
- 親Gate: G1
- ゴールへの寄与: Cloudflare上の実DB、private artifact、定期実行、認証境界を通して、
  直接入力を実Providerで完走させる。
- 合格証拠: Preview実Provider完走、故障注入行列、provider usage突合、PNG／ZIP hash一致。

## 2026-08-29 最新状態

- G1実装範囲（D1/R2/Workers gateway、dispatch、provider accounting、Access JWT所有者分離、direct-text経路）は実装済み。
- CIはtypecheck/lint/test/build、smoke、E2E、CodeQL、ci-greenが成功。local direct-text fixtureは作成、冪等性、所有者分離、D1 readback、cancel/deleteまで通過した。
- Windows版Wranglerの子processが終了後にportを解放しない問題は、G1のPreview受入を直接変えないためG6後へ再審議する。Productionは個人PWAフラグでのみ同期生成を許可する。
- G1未完了はR2契約なしによるバイナリ保存、実Provider証拠、署名鍵などのProduction秘密設定である。秘密値は利用者が直接登録するまでfail-closedとする。
- R2は利用者の「追加料金を払わない」決定により未契約。R2が有効化されるまでprivate artifactのPreview実Provider証拠は取得せず、生成受付はfail-closedのままにする。

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
  local D1 fixtureでclaim responseとjob/stageの同時running遷移、pass後のstarted_at保持・completed_at設定・lease解除、fail/retryのattempt遷移を確認した。artifactのdraft登録・checksum validation・final昇格command、private R2 streaming upload/downloadを追加した。draft readbackはinternal token限定のVercel Workflowだけに許可する。workflow dispatch schemaへcompleted/started/completed timestampsを追加し、local D1 migrationを合格した。outboxのclaim/record-started/renew/complete/requeue commandと、Preview flag下でそれを呼ぶVercel dispatcher clientを追加した。D1にprovider accountingのinflight列を追加し、期限切れleaseのstageをskipした後、usageをambiguousへ精算してjob/revision/dispatch/quotaを同一D1 batchでcancelledへ収束させる`settlePendingCancellations` commandを追加した。local D1 fixtureで、期限切れworkerは`settled:1`、job/revision/dispatch=`cancelled`、stage=`skipped`、usage/quota=`ambiguous`、inflight image/cost=`0`となることと、有効lease中は`settled:0`のまま`cancelling`を維持することを確認した。Vercel Workflow用のprivate R2 artifact clientを追加し、metadata登録、stream upload、server-only readback SHA-256照合後のvalidate、finalizeを型付きcommandで行えるようにした。readback不一致時はvalidateしない。provider reservation/settlementもD1 triggerでquota更新と同一transactionに移し、local fixtureで初回`shouldCall:true`、同一fingerprint再送`shouldCall:false`、confirmed後の`confirmed image/cost=1/10`と`inflight=0/0`を確認した。stage ensure commandを追加し、local D1 fixtureで初回`created:true`、同一stage再送`created:false`として同じpending runを返すことを確認した。passed stageのvalidated artifact ID検索とartifact metadata read commandを追加し、local D1 fixtureでそれぞれのgateway readbackを確認した。Workflow helperをfeature flag下でD1 stage ensure/claim/pass/fail、private R2 artifact read/write/readback/finalizeへ接続した。直接入力ではsource loaderもSupabase client無しで開始でき、attachmentは完全実装までfail-closedにする。次はjob read/complete/failとprovider checkpointをD1へ移す。Webにはserver-onlyのcontrol-plane clientを追加済みで、tokenをブラウザーへ渡さず、
  通信不成立は503へfail-closedにする。Web全160テスト、型検査、lintは合格した。
- Supabase migration、scheduler手順、依存コードはCloudflareの同等実装が実証されるまで削除しない。

## 外部ブロッカー

- Cloudflare accountとD1 database（`kyozai-preview`）は作成済み。R2 private bucketは追加料金を発生させない方針により未契約で、Workersの実行設定はdry-run後に再検証する。
- Cloudflare Access One-time PINを採用済みだが、Zero Trust organization、許可リスト、Access application、
  Vercel Previewを通す正規hostnameは未設定である。
- Vercel Productionには既存のprovider設定とpipeline flag、および個人PWA非秘密フラグを登録済み。署名鍵・共有Redis設定は未登録である。
- Windows/Node 24では`wrangler deploy --dry-run`がbundleとbinding解決後に`0xC0000409`（終了コード`3221226505`）で異常終了する。local D1 migrationとlocal Worker起動は合格しているが、Cloudflare実行環境またはCIでdry-runを再検証する。

## 最新の実装状態

- Workflowの直接入力経路で必要なjob read、正常完了、失敗時のfail-closed usage精算を、
  `KYOZAI_CLOUDFLARE_STATE_ENABLED=1`時にD1 command gatewayへ移した。local D1 fixtureで
  request read、job/revisionのcompleted、job/revisionのfailed、未使用quotaのreleasedを確認した。
- 次はprovider attemptのcheckpoint/result artifactをD1/R2へ移し、Supabaseを経由しない実Providerの
  二重呼出し防止と結果回復を完成させる。

- 完了: provider attemptをfeature flag下でD1 reservation/settlementとprivate R2 checkpointへ移した。
  checkpointは保存後にreadback SHA-256照合してからusageをconfirmedにし、同一fingerprintの再送は
  providerを呼ばずにprivate checkpointを回収する。Cloudflare分岐の回収contract testを追加した。
  次はdirect-text WorkflowをCloudflare stateのみで起動する実fixtureと、dispatch/job状態遷移の結合を検証する。

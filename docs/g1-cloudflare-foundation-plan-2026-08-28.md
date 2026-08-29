# G1 Cloudflare foundation plan

制定: 2026-08-28
状態: G1の実装前設計（実行正本 `docs/skill-app-parity-execution-plan-2026-08-26.md` に従属）

## Gate record

- 親Gate: G1
- ゴールへの寄与: 直接入力のjobを、所有者分離された永続状態、private artifact、定期起動、
  provider費用上限を通して実Providerへ安全に到達させる。
- この設計の合格証拠: ローカルのWorker/D1契約テスト、PreviewのD1 readback、Cloudflare Cronから
  Vercel dispatch/cleanupが起動した記録、Access認証済みの2所有者分離E2E。最終G1合格には加えて
  実Provider fixture、故障回復、usage突合、PNG/ZIP hash一致が必要である。

## 固定する境界

Cloudflare Workers Freeは1 invocationあたりCPU 10msである。
画像生成の結果処理、PDF検査、Sharpによる画像QA、ZIP組み立てをWorkerへ置くと、この上限で
実行を保証できない。従って責務を次のように分ける。

| 層 | 実行場所 | 責務 | 禁止すること |
| --- | --- | --- | --- |
| 画面/API | Vercel Next.js | Cloudflare Access JWTを検証し、所有者を確定してjob APIを公開する | JWT未検証のVercel直アクセスをjob APIへ通すこと |
| durable execution | Vercel Workflow | 本文生成、provider checkpoint、PDF検査、画像QA、ZIP作成 | Cloudflareの無料CPU枠に重い処理を移すこと |
| state gateway | Cloudflare Worker | Vercelからの署名済み内部要求だけを受け、D1 transactionとprivate R2のstreaming I/Oを行う | ブラウザーへのD1/R2直接公開、provider API呼出し、重い変換 |
| scheduler | Cloudflare Worker Cron | dispatchとcleanupをVercel内部APIへ認証付きで起動する | Vercel Cron、Supabase `pg_cron`、公開APIとしての起動 |

根拠: Cloudflare Workers FreeのCPU・request上限は
<https://developers.cloudflare.com/workers/platform/limits/>、Cron Triggerの`scheduled()`仕様は
<https://developers.cloudflare.com/workers/configuration/cron-triggers/> を確認した。

## 認証と所有者分離

G1 Previewの認証方式は、Cloudflare Access One-time PINを採用する。許可リストに載った確認済み
メールアドレスだけがAccess applicationへ到達し、email claimを内部の`owner_id`として固定する。
VercelはCloudflare Accessを経由して転送された`Cf-Access-Jwt-Assertion`を、team domainのJWKS、issuer、
application AUDで検証する。JWTが無い、失効、issuer/AUD不一致のどれでも、存在しないjobと同じ外部応答にする。

Cloudflare AccessのJWT検証と鍵ローテーションの公式手順は
<https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/>、
OTPの許可リスト挙動は
<https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/one-time-pin/> を根拠とする。

Vercelの直接URLはAccess headerを持たないため、`requireJobUser`が常に拒否する。G1のPreviewは
Access保護したCloudflare hostnameを正規入口にし、Cloudflare Worker reverse proxyがVercel Previewへ
検証済みheaderを渡す。これにより、Vercelを配備先として維持しつつ、直URL経由での認証回避を防ぐ。

Cloudflare gatewayはブラウザーJWTを信頼しない。Vercelだけが保持する`KYOZAI_CLOUDFLARE_GATEWAY_TOKEN`
で認証し、Vercelが検証済みAccess claimから導出したowner IDを渡す。gatewayはowner IDを任意の
クライアント入力として受理しない。

## D1/R2 migration

SupabaseのUUIDは外部契約として保持する。D1ではUUIDを`TEXT`、timestampをUTC ISO-8601 `TEXT`、
JSONBを`TEXT`、booleanを`INTEGER CHECK (value IN (0, 1))`へ写す。外部のartifact path、stage名、
status値、SHA-256、job/revision IDは変更しない。

| 現在のSupabase要素 | Cloudflare対応 | 移行上の不変条件 |
| --- | --- | --- |
| `jobs`, `job_revisions`, `stage_runs`, `workflow_dispatches` | D1 tables + `BEGIN IMMEDIATE` transaction | outbox lease、stage試行、cancel terminal化が原子的 |
| `artifacts`, `revision_artifact_refs`, `upload_sessions` | D1 metadata + private R2 objects | readback時のbyte数/SHA-256再検証 |
| `quota_reservations`, `usage_events`, provider attempts | D1 tables + unique fingerprint | reservation→confirmed/ambiguous/releasedが単調、二重課金なし |
| Supabase RPC群 | gatewayの型付きcommand endpoint | 1 commandにつきtransaction 1つ、所有者照合を最初に行う |
| Supabase signed upload/download URL | gatewayが短期R2 upload/download tokenを発行、またはVercelを経由してstream | bucketをpublicにしない |
| `pg_cron`/`pg_net` migration | Worker Cron `scheduled()` | dispatch 5分、cleanup 6時間、UTCで記録 |

Cloudflare D1 Freeは1日あたりread 500万行、write 10万行、総storage 5GBであり、超過するとD1 APIが
errorを返す。R2 Freeは月あたりstorage 10GB-month、Class A 100万、Class B 1,000万である。
このためgatewayは、D1/R2 usageを監視するだけでなく、保守的なapplication budgetを超えた時点で
新規jobを作らず`SERVICE_UNAVAILABLE`にする。provider呼出しより前に止め、Cloudflare有料planへは
移行しない。根拠: <https://developers.cloudflare.com/d1/platform/pricing/>、
<https://developers.cloudflare.com/r2/pricing/>。

## 実装順序

1. `apps/control-plane`をWrangler Workerとして追加し、D1 schema、R2 bindings、Cron、内部token検証、
   `/health`だけを実装する。D1/R2/Accessのbindingまたは設定が無ければfail-closedにする。
2. Supabase RPCをcommand単位へ移植する。最初はjob create/list/read/cancel/delete、次にupload/artifact、
   stage/dispatch/provider attempt、最後にrevision/cleanupとする。各commandは旧RPCと同じ入力・
   成功・競合・not-found隠蔽を契約テストで比較する。
3. `apps/web/lib/supabase/**`をCloudflare gateway clientへ置換し、`job-auth.ts`をAccess JWT検証へ置換する。
   `@supabase/supabase-js`、Supabase migration、Supabase scheduler手順は、この時点では削除しない。
4. Vercel Workflowのprovider、PDF、画像、ZIP工程を残したまま、state I/Oのみgateway経由に置換する。
   既存のprovider checkpoint再読込とstage idempotencyを維持する。
5. Cloudflare Cronから認証済みVercel dispatch/cleanupを実行し、lease回復・cancel settlement・物理削除を
   Previewで確認する。
6. disposable Previewでdirect-textの実Provider fixtureを完走し、D1 provider usage、checkpoint metadata、
   PNG/ZIP hash、2所有者E2E、故障注入行列を証拠として残す。

## 実行前の外部設定

利用者または運用者がCloudflareで直接行う（秘密値はこの会話へ入力しない）。

1. Workers Free account、Zero Trust organization、D1 databaseを作成する。R2は有料契約を伴うため作成しない。
2. Access One-time PIN identity providerと、G1 fixture利用者だけを許可するAccess applicationを作成する。
3. Access保護されたWorker hostnameをVercel Previewの正規入口に設定する。
4. CloudflareとVercelへ、名前だけを`.env.example`に記載する専用secretを直接登録する。
5. D1/R2のFree usage表示、Cron実行履歴、Vercel Preview URLを証拠として保存する。

この外部設定が存在しない間、実装はlocal/miniflare契約テストまで進める。実Provider fixtureと
Access E2Eは開始しない。

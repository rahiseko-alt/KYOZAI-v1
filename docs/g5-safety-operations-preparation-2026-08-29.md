# G5 削除・安全性・運用の実装準備

制定: 2026-08-29  
状態: 準備のみ（G5未着手、Gate状態は変更しない）  
実行正本: `docs/skill-app-parity-execution-plan-2026-08-26.md`

## Gate record

- 親Gate: G5（前提: G1〜G4の合格と各Gate PRのマージ）
- ゴールへの寄与: 期限切れ入力と論理削除済みjobをprivate R2から物理削除し、再開処理のartifact完全性、費用・待機・削除失敗の運用証拠を得る。
- G5合格証拠: `fault_injection_matrix`、`physical_deletion_record`、`operational_slo_report`。削除対象objectは完了後に認証済み内部readでも再取得できず、失敗時に終端化してはならない。
- 非目標: この文書は実装、schema変更、Cron設定、Gate進行、既存Supabase経路の削除を行わない。

## 現状と不足

| 領域 | 現在 | G5で必要な状態 |
| --- | --- | --- |
| job削除 | Supabaseの`claim_kyozai_deletion_cleanup`が10分leaseを取り、Storage削除後に`deleted`へ終端化する。D1/R2経路は未実装。 | D1で同等以上のleaseを取得し、R2の削除と再読不能確認後だけD1のartifact/jobを`deleted`にする。 |
| TTL | `jobs.expires_at`と`upload_sessions.expires_at`はD1にあるが、期限切れをcleanup対象化していない。 | 未使用uploadと期限切れjobを、live workflow leaseを壊さずcleanup対象にする。 |
| artifact再開 | 書込み直後はR2 readback hashを検証する。`readJsonArtifact`と既存画像復元は、利用直前のD1 byte size/SHA-256照合をまだ強制しない。 | 再開・parse・provider checkpoint回収の全読取で、D1記録のsizeとSHA-256を照合してから利用する。 |
| 運用観測 | Cronはdispatch 5分・cleanup 6時間の二種類だが、queue/stage/cost/deletion失敗を時系列に残すD1計測がない。 | 集計可能なoperation eventとSLO reportを残し、失敗はretry可能なnon-terminal状態として記録する。 |

## 実装順序とファイル単位の変更計画

1. D1 cleanup leaseと削除台帳を追加する。

   - 追加: `apps/control-plane/migrations/0006_g5_cleanup.sql`。
   - `jobs`に`deletion_lease_owner`、`deletion_lease_expires_at`、`cleanup_attempts`、`cleanup_last_error`を追加する。期限切れterminal jobはCronが明示的に`deleting`へ遷移させる。`running`、`cancelling`、有効なstage/dispatch leaseを持つjobは対象外とする。
   - `upload_sessions`には削除leaseと削除済み時刻を持たせる（またはjobと同じcleanup task tableを使う）。未使用かつ期限切れだけが対象で、`consumed_by_job_id`のあるsourceはjob削除leaseに従わせる。
   - `cleanup_operations`を追加する。対象種別、対象ID、lease owner/expiry、試行数、started/completed、error code、object count、削除済みobject countを記録し、R2 pathや利用者本文を運用eventへ複写しない。
   - cleanup対象をclaimするD1 commandは1件ずつ、期限切れleaseの再claimだけを許す。claimの応答はbucket/path/expected metadataを含む不変のwork listにする。

2. Cloudflare gatewayの型付きcleanup commandとprivate object削除を追加する。

   - 追加: `apps/control-plane/src/cleanup-commands.ts`。
   - 変更: `apps/control-plane/src/index.ts`、`apps/control-plane/src/artifact-objects.ts`、`apps/control-plane/src/job-commands.ts`。
   - commandsは`claim`、`markExpired`、`complete`、`fail`、`measure`に限定する。`complete`は同一lease owner・全objectの削除確認があるときだけartifact lifecycle=`deleted`、upload tombstone、job=`deleted`を同一D1 batchで確定する。
   - R2の`delete`はD1 transactionに含められない。したがって「D1 claim → R2 delete → R2 head/getで不存在確認 → D1 complete」のsagaに固定する。R2失敗・timeout・確認不能では`fail`だけを記録し、D1の論理削除途中状態を保つ。read APIは`deleting`/`deleted`/artifact `deleted`を存在しないものとして扱う。
   - 除去はobject ID/pathのallowlisted claim work listからのみ行う。リクエストが任意bucket/pathを指定する削除APIは作らない。

3. Vercel cleanup workerをCloudflare flag下で置換する。

   - 変更: `apps/web/lib/kyozai/deletion-cleanup.ts`、`apps/web/app/api/internal/jobs/cleanup/route.ts`、`apps/web/lib/kyozai/control-plane-client.ts`。
   - `runOneDeletionCleanup`はCloudflare state flag時にclaim結果だけを使い、Vercelからgatewayの内部endpointでR2 delete/readbackを実行する。Supabase実装はG1〜G4同等証拠が残るまでfallbackとして保持する。
   - Cron callerがPOSTであるため、cleanup routeはdispatch routeと同様に認証済み`POST`を受ける必要がある。現状は`invokeScheduler()`がPOSTを送る一方でcleanup routeが`GET`だけで、この不整合はG1のCloudflare Cron実証前に解消が必要である。
   - 6時間間隔はcleanupの遅延上限ではない。期限到来からclaim、削除完了までの時刻を計測し、SLO違反はjobを再公開せずoperation failureとして残す。

4. artifact利用直前の再hashを単一helperへ集約する。

   - 変更: `apps/web/lib/kyozai/control-plane-artifacts.ts`、`apps/web/lib/kyozai/job-workflow.ts`、`apps/web/lib/kyozai/job-workflow-artifacts.ts`、`apps/web/lib/kyozai/provider-attempt.ts`。
   - `readVerifiedPrivateControlPlaneArtifact`を唯一の読取入口にし、D1 artifact metadataのlifecycle、byte_size、SHA-256とR2 readbackを比較する。size/hashが無い、artifactがdraft/deleted、metadata JSONが不正、R2 objectがない場合はいずれもfail-closedにする。
   - JSON parse、既存slide image、package入力、provider checkpoint recoveryはこのhelperだけを使用する。provider checkpointのresult path/hash/sizeとartifact recordの両方が同じ値であることを確認する。
   - 不一致後はstageをpass/finalizeせず、providerを再呼出ししない。reserved usageは結果到達が不明なら`ambiguous`、明確に未呼出なら`released`とする。

5. 運用eventとSLO集計を実装する。

   - 追加: `apps/control-plane/src/operational-measurements.ts`、必要なら`apps/web/lib/kyozai/operational-measurements.ts`。
   - 計測値はqueue wait（dispatch create→workflow start）、stage duration（claim→pass/fail）、provider estimated/confirmed/ambiguous cost、cleanup age（expiry/delete request→physical confirmation）、cleanup retry数、failure codeである。利用者入力・artifact bytes・秘密値はeventに保存しない。
   - 集計commandは内部のみで、Preview実証用に期間、count、p50/p95/max、失敗数、未処理lease数を返す。Free tier上限・gateway不達時は新規job/providerをfail-closedとする既存方針を崩さない。

## fixture とテストのチェックリスト

| fixture / 試験 | 実施場所 | 合格条件 |
| --- | --- | --- |
| 期限切れ未使用upload | local D1 + private R2 | claim後にsource objectが不存在、sessionは再利用不可、他owner/未期限sessionは変化なし。 |
| 論理削除completed job | local D1 + private R2 | claim中はread/downloadが404相当、全artifact/sourceの不存在確認後にだけjob/artifact=`deleted`。 |
| R2 delete失敗 | fault injected Preview/local | leaseは終端化されずerror/retry時刻を記録。次leaseで冪等に完了。 |
| cleanup worker喪失 | local D1 | 有効leaseは奪えず、期限切れleaseだけが別ownerに再claimされる。二重`complete`は拒否。 |
| 再開時size不一致 | local + Preview | stage/package/provider checkpointを利用しない。provider再呼出しゼロ、usageは`ambiguous`または`released`の根拠に一致。 |
| 再開時SHA-256不一致 | local + Preview | 上記と同じ。D1 metadata更新やfinalizeを行わない。 |
| provider checkpoint消失 | Preview実Provider | confirmed usageを再課金せず、結果欠損としてfail-closed/ambiguousに収束する。 |
| queue/stage/cost/deletion計測 | local + Preview | measurement recordの時刻順、集計値、失敗数がfixtureの実行結果と一致。 |
| object再アクセス | Preview | cleanup完了後に内部gateway GET、Vercel read、owner downloadの全てが非存在応答。 |

実装時は少なくとも次を追加する。

- `apps/control-plane/fixtures/g5-expired-upload.sql`
- `apps/control-plane/fixtures/g5-deletion-lease.sql`
- `apps/control-plane/fixtures/g5-expired-lease-reclaim.sql`
- `apps/control-plane/fixtures/g5-rehash-mismatch.sql`
- `apps/control-plane/tests/cleanup-commands.test.ts`
- `apps/web/tests/g5-cleanup-contract.test.ts`
- `apps/web/tests/g5-rehash-recovery.test.ts`
- `apps/web/tests/g5-operational-measurements.test.ts`

fixtureは固定のダミーowner/ID/bytesだけを使い、実案件のartifactやprovider結果をリポジトリへ保存しない。R2を含むfixtureは使い捨てPreview namespaceで実行し、test終了時のobject不存在をassertする。

## 外部証拠の取得順序

1. CI: typecheck、lint、unit/contract test、build、smoke、E2E、依存監査のrun URLとcommit SHAを保存する。
2. Preview: Cron実行履歴、D1 claim/complete event、R2 object不存在のreadback、Vercel cleanup endpointの認証済み実行を同一fixture時刻で保存する。
3. Preview実Provider: 故障注入前後のusage reservation/settlement、provider呼出し数、recovery結果、PNG/ZIP hashを突合する。
4. SLO report: fixture期間、件数、queue/stage/cleanupの分位値、失敗・再試行・未完了leaseを含める。成功だけを抽出したレポートは不合格とする。

G5は上記の外部証拠が揃うまで完了扱いにせず、Production生成の404を維持する。

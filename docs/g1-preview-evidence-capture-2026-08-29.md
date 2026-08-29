# G1 Preview evidence capture

記録日: 2026-08-29  
状態: G1実証用（実行正本 `docs/skill-app-parity-execution-plan-2026-08-26.md` に従属）

## Gate record

- 親Gate: G1
- ゴールへの寄与: Cloudflare D1/R2/Worker、Cloudflare Access、Vercel Workflowを通るdirect-text実行を、再現可能な外部証拠として残す。
- 合格証拠: `preview_real_provider_run`、`fault_recovery_matrix`、`provider_usage_reconciliation`。

## 実行前の利用者設定

利用者がCloudflare/Vercelの管理画面で直接設定する。秘密値は会話、リポジトリ、ログに記録しない。

- Preview専用D1とprivate R2、Worker hostname、Workerの内部API認証変数を設定する。
- Cloudflare Access One-time PIN applicationを作り、fixture実行者だけを許可する。Vercel APIには`KYOZAI_CLOUDFLARE_ACCESS_ENABLED=1`、team domain、Audienceを設定する。
- Vercelにはcontrol-plane URL、内部API認証、実provider利用に必要な既存の環境変数を直接設定する。Productionの生成許可は設定しない。

## 証拠台帳

| ID | 実施 | 必須の外部証拠 | 合格条件 |
|---|---|---|---|
| G1-E1 | Access経由のdirect-text実Provider実行 | Preview URL、commit SHA、CI URL、job/revision ID、D1 readback、R2のPNG/ZIP SHA-256 | 最終状態がcompleted、R2 readback hashとmanifestが一致 |
| G1-E2 | 別Access利用者によるread/list/download | 2利用者のE2E結果、各HTTP status | 他者のjob/artifactは同一の非存在応答 |
| G1-E3 | provider応答受信後の故障注入と再開 | fault point、dispatch/usage readback、再開後のartifact hash | provider再呼出しなし、既存結果を回収 |
| G1-E4 | usage予約・確定・曖昧状態 | provider request fingerprint、usage/quota readback | 同一fingerprintの二重課金ゼロ、曖昧状態はfail-closed |
| G1-E5 | Cloudflare Cron dispatch/cleanup | Worker invocation記録、D1/R2 readback | 認証済みPOSTが完了し、所有者境界を越えない |

## 収集手順

1. `KYOZAI_E2E_MODE`を無効のまま、Access保護hostnameからdirect-textを1件実行する。
2. 実Provider呼出し前後のrequest fingerprint、D1 job/revision/stage/usage、private R2 objectのSHA-256を、秘密値を含めずに記録する。
3. E2〜E5を個別の使い捨てjobで実行する。failure injectionはPreview限定で有効化し、実行直後に無効へ戻す。
4. commit SHA、CI run URL、Preview URL、各readbackの時刻をPR #27の証拠欄へ添付する。証拠が揃うまでDraftを解除・マージしない。

## 禁止事項

- Production URLからの生成、Production unlock、実運用の秘密値の転記。
- fixture間のjob/revision/artifact再利用。
- providerの応答またはR2 hashを読まずに、HTTP 200だけで合格とすること。

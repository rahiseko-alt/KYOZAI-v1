# G4 自然言語revision実行・不変版 準備チェックリスト

- 記録日: 2026-08-29
- 親Gate: G4（現在のactive GateはG1。これは実装前の準備記録であり、Gate状態を変更しない）
- ゴールへの寄与: 型付きrevisionを独立して実行し、対象外artifactを変えず、失敗時も旧finalを保持して復元可能にする。
- G4合格証拠: `three_revision_runs`、`zero_untargeted_diffs`、`rollback_proof`。
- 着手条件と証拠記録: G1〜G3の必須実fixture・Preview証拠と各Gateの単一PR完了後にだけ、G4専用PRを開始する。そのPR説明に親Gate G4、上記のゴールへの寄与、3つの合格証拠ID、成功・失敗・復元fixture IDを固定する。完了時はcommit SHA、CI URL、PreviewのD1/R2 readback hash、provider usage突合、PC/mobile E2Eを証拠へ追記し、ローカル試験のみでGateを進めない。

## 現在地と不足

既にあるものは、`revision-request`／`revision-plan`／`revision-validation` Schema、50件の
revision benchmark、対象外deck差分を検出する
`.agents/skills/kyozai-revise/scripts/validate_revision.mjs`、およびSupabaseのcandidate lineage
である。Cloudflare D1にも`job_revisions`と`revision_artifact_refs`の土台がある。

しかし実行正本のG4 gapである`inert_revision_candidate`は残る。現在の
`createRevisionCandidate`はcandidate行を作るだけで、Cloudflareのrevision作成command、
revisionごとのoutbox、candidate専用workflow、validation artifact、atomic promotion、
restore commandを持たない。`workflow_dispatches.job_id`が一意であるため、初版のdispatchを
再利用してcandidateを安全に実行することもできない。既存`loadOrCreatePackage`をcandidateへ
そのまま流用すると全deckを再生成し、局所修正の対象外差分ゼロを破る。

## 実装順序（G1合格・G4 PR開始後）

1. **revision commandとD1 migrationを先に通す。**
   - `apps/control-plane/migrations/`へ、revisionごとに複数のdispatchを持てる一意制約へ安全に
     移行するmigrationを追加する。既存の初版dispatchを保ったまま、`(job_id, revision_id)`
     またはrevision単位の一意性を適用する。migration名／番号はG1 merge時点の最新番号に合わせる。
   - `revision_plans`（instruction hash、operation、target、allowed fields、invariants、base manifest
     hash、schema version）と`revision_validations`（candidate manifest hash、scope report、retry、
     promotion／rollback結果）のimmutable recordをD1へ追加する。JSON本文はprivate R2 artifactとして
     保存し、D1にはID・SHA-256・状態だけを持たせる。
   - `revision_artifact_refs`をcandidateの完全なmaterialization表として使う。未変更artifactは
     `reused`、変更／新規artifactは`replaced`、restoreは復元元を指す参照を追加する。baseの
     `artifacts`をupdate/deleteしてはいけない。
   - `revision.create`、`revision.read`、`revision.promote`、`revision.rollback`、
     `revision.restore`を型付きinternal commandとして追加する。利用者入口はAccess JWTで得た
     ownerを渡し、非所有jobと不存在jobを同じ404にする。worker専用commandはowner入力を受けず、
     revision IDとjob IDの整合を必ず照合する。

2. **candidateを初版と分離してdispatchする。**
   - `apps/web/lib/kyozai/job-store.ts`のcandidate作成をCloudflare feature flag対応にし、baseが
     activeかつcompleted、base manifest hashが読めることをD1 transaction内で確認する。candidate
     作成、plan/request artifact登録、base final refsの複製、revision dispatch enqueueを一つの
     commandにする。
   - `apps/web/lib/kyozai/internal-dispatch.ts`とcontrol-plane dispatch commandをrevision単位にする。
     初版jobとcandidate revisionのleaseは別に回復できなければならない。
   - `apps/web/workflows/kyozai-job-workflow.ts`（またはrevision専用workflow）では、`revision` stageを
     入口にしてbase revisionのartifactをread-onlyで読む。初版用のsource ingestからpackageまでの
     全再生成経路は呼ばない。

3. **typed operation executorを共通境界へ置く。**
   - 入口の自然言語は`revision-plan.ts`だけで最終的に許可しない。Schemaに適合する完全な
     `revision_plan` artifactを生成し、曖昧な対象・field・復元元はfail-closedにする。
   - `text.replace`／`text.rewrite`は対象slideの表示内容と紐付くspeaker notesだけを候補生成する。
     `slide.move`は既存slide内容hashを保ったまま順序と参照番号だけを更新する。`version.restore`は
     過去finalをコピーせず、復元元manifest SHA-256を検証して新しいimmutable revisionとして
     active pointerを進める。
   - 画像・layout・source correctionなど他operationも同じexecutor interfaceを通す。必要な画像
     provider呼出しはG1のusage reservation/checkpointを使い、対象slide以外には呼ばない。
   - candidate artifactはすべてdraft→readback SHA-256検証→validatedの順にし、validation成功前に
     `final`へ昇格しない。

4. **検証をpromotionの唯一の入口にする。**
   - Phase 0 validatorをlibrary化または同等の純粋関数として呼び、deck差分に加えてartifact manifest
     のtarget／非target SHA-256、layout hash、source reference、speaker notes、duration、画像検査を
     比較する。比較入力・report自体をprivate artifactとして残す。
   - candidate manifestはbase manifestの全artifactを、`reused`または`replaced`として一意に覆う。
     target外のhash差分、未宣言artifact、参照切れ、base manifest mismatch、render失敗は即失格とする。
   - retryは最大2回、同じplan hash・同じscopeに固定する。scopeを広げる再planは新しい利用者要求とし、
     元candidateをpromotionしない。
   - `revision.promote`は一つのD1 transactionで、validation status=passed、base still immutable、
     baseが作成時に読んだactive revisionと一致、candidate全artifact validatedを再確認してから
     artifactをfinal化し`jobs.active_revision_number`を更新する。比較後にbaseが変わった競合は409にする。
   - failure時の`revision.rollback`はcandidateをfailed/rolled_back、promotionをblockedにし、base finalと
     active revisionを変えない。失敗reportとdraft evidenceは監査可能に保持する。物理削除はG5の責務である。

## ファイル単位の実装チェックリスト

| 境界 | 追加／変更対象 | 完了条件 |
| --- | --- | --- |
| D1 schema | `apps/control-plane/migrations/<next>_g4_revision_execution.sql` | revision plan/validation、revisionごとのdispatch、immutable reference、atomic promotionの制約をDBが強制する。 |
| command parser/executor | `apps/control-plane/src/revision-commands.ts`、`job-commands.ts`、`index.ts` | create/read/promote/rollback/restoreをserver-only command化し、所有者照合とworker整合性を分離する。 |
| dispatch | `apps/control-plane/src/dispatch-commands.ts`、`apps/web/lib/kyozai/internal-dispatch.ts` | revision IDごとにclaim/renew/complete/requeueでき、旧revisionのleaseが新revisionを妨げない。 |
| web state entry | `apps/web/lib/kyozai/job-store.ts`、`apps/web/lib/kyozai/control-plane-client.ts`、`app/api/jobs/[jobId]/revisions/route.ts` | Cloudflare flagでcandidate作成・閲覧・restoreをD1/R2へ通し、非所有者は存在情報を得ない。 |
| revision executor | 新規`apps/web/lib/kyozai/revision-execution.ts`とoperation別小モジュール | base artifactをread-onlyでmaterializeし、宣言scope内だけを生成する。初版workflowを再利用しない。 |
| workflow | `apps/web/workflows/kyozai-job-workflow.ts`、`apps/web/lib/kyozai/job-workflow.ts` | revision stage、checkpoint recovery、usage reservation、terminal handlingをcandidate用に分離する。 |
| artifact/validation | `apps/web/lib/kyozai/control-plane-artifacts.ts`、新規`revision-validation.ts` | request/plan/report/manifestをprivate artifact化し、全hash・render・同期・scope report合格時だけpromotionする。 |
| contracts | `shared/kyozai-job-contract.ts`、既存revision Schema | 実際に保存するartifact kind、stage ledger、operation／rollback reportがSchemaと一致する。Schemaを緩和しない。 |
| UI/E2E | job revision routeと既存job画面、Playwright tests | candidate中、旧final、promotion済み、failed/rolled-back、restore済みを区別して表示する。 |

## 実fixtureと回帰テスト

### 必須成功fixture（自然言語3本）

1. **局所文言置換:** benchmark `R001`相当（1枚目の指定語だけ変更）。対象slideの宣言field以外、
   他slide、speaker notes、画像、layout、source referenceのSHA-256が同一であること。
2. **局所要約:** benchmark `R017`相当（6枚目を30秒量へ短縮）。対象slideのbody/notesだけが変化し、
   claim/source traceability、指定時間、他artifact hashが保持されること。
3. **構造変更:** benchmark `R032`相当（6枚目を5枚目の前へ移動）。全slideの内容・画像・layout hashを
   保ち、順序とcross-artifact referenceだけを整合更新すること。

各fixtureはSkillとAPPの双方で同じrequest/plan/manifest契約を出し、Preview実Providerを要する操作は
実provider usage eventとreadback hashを添える。fixture本文・画像・生成物そのものをリポジトリへ保存しない。

### 必須失敗・復元fixture

- **scope violation:** R001 candidateに対象外slide差分を故意に注入する。validationはfailed、candidate
  はpromotionされず、旧active revision・base manifest・全base artifact SHA-256が同一であること。
- **競合:** candidate作成後に別candidateをpromotionし、最初のcandidateのpromotionを409で拒否する。
- **再試行上限:** render/validator faultを注入し、最大2回とも同じplan hash・scopeであること。3回目は
  起動せずrollbackへ入ること。
- **復元:** revision 1→2成功後、自然言語の復元要求でrevision 1のmanifest SHA-256を参照する新revisionを
  作り、artifactをコピーせずactive pointerだけが復元先へ進むこと。revision 2はfinalのまま読めること。
- **所有者分離:** 非所有者と不存在jobはcandidate/read/restore/artifact取得のすべてで同じ404とする。

### 自動検証の最小セット

- `pnpm validate:revise`（Schemaと50 benchmarkを維持）
- revision executor/unit、D1 command contract、migration fixture、ownership regression
- `pnpm --filter web typecheck`、`pnpm --filter web lint`、`pnpm --filter web test`
- `pnpm --filter @kyozai/control-plane typecheck`、`pnpm --filter @kyozai/control-plane test`
- build、smoke、PC/mobile Playwright E2E、依存監査

## G4を完了と判断する証拠

実装PRをgreenにしただけでは不十分である。3成功fixture、scope-violation rollback、restoreの各々について、
commit SHA、CI run URL、PreviewのD1/R2 readback hash、provider usage突合、PC/mobile E2E結果を記録する。
これらが揃うまで`shared/kyozai-parity-goal.json`のG4 statusとgapは変更しない。G1のPreview直接入力証拠が
揃う前に、この文書以外のG4 product codeをG1 PRへ混在させない。

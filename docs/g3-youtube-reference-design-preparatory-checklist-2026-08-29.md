# G3準備: YouTube字幕・参考デザインの実装／fixtureチェックリスト

作成日: 2026-08-29  
状態: **準備のみ。G3未着手。**

## Gate境界

- 親Gate: G3（pending。現在の `activeGate` はG1であり、G3の開始を意味しない）。
- ゴールへの寄与: 正本SkillとAPPが、字幕付きYouTubeと参考デザインを同じ原典追跡・工程契約で扱えるようにする。
- G3の合格証拠: `captioned_youtube_run` と `reference_design_run`。実Provider、Preview、実fixtureの証拠が必要であり、この文書・単体テストだけでは合格しない。
- 着手条件: G1とG2の全必須実fixture・Preview証拠が揃い、各Gateの単一PRが完了するまで、下記の製品コード、migration、fixture実行、Gate状態は変更しない。
- G3開始時の証拠記録: PR説明に親Gate G3、上記のゴールへの寄与、`captioned_youtube_run`／`reference_design_run`、各fixture ID、先行G1/G2の証拠参照を固定する。完了時はさらにcommit SHA、CI URL、Preview runを追記し、ローカル試験だけでは合格にしない。

このチェックリストは `docs/skill-app-parity-execution-plan-2026-08-26.md`、`shared/kyozai-parity-goal.json`、正本の [KYOZAI Slide Skill](../.agents/skills/kyozai-slide/SKILL.md)、[KYOZAI Design Skill](../.agents/skills/kyozai-design/SKILL.md) を照合して作成した。G3のPRを始める際は、ここに記した決定を再確認し、実装前に「G3」「ゴールへの寄与」「合格証拠」をPR説明に記録する。

## 現状との不一致

| 入力 | 現行経路 | G3で必要な経路 |
| --- | --- | --- |
| YouTube | `apps/web/lib/kyozai/source.ts` が任意URLをHTML可視テキストへ変換 | 動画IDを限定して、動画metadataと日本語字幕（手動優先、次に自動）を取得・保存・正規化 |
| 参考デザイン | `apps/web/lib/kyozai/design.ts` の標準profile固定 | 参考原本をprivate R2に保持し、抽象化した独立profileと検証結果を保存。原本のロゴ・コピー等は再利用しない |

## 1. YouTube字幕入力

### 契約と安全境界

- [ ] `apps/web/lib/kyozai/job-store.ts` の `CreateJobRequest` と入力分類を、一般 `sourceUrl` と区別できる `youtubeUrl`（または等価な型付き入力）へ拡張する。URL文字列を後段で再判定しない。
- [ ] `apps/web/lib/kyozai/source.ts` にはYouTube取得を足さない。一般Web取得のSSRF対策・HTML抽出と、動画プラットフォーム専用取得を混ぜない。
- [ ] 新規 `apps/web/lib/kyozai/youtube-source.ts`（名称は実装時に確定）で、許可する `youtube.com` / `youtu.be` の動画ID形式だけを受理する。埋込、playlist、短縮URL、余計なqueryの扱いを明文化し、任意ホスト、IP、認証情報、内部URLを拒否する。
- [ ] extractorの実行位置をG1基盤の役割分担に合わせて決める。Workers FreeのCPU枠へ重い抽出を置かず、Vercel Workflowから専用extractorを呼び出す。無料枠を超える場合はprovider呼出し前と同じくfail-closedにする。
- [ ] extractorの認証・timeout・再試行・許容レスポンスサイズを、既存の内部Control Plane境界と同等に定義する。利用者の任意URLをextractorへ渡さず、検証済み動画IDだけを渡す。

### 原典と正規化成果物

- [ ] 正本Skillの `yt-dlp --dump-single-json --skip-download` 相当の、canonical URL、動画ID、タイトル、チャンネル、公開日、duration、chapters、取得時刻を取得する。
- [ ] `--write-subs` を `--write-auto-subs` より優先し、`ja-orig,ja` の字幕をjson3相当で取得する。選ばれた字幕の言語、種類（manual/auto）、取得不能理由、候補言語をmetadataに残す。
- [ ] 字幕を時系列segment（開始・終了・本文・順番）へ正規化する。話者、重複、空segment、時間逆転、文字化けをfail-closedで検証する。教材化する本文はこの正規化字幕だけから導出可能にする。
- [ ] metadata原本、字幕原本、正規化字幕、`source-info.json` を別artifactとしてprivate R2へ書き、各artifactのbyte数とSHA-256をD1 `artifacts` に記録する。
- [ ] `sourceHash` は、曖昧なHTML本文ではなく、versioned canonical metadataと正規化字幕の決定的なbyte列から算出する。hash algorithm、canonical JSON順序、結合順、extractor versionを`source-info.json`に明記する。
- [ ] `apps/web/lib/kyozai/durable-source.ts` を型付きsource readerへ拡張し、Workflow再開時はR2の正規化字幕を再読する。取得を繰り返して動画更新後の別原典を混ぜない。
- [ ] `apps/web/lib/kyozai/content-pipeline.ts` / `job-workflow.ts` の `source_ingest` stageが、source refs、sourceHash、字幕由来をledgerとpackageに出力することを確認する。

### D1・R2・API・画面

- [ ] `apps/control-plane/migrations/` に、必要ならYouTube source metadataをartifact metadataで表すか、独立tableで表すかを追加する。owner、job、revision、lifecycle、hashの参照を必ず持たせる。既存の`artifacts`を再利用できるならtableを増やさない。
- [ ] `apps/control-plane/src/artifact-commands.ts`、`artifact-objects.ts`、`apps/web/lib/kyozai/control-plane-artifacts.ts` に、private source artifactのregister/upload/readback/validate/read APIを揃える。browserにR2 URL、metadata、字幕を公開しない。
- [ ] `apps/web/app/api/jobs/route.ts` は入力型の検証エラーを既存の非公開エラー契約で返す。別所有者のjob、artifact、字幕はすべて同じ非存在応答に閉じる。
- [ ] `apps/web/app/async-job-workspace.tsx` にYouTube専用の入力UIと、字幕の有無・再試行可能な失敗の表示を追加する。一般公開URL欄の文言・挙動とは区別する。
- [ ] `apps/web/lib/kyozai/job-client.ts` と `apps/web/app/job-workspace.tsx` に、利用者が取得を許可された最終成果物だけを表示することを確認する。字幕原本をUIへ露出しない。

### テストと実fixture

- [ ] `apps/web/tests/youtube-source.test.ts` を追加し、URL正規化、非YouTube拒否、playlist/ID不正拒否、字幕手動優先、自動字幕fallback、字幕なしfail-closed、segment整列、sourceHash決定性を検査する。ネットワークはfixture/stubに固定する。
- [ ] `apps/control-plane/tests/` に、source artifactのowner/job/revision整合、R2 readback hash不一致、未validated artifact、別owner読出し拒否を追加する。
- [ ] `apps/web/tests/durable-source.test.ts` と `apps/web/tests/content-pipeline.test.ts` に、再開時に保存済み字幕を用い、`source_ingest`から`package`まで由来が残る検査を追加する。
- [ ] `shared/fixtures/process-parity/fixtures.json` の `youtube-captioned-training` を実fixture contractへ具体化する。ただし第三者の字幕・動画本文・個人情報をリポジトリへ保存しない。fixture ID、取得日時、動画ID hash/外部証拠参照、期待する字幕種別だけをversion管理する。
- [ ] Previewで実動画を1本完走する。取得metadata、字幕artifact hash、sourceHash、package ZIP hash、Provider usage、commit SHA、CI URL、Preview URLを証拠として残す。字幕なし、extractor timeout、Workflow再開の3故障ケースも実証する。

## 2. 参考デザイン入力

### 契約と知的財産境界

- [ ] `apps/web/lib/kyozai/job-store.ts` のjob requestへ、一般資料添付と区別できる`referenceDesignAttachmentId`（または型付きdesign input）を追加する。参照デザインは教材本文のsource textに混入させない。
- [ ] `apps/web/app/async-job-workspace.tsx` に専用の参考デザイン入力を置き、入力できるmedia type、件数、byte上限、利用権の注意、標準designへ戻す方法を表示する。
- [ ] `apps/web/app/api/uploads/route.ts` とupload session契約を、design原本のmedia type・用途を区別できる形へ拡張する。G2/G3でCloudflare state有効時も、Supabase upload経由へ戻さずprivate R2で完結させる。
- [ ] 参考原本はprivate R2にのみ保存し、D1にowner、job、revision、media type、byte size、SHA-256、取得時刻、artifact lifecycleを記録する。認証済み利用者以外へ原本・署名URLを渡さない。
- [ ] `.agents/skills/kyozai-design/SKILL.md` の最小項目（palette、typography、layout/spacing/chart/icon rules、density、do/avoid、imagegen prompt rules）を、APPが保存するprofile schemaとして共有化する。標準profile (`kyozai-standard@1.0.0`) を上書きしない。
- [ ] 原本hash、profile hash、analysis/validation hash、profile version、生成日時、抽出器versionを`design_profile_provenance`（artifact metadataまたは独立D1 table）に固定する。profileは抽象ルールだけで、ロゴ、固有イラスト、固有テンプレート、固有コピーを保存・出力しない。
- [ ] `apps/web/lib/kyozai/design.ts` の固定profile参照を、job/revisionのvalidated design profileへ解決できるinterfaceへ分離する。未検証profileは画像生成へ到達させない。

### Workflow・成果物

- [ ] `source_ingest`後、`design`前にreference design analysisを独立stageまたは明示されたdesign substageとして記録する。入力artifact、analysis、profile、validationをstage ledgerへ紐付ける。
- [ ] `apps/web/lib/kyozai/job-workflow-artifacts.ts` のartifact種別を拡張し、`design-analysis`、`design-profile`、`design-validation` と原本参照のlifecycleを明示する。package manifestにはprofile ID/hashと由来hashを載せ、原本そのものは納品ZIPに含めない（ユーザーが明示しない限り）。
- [ ] `apps/web/lib/kyozai/durable-package.ts`、`package-zip.ts`、`shared/schemas/kyozai-package-manifest.schema.json` を、標準profile限定の現在契約から、validated custom profileのID/hashとprovenanceを検証できる契約へ更新する。
- [ ] `apps/web/lib/kyozai/content-pipeline.ts` と画像prompt生成で、profileの抽象rulesだけを使用する。文章・素材の複製を防ぐvalidatorをdesign validationに入れる。
- [ ] 再実行／再開では同じvalidated profile artifactを読む。原本を再解析してprofileを静かに差し替えない。G4のrevisionではprofile hashを不変条件として扱う。

### テストと実fixture

- [ ] `apps/web/tests/design-profile-provenance.test.ts` を追加し、標準profileの不変、原本hash/profile hashの連結、未validated拒否、ロゴ/固有コピー検出、profile hash決定性を検査する。
- [ ] `apps/web/tests/control-plane-client.test.ts` とcontrol-plane testsに、design原本のupload/readback hash、owner隔離、artifact lifecycle、物理objectのprivate性を追加する。
- [ ] `apps/web/tests/process-contract.test.ts`、`durable-package.test.ts`、package validator testsに、custom profile由来を含むmanifestが受理され、由来欠落・原本コピー・profile hash不一致が拒否されるケースを追加する。
- [ ] `shared/fixtures/process-parity/fixtures.json` の `reference-design-training` を実fixture contractへ具体化する。原本画像をリポジトリに入れず、利用許諾済みの実入力をPreviewで供給し、image hashと外部証拠だけを残す。
- [ ] Previewでreference image付きjobを実Provider完走する。原本hash、design profile hash、validation、final PNG/ZIP hash、provider usage、commit SHA、CI URL、Preview URLを証拠として残す。profile validation失敗、R2 readback hash不一致、再開時profile一致の故障ケースも実証する。

## G3開始時の完了判定

- [ ] G1の`preview_real_provider_run`、`fault_recovery_matrix`、`provider_usage_reconciliation`が実証済みである。
- [ ] 2入力それぞれで、正本SkillとAPPのstage ledger、source/design provenance、停止条件、package契約をblind基準で比較できる。
- [ ] typecheck、lint、unit/contract tests、build、smoke、E2E、依存監査をすべて通し、CI URLとcommit SHAを記録する。
- [ ] `captioned_youtube_run` と `reference_design_run` のPreview実証を外部証拠として残すまで、G3を完了扱いにせずProduction生成404を維持する。

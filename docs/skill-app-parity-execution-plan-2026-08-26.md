# KYOZAI Skill／APP完全同等化・逸脱防止 実行計画

制定: 2026-08-26
状態: 実行正本
旧計画: `docs/skill-app-process-parity-plan-2026-08-13.md`（履歴として保持）

## 最終ゴール

直接入力、長文PDF、字幕付きYouTube、参考デザイン、完成教材への自然文修正の5入力を、
正本SkillとAPPで同じ工程、停止条件、品質基準、成果物契約により完走させる。
全5fixtureの実環境証拠が揃った後にだけ、認証済み利用者向けProduction生成を再開する。

完了は実装量や単体テスト数ではなく、CI run URL、commit SHA、Production URL、
blind evidence、provider usage突合、物理削除記録で判定する。SaaS向けProduction生成は凍結し、個人PWAは専用guardと利用者自身のAPIキーが揃った場合だけ有効化する。

## 2026-08-29 SaaS化の凍結と個人PWAへの再定義

利用者の明示指示により、不特定多数向けSaaS化、課金、テナント運用、常時稼働の共有基盤は凍結する。以後の完成対象は、利用者本人が自分の端末と自分のAPIキーで使う個人PWAとする。

個人PWAでは、ブラウザーへ秘密値を渡さず、端末内または利用者が管理する単一環境で生成する。Cloudflare Accessによる多人数所有者分離、R2 subscription、共有quota、SaaS向けCron/SLOは完成条件から外し、SaaS再開時の再審議事項として記録する。Production 404ロックは解除し、個人PWAとして安全に利用できる単一利用者向け入口を整備する作業へ切り替える。ただし、APIキー未設定・上限不明・生成結果保存先なしの場合はfail-closedを維持する。

個人PWAのProductionレート制限は、追加料金の発生する共有Redisを前提にせず、プロセス内の短期バケットで制限する。SaaS／Previewの分散レート制限と秘密鍵要件は維持する。署名鍵などの秘密設定が無い場合は、個人PWAでも生成をfail-closedにする。

## 2026-08-29 個人PWAの署名鍵省略

利用者が「本人だけが使う個人PWAとして今すぐ使えるようにする」と明示したため、個人PWAフラグが有効なProductionでは、画像render grantのHMAC署名用秘密鍵を必須としない。代わりに、15分で失効し、教材hash・画像model・slide数に結び付く非署名grantを使う。これは不特定多数向けの費用保護や改ざん防止を提供しない。SaaS／Previewは従来どおり専用署名鍵を必須とし、利用者のAPIキーをブラウザーへ渡さない制約は維持する。

個人PWAの公開は、同経路のunit test、typecheck、lint、build、smoke、E2E、CIが合格した時点でG1のSaaS実証と切り離してmainへ反映する。G1〜G6のSaaS向け実Provider・所有者分離・artifact evidenceの不足は解消済みとは扱わず、SaaSを再開するまで凍結する。

## 2026-08-29 個人PWA画像生成の回復（G1-PWA-IMG-001）

- 親Gate: G1の個人PWA公開例外。
- ゴールへの寄与: 直接テキスト入力から、正本Skillと同じ完成PNG・画像QA・ZIPまでを個人PWAで途切れず実行可能にする。
- 着手根拠: Productionで教材生成と1枚目の`/api/render-slide`は成功し、次ページが`UPSTREAM_FAILURE`で停止した。PWA公開可否、grant、Vercelの起動・Sharpの全停止は原因ではない。
- GitHub根拠: Google公式SDKの画像出力契約は[Interactions README](https://github.com/googleapis/js-genai#multimodal-output)の`outputs`／`response_modalities`であり、現行の手書き`response_format`／`output_image`／`steps`契約とは一致しない。実装はExperimental Interactionsではなく公式SDKの安定Models APIへ統一する。OpenAI画像生成パラメータは[公式型定義](https://github.com/openai/openai-python/blob/main/src/openai/types/image_generate_params.py#L544-L668)に照合して維持し、画像QA応答の検証だけを分離する。過去のSharp/libvips障害は[741ba3f](https://github.com/rahiseko-alt/KYOZAI-v1/commit/741ba3f928fb7870e9266ea59abfd191d80f02ff)で対処済みだが、本番実行で再確認する。
- 実装範囲: (1) Geminiを公式SDKのModels API adapterへ置換し、SDK形の画像出力を厳格検証する。(2) `image_provider`、`image_decode`、`image_normalize`、`image_qa_response`、`image_qa_verdict`の段階コードとrequest IDを安全に相関する。プロンプト、本文、画像base64、APIキー、上流レスポンス本文は記録・返却しない。(3) 成功済みページを端末内へcheckpointし、失敗ページだけを再開できるようにする。(4) Production smokeを旧404期待からPWA可用性と非課金schema smokeへ更新する。実Providerは明示実行の1枚canaryに限定する。
- 受入条件: GeminiとOpenAIを各1枚、ProductionでHTTP 200、PNG magic、1672×941、SHA-256、画像QA合格で記録する。小さなdeckの全ページが表示され、ZIPのPNGが表示PNGと同じhashになる。上流・decode・Sharp・QAの各故障は、秘密値や入力を含まず段階コードとrequest IDで追跡できる。timeout／接続断と上流障害は自動再送せず、利用者が成功済みページを保持したまま失敗ページだけ再開する。
- テスト方法: SDK形Gemini／OpenAI／QAのrecorded fixture unit、段階別の故障注入unit、route error mapping、IndexedDB resumeのcomponent/E2E、typecheck、lint、全test、build、smoke、E2Eを実行する。通常CIは実APIを呼ばず、Production canaryは明示操作で1枚ずつ実行してHTTP応答・画像hash・Vercel request IDを証拠にする。現在の旧404 smoke失敗（[run 33235270171](https://github.com/rahiseko-alt/KYOZAI-v1/actions/runs/33235270171)）はこの変更で置換する。
- 実証結果: commit `76a24ef6ed3b980fa1bfacdd6673ae89678b7a89`をProductionへ配備後、OpenAI `gpt-image-2-medium`の最小fixtureを実Provider・画像QA経由で1枚生成し、HTTP 200、PNG magic、1672×941、SHA-256一致、QA passed、attempt 1を確認した。Gemini canaryはGoogle側429を`SERVICE_UNAVAILABLE`／`image_provider_response`として安全に返した。これは契約不整合ではなくProvider利用可能性の証拠として保持する。
- 個人PWAの初期選択: 上記実証済みの`gpt-image-2-medium`を初期選択にする。Geminiは明示選択の比較候補として維持し、Provider 429をOpenAIへの無断切替で隠さない。
- 本文生成504の観測と最小対応（G1-PWA-CONTENT-OBS-001）: 親GateはG1の個人PWA公開例外。Productionの`POST /api/generate`が504となり、画像生成前の本文生成が未完了であることを確認した。根本のProvider停止工程は未特定のため、挙動・品質工程・timeout値を変えず、本文生成の開始工程（analysis／slide_map／script_timing／content_freeze／design）、経過時間、相関request IDだけを安全に記録・返却する。受入条件は、timeout時に本文・プロンプト・APIキー・上流本文を含まず工程・相関IDを返し、各Provider境界の開始工程をunitで検証すること。
- 本文stream timeoutの修正（G1-PWA-CONTENT-STREAM-002）: 親Gateは同じG1個人PWA公開例外。Production観測で`analysis`開始後にアプリのcatchへ戻らず504になった。調査により、OpenAIのSSE本文を読む`reader.read()`に明示的な時間制限が無いことを確認した。画像・品質工程・モデル・自動再送は変更せず、既存のProvider試行deadlineの残り時間でSSE本文を中断しreaderを閉じる。受入条件は、停止streamがdeadline内に制御されたtimeoutとなり、二重生成を避ける既存の自動再送禁止を維持すること。テストは停止stream fixture、既存のtimeout／route／E2Eを使用する。
- 本文の返答前接続失敗の回復（G1-PWA-CONTENT-CONNECTION-003）: 親Gateは同じG1個人PWA公開例外。Productionで`analysis`工程が開始して約0.8秒後に504となり、HTTP応答・SSE本文のいずれも受け取る前にOpenAIへの接続が失敗したことを確認した。個人PWAの直接経路に限り、`fetch failed`で接続失敗コードを安全に取得できる場合だけ、同じ工程を1回だけ再接続する。SaaSの追跡済みprovider試行、HTTP応答受信後、SSE本文読取中断、TimeoutErrorは従来どおり自動再送しない。画像、モデル、本文品質工程、timeout値は変更しない。受入条件は、最初の接続失敗後に教材生成が完走し、再接続が1回を超えず、応答未確認のtimeoutでは再接続しないこと。テストは接続失敗→成功fixture、TimeoutError fixture、既存の型検査・lint・全test・build・smoke・E2Eを使用する。
- 本文の返答前接続失敗の分類（G1-PWA-CONTENT-CONNECTION-004）: 親Gateは同じG1個人PWA公開例外。003をProduction最小fixtureで検証しても`analysis`工程で504が再発したが、routeの共通エラー処理が原因エラーを`PublicHttpError`へ丸めていた。返答前の`fetch`失敗だけを専用型として保持し、本文・プロンプト・APIキー・上流本文を含めず、接続エラー名、許可形式の接続コード、工程名、試行番号、経過時間だけをVercelへ記録する。原因が確定するまで回復条件は広げない。受入条件は、返答前接続失敗だけが分類記録され、HTTP応答後・SSE本文中断・通常のProvider HTTPエラーに分類記録が出ないこと。テストは既存の接続失敗／TimeoutError fixtureと、Production最小fixtureのログ相関を使用する。

## AS-IS／TO-BE

| AS-ISの不足 | TO-BE | Gate |
|---|---|---|
| 空manifest・空QA・工程逆順を検出しない | 実成果物、工程順、時刻、hash、QA内容を検証 | G0 |
| 実DB・Storage・Workflow・providerの証拠がない | disposable Previewで実Provider縦断を残す（有料Storage契約は前提にしない） | G1 |
| Vercel 5分Cronは0円運用制約と両立しない | 無料Supabase内schedulerから認証済みdispatcher／cleanupを起動し、Vercel設定にCronを置かない | G1 |
| stage間cancelが残留 | 全境界でterminalへ確定 | G1 |
| provider成功直後から回収不能 | 二重課金せず結果を回収・再開 | G1 |
| 本文、再画像、画像QAを費用計上しない | 全provider試行をusageへ記録 | G1 |
| PDFの位置付きchunkがない | 全文を原典追跡可能に正規化 | G2 |
| upload上限を並列突破可能 | DB内で件数・合計容量を原子的保証 | G2 |
| ZIPに原典がない | Skillと同じ原典・manifest構成で納品 | G2 |
| YouTubeを一般HTMLとして取得 | 専用extractorでメタデータ・字幕を取得 | G3 |
| 参考画像を入力不能 | 独立design profileと原本hashを保存 | G3 |
| revision candidateが実行されない | revision単位dispatchと検証昇格 | G4 |
| 期限切れ・未使用uploadを削除しない | 自動期限切れ・物理削除 | G5 |
| 再開時にartifactを再検証しない | 利用直前にbyte数・SHA-256を検証 | G5 |
| 待ち時間・原価・削除失敗を測定しない | queue、stage、費用、削除SLOを監視 | G5 |
| packageの由来と`real`申告を自己整合性だけで判定する | 外部attestationと再検証可能な非案件metadataで由来を証明 | G6 |

## Gate

| Gate | 目的 | 必須の合格証拠 |
|---|---|---|
| G0 | 正しい測定器 | negative package全件不合格、正本Skill実package合格 |
| G1 | 直接入力の実縦断 | Preview実Provider完走、停止回復、二重課金0、D1状態・usage突合（バイナリStorageは別Gate） |
| G2 | 文書入力と納品完全性 | 長文PDF／Markdown完走、原典追跡、ZIP／manifest一致 |
| G3 | YouTubeと参考デザイン | 実字幕と参考画像fixture完走 |
| G4 | 自然文修正と不変版 | 3修正fixture、対象外差分0、旧版維持／復元 |
| G5 | 削除、安全性、運用 | 破壊試験fail-closed、削除object再アクセス不可 |
| G6 | 全fixture比較とProduction公開 | blind基準、本番PC／mobile E2E、外部証拠 |

Gateの不足項目と証拠は `shared/kyozai-parity-goal.json` を機械可読な正本とする。
PRはGateごとに1本とし、合格前に次Gateへ進まない。

## 2026-08-26 監査補正の例外

`G1-CRON-002`が外部の配備制約により停止している間、利用者の明示指示により、監査で確認された
Production E2E mock遮断、Preview E2E固定値の撤廃、revision所有者先行確認、由来・blind証拠契約の
不足だけを同じG1 PR内で補正する。この例外はG2以降の機能実装やGateの前倒しを許可しない。
各補正は、G1の安全な実縦断とG6の証拠正当性を直接守る回帰テストまたは機械検証を合格証拠とする。
この補正で解決済みとなったG4所有者先行確認、G5 Preview E2E固定値、G6 Production E2E mock遮断、
G6 blind semantic rubricは`shared/kyozai-parity-goal.json`の未解決gapから除外した。外部attestationを伴う
実package由来は未取得のため、G6 gapとして残す。

## 2026-08-27 0円運用への計画変更

利用者が「サーバーの運用費だけ0円、AI生成API費用は利用者ごとの実費」と決定した。したがって
Vercel有料planへの変更は選択肢から除外する。G1は、無料Supabase projectで`pg_cron`／`pg_net`を用い、
認証済みVercel dispatcherとcleanupを起動する構成へ変更する。

この構成の合格証拠は、(1) VercelがCronなしでPreview配備できること、(2) Supabaseからdispatcherと
cleanupが実行されること、(3) Free tierの上限・停止時に新規provider呼出しをfail-closedで止めること、
の3点とする。無料枠で利用できない機能が判明した場合、有料化は行わず、受付停止と計画再審議へ戻る。

## 2026-08-27 Cloudflare基盤への方針変更

利用者が、KYOZAIの基盤をSupabaseではなくCloudflareへ変更すると決定した。この決定は直前の
「無料Supabase projectでschedulerを動かす」方針を置き換える。Supabaseの既存projectを新規に
作成、再利用、削除する作業は行わない。

G1の基盤は、Cloudflare D1（job・revision・usage等の永続データ）、R2（private artifact）、
Workers（認証済みdispatcher・cleanup・定期実行）へ置き換える。画面のVercel配備は継続する。
Supabase Authの代替となる認証方式は、所有者分離を実装する前に選定して記録する。既存の
Supabase migration、scheduler手順、Supabase依存コードは、Cloudflareの同等実装と実fixtureの
証拠が得られるまで削除しない。

運用費0円の条件は維持する。Cloudflare Freeの上限を超えた場合は、有料planへ切り替えず、
provider呼出し前に新規受付をfail-closedで停止する。次セッションの最初の作業は、既存の
Supabase依存を一覧化し、Cloudflareの対応先、認証境界、migration方式、Preview実証条件を
G1の実行項目として確定することとする。

### G1 Cloudflare実装設計（2026-08-28）

棚卸しと公式仕様の確認により、Cloudflare Workers Freeの10ms CPU上限では、PDF検査、画像QA、
ZIP作成をWorkersへ移せないことを確認した。CloudflareはD1/R2/state gateway/Cronを担い、Vercel
Workflowは重い生成工程を継続する。G1 Previewの認証はCloudflare Access One-time PINとし、
Vercel APIはAccess JWTを検証して所有者を確定する。詳細、対応表、実装順序、外部設定は
`docs/g1-cloudflare-foundation-plan-2026-08-28.md` を参照する。

## 2026-08-29 追加課金なしへの計画変更

利用者がR2 subscriptionの追加料金を支払わないと決定した。R2の初回有効化には登録済み支払方法を使う契約確認が必要であり、無料枠内であっても超過時の自動請求を伴うため、エージェントは契約を実行しない。

この決定により、G1の必須証拠をD1のjob/revision/stage/usage状態、Cloudflare Access所有者分離、実Providerの予約・確定・曖昧状態、故障後の結果回収へ限定する。R2のPNG/ZIP実byte保存・readback hashはG1の合格条件から外し、無料で利用できるバイナリStorage方式が別途選定されるまで未解決のG5/G6前提として保持する。R2未有効化またはStorage上限不明時は新規生成をfail-closedにする。

Production生成404、全5fixtureの実証、G6の外部attestation判定は変更しない。無料Storage方式が確定した場合は、この節を根拠にG1以降のartifact証拠を再審議し、計画とGoal JSONを同時に更新する。

## 計画外問題

現Gateの合格を妨げず、秘密情報、所有者分離、費用上限、データ消失、証拠の正当性を
壊さない問題は修正せず、`docs/reconsideration-log.md` へ記録する。

放置不能の問題だけを1ダイブで解決する。その間の全報告に
`【寄り道中 1/1｜問題ID｜復帰先Gate】` を表示し、固定した再現条件と終了条件以外を変更しない。
寄り道中に見つけた別問題は修正せず、解決自体を阻止する場合だけ利用者へ判断を返す。

## 変更しない条件

- `.agents/skills/kyozai-slide/**` は変更しない。
- `kyozai-standard@1.0.0`、300文字／分、4～12枚、内容凍結前の画像生成禁止を維持する。
- Support、Movie、Orchestrator、PPTX、高機能手動編集は今回のゴール外とする。
- 秘密値は利用者または運用者が提供元へ直接登録し、エージェントは受領・表示しない。

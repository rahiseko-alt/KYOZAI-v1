# KYOZAI Skill／APP完全同等化・逸脱防止 実行計画

制定: 2026-08-26
状態: 実行正本
旧計画: `docs/skill-app-process-parity-plan-2026-08-13.md`（履歴として保持）

## 最終ゴール

直接入力、長文PDF、字幕付きYouTube、参考デザイン、完成教材への自然文修正の5入力を、
正本SkillとAPPで同じ工程、停止条件、品質基準、成果物契約により完走させる。
全5fixtureの実環境証拠が揃った後にだけ、認証済み利用者向けProduction生成を再開する。

完了は実装量や単体テスト数ではなく、CI run URL、commit SHA、Production URL、
blind evidence、provider usage突合、物理削除記録で判定する。G6合格までProduction生成は404を維持する。

## AS-IS／TO-BE

| AS-ISの不足 | TO-BE | Gate |
|---|---|---|
| 空manifest・空QA・工程逆順を検出しない | 実成果物、工程順、時刻、hash、QA内容を検証 | G0 |
| 実DB・Storage・Workflow・providerの証拠がない | disposable Previewで実Provider縦断を残す | G1 |
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
| G1 | 直接入力の実縦断 | Preview実Provider完走、停止回復、二重課金0 |
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

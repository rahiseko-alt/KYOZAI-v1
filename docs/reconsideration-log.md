# KYOZAI 再審議記録帳

このファイルはappend-onlyで運用する。現在のGateの合格を妨げない計画外問題を記録し、
G6完了後に一括して再審議する。既存記録は削除・上書きしない。

## 記録形式

```text
## R-YYYYMMDD-NN 要約
- 発見日:
- 発見Gate:
- 症状:
- 再現方法:
- 放置可能な根拠:
- 想定影響:
- 再審議時の候補対応:
- 状態: goal_after_review
```

## 再審議待ち

なし。

## R-20260826-01 CodeRabbitがリポジトリ条件によりレビューを提供しない

- 発見日: 2026-08-26
- 発見Gate: G0
- 症状: PR #24のCodeRabbit checkが、リポジトリのstar数条件によりreview skippedとなった。
  `@coderabbitai review`を手動投稿してもレビューは開始されなかった。
- 再現方法: PR #24のCodeRabbit checkとbotコメントを確認する。
- 放置可能な根拠: G0の実package通常モード検証、致命的negative 10件、品質、build、smoke、E2E、
  CodeQL、集約`ci-green`は合格し、PRのmerge stateは`CLEAN`である。秘密情報、所有者分離、
  費用上限、データ消失、証拠の正当性を変更しない。
- 想定影響: CodeRabbitによる定性的な自動レビュー結果はG0証拠に含まれない。
- 再審議時の候補対応: CodeRabbitのOSS設定、review trigger条件、別の必須review経路を確認する。
- 状態: goal_after_review

## R-20260826-02 G0 package証拠が自己整合性を超える由来を証明しない

- 発見日: 2026-08-26
- 発見Gate: G1（G0監査指摘）
- 症状: `evidenceMode`、producer、時刻、hashはpackage作成者が一貫して作り直せるため、validatorが
  証明するのは破損・内部矛盾の不在であり、外部由来や非捏造性そのものではない。また正本Skill実packageの
  検証metadataがリポジトリまたは外部artifactとして第三者から再取得できない。
- 再現方法: 内容を一貫して作ったpackageのmanifest、ledger、QA、全hashを再計算し、normal modeで検証する。
- 放置可能な根拠: G1は同validatorによるSkill／APP同等性を合格条件にせず、Previewの実DB、provider usage、
  Storage実byte、terminal状態を外部事実で直接確認する。現在のG1実装・故障注入を妨げない。
- 想定影響: G0の`fabricated packageを拒否`というgoal contributionは過大であり、現状の外部証拠だけでは
  正本Skill実packageの再検証性が不足する。
- 再審議時の候補対応: 主張を内部整合性検証へ限定するか、由来を検証可能な署名・CI attestationを追加する。
  案件データを含まないevidence metadataを外部CI artifactまたはリポジトリへ残し、G6開始前にG0状態を再判定する。
- 状態: goal_after_review

## R-20260826-03 blind evidenceが内容品質の同等性を判定しない

- 発見日: 2026-08-26
- 発見Gate: G1（G0監査指摘）
- 症状: pair validatorはfixture、source hash、工程契約、design profileを揃えるが、deckの主張・学習順・台本・
  視認性のSkill／APP差を採点しない。CI名`Validate blind parity measurement`も合成fixtureの計測器テストと
  実fixture評価を区別しにくい。JSON Schemaはcompile検査だけで実package validationへ使っていない。
- 再現方法: 同じsource hashを持ち、各々のmanifestとhashが整合するがdeck本文が異なる2packageをpair modeへ渡す。
- 放置可能な根拠: G1は直接入力APP単体の耐久性Gateであり、Skill／APPの内容blind比較はG6の合格条件である。
- 想定影響: validator出力だけをG6の同等性証拠と誤認すると、内容品質の差を見逃す。手書き検証とSchemaの
  二重管理にも将来の乖離余地がある。
- 再審議時の候補対応: G6前に匿名blind評価の採点者、rubric、最低件数、同点基準、証拠形式を固定する。
  CI名をcontract-validator testと分かる名称へ変え、実packageへSchemaを適用するか二重管理を廃止する。
- 状態: goal_after_review

## R-20260826-04 durable jobのE2E mock判定にProduction二重ガードがない

- 発見日: 2026-08-26
- 発見Gate: G1
- 症状: `job-workflow.ts`の固定教材・固定画像分岐だけが`KYOZAI_E2E_MODE === "1"`を単独判定し、
  `VERCEL_ENV !== "production"`を同時確認しない。
- 再現方法: Production相当envでE2E modeを有効にし、durable workflowのcontent/image stageを実行する。
- 放置可能な根拠: G1からG5までProduction生成はコード上404で、G1実fixtureではE2E modeを無効にする。
- 想定影響: G6でProduction生成を再開するとき環境変数が残っていれば、モック教材を実成果物として配信し得る。
- 再審議時の候補対応: G6のProduction解錠前に共通`isE2eModeAllowed`へ全入口を統一し、Productionでは
  E2E modeが常にfalseとなる回帰テストを追加する。
- 状態: goal_after_review

## R-20260826-05 Preview E2E用公開固定値の安全前提がコード外にある

- 発見日: 2026-08-26
- 発見Gate: G1
- 症状: E2E modeのPreviewでは公開リポジトリ内の固定値をrender grant署名とrate-limit識別へ使う。
  Deployment Protectionが有効という外部前提をコードから検証できない。
- 再現方法: protectionのないPreview相当環境でE2E modeを有効にし、公開固定値からgrantまたはactor hashを再現する。
- 放置可能な根拠: G1実Provider fixtureはE2E modeを無効にし、固定値経路を使用しない。Productionでも二重ガード済み。
- 想定影響: 保護されていないE2E Previewを外部公開した場合、grant偽造とactor識別予測が可能になる。
- 再審議時の候補対応: G5でDeployment Protectionの外部証拠を必須化するか、Previewでもprocess内一時値または
  運用者登録の専用値だけを使い、公開固定値を廃止する。
- 状態: goal_after_review

## R-20260826-06 revision元artifactを所有者確認より先に読む

- 発見日: 2026-08-26
- 発見Gate: G1
- 症状: `createRevisionCandidate`はservice roleでbase revisionとdeck artifactを取得・downloadした後に、
  revision作成RPCで初めて`p_owner_id`を検証する。
- 再現方法: 別所有者のjob IDとbase revisionをrevision APIへ渡し、所有者検証前のread経路を追う。
- 放置可能な根拠: G1はrevision APIを使用せず、G4が自然文修正と所有者分離を検証するGateである。
- 想定影響: UUID推測難度は高いが、他者artifactへのservice-role readと応答差による存在オラクルを作り得る。
- 再審議時の候補対応: G4で最初にjob所有者を同一query/RPCで確定し、その後だけbase revisionとartifactを読む。
  不一致と不存在の外部応答を同一化する。
- 状態: goal_after_review

## 2026-08-26 監査補正の実施記録

- 対象: R-20260826-02、R-20260826-03、R-20260826-04、R-20260826-05、R-20260826-06。
- 判断: `G1-CRON-002`とは独立して、利用者が「それ以外を直せ」と明示したため、G1の安全性と
  G6証拠正当性へ直接寄与する最小範囲を補正する。
- 実施範囲: ProductionのE2E runtime禁止、process内一時E2E secret、revision所有者先行確認、
  blind semantic evidence／実package provenance evidenceのschemaと検証器。
- 非実施範囲: 実Provider packageのattestation生成、G2以降の機能実装、Cron構成変更。
- 状態: implemented_under_explicit_exception

## 2026-08-27 G1-CRON-002の方針決定

- 利用者決定: サーバー運用費は0円とし、AI生成API費用だけを利用者ごとの実費として扱う。
- 採用方針: 有料Vercel Cronは使わず、無料Supabase projectの`pg_cron`／`pg_net`から認証済みVercel endpointを起動する。
- 未確定事項: Free tierでschedulerが実際に利用可能か、休止・上限時にfail-closedできるかはPreviewで実証する。
- 状態: implementation_required

## 2026-08-27 G1-CRON-002の方針変更

- 決定: 利用者の明示指示により、無料Supabase projectを用いる方針を撤回し、Cloudflare D1、R2、Workersへ基盤を変更する。
- 理由: DB、artifact保存、定期実行を含めてサーバー運用費0円を維持しつつ、Supabase project枠に依存しない構成へ変更するため。
- 影響: Supabase schedulerのPreview実証は実施しない。Cloudflareへの置換範囲、認証方式、所有者分離、Free上限でのfail-closedをG1で実証する。
- 次の判断: Cloudflare Freeの実利用条件を確認し、上限超過時に課金せず止まる構成を実装前に固定する。
- 状態: superseded_by_user_decision

## 2026-08-29 Windows Wrangler fixture cleanupの延期

- 発見Gate: G1
- 症状: 実Worker/D1のdirect-text機能検証は全項目を通過するが、Windows版Wranglerのchild processが終了後もportを解放しない場合がある。
- 判断: G1のPreview実Provider、Access所有者分離、usage突合の外部証拠を阻害しない小問題として、G6完了後に再審議する。
- 実施済み: 起動時に所有PIDを記録し、そのprocess treeだけを停止するcleanup、port解放確認、失敗履歴を追加した。
- 状態: deferred_after_g6

## 2026-08-29 R2契約の課金回避決定

- 発見Gate: G1
- 利用者決定: 既存カードを使うR2 subscriptionは契約せず、追加料金を発生させない。
- 影響: R2 private artifactを使うPreview実Provider縦断は、R2が有効化されるまで実施不可。Production生成404ロックと新規jobのfail-closedは維持する。
- 次の判断: 無料枠内で課金上限を機械的に監視できるCloudflare構成が確認できた場合のみ再審議する。秘密値や支払情報は記録しない。
- 状態: blocked_by_billing_decision

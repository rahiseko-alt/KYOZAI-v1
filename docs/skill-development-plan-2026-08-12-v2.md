# KYOZAI Skill開発計画書 改訂第2版

- 作成日: 2026-08-12
- 計画期間: 次の1〜3か月
- 対象: KYOZAI Skill群、共通基盤、将来SaaSの最小UI
- 状態: 採用方針
- 旧版: `skill-development-priority-report-2026-08-12.md`

## 1. エグゼクティブサマリー

KYOZAIは、スライドを人が細かく編集するためのAPPを目指さない。

製品の基本体験を次に固定する。

```text
資料を入れる
-> そのまま使える教材一式が完成する
-> 不満点だけAIへ指示する
-> 指定箇所以外を壊さず修正する
-> 台本・講師資料も同期する
-> 自動検証済みの完成状態へ戻す
```

高度な手動編集は競合が強く、機能追加に終わりがない。KYOZAIの中核価値は編集自由度ではなく、次の2点とする。

1. 最初からそのまま使える完成度
2. AIへ言えば、他を壊さず確実に直る安心感

このため、次の新規Skillは **KYOZAI Revise (`kyozai-revise`)** とする。PPTX編集機能は主力Skillにせず、最低限のExport adapterとして後順位へ変更する。

## 2. 製品境界

### 2.1 作るもの

- URL、動画、台本、文書を入れるだけで完成する教材パッケージ
- 1スライド1テーマの日本語教材スライド
- 表示内容と対応した講師台本、時間、講師支援資料
- 会話による局所修正と全体修正
- 修正前後の差分、検証、復元
- PDF、PNG、ZIP、最低限のPPTX出力

### 2.2 作らないもの

- PowerPoint、Canva、Figmaの代替となる自由配置キャンバス
- レイヤーパネル、詳細なz-order操作、アンカーポイント編集
- フォント、線、影、余白を網羅する高度なプロパティパネル
- 大量のテンプレートを探して選ぶマーケットプレイス
- 複雑なグラフ作成画面、マスター編集、アニメーションタイムライン
- 高度なリアルタイム共同編集
- 手作業を前提にした「下書きを作るだけ」の生成体験

### 2.3 許容する最低限の手動操作

- 表示文言の直接修正
- スライドの並べ替えと削除
- 修正対象スライドの選択
- 「このスライドだけ再生成」「この画像だけ変更」
- 取り消し、前版への復元
- 出力形式の選択

任意の要素を自由配置する操作は初期範囲に含めない。

## 3. 競合との距離

### 3.1 確認できた競合機能

- [Claude Design](https://claude.com/resources/tutorials/using-claude-design-for-presentations-and-slide-decks) は、会話から完成デッキを生成し、特定スライドの変更、追加・削除、ブランド適用、PPTX/PDF/HTML出力まで扱う。
- [Gamma Agent](https://help.gamma.app/en/articles/8033284-can-i-edit-my-content-using-ai) は、全スライド一括修正、テーマ変更、図解、翻訳、要約、手動編集を扱う。
- [Beautiful.ai Slide AI](https://support.beautiful.ai/hc/en-us/articles/43350069148557-Create-and-Edit-your-Slides-with-Slide-AI) は、局所再生成、原文保持、画像だけの再生成、他スライドを維持した修正を扱う。

したがって、「AIに言えばスライドを直せる」だけでは差別化にならない。

### 3.2 KYOZAIが取る位置

| 領域 | 汎用競合 | KYOZAI |
|---|---|---|
| 主目的 | プレゼン・デザイン制作全般 | 日本語教材パッケージ完成 |
| 初回出力 | 編集可能な生成物 | 原則そのまま使用可能な完成物 |
| 修正 | スライドやキャンバスの変更 | 教材全体の整合性を保つ変更 |
| 連動物 | 主にデッキ | 台本、時間、講師資料、検証、ZIP |
| 根拠 | URLや検索を使う場合がある | 元資料対応をartifactとして保存 |
| 品質保証 | エディタ内で確認・再生成 | 自動検証、不変条件、失敗時再試行 |
| 手動編集 | 高機能 | 最低限 |

Claude Designからは、会話中心、結果を即時表示、対象を指して修正、版を戻せる操作感を参考にする。一方、汎用デザイン、広いコネクター市場、自由編集キャンバスは追わない。

## 4. 評価方法

候補を5段階で採点し、次の重みで100点換算する。

| 評価軸 | 重み | 判断内容 |
|---|---:|---|
| 顧客貢献度 | 25% | 手間を減らし、そのまま使える状態へ近づけるか |
| 中核差別化 | 25% | 汎用スライドAPPではない勝ち筋を強めるか |
| 信頼性レバレッジ | 20% | 他Skillと最終成果物の品質も高めるか |
| 実装実現性 | 10% | 現在の資産で安全に作れるか |
| 検証可能性 | 10% | 合否を再現可能な方法で判定できるか |
| OSS再利用性 | 5% | 成熟したOSSを安全に利用できるか |
| UI単純性 | 5% | 利用者の操作と画面を増やさないか |

## 5. 改訂優先順位

共通契約・検証基盤は利用者向けSkillではないため、優先0として先行する。

| 優先 | 候補 | 種別 | 総合点 | 難易度 | 判断 |
|---:|---|---|---:|---:|---|
| 0 | 共通契約・検証基盤 | 共通基盤 | 94 | 3 | Reviseの確実性を支える前提 |
| 1 | KYOZAI Revise | 新規Skill | 96 | 4 | 次の中核開発 |
| 2 | KYOZAI Design | 既存scaffold | 88 | 4 | 初回完成度を上げ、修正回数を減らす |
| 3 | KYOZAI Support安定化 | 既存Skill | 84 | 2 | 教材パッケージとしての差別化を強化 |
| 4 | KYOZAI Source | 新規Skill | 81 | 3 | 入力対応を広げ、根拠管理を統一 |
| 5 | KYOZAI Orchestrator | 既存scaffold | 81 | 3 | 契約確定後に全体を自動連動 |
| 6 | 最低限Export adapter | 共通機能 | 56 | 2 | 納品互換性のためだけに薄く実装 |
| 7 | KYOZAI Assessment | 新規Skill | 67 | 3 | 中核安定後の教材価値拡張 |
| 8 | KYOZAI Movie | 既存scaffold | 43 | 5 | 高コスト。具体需要確認後に再評価 |

Assessmentは点数上Exportより高いが、Exportは既存成果物の納品互換性を確保する小規模作業のため先に置く。高機能編集へ拡張しない。

## 6. KYOZAI Revise計画

### 6.1 責務

完成済みKYOZAI jobに自然言語の修正指示を適用し、変更対象だけを更新して、関連artifactを再同期・再検証する。

```text
existing job + revision request
-> scope detection
-> revision-plan.json
-> typed patch operations
-> affected artifact regeneration
-> invariant and visual validation
-> retry or rollback
-> new validated version
```

### 6.2 代表的な利用例

- 「3枚目の見出しを半分の長さにして」
- 「この画像だけ飲食店の現場写真に変えて」
- 「全体をAI初心者向けの表現にして」
- 「5枚目を削除して、6枚目を前へ移動して」
- 「この数字は元資料に根拠がないので削除して」
- 「青を少し濃く。ただしレイアウトと文章は変えない」
- 「前の版へ戻して」

### 6.3 修正操作の型

自由文をそのまま画像生成へ渡さず、次の操作へ分類する。

| 操作群 | 初期対応 |
|---|---|
| `text.replace` | 誤字、固有文言、見出し変更 |
| `text.rewrite` | 短縮、対象者変更、トーン変更 |
| `visual.replace-image` | 指定画像だけ変更 |
| `visual.relayout-slide` | 指定スライドだけ再配置 |
| `visual.restyle-deck` | 配色など限定された全体変更 |
| `slide.add` | 新規スライド追加 |
| `slide.remove` | スライド削除 |
| `slide.move` | 順番変更 |
| `source.correct` | 根拠追加、誤情報削除、出典更新 |
| `version.restore` | 過去版への復元 |

各操作には対象、変更可能フィールド、維持すべきフィールド、再生成対象を明記する。

### 6.4 主要artifact

```text
outputs/drafts/{job_id}/revisions/{revision_id}/
├─ revision-request.json
├─ revision-plan.json
├─ patch.json
├─ impact-report.json
├─ before-after.json
├─ revision-validation.json
└─ retry-log.json
```

共通Schema候補:

- `revision-request.schema.json`
- `revision-plan.schema.json`
- `revision-validation.schema.json`
- `deck-spec.schema.json`
- `source-info.schema.json`
- `design-profile.schema.json`

finalの版管理方法はPhase 0で確定する。最低条件は、既存finalを上書きせず、最新版参照と復元元を保持することとする。

### 6.5 不変条件

修正前に維持条件を保存し、修正後に検証する。

- 対象外スライドの表示文言と台本は変化していない。
- 「文章を変えない」指定では文字列hashが一致する。
- 「レイアウトを変えない」指定では要素座標が一致する。
- 根拠を変更していない主張はsource参照を維持する。
- スライド番号、台本、時間、講師資料の参照が一致する。
- 画像寸法、破損、空白、文字切れ、重なり検証を通過する。
- 検証失敗時はfinalへ昇格しない。

### 6.6 失敗時動作

1. 検証失敗理由を機械可読で記録する。
2. 変更範囲を維持したまま最大2回自動再試行する。
3. 解消しない場合は変更をfinalへ反映せず、直前の完成版を維持する。
4. 指示自体が矛盾する場合だけ、短い確認を利用者へ返す。

## 7. UI計画

初期SaaS画面は次の4領域で足りる。

1. 資料投入
2. 完成結果プレビュー
3. AI修正欄
4. 版履歴と出力

修正時はスライド選択を任意にし、選択中なら自動的に「このスライドだけ」をscopeへ入れる。適用後は変更要約とbefore/afterを表示し、詳細なプロパティ操作は出さない。

初期画面の成功指標は、操作数ではなく「手動編集画面を開かず完成した割合」とする。

## 8. 開発フェーズ

工数は1人の開発者がCodexを併用し、ローカルSkillと決定論的スクリプトを対象にする概算である。認証、課金、マルチテナント、クラウドキューは含まない。

### Phase 0: 契約と評価基盤 4〜6日

- 共通Schemaを追加する。
- revisionのscope、operation、invariantを定義する。
- 既存2案件を回帰fixtureにする。
- finalの版管理と復元方法を決める。
- 50件の修正指示ベンチマークを作る。

完了条件:

- 既存jobをSchema検証できる。
- 対象外変更を差分として検出できる。
- 同じ入力から同じ検証結果を再現できる。

### Phase 1: KYOZAI Revise MVP 8〜12日

- `kyozai-revise` をSkill Creatorの正規手順で初期化する。
- text.replace、text.rewrite、visual.replace-imageを実装する。
- revision plan、patch、impact reportを生成する。
- 対象slideと関連台本だけを再生成する。
- 自動再試行、rollback、version restoreを実装する。

完了条件:

- 局所修正30件で対象外文言変更が0件。
- 全ケースで変更前へ復元できる。
- 検証失敗版がfinalへ入らない。

### Phase 2: 構造・全体修正 5〜8日

- slide.add、remove、moveを実装する。
- visual.relayout-slide、visual.restyle-deckを実装する。
- 台本時間とSupport資料への影響伝播を追加する。
- scopeが広い指示の変更要約を作る。

### Phase 3: KYOZAI Design本実装 8〜12日

- Web、画像、PDF、PPTXのデザイン分析を実装する。
- `design-profile.json` をSchema化する。
- 初回生成とRevisionの両方で同じprofileを使う。
- 3種類以上の参考デザインでforward-testする。

目的は編集機能を増やすことではなく、初回完成度を上げ、利用者の修正回数を減らすことである。

### Phase 4: Support・Source 8〜12日

- Supportを既存2案件でforward-testする。
- SourceでWeb、YouTube、PDF、PPTX、DOCXを共通形式へ正規化する。
- 修正時も元資料対応を追跡できるようにする。

### Phase 5: Orchestrator 4〜7日

- 必要なSkillだけを選んで連動する。
- 同じjobを途中から再開する。
- Revision後のSlide、Support、Exportをまとめ直す。
- 完了済みartifactを不要に再生成しない。

### Phase 6: 最低限Export 2〜4日

- PNG、PDF、ZIPを安定出力する。
- PPTXは全面画像による高再現版を標準とする。
- 必要ならタイトルと本文だけ編集可能な限定版を追加する。
- 高度な図形編集、自由配置、完全なPowerPoint再構築は行わない。

## 9. 品質指標

「確実に直る」を無限定な宣伝文句にせず、測定可能な指標へ分解する。

| 指標 | MVP目標 |
|---|---:|
| 修正指示の達成率 | 95%以上 |
| 局所修正の対象外文言変更 | 0件 |
| Schema適合率 | 100% |
| final昇格時の必須検証通過率 | 100% |
| rollback成功率 | 100% |
| 自動再試行2回以内の回復率 | 90%以上 |
| 初回出力を大幅修正せず使用できる割合 | 80%以上 |
| 1案件あたり修正指示中央値 | 2回以下 |

意味やデザインの評価は完全決定論にできない。達成率95%未満の操作型は「安定対応」と表示せず、final昇格前に追加確認する。

## 10. 評価セット

既存2案件に加え、分野の異なる3案件を追加し、合計5案件でforward-testする。

修正指示50件の内訳:

- 固有文言・誤字修正: 10件
- 短縮・対象者・トーン変更: 10件
- 画像・局所レイアウト変更: 10件
- スライド追加・削除・移動: 10件
- 根拠訂正・全体デザイン変更: 10件

各テストは、指示達成、対象外変更、source整合、台本整合、画像検証、復元を記録する。

## 11. OSS活用計画

| OSS | 用途 | License | 方針 |
|---|---|---|---|
| [Ajv](https://github.com/ajv-validator/ajv) | JSON Schema検証 | MIT | 共通validatorの第一候補 |
| [fast-json-patch](https://github.com/Starcounter-Jack/JSON-Patch) | RFC 6902 patch、比較、test operation | MIT | Reviseの局所変更候補 |
| [sharp](https://github.com/lovell/sharp) | 画像処理、montage、統計 | Apache-2.0 | 継続利用 |
| [pixelmatch](https://github.com/mapbox/pixelmatch) | 対象外画像差分、視覚回帰 | ISC | Revise検証へ利用 |
| [Playwright](https://github.com/microsoft/playwright) | Web取得、レンダリング、画面検証 | Apache-2.0 | DesignとQAに利用 |
| [MarkItDown](https://github.com/microsoft/markitdown) | 文書入力の正規化 | MIT | Sourceで必要形式だけ利用 |
| [PptxGenJS](https://github.com/gitbrent/PptxGenJS) | 最低限PPTX | MIT | Export限定。中核にしない |

原則はpackage依存、CLI、公式APIの利用とし、ソースコードのコピーやforkは最後の手段にする。採用version、license、改変、撤去方法を記録する。

## 12. リスクと対策

| リスク | 対策 |
|---|---|
| AI修正で別箇所が変わる | scope制約、hash、JSON Patch test、対象外差分検査 |
| 修正のたびに全体の見た目が揺れる | design-profile固定、対象slideだけ再生成 |
| 台本やSupportが古いまま残る | artifact依存関係とimpact reportで更新対象を決定 |
| 「確実」という期待が過大になる | 操作型別に成功率を測り、未安定機能を区別 |
| UIが編集APP化する | 非目標リストを変更審査の基準にする |
| 初回品質が低く修正が増える | Designを第2優先に置き、修正回数をKPI化 |
| 版管理が肥大化する | immutable manifestと保持ポリシーをPhase 0で決定 |
| OSS条件がSaaSと衝突する | permissive licenseを優先し、独自ライセンスを中核から外す |

## 13. 30・60・90日計画

### 30日

- 共通Schemaとvalidatorを完成する。
- KYOZAI Revise MVPを完成する。
- 既存2案件、修正30件で検証する。

### 60日

- 構造変更と全体修正を追加する。
- KYOZAI Designを本実装する。
- 5案件、修正50件へ評価を拡張する。

### 90日

- Support、Source、Orchestratorを連動する。
- 最低限Exportを追加する。
- 初回完成度と修正成功率を実顧客案件で再評価する。

## 14. 開発開始条件と中止条件

KYOZAI ReviseのPhase 1開始条件:

- deck-specとrevision planのSchemaが確定している。
- 対象外変更を検出できる。
- finalを上書きせず復元できる。

機能追加を止める条件:

- 自由配置や詳細プロパティ編集が必要になる。
- 汎用プレゼン制作が主目的になる。
- 利用者自身の手作業を増やさないと成立しない。
- 修正成功率を測れないまま「対応済み」とする必要がある。

この場合は機能を追加せず、AI修正の操作型、初回生成品質、検証方法を改善する。

## 15. 最終提言

最初に共通Schema、差分検査、版管理を整備し、その直後に `kyozai-revise` を開発する。

KYOZAI Designは「利用者がデザインを細かく選ぶ機能」ではなく、「最初から使える完成度を裏側で上げる機能」として実装する。Exportは完成物を外へ渡すための薄いadapterに限定する。

KYOZAIの競争軸を、編集機能数ではなく、初回完成率、修正達成率、対象外変更ゼロ、教材一式の整合性へ固定する。


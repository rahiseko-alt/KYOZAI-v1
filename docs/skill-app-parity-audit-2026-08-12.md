# KYOZAI Skill / APP 同一性監査報告書

> **2026-08-13 訂正**  
> 利用者が求める「同じ」は、AI生成結果、PNG、artifact hashの完全一致ではなく、入力取得から
> 教材設計、内容凍結、画像生成、画像QA、修正、納品までを同じ水準で行う工程同等性である。
> 本報告のうち、現行APPに工程不足があるという調査事実は有効だが、「共通jobで1回だけ生成する」
> 「Skill/APP間で同一artifactを参照する」という合格条件は撤回する。実装と受入判定は
> [`skill-app-process-parity-plan-2026-08-13.md`](skill-app-process-parity-plan-2026-08-13.md)を優先する。

作成日: 2026-08-12  
対象: `kyozai-slide`正本Skill / 公開APP `https://kyozai-v1.vercel.app`  
監査方式: 独立サブ監査3体による読み取り専用静的監査と、主担当による証拠統合  
結論: **現状は同じ生成条件ではなく、品質・失敗率・費用を比較してはならない。**

## 1. エグゼクティブサマリー

主担当は、3つの`kyozai-standard@1.0.0` profileが一致し、同じlayout familyを使うことをもって、
SkillとAPPが「ほぼ同じデザインを出す」と判断した。この判断は誤りだった。

一致しているのは主に次の範囲だけである。

- 16:9、1672 x 941という基準
- 白`#FFFFFF`、黒`#0A0A0A`、青`#075AC8`
- 7種のlayout family
- 表紙とactionスライド
- 1スライド1テーマ、結論型タイトル
- 一部のdeck-specスライドフィールド

一方、入力取得、教材分析、本文モデル、工程、講師台本、時間計算、画像生成、画像モデル、
検証、修正、保存、最終成果物、費用記録は一致していない。特にSkillはImageGenでPNGを作るが、
APPはReact/CSSで描画している。この差を残したまま同じ入力を試しても、原因変数が多すぎるため、
失敗修正の効果や費用差を評価できない。

### 独立監査の集計

| 監査 | 観点 | 結果 |
|---|---|---|
| 監査A | 内容、入力、schema、台本、時間、FAQ/quiz、修正 | 40項目中、完全一致8、部分一致5、異なる7、APP未実装7、Skill未定義13 |
| 監査B | 画像生成、デザイン、検証、再生成、納品 | 30項目。P0 14、P1 10、P2 5、P3 1 |
| 監査C | モデル、基盤、保存、費用、安全性、運用 | 32差分。同条件比較は不可能 |

3監査の結論は一致した。**共通profileは同じ設計思想の証拠であり、同じ生成条件・同じ成果物の
証拠ではない。**

## 2. 公開停止級の差分 P0

| ID | 差分 | Skill | APP | 影響 | 完全同一化の条件 |
|---|---|---|---|---|---|
| P0-01 | 最終生成方式 | ImageGenで完成PNGを1枚ずつ生成。[Skill:279](../.agents/skills/kyozai-slide/SKILL.md#codex-imagegenへのhandoffスライド画像生成) | React/CSS描画。[slide-artwork.tsx](../apps/web/app/slide-artwork.tsx) | 見た目、文字精度、図解、失敗率、費用が別物 | 共通backendで最終PNGを1回だけ生成し、双方が同じartifactを参照 |
| P0-02 | 画像モデル | 組み込み`image_gen`のみ指定し、モデルID・版を固定していない | 画像生成自体がない | 画像品質と原価を再現できない | 画像モデル、版、品質、サイズ、retryをmanifestへ固定 |
| P0-03 | 本文モデル | Skill実行ホストに依存し、モデル・推論設定・出力上限を固定していない | `gpt-5.5`、reasoning low、Structured Outputs。[openai.ts](../apps/web/lib/kyozai/openai.ts) | 内容品質と費用を比較できない | 両入口が同じ本文生成serviceを呼ぶ |
| P0-04 | 生成工程 | 内容分析、凍結、画像生成、画像検証の10段階 | 教材一式を1回の構造化応答で生成 | 構成品質と失敗点が異なる | 共通stage定義、prompt version、validatorを使用 |
| P0-05 | YouTube入力 | `yt-dlp`でメタデータと字幕取得。[Skill:57](../.agents/skills/kyozai-slide/SKILL.md#urlから完成画像までの標準直通フロー) | 一般WebページとしてHTML/textを取得。[source.ts](../apps/web/lib/kyozai/source.ts) | 同じURLでも元データが違う | 共通Source正規化serviceを使用 |
| P0-06 | 講師台本 | 講師が話す完成文章 | 120～240字の進行要点で朗読台本を否定。[openai.ts](../apps/web/lib/kyozai/openai.ts) | 教材の用途と内容量が違う | `speakerNotes`の定義、長さ、品質基準を共通schemaへ固定 |
| P0-07 | 総時間 | 台本文字数合計を300字/分で決定論的に算出 | AIが`durationMinutes`を出力し、台本合計との一致検証なし。[schema.ts](../apps/web/lib/kyozai/schema.ts) | 表示時間と実演時間が矛盾し得る | 共通時間計算器で再計算し、AI申告値を使わない |
| P0-08 | 成果物範囲 | Skillに独立したscenario、FAQ、quizの必須schemaがない | scenario、FAQ、quizを必須生成 | 教材一式の構成が違う | 共通TeachingPackage schemaを単一正本化 |
| P0-09 | 最終納品 | PNG、deck-spec、source-info、prompt、validation、montage、manifest、ZIP | 印刷HTMLのみ。[workspace.tsx](../apps/web/app/workspace.tsx) | 比較対象そのものが違う | 同じartifact setを双方へ返す |
| P0-10 | 画像QA | 実寸、白紙、文字崩れ、重なり、コントラスト、25%、スマホ、モンタージュ | JSON構造とmock DOM overflow中心。[home.spec.ts](../apps/web/e2e/home.spec.ts) | 完成判定が違う | 同じPNGを同じ画像validatorへ通す |
| P0-11 | 再生成単位 | 不良画像だけを再生成 | 教材JSON全体をAI修正し再評価 | 無関係ページが変わる | page単位revisionとartifact差分固定 |
| P0-12 | APP内preview/export | 該当なし | preview React/CSSとdownload HTML CSSが別実装 | APP内ですら見たものと納品物が一致しない | 同じ最終PNGまたは同一renderer出力を使用 |
| P0-13 | deck-spec往復 | APP/Skill相互受渡しを仕様に記載 | JSON import/export UI/APIがない | 同じdeck-specで比較できない | 共通schemaのimport/exportと往復hash test |
| P0-14 | 修正時の原典 | 原典と変換物を保持 | 現在の教材JSONと修正依頼だけで修正 | 原典逸脱を検証できない | source hashと正規化原典をrevision engineへ渡す |
| P0-15 | 恒久仕様の衝突 | 最新要求は「全く同じ」 | `design.md`はpixel一致を不要としている。[design.md:116](design.md) | 今後も別実装が正当化される | 旧決定を廃止し、共通artifactを正本化 |

## 3. 重大差分 P1

| ID | 差分 | 現状と影響 | 統一条件 |
|---|---|---|---|
| P1-01 | 教材分析 | Skillは対象者、課題、到達点、中核主張、根拠、行動を抽出。APPは一部だけ。 | 共通analysis schemaを先に生成 |
| P1-02 | 学習順 | Skillは時系列を理解順へ再構成。APP promptに同じ明示なし。 | 同一prompt moduleを使用 |
| P1-03 | 初回意味QA | Skillは画像前に論理チェック。APPは初回に意味評価なし。 | 初回と修正に共通evaluatorを適用 |
| P1-04 | スライド枚数 | APPは4～8枚。Skillは上限未定義、実績14枚。 | 素材量・研修時間から共通規則で決定 |
| P1-05 | 長文処理 | APPは80,000文字で切断。Skillは必要範囲の全文を読む。 | chunk、source位置、要約証跡を共通化 |
| P1-06 | 入力形式・上限 | APPはPDF/TXT/MD、2件、各8MB。Skill条件は異なる。 | 対応表、容量、分割規則を固定 |
| P1-07 | 複数URL | Skillは統合/分離を定義。APPはURL 1件。 | source配列と統合規則を共通化 |
| P1-08 | 参考デザイン | Skillは画像を目視しImageGenへ渡す。APPに専用経路なし。 | 同じreference image hashとdesign profileをjobへ保存 |
| P1-09 | キャンバス | Skillは1672 x 941。APPは可変aspect-ratio。 | 基準キャンバスから同じPNGを生成 |
| P1-10 | 図解表現 | Skillは線画、矢印、関係図。APPは固定CSS図形中心。 | 共通画像生成または図解renderer |
| P1-11 | モンタージュ | Skillあり、APPなし。 | 共通artifact pipelineで生成 |
| P1-12 | 永続job | Skillはdraft/final等を保存。APPはReactメモリ。 | 永続job、object storage、状態機械を共通化 |
| P1-13 | 非同期実行 | APPは同期HTTP、240秒上限。 | queue/worker/進捗API/再開を実装 |
| P1-14 | retry policy | APPはJSON生成最大2回。Skillは不良画像単位。 | stage別retryと費用上限を共通化 |
| P1-15 | 自然文修正 | APPに評価/repairあり。Skillに同じworkflowなし。 | 共通revision engineを利用 |
| P1-16 | labels検証 | Skillはcompare以外空配列。APP validatorは非compareのlabelsを拒否しない。 | 共通validatorを単一正本化 |
| P1-17 | プロンプト注入防御 | APPは資料内命令を無視。Skillに同等規則なし。 | 共通system instructionとingestion policy |
| P1-18 | usage/費用 | 両方ともjob単位のtoken/image費用をmanifestへ記録しない。 | usage、推定原価、retry理由、上限を保存 |
| P1-19 | モデル証跡 | APP成果物に実モデルID、prompt/schema versionがない。 | manifestへ非秘密の実行条件を保存 |
| P1-20 | deployment証跡 | 公開deploymentと監査ソースのcommit SHAが結び付かない。 | deployment ID、commit SHA、artifact hashを保存 |
| P1-21 | 同一性CI | APP E2Eは固定mock。Skillとのgolden比較なし。 | 同じjob IDとartifact hashを両入口で検証 |
| P1-22 | quota/security | APPは公開IP制限、Skillは限定環境。安全性・費用条件が違う。 | 共通user ID、quota、ingestion sandboxを利用 |

## 4. 比較試験が有効になる合格条件

次をすべて満たすまで、SkillとAPPの品質・失敗率・費用比較を実施しない。

1. APPとSkillは入口だけ異なり、同じbackend jobを作成する。
2. 正規化済みsource hashが一致する。
3. 本文モデルID、推論設定、prompt version、schema versionが一致する。
4. 同じTeachingPackage schemaとvalidatorを使用する。
5. 講師台本と時間計算を同じコードで確定する。
6. ImageGenはjob内で1回だけ実行し、双方が同じ生成済みPNGを参照する。
7. 画像モデル、サイズ、品質、prompt、retryがmanifestに残る。
8. preview、download、Skill納品が同じPNG hashを参照する。
9. 同じ画像QAを通過し、validation結果が一致する。
10. source-info、deck-spec、scenario、FAQ、quiz、prompt、validation、manifest、ZIPが一致する。
11. 修正は同じsourceとrevision engineを使い、変更対象外artifactのhashを維持する。
12. token、画像枚数、retry、経過時間、推定費用をjob単位で記録する。

この条件で初めて、APPとSkillの差はUI入口だけになり、障害修正へかけたコストの効果を比較できる。

## 5. 最短の是正アーキテクチャ

```text
APP UI ---------\
                 > Common Job API
Skill Adapter --/        |
                         +-- Source Normalizer
                         +-- Content Generator (fixed model/config)
                         +-- TeachingPackage Validator
                         +-- Image Prompt Builder
                         +-- ImageGen Worker
                         +-- Image QA / Repair
                         +-- Artifact Store / Manifest
                         +-- PNG / HTML / PPTX / ZIP adapters
```

「APPにもImageGenを追加し、Skillも別にImageGenを呼ぶ」だけでは完全同一にならない。ImageGenは
確率生成であるため、同じpromptでも画像は一致しない。**1つの共通jobで1回だけ生成・検証・保存し、
APPとSkillが同じartifactを参照すること**が必要である。

## 6. 主担当の誤り

1. profileの一致をpipelineの一致と誤認した。
2. ユーザーが一度「ほぼ同じ」と指示した後も、SkillのImageGenとAPPのCSS描画差を残した。
3. `design.md`へpixel一致不要と記録し、最新要求と逆の恒久仕様を残した。
4. APPだけでタイムアウト修正とモデル変更を行い、Skill側の条件を揃えず比較可能と扱った。
5. 同一性の合格試験をartifact hashで定義しなかった。

これは実装不足だけではなく、検証設計の誤りである。

## 7. 監査元

- 監査A: 内容・入力・schema・台本・時間・FAQ/quiz・修正、40項目
- 監査B: 画像生成・デザイン・検証・再生成・納品、30項目
- 監査C: モデル・実行基盤・保存・費用・安全性・運用、32差分
- 3監査ともファイル編集なし

監査対象の主要証拠:

- `.agents/skills/kyozai-slide/SKILL.md`
- `.agents/skills/kyozai-slide/references/kyozai-design-profile.json`
- `apps/web/lib/kyozai/openai.ts`
- `apps/web/lib/kyozai/schema.ts`
- `apps/web/lib/kyozai/source.ts`
- `apps/web/app/slide-artwork.tsx`
- `apps/web/lib/kyozai/package-html.ts`
- `apps/web/app/workspace.tsx`
- `apps/web/e2e/home.spec.ts`
- `docs/design.md`

## 8. 最終判定

**FAIL: SkillとAPPは同一ではない。現状の比較結果を製品判断や費用判断に使ってはならない。**

次の実装開始条件は、上記12項目の合格基準を正本仕様として承認し、共通Job APIを唯一の生成経路に
することである。

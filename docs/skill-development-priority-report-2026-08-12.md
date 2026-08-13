# KYOZAI Skill開発 優先順位検討報告書

- 作成日: 2026-08-12
- 対象リポジトリ: KYOZAI-v1
- 対象期間: 次の1〜3か月
- 判断対象: 既存Skillの拡張、新規Skill候補、共通基盤、GitHub上の再利用候補

> 状態: 2026-08-12の利用者方針変更により旧版となった。最新版は
> [`skill-development-plan-2026-08-12-v2.md`](skill-development-plan-2026-08-12-v2.md) を正とする。

## 1. 結論

次に顧客向けSkillとして開発すべきものは **KYOZAI Export** とする。
ただし着手前に、3〜5日程度で `deck-spec.json` の共通スキーマと共通検証スクリプトを整備する。

推奨順序は次のとおり。

1. 共通契約・検証基盤（Skillではなく `shared/` の決定論的基盤）
2. KYOZAI Export（新規）
3. KYOZAI Design（既存scaffoldの本実装）
4. KYOZAI Supportの実案件検証と安定化
5. KYOZAI Source（新規。入力正規化をSlideから分離）
6. KYOZAI Orchestrator（各Skillの契約確定後に本実装）
7. KYOZAI Assessment（新規。理解度確認・演習生成）
8. KYOZAI Movie（最後。高難易度かつ外部依存・ライセンス判断が必要）

既存scaffold 3種だけで比較する場合は、`kyozai-design`、`kyozai-orchestrator`、`kyozai-movie` の順とする。

## 2. 判断の前提

現時点で実案件を完走しているのは `kyozai-slide` であり、Webサイト2件から、各10枚のPNG、講師台本、検証JSON、モンタージュ、ZIPを生成済みである。

`kyozai-support` はA4 PDF生成スクリプトまであるが、上記2案件を使った前向き検証が未完了である。`kyozai-design`、`kyozai-movie`、`kyozai-orchestrator` は責務と出力項目を定義したscaffold段階である。

現行成果物は閲覧・納品には使える一方、顧客がPowerPoint上で文言や図形を修正できる編集可能デッキを標準納品していない。このため、成果物の利用可能性を直接引き上げるExportを最優先と判断した。

顧客インタビューや受注データはまだ蓄積されていない。以下の「顧客貢献度」は、現在の手作業削減、成果物の再利用性、既存2案件で確認できた工程上の不足から推定した値である。3〜5件の実顧客案件後に再採点する。

## 3. 評価方法

各候補を5段階で採点し、次の重みで100点へ換算した。

| 評価軸 | 重み | 見る内容 |
|---|---:|---|
| 顧客貢献度 | 30% | 手作業削減、成果物の使いやすさ、納品価値 |
| 中核製品との適合 | 20% | 「素材から再利用可能な日本語教材へ」という主張への近さ |
| 横断レバレッジ | 15% | 他Skillの品質・速度・安定性も改善するか |
| 実装実現性 | 15% | 現在の資産と環境で短期間に安全に実装できるか |
| 検証可能性 | 10% | 合否を自動または目視で明確に判定できるか |
| OSS再利用性 | 10% | 成熟したコード、API、許容可能なライセンスがあるか |

難易度は総合点と別に、1を低、5を高として示す。

## 4. 総合評価

| 優先 | 候補 | 種別 | 総合点 | 難易度 | 判断 |
|---:|---|---|---:|---:|---|
| 0 | 共通契約・検証基盤 | 共通基盤 | 90 | 2 | 全Skillの前提。最初に短期実施 |
| 1 | KYOZAI Export | 新規Skill | 92 | 3 | 次の顧客向け開発 |
| 2 | KYOZAI Design | 既存scaffold | 88 | 4 | 見た目と再現性を全案件で改善 |
| 3 | KYOZAI Support安定化 | 既存Skill | 84 | 2 | 低コストで納品物を増やせる |
| 4 | KYOZAI Source | 新規Skill | 79 | 3 | 入力種類を拡張しSlideを簡潔化 |
| 5 | KYOZAI Orchestrator | 既存scaffold | 74 | 3 | 契約確定後に大きな効果 |
| 6 | KYOZAI Assessment | 新規Skill | 71 | 3 | 教材価値は上がるが現行中核の外側 |
| 7 | KYOZAI Movie | 既存scaffold | 53 | 5 | 高コスト、検証困難、ライセンス注意 |

採点内訳は次のとおり。各軸は5点満点で、総合点は前節の重みを適用して100点換算した。

| 候補 | 顧客 | 適合 | 横断 | 実現性 | 検証 | OSS | 総合 |
|---|---:|---:|---:|---:|---:|---:|---:|
| 共通契約・検証基盤 | 4 | 5 | 5 | 5 | 4 | 4 | 90 |
| KYOZAI Export | 5 | 5 | 4 | 4 | 4 | 5 | 92 |
| KYOZAI Design | 5 | 5 | 5 | 3 | 3 | 4 | 88 |
| KYOZAI Support安定化 | 4 | 5 | 3 | 5 | 5 | 3 | 84 |
| KYOZAI Source | 3 | 4 | 5 | 4 | 4 | 5 | 79 |
| KYOZAI Orchestrator | 4 | 4 | 5 | 3 | 3 | 2 | 74 |
| KYOZAI Assessment | 4 | 3 | 3 | 4 | 4 | 3 | 71 |
| KYOZAI Movie | 3 | 3 | 3 | 2 | 2 | 2 | 53 |

## 5. 優先候補の詳細

### 5.1 共通契約・検証基盤

これは利用者が直接呼ぶSkillにしない。JSON Schema、決定論的スクリプト、共通テストとして `shared/` に置く。検証をプロンプトだけに依存させない。

最初に追加するもの:

- `shared/schemas/deck-spec.schema.json`
- `shared/schemas/design-profile.schema.json`
- `shared/schemas/source-info.schema.json`
- `shared/schemas/support-a4.schema.json`
- `shared/schemas/motion-storyboard.schema.json`
- `shared/scripts/validate_job.*`
- 2件の既存final packageを使う回帰fixtureまたは検証コマンド

合格条件:

- 必須JSONがSchemaに適合する。
- 全画像の寸法、破損、空白率、ファイル名、重複を検査できる。
- `manifest.json` とZIP内容の不一致を検出できる。
- 各Skillが同じ `job_id` とartifact参照を維持できる。
- 既存2案件を壊さずに検証できる。

### 5.2 KYOZAI Export

顧客価値が最も高い理由は、完成画像を「見る納品物」から「顧客が修正して再利用できる納品物」へ変えられるためである。

責務:

```text
deck-spec.json + slide images + speaker script
-> fidelity.pptx + editable.pptx + export-validation.json
```

実装は2段階に分ける。

1. Fidelity mode: 各PNGを全面背景として配置し、ノート、タイトル、出典、メタデータを持つPPTXを作る。
2. Editable mode: タイトル、本文、基本図形、線、表、画像を編集可能なPowerPoint要素として再構築する。

Fidelity modeだけでは優先理由を満たさないため、MVP完了はEditable modeの主要レイアウト対応までとする。Editable modeには `deck-spec.json` 内の要素座標、サイズ、スタイル、z-orderが必要であり、共通スキーマ整備を先行させる。

合格条件:

- PowerPoint、LibreOffice Impress、Google Slidesへのインポートで開ける。
- 日本語の文字化け、代替フォントによる重大な崩れがない。
- タイトルと本文が編集できる。
- 講師台本がspeaker notesとして入る。
- cover、本文、比較、手順、CTAの5レイアウトを再現できる。
- 元PNGとのモンタージュ比較を残す。

### 5.3 KYOZAI Design

すべてのSlide案件に効くため、Exportの次に投資価値が高い。現在のscaffoldは出力項目だけで、入力取得、定量抽出、検証が不足している。

MVP範囲:

- Webサイト、PNG/JPEG、PDF、PPTXの4入力を扱う。
- 配色、文字階層、余白、グリッド、角丸、線、情報密度、図解パターンを抽象化する。
- 固有ロゴ、固有コピー、固有イラストを流用しない。
- `design-profile.json` をSlideが直接読めるSchemaに固定する。
- 参考資料とKYOZAI再構成物の差分を `design-validation.json` に残す。

合格条件:

- 同じ資料を再分析したとき主要トークンが安定する。
- Web、画像、PPTXの3実例でprofileを作れる。
- Profile適用後も1スライド1テーマと日本語可読性を壊さない。
- 著作物の直接複製を避けたことを検証項目に含める。

### 5.4 KYOZAI Support安定化

新規開発量が少なく、顧客への追加納品価値を早く確認できる。新Skill開発と並行せず、Exportの区切り後に短期間で行う。

合格条件:

- 既存2案件からbefore、during A4、after A4を生成する。
- duringとafterのPDFがそれぞれ必ずA4縦1ページになる。
- 文字切れ、重なり、読めない小ささがない。
- 進行中資料が台本全文にならず、事後資料がFAQ集にならない。

### 5.5 KYOZAI Source

`kyozai-slide` は319行あり、URL取得、字幕取得、本文抽出、構成、画像生成、検証、ZIPまでを持つ。入力正規化を分離すると責務が明確になり、PDF、PPTX、DOCX、Webサイトへの拡張が容易になる。

責務:

```text
URL / YouTube / PDF / PPTX / DOCX / pasted text
-> normalized-source.md + source-info.json + source assets
```

ただし、分離によって利用者がSkillを手動でつなぐ必要はない。`kyozai-slide` から内部的に呼べる契約にする。

### 5.6 KYOZAI Orchestrator

Orchestratorを先に作ると、未確定のファイル名、Schema、失敗時処理を固定してしまう。Export、Design、Support、Sourceの入出力が確定してから本実装する。

合格条件:

- 依頼から必要Skillだけを選ぶ。
- 同じ `job_id` で再開できる。
- 途中失敗時に完了済みartifactを再生成しない。
- final昇格条件とpackage組み立てを一か所で管理する。
- 2つ以上の実案件でend-to-end完走する。

### 5.7 KYOZAI Assessment

教材から確認問題、演習、解答、採点基準を作る機能は顧客価値がある。ただし現在の製品定義はスライドと講師支援が中心であり、評価設計の品質基準も新たに必要になる。中核パイプライン安定後の拡張とする。

### 5.8 KYOZAI Movie

見栄えの効果は大きいが、時間同期、アニメーション意味付け、レンダリング、音声、字幕、動画検証まで範囲が広い。外部ツールのライセンスとSaaS利用条件も影響する。

当面は現在のscaffoldどおり、`motion-storyboard.json` と動画プロンプトまでに限定する。動画レンダリングをMVPに含めない。

## 6. GitHubコードの活用方針

### 6.1 採用候補

| リポジトリ | 主な用途 | License | 判断 |
|---|---|---|---|
| [gitbrent/PptxGenJS](https://github.com/gitbrent/PptxGenJS) | 編集可能PPTX生成 | MIT | Exportの第一候補。現在のCodex runtimeに導入済み |
| [microsoft/playwright](https://github.com/microsoft/playwright) | Web参考資料の取得、画面キャプチャ、レンダリング検証 | Apache-2.0 | DesignとValidateで直接利用。導入済み |
| [lovell/sharp](https://github.com/lovell/sharp) | リサイズ、合成、色統計、montage | Apache-2.0 | 現行Slideでも実績あり。導入済み |
| [mapbox/pixelmatch](https://github.com/mapbox/pixelmatch) | 画像差分 | ISC | ExportとDesignの視覚回帰に利用。導入済み |
| [microsoft/markitdown](https://github.com/microsoft/markitdown) | PDF、PPTX、DOCX等のMarkdown正規化 | MIT | Sourceの第一候補。必要形式だけoptional install |
| [marp-team/marp-cli](https://github.com/marp-team/marp-cli) | MarkdownからPDF/PPTX/画像への簡易変換 | MIT | fallback・比較実験用。編集可能PPTXは実験的なので主経路にしない |
| [motion-canvas/motion-canvas](https://github.com/motion-canvas/motion-canvas) | TypeScriptによるモーション設計・動画 | MIT | Movie実装時の第一検証候補 |
| [remotion-dev/remotion](https://github.com/remotion-dev/remotion) | Reactによる動画生成 | 独自ライセンス | 技術検証のみ。SaaS採用前に利用資格と再配布条件を確認 |
| [openai/skills](https://github.com/openai/skills) | Skill構造、progressive disclosure、検証手順の参考 | リポジトリの条件に従う | コード丸ごとコピーではなく構造と検証方法を参照 |
| [microsoft/presidio](https://github.com/microsoft/presidio) | PII検出・匿名化 | MIT | 将来のprivacy preflight候補。自動検出だけを安全保証にしない |

### 6.2 重要な注意

- Remotionは一般的なMIT/Apacheライセンスではない。[公開ライセンス](https://github.com/remotion-dev/remotion/blob/main/LICENSE.md)では、一定規模を超える営利組織はCompany Licenseが必要で、派生物の再販売・再配布にも制限がある。KYOZAI Movieへ固定依存させない。
- MarkItDown本体がMITでも、OCR追加機能の依存関係は別ライセンスを含み得る。[ライセンスに関する公式Discussion](https://github.com/microsoft/markitdown/discussions/1654)を踏まえ、PyMuPDF系を採用する場合はAGPLまたは商用ライセンス条件を個別確認する。
- [Marp CLI公式README](https://github.com/marp-team/marp-cli/blob/main/README.md)では、通常PPTXはレンダリング画像中心で、編集可能PPTXは実験的かつ再現性が下がるとされている。KYOZAI Exportの主経路はPptxGenJSとする。
- GitHubのコードは「見つけたからコピー」しない。原則はpackage依存、CLI呼び出し、公式API利用の順とし、ソースコピーやforkは最後の手段にする。

### 6.3 導入管理ルール

OSSを採用するときは次を記録する。

- リポジトリURL
- 採用versionまたはcommit SHA
- SPDX license
- KYOZAI内での利用箇所
- 改変の有無
- NOTICEや著作権表示の要否
- SaaS、商用利用、再配布の可否
- 代替候補と撤去方法

MIT、Apache-2.0、BSD、ISCは通常候補とする。AGPL、SSPL、独自商用条件、再配布制限があるものは、明示的な採用判断なしに中核依存へ入れない。

## 7. 推奨ロードマップ

工数は、1人の開発者がCodexを併用し、ローカルSkillと生成スクリプトを対象にする概算である。SaaS画面、認証、課金、クラウドレンダリングは含まない。

### Phase 0: 3〜5日

- 共通Schemaを追加する。
- 共通validatorを作る。
- 既存2案件を回帰fixtureにする。
- artifact kindへexport関連を追加する設計を確定する。

### Phase 1: 5〜10日

- `kyozai-export` を作る。
- PptxGenJSでFidelity modeを先に通す。
- 主要5レイアウトのEditable modeを追加する。
- speaker notes、日本語フォント、視覚比較を検証する。

### Phase 2: 8〜12日

- `kyozai-design` を本実装する。
- Playwright、sharp、pixelmatchを共通スクリプトとして組む。
- Web、画像、PPTXの3実例でforward-testする。

### Phase 3: 3〜5日

- `kyozai-support` を既存2案件でforward-testする。
- A4 PDFの自動・目視検証を固定する。

### Phase 4: 5〜10日

- `kyozai-source` を作る。
- MarkItDownを使い、PDF、PPTX、DOCXを正規化する。
- Webサイト入力とYouTube入力を同じsource契約へ合わせる。

### Phase 5: 4〜7日

- `kyozai-orchestrator` を本実装する。
- 再開、部分失敗、final昇格、package再構成を実案件で検証する。

Movieはこの後に再評価する。評価時点で、顧客から動画納品の具体要求、予算、必要尺、音声・字幕要件が揃っていることを着手条件とする。

## 8. 開発上の原則

1. Skillの文章より、繰り返す処理を `scripts/` に置く。
2. `SKILL.md` はルーティングと重要判断に絞り、詳細Schemaや例は `references/` に分ける。
3. 各Skillを単独で実行でき、JSON artifactで連携できる状態を維持する。
4. 新しいSkillは実案件3件をforward-testするまで「安定」と扱わない。
5. 顧客向け価値と内部品質を混同しない。Validateは重要でも、利用者向けSkillとして過剰に見せない。
6. OSS採用はライセンス、version固定、撤去可能性まで設計する。
7. `outputs/final/` を上書き・削除せず、再生成はversionまたは別jobとして残す。

## 9. 最終提言

次の実装は、共通Schema・validatorを短期で整備したうえで **KYOZAI Export** に進む。

理由は、現在のKYOZAIが「スライドを作れる」段階には到達した一方、「顧客が納品後に編集し、社内資産として再利用できる」段階にはまだ届いていないためである。Exportはこの差を最短で埋める。

その次にKYOZAI Designを実装し、成果物の編集可能性と見た目の品質を両方引き上げる。Orchestratorは各artifact契約が固まってから、Movieは商用条件と具体需要が確定してから着手する。

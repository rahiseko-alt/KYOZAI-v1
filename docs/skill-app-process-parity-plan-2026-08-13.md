# KYOZAI Skill / APP 工程同等化 修正計画書

作成日: 2026-08-13  
対象: 現行 `kyozai-slide` Skill / 公開APP `https://kyozai-v1.vercel.app`  
前提: 現行Skillは変更しない

## 1. エグゼクティブサマリー

本計画における「SkillとAPPを揃える」とは、生成結果のピクセルや文言を完全一致させることではない。
同じ種類の入力に対し、次の工程、判断基準、停止条件、検証、納品水準をAPPでも実施することをいう。

1. 入力取得と原典化
2. 教材分析
3. 学習順への再構成
4. 表示内容、講師台本、時間、構図の確定
5. 画像生成前の内容凍結QA
6. 共通profileによるデザイン設計
7. 1スライドずつのAI画像生成
8. 実画像QAと不良ページ単位の再生成
9. PNG、設計、台本、検証証跡、ZIPの納品
10. 原典と前版を使ったAI修正

AI生成物は実行ごとに異なるため、SkillとAPPのPNG同士のバイト一致は求めない。一方、APP内では、
プレビュー、個別ダウンロード、ZIPが同じ完成PNGを参照しなければならない。

現行APPは共通design profileまでは接続済みだが、一括JSON生成、短い進行メモ、AI申告時間、
React/CSS描画、HTML納品で止まっている。したがって現状は工程同等ではない。APP側へ不足工程を追加し、
直接入力/PDFから完成ZIPまで通る中核体験を先に公開する。

## 2. 変更しないもの

- `.agents/skills/kyozai-slide/**`の内容、ImageGen経路、QA規則、成果物構成を変更しない。
- KYOZAIを高機能な手動スライド編集APPにしない。
- 修正の主経路は自然言語とする。
- `kyozai-standard@1.0.0`の白、黒、青、7つのlayout familyを維持する。
- FAQと確認テストは削除しない。凍結済み教材から作る追加成果物として残す。
- SolはAPPの生成処理に使用しない。

## 3. 実装アーキテクチャ

```text
Browser
  -> Next.js Job API
  -> Vercel Workflow
       1. source ingest
       2. analysis
       3. slide map / script / timing
       4. content freeze QA
       5. image prompt build
       6. image generation per slide
       7. image QA / page retry
       8. package / publish
  -> Supabase Auth / Postgres / Private Storage
  -> OpenAI Responses API + Image API
```

- UIと公開APIは現在どおりVercelで運用する。
- 長時間処理は同期routeから外し、Vercel Workflowの耐久実行へ移す。
- 認証、job状態、版、artifact所有権、非公開ファイルはSupabaseへ集約する。
- YouTubeの`yt-dlp`処理だけはPhase 3で専用Cloud Run extractorへ分離する。
- 公開APPからCodex CLIや現行Skillをエージェントとして直接実行しない。Skillの工程契約をAPP用コードへ実装する。

### モデル

- 教材分析、構成、台本、内容QA、修正、画像QA: `gpt-5.5`、reasoning `medium`
- 最終画像モデルは生成ごとに利用者へ質問し、未選択では開始しない。
- 選択肢は同条件比較対象の`gemini-3.1-flash-lite-image`、`gemini-3.1-flash-image`、`gpt-image-2` mediumに限定する。
- 各providerの約1K・16:9出力を受け、検証済み画像を`1672x941`へcontain正規化する。
- 生成単位: 1リクエスト1スライド
- 自動再生成: 不良ページにつき1回まで

OpenAI公式ドキュメントは、単一promptから1画像を生成する用途にImage APIを推奨している。
`gpt-image-2`は高品質画像入力、任意解像度、generation/edit endpointを提供する。

- https://developers.openai.com/api/docs/guides/image-generation
- https://developers.openai.com/api/docs/models/gpt-image-2

APPがImage APIを使うことは、Codex組み込み`image_gen`を使うSkillと実装経路が同じという意味ではない。
内容凍結後に1枚ずつ画像化し、同じprofile、prompt構造、画像QA、再生成、納品ゲートを通すことで
工程水準を揃える。

## 4. 工程契約

各jobに`stage-ledger.json`相当の記録を持ち、工程ごとに`pending / running / passed / failed`、
開始・終了時刻、入力artifact、出力artifact、validator結果、モデル、再試行理由を保存する。

| Stage | 必須出力 | 合格条件 |
|---|---|---|
| `source_ingest` | 原本参照、抽出本文、source hash、取得警告 | 無記録の切り捨てがなく、原典へ追跡できる |
| `analysis` | 対象者、課題、到達点、中核主張、根拠、具体例、最終行動 | 全項目が原典に基づく |
| `slide_map` | 1枚1テーマの学習順マップ | 表紙とCTAがあり、タイトル列で論理が通る |
| `script_timing` | 完成講師台本、文字数、各ページ時間、合計時間 | `round(chars / 300 * 60)`と一致する |
| `content_freeze` | 凍結版deck spec、意味QA | 重複、矛盾、欠落がなく全検査PASS |
| `design` | profile、layout family、labels、画像prompt | profile準拠、同一family 3連続なし |
| `image_generate` | スライドごとのPNGとprompt記録 | 全ページに対応する画像がある |
| `image_validate` | 検証JSON、縮小画像、montage | 全ページの実画像QAがPASS |
| `package` | 必須artifact一式とZIP | manifestと実ファイルが一致する |
| `revision` | 影響範囲、変更版、再QA、差分 | 指示外変更を抑え、必要工程を再通過する |

## 5. 公開インターフェース

### API

- `POST /api/jobs`: 入力と教材指示を受け、`202`と`jobId`を返す。
- `GET /api/jobs/:jobId`: 所有者確認後、stage、進捗、警告、完成artifactを返す。
- `GET /api/jobs`: ログイン利用者の有効期限内の履歴を返す。
- `POST /api/jobs/:jobId/revisions`: `baseRevision`と自然文指示から新しい不変版を作る。
- `GET /api/jobs/:jobId/artifacts/:artifactId`: 短期限の署名付きURLを返す。
- `DELETE /api/jobs/:jobId`: 論理削除し、24時間以内に原本と全artifactを物理削除する。

### 主要型

- `KyozaiJob`: 所有者、状態、現在stage、入力種別、期限、active revision。
- `JobRevision`: 不変の版番号、基準版、修正指示、影響範囲、状態。
- `StageLedgerEntry`: stage、入力・出力artifact ID、validator、model、usage、retry。
- `Artifact`: kind、revision、lifecycle、private URI、SHA-256、media type。
- `DeckSpec`: 現行Skillが要求するスライド項目、台本、文字数、時間、profile、layout family、labels。

APP用schemaは`shared/`を単一正本とする。Skill本文を変更せず、schemaに`sourceSkillHash`を記録し、
Skillが変更された場合は工程契約の再監査をCIで要求する。

## 6. フェーズ別実装

### Phase 0: 契約固定と評価基盤 2〜3日

目的: 実装前に「工程同等」の判定方法を固定する。

- Skill全体、design profile、imagegen Skillのhashを記録する。Skillファイルは編集しない。
- `DeckSpec`、`StageLedgerEntry`、artifact manifestのschemaを`shared/`へ作る。
- 10工程の入力、出力、合格条件、失敗時停止を機械検証へ落とす。
- 既存の「同一job・Skill/APP間PNG hash一致」基準を廃止し、工程契約テストへ置き換える。
- 直接入力、長文PDF、YouTube、参考デザイン、自然文修正の評価fixtureを用意する。
- `PROCESS_PARITY_PIPELINE_ENABLED`を既定OFFで追加する。

完了条件:

- Skillの変更が0件。
- schema、stage遷移、時間計算、profile規則の単体テストがPASS。
- 旧APPは動作を維持するが、「Skill同等工程」とは表示しない。

### Phase 1: 実処理の細い縦断 3〜5日

目的: AGENTS.mdの規則どおり、中身を広げる前に入口から出口まで1回通す。

- Supabase Auth、job、revision、artifact、stage ledgerの最小構造を作る。
- Vercel Workflowで、直接入力1件、3スライド限定の非同期jobを通す。
- `gpt-5.5`で分析、マップ、講師台本、時間、凍結QAを分離実行する。
- 利用者が選択した画像モデルで3枚を別々に生成し、寸法検査、montage、ZIPまで作る。
- UIに実stage、再読込、画面を閉じた後の再開、完成PNG表示を接続する。
- APIキーや接続秘密は環境変数名だけをコードへ置き、値は利用者が管理画面へ直接登録する。

完了条件:

- 直接入力から完成ZIPまで、mockなしで1件完走する。
- APPプレビュー、個別PNG、ZIP内PNGのhashがAPP内で一致する。
- 中断後に同じjobを再開して二重画像生成しない。
- このPhaseは内部検証で、公開生成経路へは切り替えない。

### Phase 2: 中核体験版 6〜9日

目的: 見込み客が使える最小のSkill同等工程を公開する。

- 入力を直接入力、PDF、TXT、Markdownへ拡張する。
- 長文はsource位置を保持してchunk化し、先頭80,000文字で無記録に切らない。
- 素材量に応じて4〜12枚を生成する。固定4〜8枚制限を廃止する。
- 完成講師台本と決定論的な300文字/分計算を実装する。
- 内容凍結QAに落ちたjobは画像生成へ進めない。
- 実画像QAとして寸法、破損、白紙、文字差、余計な文字、切れ、重なり、コントラスト、
  25%表示、スマホ可読性、layout反復、montageを検査する。
- 画像不良は内容を変えず、そのページだけ1回再生成する。
- `deck-spec.json`、`deck-content-and-script.txt`、`source-info.json`、`image-prompts.json`、
  `image-validation.json`、`images/`、`montage.png`、`manifest.json`、`package.zip`を納品する。
- FAQ、確認テストは凍結済みdeckと原典から生成し、同じjobへ追加する。

公開制限:

- メール確認済み利用者のみ生成可能。
- 1job 25MiB、PDF 30ページ、最大12枚、同時実行1件。
- 1利用者1日3job。月額費用上限到達時は新規受付をサーバー側で停止する。
- 原本、途中成果物、完成物は7日後に自動削除する。利用者は即時削除を依頼できる。
- 機密情報や個人情報を入れない案内を維持する。

完了条件:

- 直接入力、PDF、長文Markdownの3ケースが10工程を完走する。
- 全完成ページが画像QA PASS。
- 本番URLのPCとスマートフォンで、投入、進捗、再開、閲覧、ZIP取得が成功する。
- 合格後に新pipelineを公開し、旧`/api/generate`は`410 Gone`へ切り替える。

### Phase 3: YouTubeと参考デザイン 4〜6日

目的: 現行Skillの主要入力とデザイン参照をAPPへ揃える。

- Cloud Run extractorへ`yt-dlp`を固定し、動画情報、手動字幕優先、日本語自動字幕fallbackを取得する。
- APPはYouTube動画IDだけを受理し、任意URL、短縮URL、内部アドレスへのアクセスを拒否する。
- 動画情報、字幕bytes、取得日時、source hashを保存する。
- 参考画像は原本hashを保存し、色、書体、線、余白、情報密度をprofileへ抽出する。
- 参考画像を画像生成入力へ渡し、コピーではなくデザイントークンとして使用する。

完了条件:

- 字幕ありYouTubeと参考画像付き案件が工程契約を完走する。
- 字幕取得不能時は代替経路と不足内容を利用者へ明示し、黙って一般Web本文を使わない。

### Phase 4: AI修正と版管理 5〜7日

目的: 手動編集ではなく、AIに依頼すれば確実に直る中核価値を実装する。

- 修正前に`visual_only / local_content / structural`へ影響範囲を分類する。
- `visual_only`: 文言を変えず、対象画像だけ画像化とQAを再実行する。
- `local_content`: 対象ページ、接続する前後台本、時間を更新し、凍結QA後に対象画像を再生成する。
- `structural`: 学習順、枚数、対象者、研修時間へ影響するため、影響範囲を記録して全工程を再実行する。
- 指示外のslide specとPNGはAPP内の前版から引き継ぎ、変更理由のない再生成を禁止する。
- revisionは不変版として保存し、同じ基準版への競合修正は`409 Conflict`にする。
- 修正後に指示達成評価、原典整合、画像QA、ZIP再作成を行う。

完了条件:

- 「初心者向けにする」「具体例を増やす」「3枚目の図だけ簡潔にする」の3ケースがPASS。
- 指示対象外のartifactが理由なく変わらない。
- 失敗時は前版を完成版として維持する。

### Phase 5: 公開強化と運用 4〜6日

目的: 体験版を継続公開できる安全性と観測性を持たせる。

- MIME、magic bytes、ページ数、展開後サイズをpreflight検査する。
- job/revision/attempt単位の排他リースで、Queue再配送時の二重生成を防ぐ。
- 完成かつmanifest検証済みのartifactだけを利用者へ公開する。
- 原文、メール、署名URL、認証header、秘密値をログへ出さない。
- 失敗率、待ち時間、stage別時間、画像数、再生成率、job原価、削除失敗を監視する。
- 費用または失敗率が閾値を超えた場合、新規job受付をサーバー側flagで停止する。
- DBとStorageを日次照合し、期限切れ・孤児artifactを削除する。

完了条件:

- quota、所有者分離、削除、競合修正、二重配送、部分成果物非公開のE2EがPASS。
- typecheck、lint、test、build、smoke、desktop/mobile E2EがすべてPASS。
- CI run URL、commit SHA、本番URLを完了証拠として残す。

## 7. UI方針

- 最初の画面は資料追加、教材指示、生成開始を主役にする。
- 処理中は実stageだけを表示し、固定時間や偽の完了進捗を出さない。
- 完成画面は生成済みPNG、講師台本、FAQ、確認テスト、AI修正、ZIP取得を配置する。
- 主操作は「AIに修正を頼む」とする。
- 手動微調整はテキスト訂正など最小限に留め、高機能なキャンバス編集は作らない。
- 未完成機能は「開発中」と表示するだけでなく、未実装APIも閉じる。

## 8. 工程同等性の受入試験

ピクセル一致、同一文言、同一構図、Skill/APP間のartifact hash一致は採点しない。

必須fixture:

1. 直接入力からの短い研修教材
2. 長文PDF
3. 字幕付きYouTube
4. 参考デザイン付き教材
5. 完成教材への自然文修正

全fixture共通の合格条件:

- 必要なstageが順番に実行され、各stageの証跡と合否がある。
- 原典から分析、スライド、講師台本へ追跡できる。
- 1枚1テーマ、表紙、CTA、layout規則を満たす。
- 各ページと合計時間が300文字/分の算式と一致する。
- 内容凍結PASS前に画像生成が始まっていない。
- 各ページを別々にAI画像生成している。
- 正規化後の全PNGが1672x941で、実画像QAがPASSしている。
- APPプレビューとAPP納品ZIPが同じ完成PNGを使う。
- 必須artifactがmanifestと一致する。
- 修正時は原典と前版を使用し、影響範囲と再実行stageが記録される。

品質比較は同じfixtureでSkill版とAPP版を別々に生成し、原典忠実性、学習順、台本実用性、
視認性、納品完全性を各5点でblind評価する。APPの中央値がSkillより各軸0.5点を超えて低くなく、
重大な原典逸脱が0件であることを公開合格条件とする。

## 9. PRと公開順

- PRはPhaseにつき1つとする。
- Phase途中はdraft PRへ積み、全ローカル検証後にdraftを解除する。
- Phase 0〜1では旧公開APPを維持する。
- Phase 2合格時に中核pipelineを本番へ切り替える。
- Phase 3以降は完成した機能だけ本番へ追加し、未完成機能には開発中表示とAPI遮断を併用する。
- squash merge後は次Phaseのブランチを`origin/main`から作り直す。

## 10. 最終判断

要求は実現可能である。必要なのはSkillの変更でも、SkillとAPPの生成結果を完全一致させることでもない。
現行Skillが実施している内容先行、凍結、1枚ずつの画像生成、実画像QA、ページ単位修正、納品整理を、
APPでも独立した工程として実装し、証跡と停止条件を持たせることである。

最優先はPhase 0〜2である。ここまで完了すれば、見込み客は資料を投入し、画面を閉じ、完成後に戻り、
Skillと同水準の工程を通った教材PNGとZIPを受け取れる。高機能な手動編集UIは作らない。

# design（この製品が何であるか）

**このファイルは上書きしない。** 方針が変わったら、変わった項目に日付付きで追記して
「いつ・何が・なぜ変わったか」を残す（`docs/failures.md` と同じ考え方）。
セッションごとの作業状況は `docs/handoff.md`、開発の進め方は `AGENTS.md` を見る。

判断の根拠になった実物・一次情報のリンクは、この文書に必ず残す。**リンクの無い
「業界ではこうなっている」を、この文書に書かない。**

`AGENTS.md`「業務ドメインを決めるときの作法」の対象になる案件（書式・手順・法律が既に
外の世界で決まっている実務に触れる案件）では、実装の前に必ずこの文書を埋める。
対象にならない案件では、埋められる範囲だけ埋めて残りは「なし」と書く。

---

## 1. 誰が使い、何をしないで済むのか

**使う人**：YouTube動画、台本、文字起こしを、再利用可能な日本語教材スライドへ変換したいCodex利用者。

**この製品の主張**（使う人が、この製品によって何をしないで済むか）：URL取得、字幕整理、教材構成、講師台本、時間計算、画像生成、全画像検証、納品物整理を別々の手順で組み立て直さなくてよい。

2026-08-11: このリポジトリをCodex Skillの正本として運用する方針を利用者が決定した。

---

## 2. 差別化点

- URL入力から検証済み画像とZIPまで、1つのSkillで最後まで完了する。
- 画像生成より先に、1スライド1テーマの内容設計、表示文言、講師台本、時間、構図を凍結する。
- 実際の画像生成プロンプトと画像検証結果を保存し、再生成可能性を残す。
- 白、黒、青の共通視覚言語を維持しながら、情報構造に応じてレイアウトを変える。

競合比較による差別化主張ではなく、2026-08-11に実行した実フローと利用者承認に基づく製品方針である。

---

## 3. 出す書類・成果物

- `deck-spec.json`: スライド仕様の機械可読データ
- `deck-content-and-script.txt`: 表示内容、講師台本、文字数、時間
- `source-info.json` と `source/`: 動画情報と取得字幕
- `image-prompts.json`: 各画像へ渡した生成プロンプト
- `images/`: 表紙、本文、CTAのPNG
- `image-validation.json`: 解像度、破損、白紙、統一性の検証結果
- `montage.png`: 全画像の一覧確認
- `{date}-{video-slug}-slide-package-complete.zip`: 納品一式

外部で定められた書式はない。

---

## 4. 調査で確定した事実

- 2026-08-11の実行では、YouTube URLから14枚のPNGを生成し、全画像を1672×941へ統一して検証した。
- 過去の実行ログでは、各`image_gen`プロンプトに16:9、白背景、黒文字、青アクセント、表示文言、スライド固有構図、スマートフォン可読性の指定が存在した。
- 利用者は、背景や見出し装飾の追加案ではなく、最初に一連のフローを試した白、黒、青のデザインを正本として承認した。
- Skillの配布単位は[`.agents/skills/teaching-slide-package`](../.agents/skills/teaching-slide-package/SKILL.md)とする。この配置により、リポジトリをCodexで開いた場合のプロジェクトSkillとしても、GitHub Skill Installerの導入元としても利用できる。
- Codex Skillの公開例と構造の一次情報: https://github.com/openai/skills

---

## 5. 2026-08-12 製品方向の追記

利用者は、KYOZAIを高度なスライド編集APPにしない方針を決定した。

- 原則体験は「資料を入れる -> 完成する -> そのまま使う」とする。
- 微調整の手動編集は可能にするが、高度な自由配置、レイヤー操作、詳細プロパティ編集は中核にしない。
- 修正の主経路は自然言語とし、「AIに言えば、指定箇所以外を壊さず確実に直る」ことを中核価値にする。
- 修正後はスライドだけでなく、講師台本、時間、講師資料、検証結果も整合させる。
- Exportは納品互換性のための薄い機能とし、編集可能PPTXの高機能化を競争軸にしない。
- KYOZAI Designは編集項目を増やすためではなく、初回完成度を上げて利用者の修正回数を減らすために使う。

競合機能の一次情報:

- Claude Design: https://claude.com/resources/tutorials/using-claude-design-for-presentations-and-slide-decks
- Gamma Agent: https://help.gamma.app/en/articles/8033284-can-i-edit-my-content-using-ai
- Beautiful.ai Slide AI: https://support.beautiful.ai/hc/en-us/articles/43350069148557-Create-and-Edit-your-Slides-with-Slide-AI

この判断を反映した開発計画は `docs/skill-development-plan-2026-08-12-v2.md` を正とする。

---

## 6. 2026-08-12 公開体験版の製品境界

見込み客が端末を問わず中核価値を体験できる公開体験版を先行公開した。

- 公開URL: https://kyozai-v1.vercel.app
- 完成機能は、資料または本文からスライド、講師シナリオ、FAQ、ミニテストを実際にAI生成する。
- 修正の主経路は自然言語とし、修正後に別のAI評価を行い、未達時は再修正する。
- 現在の納品物はブラウザーで閲覧・印刷できる自己完結HTMLとする。
- 生成は同期処理であり、完了まで画面を開いておく必要がある。
- 履歴、バックグラウンド生成、版管理・rollback、PPTX出力は未完成であり、画面では「開発中」と明示する。
- 未完成機能を完成したように見せる固定進捗や本番mockは置かない。
- 手動の高機能スライド編集UIは製品境界の外に置く。微調整用UIより、初回完成度とAI修正の成功率を優先する。

公開体験版の実装・検証記録は `docs/public-beta-implementation-report-2026-08-12.md` を参照する。

---

## 7. 2026-08-12 SkillとAPPの共通デザイン契約

同じ資料をKYOZAI Skillへ渡した場合と公開APPへ渡した場合で、標準デザインが別物にならないよう
`kyozai-standard@1.0.0`を共通契約として採用した。

- Skill同梱の正本: `.agents/skills/kyozai-slide/references/kyozai-design-profile.json`
- リポジトリ共通mirror: `shared/kyozai-design-profile.json`
- APP配備用mirror: `apps/web/lib/kyozai/design-profile.json`
- 3ファイルの同一性は単体テストで検査する。
- 教材JSONへ`designProfile`と各スライドの`layoutFamily`、`labels`を必須保存する。
- layout familyは`cover`、`focus`、`compare`、`sequence`、`evidence`、`checklist`、`action`に固定する。
- 先頭は`cover`、末尾は`action`とし、同じlayoutを3枚連続させない。
- AIは内容に合う情報構造を選ぶ。配色、書体、余白、青線、講師ノートの画面外分離はKYOZAI側が決定論的に適用する。
- 標準は白背景、黒い結論型見出し、`#075AC8`の青、薄いグレーの補助面とする。濃紺全面や紫gradientへ暗黙変更しない。
- 参考デザインを使う案件は別profileとしてIDと変更理由を残す。標準profileを上書きしない。

生成手段はSkillが画像生成、APPがHTML/CSSレンダリングで異なるためpixel単位の一致は求めない。
ただし、色、情報階層、layout family、表紙/CTA、表示文言、情報密度は同じ契約に従う。

---

## 8. 2026-08-12 公開APPのAIモデル方針

公開APPの教材生成・AI修正は`gpt-5.5`を標準とする。最高性能のCodex作業モデルを常用せず、
見込み客が試せる品質、応答時間、API費用の均衡を優先する。モデルはサーバー側の
`OPENAI_MODEL`で固定し、ブラウザーへAPIキーやモデル設定を公開しない。

---

## 9. 2026-08-13 SkillとAPPの「同じ」の定義

利用者は、SkillとAPPを揃える対象はAI生成結果の完全一致ではなく、**工程と品質基準の同等性**で
あると明確化した。AI生成である以上、別実行の画像、文言、構図が完全一致することは求めない。

- 現行`kyozai-slide` Skillは変更しない。
- APPは入力取得、教材分析、学習順、完成講師台本、300文字/分、内容凍結、共通profile、
  1枚ずつの画像生成、実画像QA、不良ページ再生成、成果物一式とZIPという工程を実装する。
- APPはCodex CLIを公開実行せず、本文工程を`gpt-5.5`、画像工程をAPP向け画像生成APIで実装してよい。
- Skill/APP間のPNGやartifact hash一致は求めない。
- APP内のプレビュー、個別取得、ZIPは同じ完成PNGを参照する。
- 工程同等性は、各stageの入力、出力、合否、再試行理由を記録する工程契約テストで判定する。
- FAQと確認テストは廃止せず、凍結済み教材から作る追加成果物として扱う。

この定義に基づく実装計画は
`docs/skill-app-process-parity-plan-2026-08-13.md`を正とする。

---

## 10. 2026-08-13 KYOZAI Reviseの版管理と修正境界

利用者の「AIに言えば確実に直る」を、無制限な全体再生成ではなく、型付き修正、対象外差分検査、
検証失敗時の旧版維持として実装する。

- 自由文の修正指示を、対象slide、変更可能field、維持field、影響artifactを持つoperationへ変換する。
- 「このスライドだけ」の依頼では、対象外slideを再生成しない。
- final成果物を上書きせず、修正版は新しいcandidate versionとして作る。
- Schema、対象外差分、根拠、台本、時間、関連artifactの検証合格時だけcurrent versionを進める。
- 自動再試行はscopeを広げず最大2回とし、解消しない場合は旧finalを維持する。
- 高機能な手動編集UIは追加せず、自然言語修正と復元を主経路にする。

Phase 0は修正契約、差分validator、50件の評価fixtureまでとし、画像生成APIや公開APPには接続しない。

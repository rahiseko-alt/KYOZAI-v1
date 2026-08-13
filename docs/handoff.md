# 引継ぎメモ（handoff）

セッションをまたぐ揮発的な引継ぎメモ。製品仕様は`docs/design.md`、実装報告は
`docs/public-beta-implementation-report-2026-08-12.md`、失敗履歴は`docs/failures.md`、
開発規約は`AGENTS.md`を正とする。

## 現在地

- 公開体験版: https://kyozai-v1.vercel.app
- Vercel project: `kyozai-v1`
- 中核フローは本番で実動確認済み。
- 高機能な手動スライド編集APPにはしない。資料投入、完成物、AI修正を主画面にする。
- 既存の未コミット文書変更と成果物は利用者作業を含むため、勝手に破棄しない。
- 2026-08-13、Skill/APPの一致対象は生成結果ではなく工程と品質基準であると確定した。
- 現行`kyozai-slide` Skillは変更しない。APP側へ不足工程を実装する。
- 正式な修正計画は`docs/skill-app-process-parity-plan-2026-08-13.md`。
- Phase 0の工程契約を`codex/phase-0-process-contract`で実装中。
- 10工程、deck spec、stage ledger、Skill baseline、評価fixture、validatorを追加済み。
- 新pipelineは`PROCESS_PARITY_PIPELINE_ENABLED=0`が既定で、公開生成経路には未接続。
- 2026-08-13、スライド画像モデル接続は実装せず、調査報告までで停止した。
- 別業務として`kyozai-revise` Phase 0を実装した。Skill正本、3 Schema、対象外差分validator、
  50件benchmark、artifact種別、Ajv厳格検証がある。画像生成APIと公開APPには未接続。

## 完成機能

- PDF、TXT、Markdown、URL、直接入力から教材生成
- スライド、講師シナリオ、FAQ、ミニテストの一括生成
- 自然言語による教材一式のAI修正
- 修正結果の構造検証、別AIによる指示達成評価、未達時の再修正
- 自己完結HTMLのダウンロード、ブラウザー表示、印刷
- PC・スマートフォン対応UI
- 入力資料の形式・容量検証、URLのプライベートIP拒否、基本レート制限
- OpenAI Responses APIのStructured Outputs、`store: false`
- `kyozai-standard@1.0.0`によるSkill/APP共通デザイン
- 内容別layout family、白・黒・青のスライドプレビューとHTML出力

## 開発中

- バックグラウンド生成と、画面を閉じた後の再開
- ログイン、案件履歴、端末間同期
- 版管理、差分表示、rollback
- PPTX、PDF、PNG、ZIPの正式出力
- PowerPoint・Wordの直接入力
- 永続ストアを使った分散レート制限

画面上では未完成のものだけに「開発中」を表示する。本番mockや固定の完了進捗は置かない。

## 本番検証

2026-08-12に公開URLで以下を確認した。

- `/`: HTTP 200、正しい見出し、CSP、`X-Frame-Options: DENY`、`nosniff`
- `/api/health`: HTTP 200、`{"status":"ok"}`
- 実OpenAI生成: スライド6枚、FAQ 4件、ミニテスト3問
- その生成物への実AI修正: 成功、件数・構造を維持
- 実PDF入力: 汎用MIMEのブランド設計PDFからスライド8枚、シナリオ6区分、FAQ 6件、ミニテスト4問を生成
- ローカル: typecheck、Lint、単体テスト21件、production buildが成功
- Playwright: desktop 2件、mobile 1件、計3件が成功

2026-08-12の公開後にOpenAI応答の途中JSONが発生したため、自動再試行と利用者向けエラーへの
置換を追加して再配備した。再配備後、本番でスライド5枚、シナリオ4区分、FAQ 4件、
ミニテスト4問の実生成に成功した。

同日、APPの教材デザインへ正本Skillの詳細が接続されていないことが判明した。
`kyozai-standard@1.0.0`を共通profileとして追加し、Skill・shared・APPの同一性検査、
`designProfile`、`layoutFamily`、比較`labels`を実装した。実OpenAIでは8枚、
`cover -> sequence -> checklist -> compare -> evidence -> checklist -> focus -> action`を返し、
比較ラベルも「決定事項 / 未決事項」と内容固有になった。

独立再レビューでは、deck-spec統一、具体構図、Schema/runtime整合、ブラウザーJSON安全化、
修正API時間上限、全7 layout検証を確認し、公開停止相当の未解消P1なしと判定された。

最終本番検証では生成が77秒で成功し、`kyozai-standard@1.0.0`、7枚、
`cover -> sequence -> focus -> compare -> checklist -> evidence -> action`を確認した。
本番AI修正も成功し、修正前後でprofileとlayout familyが維持された。

その後、生成がOpenAIへの78秒timeoutへ2回連続で到達した。Responses APIをSSE受信へ変更し、
講師ノートを120〜240文字の進行要点へ制限、生成の1試行を105秒へ拡張した。入力を短くするよう
求める誤った案内も削除した。ストリーム分割受信の単体テストを追加し、ローカル全検証は成功した。

独立レビューの指摘を受け、route全体へ225秒の絶対締切を追加した。URLのDNS・fetchとAI試行を
同じ締切で管理し、Vercelの240秒上限へ突入する再試行を開始しない。runtime validator不合格時も
再生成する。公開停止相当P1の解消は独立再レビューで確認済み。

タイムアウト修正直後、公開URLから当時の`gpt-5.6`で実生成が50.1秒で成功した。profileは
`kyozai-standard@1.0.0`、7枚、6シナリオ、FAQ 4件、確認テスト3問で、警告ログはない。

公開APPの標準モデルを`gpt-5.5`へ変更し、Vercel productionの`OPENAI_MODEL`にも明示設定した。
再配備後の実生成は32.9秒で成功し、6枚、FAQ 3件、確認テスト3問を返した。Codex用の
`terra`/`sol`は公開APPの教材生成APIには使用しない。

## 環境変数

- 必須: `OPENAI_API_KEY`
- 任意: `OPENAI_MODEL`（既定・本番設定ともに`gpt-5.5`）
- E2E専用: `KYOZAI_E2E_MODE=1`。Vercel productionでは無効化される。

値そのものを文書、ログ、Gitへ残さない。

## 次の優先順位

1. `kyozai-revise` Phase 0の変更範囲をレビューし、1つのPRとして確定する。
2. Revise Phase 1: `text.replace`、`text.rewrite`、対象外hash検証、candidate version、rollbackを実案件fixtureで通す。
3. KYOZAI Designを本実装し、初回完成度を上げて修正回数を減らす。
4. KYOZAI Supportを既存案件でforward-testし、A4 1ページ制約を固定する。
5. スライド画像モデルは調査報告の同条件A/B試験までとし、承認なしにAPP接続しない。

## 注意

- 現在の生成は同期処理で、利用者は完了まで1〜2分ほど画面を開いておく必要がある。
- APP版はAIが教材内容とlayout familyを生成し、React/CSSで決定論的に描画する。現時点では
  ImageGenによる写真・挿絵・スライド全面画像の生成は行わない。Skill版はImageGenを使用する。
- 上記の現行APP方式は工程同等性を満たしていない。新pipelineでは内容凍結後に1枚ずつAI画像生成し、
  実画像QAを通ったPNGをプレビューとZIPへ使う。
- 上記の新pipelineは計画として残すが、利用者の2026-08-13指示によりスライド実装は停止中。
- Revise Phase 0検証は`pnpm validate:revise`。3 Schema、50件fixture、差分validator単体5件を検査する。
- Revise統合時のtypecheck、lint、既存28 test、production build、依存監査、HTTP smoke、
  desktop/mobile E2Eは成功した。Windows smokeはGit Bash用のprocess tree終了分岐を追加した。
- KYOZAIのサーバーには入力資料を保存しないが、生成のためOpenAI APIへ送信する。
- 機密情報・個人情報を体験版へ入れない案内を維持する。
- `outputs/final/`は清書成果物なので、利用者の明示なしに削除しない。

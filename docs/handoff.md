# KYOZAI handoff

更新: 2026-08-14

## 最優先

- `AGENTS.md`先頭の決定に従い、KYOZAI Skillと公開APPの処理を入力から最終成果物まで全く同じにする。
- この同一化が完了するまで、デプロイ、モデルUI、Revise、その他の機能開発は後回しにする。
- 同じ入力をSkillとAPPへ渡し、工程、判断、layout、成果物、検証が一致する実物比較を合格条件にする。

## 現在地

- ブランチ: `codex/skill-app-process-parity`。起点は`0a21ccb`。
- 正本`kyozai-slide` Skillは変更していない。
- APPの教材本文生成を、1回の完成JSON生成から、`analysis`、`slide_map`、`script_timing`、`content_freeze`の独立AI工程へ変更した。
- 講師台本の文字数と時間はAI申告を使わず、APPが300文字/分で決定論的に計算する。
- 各スライドへ具体的な`composition`を保存し、画像promptへ要素数、位置、関係として渡す。
- source hash、原典参照、教材分析、凍結結果、画像prompt、10段階のstage ledgerをdeckへ保存する。
- 内容凍結のAI QAまたは機械検証が不合格なら、画像生成用deckを作らない。
- 完成ZIPを実際に作った時だけ`image_generate`、`image_validate`、`package`を`passed`へ昇格する。
- 直接入力fixtureで工程を再現し、凍結不合格と表紙欠落を停止する回帰テストを追加した。

## 本番状態

- 公開URL: https://kyozai-v1.vercel.app
- 現在の本番は旧ソース。画像モデル選択UIは表示されない。
- `vercel redeploy`は旧デプロイを再ビルドしただけで、最新`main`を反映していなかった。
- 最新ソースの`vercel --prod`は`turbopack.root`の誤設定で失敗。旧本番は維持された。
- `GEMINI_API_KEY`はPreview/Productionへ登録済み。
- `PROCESS_PARITY_PIPELINE_ENABLED=1`はProductionへ登録済み。
- ただし旧本番のため、Gemini画像生成の実動作確認は未実施。

## Skill同等性の不足

- ブラッドボーン記事の元URLまたは本文が残っておらず、同じ実入力によるSkill/APP blind比較は未実施。
- 現行routeは同期処理のため、画面を閉じた後の再開、永続job、private artifact storage、二重生成防止は未実装。
- APPのstage進捗は生成完了後の証跡には残るが、処理中UIへ10段階を逐次配信していない。
- 実画像の文字差、切れ、重なり、コントラスト、25%表示、スマホ可読性のQAは現行画像QAに依存し、Skillとのblind品質比較は未実施。
- 現在の本番結果はブラッドボーンの記事を「体験価値の伝え方」という8枚教材へ変換していたが、元記事URLを完成画面・成果物へ残していない。
- 同一入力でSkill比較するための出典が欠落しており、Skillの実行比較は未完了。

## 次回の着手順

1. 再現可能な直接入力fixtureを正本Skillでも最後まで実行し、APP成果物とのblind評価表を作る。
2. ブラッドボーン記事の元URLまたは本文が判明したら、同じ比較器へ追加する。
3. 同期routeを永続jobへ移し、stage ledgerを処理中UIへ逐次表示する。
4. 原本、draft、final、manifest、ZIPをprivate storageで不変artifactとして管理する。
5. 実3画像モデルでforward testし、文字差・可読性・montage QAを同一fixtureで検証する。
6. 同一入力のSkill/APP blind評価が合格してから、本番反映へ戻る。

## 今回の検証

- `pnpm validate:process`: PASS（10 stages、Skill baseline 3 files）
- `pnpm validate:skills`: PASS（7 Skills）
- typecheck / lint: PASS
- Vitest: 6 files、42 tests PASS
- build: PASS
- `scripts/smoke.sh`: PASS
- Playwright: desktop/mobile 3 tests PASS

## 禁止

- 7種類のlayout名が一致するだけで「Skillと同等」と判定しない。
- 本番HTTP 200、環境変数の存在、API入口だけで画像生成完了と報告しない。
- 元記事を確認せずmockや要約だけで比較しない。
- Skill同一化の完了前に他機能へ進まない。

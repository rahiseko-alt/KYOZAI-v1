# KYOZAI handoff

更新: 2026-08-14

## 最優先

- `AGENTS.md`先頭の決定に従い、KYOZAI Skillと公開APPの処理を入力から最終成果物まで全く同じにする。
- この同一化が完了するまで、デプロイ、モデルUI、Revise、その他の機能開発は後回しにする。
- 同じ入力をSkillとAPPへ渡し、工程、判断、layout、成果物、検証が一致する実物比較を合格条件にする。

## 現在地

- ブランチ: `main`。
- 今回のチェックイン対象: `AGENTS.md`、`apps/web/next.config.ts`、`docs/failures.md`、この`docs/handoff.md`。
- `AGENTS.md`へ最優先指示を追加済み。
- `next.config.ts`にはVercelのpnpmモノレポ解決用修正があるが、Skill同一化より後回し。
- `docs/failures.md`へ旧デプロイ再実行の誤認とVercelビルド失敗を追記済み。
- 変更後のtypecheck、lint、test（39件）、build、`scripts/smoke.sh`はすべてPASS。

## 本番状態

- 公開URL: https://kyozai-v1.vercel.app
- 現在の本番は旧ソース。画像モデル選択UIは表示されない。
- `vercel redeploy`は旧デプロイを再ビルドしただけで、最新`main`を反映していなかった。
- 最新ソースの`vercel --prod`は`turbopack.root`の誤設定で失敗。旧本番は維持された。
- `GEMINI_API_KEY`はPreview/Productionへ登録済み。
- `PROCESS_PARITY_PIPELINE_ENABLED=1`はProductionへ登録済み。
- ただし旧本番のため、Gemini画像生成の実動作確認は未実施。

## Skill同等性の不足

- 公開APPは教材生成を1回のStructured Outputへ集約しており、Skillの分析、学習順、スライドマップ、内容凍結を独立工程として実行・検証していない。
- APPの画像プロンプトは`layoutFamily`名と表示文言を渡すだけで、Skillが定める具体構図、要素数、位置、関係を渡していない。
- そのため記事内容に応じた比較、工程、因果、関係、数値、対象者、絞り込み等の構図選択が弱く、固定的で低品質な資料になる。
- 現在の本番結果はブラッドボーンの記事を「体験価値の伝え方」という8枚教材へ変換していたが、元記事URLを完成画面・成果物へ残していない。
- 同一入力でSkill比較するための出典が欠落しており、Skillの実行比較は未完了。

## 次回の着手順

1. 比較対象のブラッドボーン記事の元URLまたは本文を確定する。
2. 正本`kyozai-slide` Skillをその入力で最後まで実行し、分析、slide map、台本、時間、具体構図、画像、検証、ZIPを作る。
3. APPの各工程と成果物を同じ入力で採取し、Skillとの差分表を作る。
4. APPをSkillの段階処理へ置き換え、各段の中間成果物とgateを機械検証する。
5. `layoutFamily`だけでなく、内容から選んだ具体構図、要素数、位置、関係をdeck specと画像promptへ保存する。
6. 同一入力のSkill/APP比較が合格してから、保留中のVercel修正と本番反映へ戻る。

## 禁止

- 7種類のlayout名が一致するだけで「Skillと同等」と判定しない。
- 本番HTTP 200、環境変数の存在、API入口だけで画像生成完了と報告しない。
- 元記事を確認せずmockや要約だけで比較しない。
- Skill同一化の完了前に他機能へ進まない。

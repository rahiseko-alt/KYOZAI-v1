---
name: kyozai-support
description: KYOZAI Support。KYOZAI Slideや既存スライドのdeck-spec.json、source-info.json、スライド画像、講師台本をもとに、スライド説明の事前資料、進行中A4縦1枚カンペ、事後A4縦1枚持ち帰り資料を作るSkill。「講師資料」「説明用資料」「カンペ」「事前資料」「進行中資料」「事後資料」「A4 1枚」「登壇用」「FAQ」「説明者用レポート」等で発火。
---

# KYOZAI Support

KYOZAI Supportは、完成済みまたは作成中の教材スライドを説明する講師のために、説明前・説明中・説明後の資料を作る。

## 入力

優先入力:

1. `deck-spec.json`
2. `source-info.json`
3. スライド画像
4. 講師台本または `deck-content-and-script.txt`
5. 参考ソース本文またはURL

入力が不足する場合は、既存ファイルを探して補う。スライド番号、スライドタイトル、表示文言、講師台本、元ソース対応を維持する。

## 出力

下書きは `outputs/drafts/{job_id}/support/`、清書は `outputs/final/{job_id}/support/` に置く。

```text
support/
├─ 01-before-explanation.md
├─ 02-during-explanation-a4.md
├─ 02-during-explanation-a4.pdf
├─ 03-after-explanation-a4.md
├─ 03-after-explanation-a4.pdf
├─ support-a4.json
└─ support-validation.json
```

## 資料設計

### 01-before-explanation.md

説明前に読む深掘り資料。長くてよい。元ソースの主張、スライド対応、説明方針、誤解防止、厚く話すべきスライドを入れる。

### 02-during-explanation-a4

説明中に横へ置くカンペ。A4縦1枚に必ず収める。台本ではなく発話トリガーにする。

各スライドは最大3要素:

- 必ず言う一言
- 補足1点
- つなぎ/問い

全体タイムライン、長いFAQ、複数補足、価格詳細、読み上げ文章は入れない。

### 03-after-explanation-a4

説明後に見る持ち帰り判断シート。A4縦1枚に必ず収める。FAQ集ではなく、受講者が次に何を確認するかを決める紙にする。

優先して残す:

- 今日の結論
- 判断軸
- 実務質問
- 危険サイン
- 次アクション
- 注意書き

## PDF生成

`support-a4.json` を作ってから、同梱スクリプトでA4 PDFを生成する。

```powershell
python .agents/skills/kyozai-support/scripts/build_a4_support_pdfs.py --input path/to/support-a4.json --output-dir path/to/support
```

`support-a4.json` の形式は `references/support-a4-format.md` を読む。

## 検証

1. PDFのページ数がそれぞれ1ページであることを確認する。
2. PDFをPNGにレンダリングし、文字切れ、重なり、極端な小ささがないことを目視する。
3. 進行中資料に長文台本が混ざっていないことを確認する。
4. 事後資料がFAQ集になっていないことを確認する。
5. `support-validation.json` に検証結果を書く。

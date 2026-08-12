# support-a4.json format

`build_a4_support_pdfs.py` はこのJSONから進行中A4 PDFと事後A4 PDFを生成する。

```json
{
  "title": "AIコンサルは実装力で選ぶ",
  "during": {
    "title": "進行中カンペ｜AIコンサルは実装力で選ぶ",
    "summary": "結論: 肩書きより実装経験を見る。紙は読まず、一瞬だけ見てスライドへ戻る。",
    "rows": [
      {
        "page": "cover",
        "must": "肩書きではなく作って動かせるかで選ぶ。",
        "supplement": "戦略型を否定せず、実装まで欲しい時のミスマッチを避ける話。",
        "transition": "AIコンサルと聞いて、どんな仕事を想像しますか？"
      }
    ],
    "source_note": "根拠: source-info.json / deck-spec.json"
  },
  "after": {
    "title": "AIコンサル選定｜説明後の持ち帰りシート",
    "conclusion": "AIコンサルは、どの成果物を買う相手かで見る。",
    "sections": [
      {
        "title": "1. まず分ける",
        "lines": [
          "戦略型: ロードマップ、診断",
          "実装型: AIツール、連携、運用",
          "変革型: 組織全体の導入、教育"
        ]
      }
    ],
    "source_note": "根拠: source-info.json / deck-spec.json"
  }
}
```

Constraints:

- `during.rows` はスライド枚数分までにする。
- `during.rows[*].must` は1文にする。
- `during.rows[*].supplement` は1点だけにする。
- `during.rows[*].transition` は問いまたは次スライドへのつなぎにする。
- `after.sections` は5〜7個を上限にする。
- A4 1枚に入らない場合、本文を増やさず削る。

---
name: kyozai-design
description: KYOZAI Design。参考スライド、添付デザイン、テンプレート集サイト、既存デッキの見た目を分析し、色・余白・レイアウト・図解・情報密度を抽象化したdesign-profile.jsonを作るSkill。新しい教材内容へ参考デザインをそのままコピーせず再構築する。「このデザイン風に」「参考スライドを真似て」「テンプレサイト風」「デザイン分析」「design-profile」等で発火。
---

# KYOZAI Design

KYOZAI Designは、参考デザインを分析して、KYOZAI Slideが使える `design-profile.json` を作る。

## 重要ルール

1. 参考デザインをそのまま複製しない。
2. ロゴ、固有イラスト、固有テンプレート、固有コピーは流用しない。
3. 抽出するのは、配色、余白、レイアウト傾向、図解パターン、文字密度、強調表現などの抽象ルール。
4. 分析結果は、新しい教材内容に合わせて再構築できる形にする。

## 出力

```text
outputs/drafts/{job_id}/design/
├─ design-analysis.md
├─ design-profile.json
└─ design-validation.json
```

清書に昇格する場合:

```text
outputs/final/{job_id}/design/
├─ design-profile.json
└─ design-validation.json
```

## design-profile.json の最小項目

- palette
- typography
- layout_rules
- spacing_rules
- chart_rules
- icon_or_illustration_rules
- density
- do_rules
- avoid_rules
- imagegen_prompt_rules

## 現在の実装範囲

現時点では、参考資料の分析と `design-profile.json` の作成までを正本範囲とする。動画化や実画像生成は `kyozai-slide` または `kyozai-movie` に渡す。

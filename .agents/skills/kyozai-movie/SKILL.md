---
name: kyozai-movie
description: KYOZAI Movie。完成済みスライド、deck-spec.json、design-profile.json、講師台本をもとに、ズームだけではない動くスライド動画の絵コンテ、モーション設計、動画生成プロンプトを作るSkill。グラフが伸びる、数値がカウントアップする、矢印が進む、比較表がハイライトされる等、スライド内要素そのものの動きを設計する。「動くスライド」「動画資料」「スライドを動画に」「グラフを動かす」「動画プロンプト」「motion storyboard」等で発火。
---

# KYOZAI Movie

KYOZAI Movieは、完成済み教材スライドを、スライド内要素が動く動画資料へ変換するための設計を作る。

## 重要ルール

1. 単なるズーム、パン、フェードだけで終わらせない。
2. スライドの中身を分析し、意味のある動きに分解する。
3. 動画生成前に、必ず絵コンテとモーション意図を作る。
4. 元スライドの主張、デザイン、情報順序を壊さない。

## 出力

```text
outputs/drafts/{job_id}/motion/
├─ motion-storyboard.md
├─ motion-storyboard.json
├─ video-prompts.json
└─ motion-validation.json
```

清書に昇格する場合:

```text
outputs/final/{job_id}/movie/
├─ motion-storyboard.json
├─ video-prompts.json
└─ motion-validation.json
```

## motion-storyboard.json の最小項目

- slide_number
- slide_title
- motion_intent
- scene_timing
- animated_elements
- narration_alignment
- video_prompt
- avoid_motion

## 現在の実装範囲

現時点では、動画生成そのものではなく、絵コンテ、モーション設計、動画生成プロンプト作成までを正本範囲とする。

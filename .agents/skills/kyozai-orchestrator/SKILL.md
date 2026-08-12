---
name: kyozai-orchestrator
description: KYOZAI Orchestrator。KYOZAI Slide、KYOZAI Support、KYOZAI Design、KYOZAI Movieを組み合わせ、ユーザー依頼から必要なSkillを選び、下書き/清書/添付を分けたKYOZAI教材パッケージを組み立てる司令塔Skill。「全部作って」「KYOZAIで一式」「参考デザインでスライドと講師資料」「スライドと動画まで」「教材パッケージ」等で発火。
---

# KYOZAI Orchestrator

KYOZAI Orchestratorは、複数のKYOZAI Skillを連動させる司令塔。

## Skill選択

- スライド本体: `kyozai-slide`
- 講師資料: `kyozai-support`
- 参考デザイン分析: `kyozai-design`
- 動画資料化: `kyozai-movie`

## 標準連動

```text
reference design -> kyozai-design -> design-profile.json
source material + design-profile.json -> kyozai-slide -> deck-spec.json + slide images
deck-spec.json + source-info.json -> kyozai-support -> before/during/after materials
deck-spec.json + design-profile.json -> kyozai-movie -> motion storyboard + video prompts
```

## 出力ルール

すべての生成物はKYOZAIライフサイクルに従う。

```text
outputs/drafts/{job_id}/
outputs/final/{job_id}/
outputs/attachments/{job_id}/
outputs/tmp/{job_id}/
outputs/cache/{source_hash}/
```

最終納品物は `outputs/final/{job_id}/package.zip` にまとめる。

## 現在の実装範囲

現時点では、依頼内容を分解し、どのKYOZAI Skillをどの順序で使うべきかを決める。各Skillの実作業は、それぞれのSkillの正本手順に従う。

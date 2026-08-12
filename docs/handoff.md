# 引継ぎメモ（handoff）

セッションをまたぐ揮発的な引継ぎメモ。製品仕様は `docs/design.md` と `docs/kyozai-architecture.md`、失敗履歴は `docs/failures.md`、開発規約は `AGENTS.md` を正とする。

## 今回実施

- SaaS名を `KYOZAI` として、Skill群の正本構成を作成した。
- 既存 `teaching-slide-package` を削除せず、Legacy互換Skillとして残した。
- 新規正本Skillを `.agents/skills/` 配下に追加した。
  - `kyozai-slide`: スライド生成の正本。旧 `teaching-slide-package` の後継。
  - `kyozai-support`: 講師資料生成の正本。事前資料、進行中A4 1枚、事後A4 1枚。
  - `kyozai-design`: 参考デザイン分析・`design-profile.json` 生成のスキャフォールド。
  - `kyozai-movie`: 動くスライド動画用の絵コンテ・動画プロンプト生成のスキャフォールド。
  - `kyozai-orchestrator`: KYOZAI系Skill連動の司令塔スキャフォールド。
- `docs/kyozai-architecture.md` を追加し、KYOZAIのSkill境界、出力ライフサイクル、添付ファイル保持方針、SaaS化前提の保存構造を記録した。
- `shared/schemas/kyozai-job.schema.json` と `shared/schemas/kyozai-artifact.schema.json` を追加した。
- 生成物を `outputs/drafts/`, `outputs/final/`, `outputs/attachments/`, `outputs/tmp/`, `outputs/cache/` に分ける方針を `.gitignore` に反映した。
- `outputs/drafts/`, `outputs/tmp/`, `outputs/cache/` は安全に削除可能、`outputs/final/` と `outputs/attachments/` は明示なしに削除しない方針。

## 今回の判断

- 1つの巨大Skillにせず、KYOZAI機能ごとにSkillフォルダを分ける。
- 実体のSkill名はCodex互換のため lowercase hyphen-case にする。
- 表示名・プロダクト名は `KYOZAI Slide`, `KYOZAI Support`, `KYOZAI Design`, `KYOZAI Movie`, `KYOZAI Orchestrator` とする。
- 添付資料は将来SaaSの object storage に移行できるよう、ローカルでも `attachments/{job_id}/originals` と `attachments/{job_id}/normalized` に分ける。
- 旧 `teaching-slide-package` は互換のため残すが、新規作業では `kyozai-slide` を優先する。

## 検証結果

- `node scripts/validate-skills.mjs`: PASS
  - `kyozai-design`
  - `kyozai-movie`
  - `kyozai-orchestrator`
  - `kyozai-slide`
  - `kyozai-support`
  - `teaching-slide-package`
- `kyozai-support/scripts/build_a4_support_pdfs.py` は最小 `support-a4.json` で実行確認済み。
  - `02-during-explanation-a4.pdf`: 1ページ
  - `03-after-explanation-a4.pdf`: 1ページ

## 次回やること

1. `kyozai-slide` を実案件で使い、旧 `teaching-slide-package` と同等以上に動くか確認する。
2. `kyozai-support` をAIコンサル以外のデッキでも試し、A4 1枚制約が破綻しないか検証する。
3. `kyozai-design` の `design-profile.json` 仕様を具体化する。
4. `kyozai-movie` の `motion-storyboard.json` 仕様を具体化する。
5. `kyozai-orchestrator` で複数Skillを連動させる実行順と中間JSONを固める。

## 注意

- `cc-v3/`, `kose-food-ai-hp/`, `test/` は今回のKYOZAI正本化とは無関係の未追跡フォルダとして扱った。
- `docs/drafts/` は過去の試作メモ。今回の正本化コミットには含めない。

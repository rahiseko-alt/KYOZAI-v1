# 提案書：安全度と快適性のバランス（branch protection 未設定への対応）

作成日：2026-08-03。**2026-08-03、下記Aは実施済み（Ruleset `require-ci-green` を有効化。GitHub API で確認済み）。**
根拠は敵対的監査エージェントが GitHub API・ワークフロー実ログを直接確認した結果（会話ログ参照。実行者は `rahiseko-alt`、対象コミットは `main` の各PRマージコミット）。

## 目的

「いちいち待たない・承認を求めない」というサクサク感は維持したまま、「壊れたコード（CI赤）が `main` に入る」という**最低限破綻するケースだけ**を機械的に防ぎたい。全部を固くするのではなく、コストの割に効果が薄い対策は見送る。

## 現状・穴・重要度（監査結果の再掲）

| # | 現状 | 見つかった穴 | 重要度 |
|---|------|------|--------|
| 1 | `main` に branch protection / Ruleset が一切無い（API確認：`protected:false`、`rulesets:[]`） | CI緑を待たず・PRを経由せず直push/直マージできる。**実例：PR#17を、CodeRabbitの判定待ちの間に人間が直接マージ済み**（`ci-green` 自体は緑だった） | 最重度（実際に発生） |
| 2 | `hold` ラベルがリポジトリに存在しない | 唯一の「待った」の仕組みが使えず、安全弁が形骸化 | 高 |
| 3 | 全PR再スキャン設計で auto-merge の収束が遅い | 待ちきれず人間が直接マージ（過去7件中6件が手動）。ただし実運用は成立している | 中（実害は小） |
| 4 | 完了の証明（外部事実のみ）はCI自体は本物 | マージ前にそれを見ることを強制する仕組みが無い（1と同根） | 高（1と同一原因） |
| 5 | `out` フローにローカルチェック強制が無い | 赤いままpushされても技術的に止まらない | 低〜中 |
| 6 | `setup` 手順0の過去2事故（2026-08-01）への対策 | 無し（構造的に修正済みと判断） | 低（対応不要） |
| 7 | `auto-merge.yml`・`scripts/setup.sh` のコメントが旧AGENTS.mdの節（「検証の規律」「手順0-b」）を参照したまま | 実行ロジックに影響は無いが、参照先が現存しない | 低 |

## 推奨する最小セット（やること）

### A. GitHub Ruleset を1つ設定する（`#1・#4・#5` の根本原因に対応）— **実施済み**

2026-08-03、`rahiseko-alt` が GitHub UI で Ruleset `require-ci-green` を作成。GitHub API
（`GET /repos/rahiseko-alt/FreeTemplate-1/rulesets/20293174`）で以下を確認済み：

- `enforcement: active`、対象 `~DEFAULT_BRANCH`
- `required_status_checks`: `ci-green`
- `pull_request`: `required_approving_review_count: 0`（PR必須・承認不要）
- 追加で `deletion` / `non_fast_forward` も含まれる（ブランチ削除・強制push上書きも防止。提案時点の想定より一歩手厚い）
- `current_user_can_bypass: never`（管理者含め誰もバイパスできない）

以下は設定当時に検討した内容（記録として残す）。

**人が管理者権限で GitHub UI から行う必要がある**（GitHub Actions からは変更できない）。

- Settings → Rules → Rulesets → New branch ruleset
- Enforcement status：**Active**（既定はDisabledなので必ず変える）
- Target branches：Include default branch（`main`）
- Require status checks to pass：**`ci-green` のみ**（CodeRabbit・Vercelは含めない）
- Require a pull request before merging：**有効**（Required approvals は **0 のまま**）

**なぜこれでサクサク感と両立するか：**

- 待たされない：`ci-green` は毎回の push で既にCI自動実行されている。新たに待つ工程は増えない。
- 承認を求められない：Required approvals=0 のため、人間のレビュー承認は不要のまま。
- それでも防げること：CIが赤い/未実行のまま `main` へ直pushすることができなくなる。実際に起きた「auto-mergeの緑判定を待たずに人間が直接マージ」も、`ci-green` さえ緑であれば通常運用として通るので、いつも通りの操作は妨げない。

**注意：`scripts/setup.sh` だけでは不十分。** classic Branch Protection API の制約で「Required approvals=0のPR必須化」を設定できないため、スクリプトを実行しただけでは直pushが可能なまま＝`ci-green`を丸ごと迂回できる状態が残る（`scripts/setup.sh` 冒頭コメントに既知の制約として明記済み）。上記のUI手順が必須。

### B. `hold` ラベルを作成する（`#2` に対応）— **実施済み**

- ラベル名 `hold` を1つ作成するだけ。
- `.claude/skills/in-out/SKILL.md` に1行だけ「様子見したいPRにだけ付ける。それ以外では使わない」を追記。
- 使用頻度を増やす設計にはしない（デフォルトでは誰も付けない前提のまま）。

## やらないこと（サクサク感を優先して見送る）

- **ローカル pre-push フックの復活** → 過去に「変に安全装置を増やすな」というユーザーの明示的な意向で削除済み（`docs/failures.md` 2026-08-02参照）。再度追加しない。
- **`auto-merge.yml` への人間レビュー必須化の追加** → 承認待ちが発生し「待たない」という目的と正面から矛盾するため見送る。
- **`auto-merge.yml` の再設計（収束の高速化）** → `#3` は実害が小さく、実運用は人間の手動マージで十分に機能している。再設計のコスト・複雑化のリスクに見合わない。

## ついでに直しておくと良い軽微な修正（`#7`、コストほぼゼロ）— **実施済み**

- `.github/workflows/auto-merge.yml` のコメント「AGENTS.md『検証の規律』を参照」→ 現行の節名「完了の証明」に更新。
- `scripts/setup.sh` のコメント「AGENTS.md 手順0-b」→ 現行の場所「`setup` skill 手順7」に更新。

## チェックリスト（更新: 2026-08-03）

1. [x] リポジトリが Public であることを確認
2. [x] GitHub UIからRulesetを作成（`rahiseko-alt` が実施。証拠：`GET /repos/.../rulesets/20293174` の応答内容、本ファイル上部に記録）
3. [x] `hold` ラベルを作成し、`in-out/SKILL.md` に1行追記（commit `8c5da81`）
4. [x] `auto-merge.yml` / `scripts/setup.sh` のコメント参照を更新（commit `8c5da81`）
5. [ ] Ruleset設定後、実際に赤いブランチ・直pushが拒否されることを実地で確認する（API上の設定確認は済んでいるが、実際に弾かれる様子はまだ見ていない）
6. [ ] `docs/handoff.md` に今回の証拠（Ruleset ID・commit SHA）を反映する

主要3点（Ruleset・holdラベル・コメント修正）は完了。残るのは5の実地確認と6の引継ぎ反映のみ。

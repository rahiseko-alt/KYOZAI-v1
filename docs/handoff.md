# 引継ぎメモ（handoff）

## 現在地

- 公開体験版: https://kyozai-v1.vercel.app
- ブランチ: `codex/revise-phase-1`（`origin/main`から作成）
- Phase 0はPR #4でsquash merge済み。main merge commitは`6601fe9`。
- Revise Phase 1を実装中。現行`kyozai-slide` Skillと画像生成工程は変更していない。
- 製品仕様は`docs/design.md`、失敗履歴は`docs/failures.md`、開発規約は`AGENTS.md`を正とする。

## Phase 1実装

- `text.replace`と`text.rewrite`だけを許可する型付きplan、patch、server executor。
- 対象は「このスライド」または明示番号の1〜3枚。
- 変更可能fieldは`theme`、`title`、`keyMessage`、`labels[itemIndex]`、`bullets[itemIndex]`。
- baseからcandidateをdeep cloneし、事前条件、配列形状、TeachingPackage、対象外deep diff、SHA-256を検査。
- 成功時だけcandidateを昇格し、失敗時は有効なbaseとfailure codeを返す。
- provider/Structured Output一時障害だけ初回を含む最大3回。同一scopeとbaseを維持。
- API本文はUTF-8実測256KiB上限。教材本文をログへ出さない。
- UIはAI修正、取消、Undo/Redo、stale response拒否。直接文字編集や詳細プロパティUIは追加していない。
- 履歴はReact state内だけで、リロード・別端末・永続履歴は対象外。

## 検証状況

- 既存Phase 0 benchmark 50件は維持。
- Phase 1 fixture 50件を追加: success 20、reject 20、version/API/UI flow 10。
- VitestはAPI境界・provider再試行を含め97件。
- Playwrightはdesktop/mobileの成功、拒否、取消、Undo/Redoを含む4件。
- 実`gpt-5.5` forward-testは利用枠が残っていた実行で安全性20/20、意味意図20/20。その後の厳密target再実行はAPI利用枠不足でcandidate生成前に停止した。
- Skill、工程契約、Revise validator、typecheck、lint、test、build、audit、HTTP smoke、E2E、diff checkは成功。

## 固定条件

- 公開APPは`gpt-5.5`、`OPENAI_API_KEY`、`store: false`を継続する。
- 新しい秘密情報は追加しない。値を文書・ログ・Gitへ残さない。
- スライド画像生成モデル/APIは接続しない。
- 高機能な編集APPにはしない。
- Phase 2候補は台本・時間・FAQ等の同期修正と永続版管理。

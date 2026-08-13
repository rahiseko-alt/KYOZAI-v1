# KYOZAI handoff

更新: 2026-08-13

## 現在地

- 現在ブランチ: `codex/image-process-parity`。`origin/main`から独立して作成。
- KYOZAI Revise Phase 1は別ブランチ・Draft PR #6。画像工程へ混ぜていない。
- 正本`.agents/skills/kyozai-slide/**`の変更は0件。
- 画像モデルは固定しない。生成ごとに3候補から明示選択し、未選択を拒否する。
- 実装報告: `docs/image-process-parity-phase-report-2026-08-13.md`。

## 実装済み

- Gemini Flash Lite / FlashとGPT Image 2 Mediumのadapter。
- 教材hashと選択モデルを束ねる期限付き署名render grant。
- 1枚単位生成、実MIME・寸法・白紙検査、gpt-5.5画像QA、不良ページ1回再生成。
- timeout時の画像API自動再送禁止。
- 完成PNGのプレビュー、個別取得、HTML、ZIP共通利用。
- ZIP内の実bytes SHA-256再計算、manifest照合、montage、prompt、validation一式。
- feature flag既定OFF。E2Eだけ明示ON。

## 検証

- `pnpm validate:process`: PASS
- `pnpm validate:skills`: PASS
- typecheck / lint: PASS
- Vitest: 39件PASS
- build: PASS
- dependency audit moderate: 既知脆弱性0
- smoke: PASS、検査サーバー残留なし
- Playwright: desktop/mobile 3件PASS
- E2EでZIP全7 PNGの1672x941、実hash、manifest、個別PNG一致、montage PNGを検査済み

## 未完・公開前に必要

- `GEMINI_API_KEY`の実値は未登録。利用者がVercelへ直接登録する。
- productionの`PROCESS_PARITY_PIPELINE_ENABLED`は既定0。公開切替時だけ1にする。
- 実3モデルforward-testは未実行。
- 認証付き分散rate limit、月額費用停止flag、永続job、再開、private artifact storageは未実装。
- montageを使った全体統一感AI QAと不良ページ再生成は未実装。
- 以上のためDraft PRのままにし、完成表示へ切り替えない。

## ローカル

- 開発サーバー: `http://localhost:3142`
- PIDはポート所有者を確認してから停止する。

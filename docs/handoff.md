# KYOZAI handoff

更新: 2026-08-26

## 現在のGate

- Gate: G0（正しい測定器）
- ブランチ: `codex/g0-parity-measurement`
- 親Gate: G0
- ゴールへの寄与: 偽の工程同等性合格を止め、以後のGateを実fixtureで判定可能にする。
- 合格証拠: 致命的negative 10件が全件不合格、正本Skillの実packageが通常モードで合格、
  Skill baseline不変。
- 復帰先: なし（寄り道中ではない）

## G0実fixture結果

- fixture: `direct-input-record-decisions`
- evidence mode: `real`
- process contract: `kyozai-slide-process@1.0.0`
- design profile: `kyozai-standard@1.0.0`
- slides: 4、台本460字、300文字／分換算91秒
- images: 4枚、1672×941 PNG、全件QA合格。2枚は各1回再生成し、上限2回以内。
- package digest: `99f1f656597395d80698fe611e717b826d643cdb84f8732c4c3fdcff5f4de153`
- 生成packageはリポジトリ外のOS一時領域に置き、案件固有の生成画像をコミットしない。

## 外部証拠と次の一手

- G0の実fixture条件はローカル合格済み。
- commit SHAとCI run URLは未取得。G0の全ローカル検証後にG0差分だけをコミットし、PRを作成する。
- CI合格とG0 PR完了まではG1へ着手しない。
- G1ではdisposable Preview SupabaseとPreview用の必須環境変数が必要。秘密値は運用者が
  エージェントを経由せず直接登録する。

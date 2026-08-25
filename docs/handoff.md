# KYOZAI handoff

更新: 2026-08-25

## 最優先

- KYOZAI SkillとAPPは、入力から最終成果物まで同じ工程、停止条件、検証、成果物契約を守る。
- PNGの完全一致ではなく、内容凍結、300文字/分、design profile、画像QA、manifest、ZIP整合の同等性を合格条件にする。
- 正本Skill `.agents/skills/kyozai-slide/**` は変更しない。

## 現在地

- `main` は `661b584 Repair durable generation safety invariants (#16)`。
- 次ブランチは `codex/revision-operations`。未コミット差分なし。
- Productionはポートフォリオだけを返し、生成APIは404のまま閉鎖している。
- durable jobはSupabase Auth、private Storage、RLS、outbox、Vercel Workflow、stage ledger、artifact hash検証、private ZIPを実装済み。
- 内容工程は `source_ingest → analysis → slide_map → script_timing → content_freeze → design` を独立Workflow stepとして保存・再開する。
- content freezeがPASSするまで画像APIを呼ばない。画像呼出しは論理fingerprintで予約し、二重課金を停止する。
- Redis異常、RLS直接更新、Storage read-back hash不一致、workflow lease回復を回帰検査へ含めた。

## 未証明・次の一本道

1. 同じ直接入力fixtureを正本SkillとAPPへ実行し、blind評価表（工程順、停止条件、300文字/分、内容網羅、画像QA、manifest、納品構成）を残す。
2. disposableなPreview Supabaseへmigrationとprivate bucketsを適用し、実Providerで3-slide fixtureを完走させる。
3. 同環境で、workflow停止・lease期限切れ・二重配送・freeze失敗・quota競合・Redis/DB障害・Storage破損・RLS越境・取消・署名URL失効を壊して確認する。
4. 実証後にだけ、revision、物理削除cleanup、監視運用を同じ永続経路へ追加する。
5. Production生成の再開は別PR。実証、監視、削除実績が揃うまで404を維持する。

## 現在の外部ブロッカー

- この実行環境にはPreview Supabase接続値とVercel運用設定が存在しない。実DB・実Providerの受入試験は、接続先を偽装せず、設定済みPreviewでのみ実行する。
- したがってPhase 5は未着手ではなく「試験基盤はあるが、実環境証拠が未取得」。この事実を完了と呼ばない。

## マージ済み検証

- `pnpm validate:process`
- `pnpm validate:skills`
- `pnpm --filter web typecheck`
- `pnpm --filter web lint`
- `pnpm --filter web test`（140 tests）
- `pnpm -r build`
- `bash scripts/smoke.sh`
- `bash scripts/e2e.sh`

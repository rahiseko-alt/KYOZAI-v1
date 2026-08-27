# KYOZAI handoff

更新: 2026-08-27

## 現在のGate

- Gate: G1（直接入力の実縦断）
- ブランチ: `codex/g1-resume`
- 親Gate: G1
- ゴールへの寄与: Cloudflare上の実DB、private artifact、定期実行、認証境界を通して、
  直接入力を実Providerで完走させる。
- 合格証拠: Preview実Provider完走、故障注入行列、provider usage突合、PNG／ZIP hash一致。

## 復帰先

- 利用者決定: Supabase基盤は採用しない。Cloudflare D1、R2、Workersへ変更し、Vercelは画面配備に維持する。
- 運用費は0円、AI生成API費用だけを利用者ごとの実費とする。Free上限超過時は有料化せず、新規受付をfail-closedで停止する。
- 次の着手: Supabase依存の棚卸し、Cloudflare対応先、認証方式、所有者分離、データ移行、Preview実証条件をG1計画へ確定する。
- Supabase migration、scheduler手順、依存コードはCloudflareの同等実装が実証されるまで削除しない。

## 外部ブロッカー

- Cloudflare account、D1 database、R2 private bucket、Workersの実行設定は未作成。
- Supabase Authの代替となる認証方式は未決定であり、所有者分離の実装前に選定が必要。
- Vercel PreviewはReadyだが、Cloudflare基盤の実証に必要な環境変数は未登録。

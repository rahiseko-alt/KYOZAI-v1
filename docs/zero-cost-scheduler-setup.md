# 0円運用 scheduler の設定

この手順は、無料Supabase projectが`pg_cron`、`pg_net`、Vaultを利用できることをPreviewで確かめるためのもの。
秘密値はこのリポジトリ、チャット、CIログへ書かない。値の作成と登録は運用者が各管理画面で直接行う。

1. Vercel Previewへ`CRON_SECRET`を登録する。
2. 同じ値をSupabase Vaultへ`kyozai_scheduler_cron_secret`という名前で登録する。
3. Vercel Deployment Protectionを使う場合だけ、そのbypass値をSupabase Vaultへ
   `kyozai_scheduler_vercel_bypass`という名前で登録する。
4. migration適用後、Supabase SQL Editorで運用者自身が次を実行する。URLにはPreview deploymentのURLを使う。

```sql
select public.configure_kyozai_zero_cost_scheduler(
  'https://<preview-domain>/api/internal/jobs/dispatch',
  'https://<preview-domain>/api/internal/jobs/cleanup'
);
```

5. `cron.job`に`kyozai-zero-cost-dispatch`と`kyozai-zero-cost-cleanup`があり、実行後に
   `cron.job_run_details`と`net._http_response`へ成功結果があることを確認する。

設定、Vault secret、URLのいずれかが無い間、scheduler functionはHTTPを呼ばずfalseを返す。
したがってprovider呼出しは開始されない。無料枠でextensionまたは定期実行を利用できない場合は、
有料化せず`KYOZAI_ASYNC_JOBS_ENABLED=0`を維持して受付を停止する。

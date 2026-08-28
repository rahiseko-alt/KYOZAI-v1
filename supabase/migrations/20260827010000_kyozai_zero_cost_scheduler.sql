-- G1 zero-cost operations: Supabase schedules the existing authenticated
-- Vercel endpoints. The secret is stored only in Supabase Vault and Vercel;
-- cron.job contains the fixed Vault names, never a secret value.

create extension if not exists pg_cron;
create extension if not exists pg_net;
create extension if not exists supabase_vault with schema vault;

create schema if not exists private;

create table if not exists private.kyozai_scheduler_configuration (
  id boolean primary key default true check (id),
  dispatch_url text not null check (dispatch_url ~ '^https://'),
  cleanup_url text not null check (cleanup_url ~ '^https://'),
  updated_at timestamptz not null default timezone('utc', now())
);

create or replace function public.configure_kyozai_zero_cost_scheduler(
  p_dispatch_url text,
  p_cleanup_url text
)
returns boolean
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if coalesce(p_dispatch_url, '') !~ '^https://' or coalesce(p_cleanup_url, '') !~ '^https://' then
    raise exception using errcode = '22023', message = 'scheduler URLs must use HTTPS';
  end if;
  insert into private.kyozai_scheduler_configuration (id, dispatch_url, cleanup_url, updated_at)
    values (true, p_dispatch_url, p_cleanup_url, timezone('utc', now()))
  on conflict (id) do update set
    dispatch_url = excluded.dispatch_url,
    cleanup_url = excluded.cleanup_url,
    updated_at = excluded.updated_at;
  return true;
end;
$$;

create or replace function private.invoke_kyozai_scheduler_endpoint(p_kind text)
returns boolean
language plpgsql
security definer
set search_path = private, public, vault, net
as $$
declare
  v_config private.kyozai_scheduler_configuration%rowtype;
  v_cron_secret text;
  v_bypass_secret text;
  v_url text;
  v_headers jsonb;
begin
  if p_kind not in ('dispatch', 'cleanup') then
    raise exception using errcode = '22023', message = 'invalid scheduler endpoint';
  end if;
  select * into v_config from private.kyozai_scheduler_configuration where id = true;
  select decrypted_secret into v_cron_secret
    from vault.decrypted_secrets where name = 'kyozai_scheduler_cron_secret';
  if v_config.id is null or coalesce(v_cron_secret, '') = '' then
    -- Fail closed before HTTP dispatch and therefore before any provider call.
    return false;
  end if;
  select decrypted_secret into v_bypass_secret
    from vault.decrypted_secrets where name = 'kyozai_scheduler_vercel_bypass';
  v_url := case when p_kind = 'dispatch' then v_config.dispatch_url else v_config.cleanup_url end;
  v_headers := jsonb_build_object(
    'Authorization', 'Bearer ' || v_cron_secret,
    'Content-Type', 'application/json'
  );
  if coalesce(v_bypass_secret, '') <> '' then
    v_headers := v_headers || jsonb_build_object('x-vercel-protection-bypass', v_bypass_secret);
  end if;
  perform net.http_post(
    url := v_url,
    headers := v_headers,
    body := '{}'::jsonb,
    timeout_milliseconds := 5000
  );
  return true;
end;
$$;

-- Reapplying the migration to a disposable Preview replaces only KYOZAI's two
-- named jobs; it never removes another project's scheduler entry.
select cron.unschedule(jobid) from cron.job
  where jobname in ('kyozai-zero-cost-dispatch', 'kyozai-zero-cost-cleanup');
select cron.schedule(
  'kyozai-zero-cost-dispatch',
  '*/5 * * * *',
  $$select private.invoke_kyozai_scheduler_endpoint('dispatch')$$
);
select cron.schedule(
  'kyozai-zero-cost-cleanup',
  '17 */6 * * *',
  $$select private.invoke_kyozai_scheduler_endpoint('cleanup')$$
);

revoke all on table private.kyozai_scheduler_configuration from public, anon, authenticated;
revoke all on function public.configure_kyozai_zero_cost_scheduler(text, text) from public, anon, authenticated;
revoke all on function private.invoke_kyozai_scheduler_endpoint(text) from public, anon, authenticated;
grant execute on function public.configure_kyozai_zero_cost_scheduler(text, text) to service_role;

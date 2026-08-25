-- Claim exactly one durable outbox item. SKIP LOCKED permits concurrent cron/workflow
-- workers without executing the same job in parallel.
create or replace function public.claim_kyozai_dispatch(p_lease_owner text)
returns table (job_id uuid, revision_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dispatch public.workflow_dispatches%rowtype;
begin
  if coalesce(length(trim(p_lease_owner)), 0) = 0 then
    raise exception using errcode = '22023', message = 'lease owner is required';
  end if;

  select * into v_dispatch
  from public.workflow_dispatches
  where status = 'pending' and next_attempt_at <= timezone('utc', now())
  order by created_at
  for update skip locked
  limit 1;
  if not found then return; end if;

  update public.workflow_dispatches
  set status = 'dispatched', attempts = attempts + 1, dispatched_at = timezone('utc', now()), last_error_code = null
  where id = v_dispatch.id;
  update public.jobs
  set status = case when status = 'cancelling' then 'cancelled' else 'running' end
  where id = v_dispatch.job_id and status in ('queued', 'cancelling');

  if not exists (select 1 from public.jobs where id = v_dispatch.job_id and status = 'running') then
    return;
  end if;
  return query select v_dispatch.job_id, v_dispatch.revision_id;
end;
$$;

revoke all on function public.claim_kyozai_dispatch(text) from public, anon, authenticated;
grant execute on function public.claim_kyozai_dispatch(text) to service_role;

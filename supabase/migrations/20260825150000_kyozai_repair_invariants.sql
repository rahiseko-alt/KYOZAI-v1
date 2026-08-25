-- Repair the public-job boundary. Browser clients may observe their own rows,
-- but every mutation is performed by authenticated API code using service_role
-- RPCs. This prevents post-acceptance changes to a job's cost or provider.
drop policy if exists jobs_owner_all on public.jobs;
drop policy if exists revisions_owner_all on public.job_revisions;
drop policy if exists upload_sessions_owner_all on public.upload_sessions;

create policy jobs_owner_select on public.jobs for select
  using ((select auth.uid()) = owner_id);
create policy revisions_owner_select on public.job_revisions for select
  using (exists (select 1 from public.jobs where jobs.id = job_revisions.job_id and jobs.owner_id = (select auth.uid())));
create policy upload_sessions_owner_select on public.upload_sessions for select
  using ((select auth.uid()) = owner_id);


-- A dispatched row is a lease, not a permanent terminal state. A workflow that
-- was accepted by start() but never began is recovered after its lease expires.
alter table public.workflow_dispatches
  add column if not exists workflow_run_id text,
  add column if not exists lease_owner text,
  add column if not exists lease_expires_at timestamptz,
  add column if not exists started_at timestamptz,
  add column if not exists completed_at timestamptz;
alter table public.quota_reservations add column if not exists inflight_image_calls integer not null default 0 check (inflight_image_calls >= 0);
create index if not exists workflow_dispatches_recovery_idx
  on public.workflow_dispatches (status, lease_expires_at)
  where status = 'dispatched';

create or replace function public.claim_next_kyozai_workflow_dispatch()
returns table (id uuid, job_id uuid, revision_id uuid, attempts integer, lease_owner text)
language plpgsql security definer set search_path = public as $$
declare v_dispatch public.workflow_dispatches%rowtype; v_lease text := gen_random_uuid()::text;
begin
  select * into v_dispatch from public.workflow_dispatches
  where (status = 'pending' and next_attempt_at <= timezone('utc', now()))
     or (status = 'dispatched' and lease_expires_at <= timezone('utc', now()))
  order by coalesce(next_attempt_at, created_at), created_at
  for update skip locked limit 1;
  if not found then return; end if;
  update public.workflow_dispatches set status = 'dispatched', attempts = v_dispatch.attempts + 1,
    lease_owner = v_lease, lease_expires_at = timezone('utc', now()) + interval '15 minutes',
    dispatched_at = timezone('utc', now()), workflow_run_id = null, last_error_code = case
      when v_dispatch.status = 'dispatched' then 'workflow_lease_expired' else null end
  where workflow_dispatches.id = v_dispatch.id;
  return query select v_dispatch.id, v_dispatch.job_id, v_dispatch.revision_id, v_dispatch.attempts + 1, v_lease;
end; $$;

create or replace function public.record_kyozai_workflow_started(p_dispatch_id uuid, p_lease_owner text, p_workflow_run_id text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  update public.workflow_dispatches set workflow_run_id = p_workflow_run_id,
    started_at = coalesce(started_at, timezone('utc', now())),
    lease_expires_at = timezone('utc', now()) + interval '15 minutes'
  where id = p_dispatch_id and status = 'dispatched' and lease_owner = p_lease_owner
    and lease_expires_at > timezone('utc', now()) and workflow_run_id is null;
  return found;
end; $$;

create or replace function public.renew_kyozai_workflow_dispatch_lease(p_dispatch_id uuid, p_lease_owner text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  update public.workflow_dispatches set lease_expires_at = timezone('utc', now()) + interval '15 minutes'
  where id = p_dispatch_id and status = 'dispatched' and lease_owner = p_lease_owner
    and lease_expires_at > timezone('utc', now());
  return found;
end; $$;

-- The worker checks this immediately before every paid provider invocation.
-- The row lock serializes concurrent image-stage attempts and system controls.
create or replace function public.assert_kyozai_provider_budget(p_job_id uuid, p_image_model text, p_image_calls integer)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_control public.system_controls%rowtype; v_quota public.quota_reservations%rowtype; v_job public.jobs%rowtype;
begin
  if p_image_calls < 0 then raise exception using errcode = '22023', message = 'invalid image call count'; end if;
  select * into v_control from public.system_controls where id = true for update;
  if not found or not v_control.accept_new_jobs or not (v_control.allowed_models ? p_image_model) then
    raise exception using errcode = 'P0001', message = 'provider is disabled';
  end if;
  select * into v_job from public.jobs where id = p_job_id for update;
  if not found or v_job.status not in ('queued', 'running') or v_job.image_model <> p_image_model then
    raise exception using errcode = 'P0001', message = 'job is not executable';
  end if;
  select * into v_quota from public.quota_reservations where job_id = p_job_id for update;
  if not found or v_quota.charge_state = 'released' or v_quota.confirmed_image_calls + v_quota.inflight_image_calls + p_image_calls > v_quota.reserved_image_calls then
    raise exception using errcode = 'P0001', message = 'job image quota exceeded';
  end if;
  return true;
end; $$;

revoke all on function public.record_kyozai_workflow_started(uuid, text, text) from public, anon, authenticated;
revoke all on function public.renew_kyozai_workflow_dispatch_lease(uuid, text) from public, anon, authenticated;
revoke all on function public.assert_kyozai_provider_budget(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.record_kyozai_workflow_started(uuid, text, text) to service_role;
grant execute on function public.renew_kyozai_workflow_dispatch_lease(uuid, text) to service_role;
grant execute on function public.assert_kyozai_provider_budget(uuid, text, integer) to service_role;

create or replace function public.reserve_kyozai_image_call(p_job_id uuid, p_revision_id uuid, p_stage_run_id uuid, p_model text, p_request_fingerprint text)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_quota public.quota_reservations%rowtype; v_control public.system_controls%rowtype; v_job public.jobs%rowtype;
begin
  select * into v_control from public.system_controls where id = true for update;
  select * into v_job from public.jobs where id = p_job_id for update;
  select * into v_quota from public.quota_reservations where job_id = p_job_id for update;
  if not found or not v_control.accept_new_jobs or not (v_control.allowed_models ? p_model)
    or v_job.status not in ('queued', 'running') or v_job.image_model <> p_model
    or v_quota.charge_state = 'released' or v_quota.confirmed_image_calls + v_quota.inflight_image_calls + 1 > v_quota.reserved_image_calls then
    raise exception using errcode = 'P0001', message = 'image call is unavailable';
  end if;
  if exists (select 1 from public.usage_events where job_id = p_job_id and request_fingerprint = p_request_fingerprint) then return true; end if;
  insert into public.usage_events (job_id, revision_id, stage_run_id, provider, model, request_fingerprint, image_count, estimated_cost_units, charge_state)
    values (p_job_id, p_revision_id, p_stage_run_id, 'image', p_model, p_request_fingerprint, 1, 1, 'reserved');
  update public.quota_reservations set inflight_image_calls = inflight_image_calls + 1 where id = v_quota.id;
  return true;
end; $$;

create or replace function public.settle_kyozai_image_call(p_job_id uuid, p_request_fingerprint text, p_charge_state public.kyozai_charge_state)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_usage public.usage_events%rowtype; v_quota public.quota_reservations%rowtype;
begin
  if p_charge_state not in ('confirmed', 'ambiguous') then raise exception using errcode = '22023', message = 'invalid image settlement'; end if;
  select * into v_usage from public.usage_events where job_id = p_job_id and request_fingerprint = p_request_fingerprint for update;
  if not found then raise exception using errcode = 'P0001', message = 'image reservation not found'; end if;
  if v_usage.charge_state <> 'reserved' then return true; end if;
  select * into v_quota from public.quota_reservations where job_id = p_job_id for update;
  update public.usage_events set charge_state = p_charge_state, actual_cost_units = 1 where id = v_usage.id;
  update public.quota_reservations set inflight_image_calls = greatest(0, inflight_image_calls - 1),
    confirmed_image_calls = confirmed_image_calls + 1, confirmed_cost_units = confirmed_cost_units + 1,
    charge_state = p_charge_state where id = v_quota.id;
  return true;
end; $$;
revoke all on function public.reserve_kyozai_image_call(uuid, uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.settle_kyozai_image_call(uuid, text, public.kyozai_charge_state) from public, anon, authenticated;
grant execute on function public.reserve_kyozai_image_call(uuid, uuid, uuid, text, text) to service_role;
grant execute on function public.settle_kyozai_image_call(uuid, text, public.kyozai_charge_state) to service_role;

create or replace function public.record_kyozai_usage(
  p_job_id uuid, p_revision_id uuid, p_stage_run_id uuid, p_provider text,
  p_model text, p_request_fingerprint text, p_image_count integer,
  p_cost_units integer, p_charge_state public.kyozai_charge_state
) returns boolean language plpgsql security definer set search_path = public as $$
declare v_existing uuid; v_quota public.quota_reservations%rowtype;
begin
  if p_image_count < 0 or p_cost_units < 0 or coalesce(length(trim(p_request_fingerprint)), 0) = 0 then
    raise exception using errcode = '22023', message = 'invalid usage event';
  end if;
  select id into v_existing from public.usage_events where job_id = p_job_id and request_fingerprint = p_request_fingerprint;
  if found then return true; end if;
  select * into v_quota from public.quota_reservations where job_id = p_job_id for update;
  if not found or v_quota.charge_state = 'released' then raise exception using errcode = 'P0001', message = 'quota unavailable'; end if;
  if p_charge_state in ('confirmed', 'ambiguous')
     and v_quota.confirmed_image_calls + p_image_count > v_quota.reserved_image_calls then
    raise exception using errcode = 'P0001', message = 'quota exceeded';
  end if;
  insert into public.usage_events (job_id, revision_id, stage_run_id, provider, model, request_fingerprint, image_count, estimated_cost_units, actual_cost_units, charge_state)
  values (p_job_id, p_revision_id, p_stage_run_id, p_provider, p_model, p_request_fingerprint, p_image_count, p_cost_units,
    case when p_charge_state = 'confirmed' then p_cost_units else null end, p_charge_state);
  if p_charge_state in ('confirmed', 'ambiguous') then
    update public.quota_reservations set confirmed_image_calls = confirmed_image_calls + p_image_count,
      confirmed_cost_units = confirmed_cost_units + p_cost_units,
      charge_state = p_charge_state
    where id = v_quota.id;
  end if;
  return true;
end; $$;

create or replace function public.release_kyozai_unused_quota(p_job_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  -- Retain confirmed/ambiguous usage in the monthly calculation but release the
  -- unused reservation. Marking a partially used reservation as fully released
  -- would make already-paid calls disappear from the global budget.
  update public.quota_reservations set
    reserved_image_calls = confirmed_image_calls,
    reserved_cost_units = confirmed_cost_units,
    charge_state = case when confirmed_image_calls = 0 then 'released'::public.kyozai_charge_state else charge_state end,
    released_at = timezone('utc', now())
  where job_id = p_job_id and charge_state <> 'released';
  return found;
end; $$;
revoke all on function public.record_kyozai_usage(uuid, uuid, uuid, text, text, text, integer, integer, public.kyozai_charge_state) from public, anon, authenticated;
revoke all on function public.release_kyozai_unused_quota(uuid) from public, anon, authenticated;
grant execute on function public.record_kyozai_usage(uuid, uuid, uuid, text, text, text, integer, integer, public.kyozai_charge_state) to service_role;
grant execute on function public.release_kyozai_unused_quota(uuid) to service_role;

create or replace function public.complete_kyozai_workflow_dispatch_v2(p_dispatch_id uuid, p_lease_owner text)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_job public.jobs%rowtype;
begin
  select j.* into v_job from public.workflow_dispatches d join public.jobs j on j.id = d.job_id
  where d.id = p_dispatch_id and d.status = 'dispatched' and d.lease_owner = p_lease_owner
    and d.lease_expires_at > timezone('utc', now()) for update of d, j;
  if not found then return false; end if;
  if v_job.status = 'completed' then
    update public.workflow_dispatches set status = 'completed', completed_at = timezone('utc', now()), lease_owner = null, lease_expires_at = null, last_error_code = null
      where id = p_dispatch_id and lease_owner = p_lease_owner;
    return true;
  end if;
  if v_job.status in ('cancelled', 'cancelling') then
    update public.workflow_dispatches set status = 'cancelled', completed_at = timezone('utc', now()), lease_owner = null, lease_expires_at = null
      where id = p_dispatch_id and lease_owner = p_lease_owner;
    return true;
  end if;
  return false;
end; $$;

create or replace function public.requeue_kyozai_workflow_dispatch_v2(p_dispatch_id uuid, p_lease_owner text, p_error_code text)
returns public.kyozai_dispatch_status language plpgsql security definer set search_path = public as $$
declare v_dispatch public.workflow_dispatches%rowtype; v_job public.jobs%rowtype;
begin
  select * into v_dispatch from public.workflow_dispatches where id = p_dispatch_id for update;
  if not found then raise exception using errcode = 'P0001', message = 'dispatch not found'; end if;
  if v_dispatch.status <> 'dispatched' or v_dispatch.lease_owner is distinct from p_lease_owner then return v_dispatch.status; end if;
  select * into v_job from public.jobs where id = v_dispatch.job_id for update;
  if v_job.status in ('cancelling', 'cancelled', 'deleting', 'deleted') then
    update public.workflow_dispatches set status = 'cancelled', completed_at = timezone('utc', now()), lease_owner = null, lease_expires_at = null, last_error_code = p_error_code where id = p_dispatch_id;
    return 'cancelled';
  end if;
  if v_job.status = 'failed' or v_dispatch.attempts >= 2 then
    update public.workflow_dispatches set status = 'failed', completed_at = timezone('utc', now()), lease_owner = null, lease_expires_at = null, last_error_code = p_error_code where id = p_dispatch_id;
    update public.jobs set status = 'failed', error_code = coalesce(v_job.error_code, 'workflow_dispatch_failed') where id = v_job.id and status in ('queued', 'running');
    return 'failed';
  end if;
  update public.workflow_dispatches set status = 'pending', lease_owner = null, lease_expires_at = null, last_error_code = p_error_code,
    next_attempt_at = timezone('utc', now()) + interval '30 seconds' where id = p_dispatch_id;
  return 'pending';
end; $$;
revoke all on function public.complete_kyozai_workflow_dispatch_v2(uuid, text) from public, anon, authenticated;
revoke all on function public.requeue_kyozai_workflow_dispatch_v2(uuid, text, text) from public, anon, authenticated;
grant execute on function public.complete_kyozai_workflow_dispatch_v2(uuid, text) to service_role;
grant execute on function public.requeue_kyozai_workflow_dispatch_v2(uuid, text, text) to service_role;

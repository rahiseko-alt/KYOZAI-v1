-- G1 direct-input reliability: every paid provider attempt has one durable
-- charge state and recoverable checkpoint, while cancellation converges after
-- the last live stage lease expires.

alter table public.quota_reservations
  add column if not exists inflight_cost_units integer not null default 0
  check (inflight_cost_units >= 0);

alter table public.usage_events
  add column if not exists operation text not null default 'image_generation',
  add column if not exists result_storage_path text,
  add column if not exists result_sha256 text,
  add column if not exists result_byte_size bigint;

alter table public.usage_events
  drop constraint if exists usage_events_operation_check,
  add constraint usage_events_operation_check
    check (operation in ('text_generation', 'image_generation', 'image_qa')),
  drop constraint if exists usage_events_result_integrity_check,
  add constraint usage_events_result_integrity_check check (
    (result_storage_path is null and result_sha256 is null and result_byte_size is null)
    or (
      result_storage_path is not null
      and result_sha256 ~ '^[0-9a-f]{64}$'
      and result_byte_size > 0
    )
  );

create index if not exists usage_events_recovery_idx
  on public.usage_events (job_id, operation, request_fingerprint, charge_state);

create or replace function public.reserve_kyozai_provider_attempt(
  p_job_id uuid,
  p_revision_id uuid,
  p_stage_run_id uuid,
  p_operation text,
  p_provider text,
  p_model text,
  p_request_fingerprint text,
  p_image_count integer,
  p_cost_units integer
)
returns table (
  charge_state public.kyozai_charge_state,
  result_storage_path text,
  result_sha256 text,
  result_byte_size bigint,
  should_call boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_control public.system_controls%rowtype;
  v_job public.jobs%rowtype;
  v_quota public.quota_reservations%rowtype;
  v_usage public.usage_events%rowtype;
begin
  if p_operation not in ('text_generation', 'image_generation', 'image_qa')
    or coalesce(length(trim(p_provider)), 0) = 0
    or coalesce(length(trim(p_model)), 0) = 0
    or coalesce(length(trim(p_request_fingerprint)), 0) = 0
    or p_image_count < 0
    or p_cost_units < 0 then
    raise exception using errcode = '22023', message = 'invalid provider attempt';
  end if;

  select * into v_usage from public.usage_events
  where job_id = p_job_id and request_fingerprint = p_request_fingerprint
  for update;
  if found then
    return query select v_usage.charge_state, v_usage.result_storage_path,
      v_usage.result_sha256, v_usage.result_byte_size, false;
    return;
  end if;

  select * into v_control from public.system_controls where id = true for update;
  if v_control.id is null or not v_control.accept_new_jobs then
    raise exception using errcode = 'P0001', message = 'provider attempts are disabled';
  end if;
  select * into v_job from public.jobs where id = p_job_id for update;
  if v_job.id is null or v_job.status not in ('queued', 'running') then
    raise exception using errcode = 'P0001', message = 'job is not executable';
  end if;
  select * into v_quota from public.quota_reservations where job_id = p_job_id for update;
  if v_quota.id is null or v_quota.charge_state = 'released'
    or v_quota.confirmed_cost_units + v_quota.inflight_cost_units + p_cost_units > v_quota.reserved_cost_units then
    raise exception using errcode = 'P0001', message = 'provider attempt budget unavailable';
  end if;
  if not exists (
    select 1 from public.job_revisions where id = p_revision_id and job_id = p_job_id
  ) or not exists (
    select 1 from public.stage_runs where id = p_stage_run_id
      and job_id = p_job_id and revision_id = p_revision_id
  ) then
    raise exception using errcode = 'P0001', message = 'provider attempt lineage mismatch';
  end if;

  -- A concurrent delivery can pass the initial no-row lookup while waiting for
  -- the serialized budget locks. Recheck before insert to keep it idempotent.
  select * into v_usage from public.usage_events
  where job_id = p_job_id and request_fingerprint = p_request_fingerprint
  for update;
  if found then
    return query select v_usage.charge_state, v_usage.result_storage_path,
      v_usage.result_sha256, v_usage.result_byte_size, false;
    return;
  end if;
  if p_operation = 'image_generation' and (
    not (v_control.allowed_models ? p_model)
    or v_job.image_model <> p_model
    or v_quota.confirmed_image_calls + v_quota.inflight_image_calls + p_image_count > v_quota.reserved_image_calls
  ) then
    raise exception using errcode = 'P0001', message = 'image attempt unavailable';
  end if;

  insert into public.usage_events (
    job_id, revision_id, stage_run_id, operation, provider, model,
    request_fingerprint, image_count, estimated_cost_units, charge_state
  ) values (
    p_job_id, p_revision_id, p_stage_run_id, p_operation, p_provider, p_model,
    p_request_fingerprint, p_image_count, p_cost_units, 'reserved'
  );
  update public.quota_reservations set
    inflight_image_calls = inflight_image_calls + p_image_count,
    inflight_cost_units = inflight_cost_units + p_cost_units
  where id = v_quota.id;
  return query select 'reserved'::public.kyozai_charge_state, null::text,
    null::text, null::bigint, true;
end;
$$;

create or replace function public.settle_kyozai_provider_attempt(
  p_job_id uuid,
  p_request_fingerprint text,
  p_charge_state public.kyozai_charge_state,
  p_result_storage_path text default null,
  p_result_sha256 text default null,
  p_result_byte_size bigint default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_usage public.usage_events%rowtype;
  v_quota public.quota_reservations%rowtype;
  v_cost integer;
begin
  if p_charge_state not in ('confirmed', 'ambiguous', 'released') then
    raise exception using errcode = '22023', message = 'invalid provider settlement';
  end if;
  if p_charge_state = 'confirmed' and (
    coalesce(length(trim(p_result_storage_path)), 0) = 0
    or p_result_sha256 !~ '^[0-9a-f]{64}$'
    or p_result_byte_size <= 0
  ) then
    raise exception using errcode = '22023', message = 'confirmed provider result requires a checkpoint';
  end if;

  select * into v_usage from public.usage_events
  where job_id = p_job_id and request_fingerprint = p_request_fingerprint
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'provider reservation not found';
  end if;
  if v_usage.charge_state <> 'reserved' then return true; end if;

  select * into v_quota from public.quota_reservations where job_id = p_job_id for update;
  v_cost := case when p_charge_state = 'released' then 0 else v_usage.estimated_cost_units end;
  update public.usage_events set
    charge_state = p_charge_state,
    actual_cost_units = v_cost,
    result_storage_path = case when p_charge_state = 'confirmed' then p_result_storage_path else null end,
    result_sha256 = case when p_charge_state = 'confirmed' then p_result_sha256 else null end,
    result_byte_size = case when p_charge_state = 'confirmed' then p_result_byte_size else null end
  where id = v_usage.id;
  update public.quota_reservations set
    inflight_image_calls = greatest(0, inflight_image_calls - v_usage.image_count),
    inflight_cost_units = greatest(0, inflight_cost_units - v_usage.estimated_cost_units),
    confirmed_image_calls = confirmed_image_calls
      + case when p_charge_state <> 'released' then v_usage.image_count else 0 end,
    confirmed_cost_units = confirmed_cost_units + v_cost,
    charge_state = case when p_charge_state = 'ambiguous'
      then 'ambiguous'::public.kyozai_charge_state else charge_state end
  where id = v_quota.id;
  return true;
end;
$$;

create or replace function public.settle_kyozai_job_cancellation(p_job_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.jobs%rowtype;
  v_confirmed_images integer;
  v_confirmed_cost integer;
  v_has_ambiguous boolean;
begin
  select * into v_job from public.jobs where id = p_job_id for update;
  if not found or v_job.status not in ('cancelling', 'cancelled') then return false; end if;

  update public.stage_runs set
    status = 'skipped',
    started_at = coalesce(started_at, timezone('utc', now())),
    completed_at = timezone('utc', now()),
    lease_owner = null,
    lease_expires_at = null,
    error_code = 'job_cancelled'
  where job_id = p_job_id and (
    status = 'pending'
    or (status = 'running' and (
      lease_expires_at is null or lease_expires_at <= timezone('utc', now())
    ))
  );
  if exists (
    select 1 from public.stage_runs
    where job_id = p_job_id and status = 'running'
      and lease_expires_at > timezone('utc', now())
  ) then return false; end if;

  -- An expired worker may still have reached a provider without persisting its
  -- response. Treat every remaining reservation as charged-but-unknown before
  -- releasing the job so cancellation never erases possible provider cost.
  update public.usage_events set
    charge_state = 'ambiguous',
    actual_cost_units = estimated_cost_units
  where job_id = p_job_id and charge_state = 'reserved';
  select
    coalesce(sum(image_count) filter (where charge_state in ('confirmed', 'ambiguous')), 0)::integer,
    coalesce(sum(actual_cost_units) filter (where charge_state in ('confirmed', 'ambiguous')), 0)::integer,
    coalesce(bool_or(charge_state = 'ambiguous'), false)
  into v_confirmed_images, v_confirmed_cost, v_has_ambiguous
  from public.usage_events where job_id = p_job_id;

  update public.jobs set status = 'cancelled', current_stage = null where id = p_job_id;
  update public.job_revisions set status = 'cancelled', completed_at = timezone('utc', now())
    where job_id = p_job_id and status in ('queued', 'running');
  update public.workflow_dispatches set
    status = 'cancelled', completed_at = timezone('utc', now()),
    lease_owner = null, lease_expires_at = null, last_error_code = 'job_cancelled'
    where job_id = p_job_id and status in ('pending', 'dispatched');
  update public.quota_reservations set
    confirmed_image_calls = v_confirmed_images,
    confirmed_cost_units = v_confirmed_cost,
    reserved_image_calls = v_confirmed_images,
    reserved_cost_units = v_confirmed_cost,
    inflight_image_calls = 0,
    inflight_cost_units = 0,
    charge_state = case
      when v_has_ambiguous then 'ambiguous'::public.kyozai_charge_state
      when v_confirmed_cost = 0 then 'released'::public.kyozai_charge_state
      else 'confirmed'::public.kyozai_charge_state
    end,
    released_at = timezone('utc', now())
    where job_id = p_job_id;
  return true;
end;
$$;

create or replace function public.release_kyozai_unused_quota(p_job_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_confirmed_images integer;
  v_confirmed_cost integer;
  v_has_ambiguous boolean;
begin
  update public.usage_events set
    charge_state = 'ambiguous',
    actual_cost_units = estimated_cost_units
  where job_id = p_job_id and charge_state = 'reserved';
  select
    coalesce(sum(image_count) filter (where charge_state in ('confirmed', 'ambiguous')), 0)::integer,
    coalesce(sum(actual_cost_units) filter (where charge_state in ('confirmed', 'ambiguous')), 0)::integer,
    coalesce(bool_or(charge_state = 'ambiguous'), false)
  into v_confirmed_images, v_confirmed_cost, v_has_ambiguous
  from public.usage_events where job_id = p_job_id;
  update public.quota_reservations set
    confirmed_image_calls = v_confirmed_images,
    confirmed_cost_units = v_confirmed_cost,
    reserved_image_calls = v_confirmed_images,
    reserved_cost_units = v_confirmed_cost,
    inflight_image_calls = 0,
    inflight_cost_units = 0,
    charge_state = case
      when v_has_ambiguous then 'ambiguous'::public.kyozai_charge_state
      when v_confirmed_cost = 0 then 'released'::public.kyozai_charge_state
      else 'confirmed'::public.kyozai_charge_state
    end,
    released_at = timezone('utc', now())
  where job_id = p_job_id;
  return found;
end;
$$;

create or replace function public.settle_pending_kyozai_cancellations()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job_id uuid;
  v_count integer := 0;
begin
  for v_job_id in
    select j.id from public.jobs j
    join public.quota_reservations q on q.job_id = j.id
    where j.status = 'cancelling'
      or (j.status = 'cancelled' and q.released_at is null)
    for update of j skip locked
  loop
    if public.settle_kyozai_job_cancellation(v_job_id) then
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.reserve_kyozai_provider_attempt(uuid, uuid, uuid, text, text, text, text, integer, integer) from public, anon, authenticated;
revoke all on function public.settle_kyozai_provider_attempt(uuid, text, public.kyozai_charge_state, text, text, bigint) from public, anon, authenticated;
revoke all on function public.settle_kyozai_job_cancellation(uuid) from public, anon, authenticated;
revoke all on function public.settle_pending_kyozai_cancellations() from public, anon, authenticated;
revoke all on function public.release_kyozai_unused_quota(uuid) from public, anon, authenticated;
grant execute on function public.reserve_kyozai_provider_attempt(uuid, uuid, uuid, text, text, text, text, integer, integer) to service_role;
grant execute on function public.settle_kyozai_provider_attempt(uuid, text, public.kyozai_charge_state, text, text, bigint) to service_role;
grant execute on function public.settle_kyozai_job_cancellation(uuid) to service_role;
grant execute on function public.settle_pending_kyozai_cancellations() to service_role;
grant execute on function public.release_kyozai_unused_quota(uuid) to service_role;

-- All provider calls now use the operation-aware reservation state machine.
-- Remove the former overlapping entrances so new worker code cannot bypass it.
drop function if exists public.reserve_kyozai_image_call(uuid, uuid, uuid, text, text);
drop function if exists public.settle_kyozai_image_call(uuid, text, public.kyozai_charge_state);
drop function if exists public.record_kyozai_usage(uuid, uuid, uuid, text, text, text, integer, integer, public.kyozai_charge_state);

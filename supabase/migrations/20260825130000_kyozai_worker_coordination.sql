-- Service-role worker coordination. These functions make leases and terminal writes
-- conditional, so a stale or concurrent worker cannot overwrite a newer attempt.

create or replace function public.claim_kyozai_stage_run(
  p_stage_run_id uuid,
  p_lease_owner text,
  p_lease_seconds integer default 300
)
returns table (
  id uuid,
  job_id uuid,
  revision_id uuid,
  stage text,
  slide_number integer,
  attempt integer,
  lease_expires_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run public.stage_runs%rowtype;
  v_job public.jobs%rowtype;
  v_expires_at timestamptz;
begin
  if coalesce(length(trim(p_lease_owner)), 0) = 0 or p_lease_seconds not between 15 and 900 then
    raise exception using errcode = '22023', message = 'invalid stage lease';
  end if;

  select * into v_run from public.stage_runs where stage_runs.id = p_stage_run_id for update skip locked;
  if not found then return; end if;
  select * into v_job from public.jobs where jobs.id = v_run.job_id for update;
  if v_job.status not in ('queued', 'running') then return; end if;
  if v_run.status <> 'pending' and not (v_run.status = 'running' and v_run.lease_expires_at < timezone('utc', now())) then
    return;
  end if;

  v_expires_at := timezone('utc', now()) + make_interval(secs => p_lease_seconds);
  update public.stage_runs
  set status = 'running',
      lease_owner = p_lease_owner,
      lease_expires_at = v_expires_at,
      started_at = coalesce(started_at, timezone('utc', now()))
  where stage_runs.id = v_run.id;
  update public.jobs set status = 'running', current_stage = v_run.stage where jobs.id = v_job.id;

  return query select v_run.id, v_run.job_id, v_run.revision_id, v_run.stage, v_run.slide_number, v_run.attempt, v_expires_at;
end;
$$;

create or replace function public.pass_kyozai_stage_run(
  p_stage_run_id uuid,
  p_lease_owner text,
  p_output_artifact_ids uuid[],
  p_validator text,
  p_usage jsonb default '{}'::jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run public.stage_runs%rowtype;
  v_job public.jobs%rowtype;
  v_artifact_count integer;
begin
  select * into v_run from public.stage_runs where id = p_stage_run_id for update;
  if not found then return false; end if;
  select * into v_job from public.jobs where id = v_run.job_id for update;
  if not found or v_run.status <> 'running' or v_run.lease_owner is distinct from p_lease_owner or v_run.lease_expires_at <= timezone('utc', now()) then
    return false;
  end if;

  if coalesce(cardinality(p_output_artifact_ids), 0) > 0 then
    select count(*) into v_artifact_count from public.artifacts
    where id = any(p_output_artifact_ids)
      and job_id = v_run.job_id
      and revision_id = v_run.revision_id
      and lifecycle in ('draft', 'validated', 'final');
    if v_artifact_count <> cardinality(p_output_artifact_ids) then
      raise exception using errcode = '22023', message = 'stage output artifact does not belong to this revision';
    end if;
  end if;

  if v_job.status = 'cancelling' then
    update public.stage_runs
    set status = 'skipped', completed_at = timezone('utc', now()), lease_owner = null, lease_expires_at = null,
        retry_reason = coalesce(retry_reason, 'job_cancelled_before_stage_completion')
    where id = v_run.id;
    if not exists (select 1 from public.stage_runs where job_id = v_run.job_id and status = 'running') then
      update public.jobs set status = 'cancelled', current_stage = null where id = v_run.job_id;
    end if;
    return false;
  end if;

  update public.stage_runs
  set status = 'passed', output_artifact_ids = coalesce(p_output_artifact_ids, '{}'), validator = p_validator,
      usage = coalesce(p_usage, '{}'::jsonb), completed_at = timezone('utc', now()), lease_owner = null, lease_expires_at = null
  where id = v_run.id;
  return true;
end;
$$;

create or replace function public.fail_kyozai_stage_run(
  p_stage_run_id uuid,
  p_lease_owner text,
  p_error_code text,
  p_retry_reason text default null,
  p_retry boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run public.stage_runs%rowtype;
  v_job public.jobs%rowtype;
  v_retry_id uuid;
begin
  if coalesce(length(trim(p_error_code)), 0) = 0 then
    raise exception using errcode = '22023', message = 'error code is required';
  end if;
  select * into v_run from public.stage_runs where id = p_stage_run_id for update;
  if not found then return null; end if;
  select * into v_job from public.jobs where id = v_run.job_id for update;
  if not found or v_run.status <> 'running' or v_run.lease_owner is distinct from p_lease_owner or v_run.lease_expires_at <= timezone('utc', now()) then
    return null;
  end if;

  update public.stage_runs
  set status = 'failed', error_code = p_error_code, retry_reason = p_retry_reason,
      completed_at = timezone('utc', now()), lease_owner = null, lease_expires_at = null
  where id = v_run.id;

  if v_job.status = 'cancelling' then
    update public.jobs set status = 'cancelled', current_stage = null where id = v_job.id;
    return null;
  end if;
  if p_retry and v_run.attempt < 1 then
    insert into public.stage_runs (
      job_id, revision_id, stage, slide_number, attempt, status, input_artifact_ids, validator, retry_reason
    ) values (
      v_run.job_id, v_run.revision_id, v_run.stage, v_run.slide_number, v_run.attempt + 1, 'pending',
      v_run.input_artifact_ids, v_run.validator, p_retry_reason
    ) returning id into v_retry_id;
    return v_retry_id;
  end if;

  update public.jobs set status = 'failed', error_code = p_error_code where id = v_job.id;
  return null;
end;
$$;

create or replace function public.promote_kyozai_artifacts_to_final(
  p_job_id uuid,
  p_revision_id uuid,
  p_artifact_ids uuid[]
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_requested integer := coalesce(cardinality(p_artifact_ids), 0);
  v_promoted integer;
begin
  if v_requested = 0 then return 0; end if;
  -- Rows are locked before promotion; draft artifacts must have passed a separate
  -- validator and be marked `validated` before they can become downloadable.
  perform 1 from public.artifacts
  where id = any(p_artifact_ids) and job_id = p_job_id and revision_id = p_revision_id
  for update;
  update public.artifacts
  set lifecycle = 'final', finalized_at = timezone('utc', now())
  where id = any(p_artifact_ids)
    and job_id = p_job_id
    and revision_id = p_revision_id
    and lifecycle = 'validated'
    and sha256 is not null;
  get diagnostics v_promoted = row_count;
  if v_promoted <> v_requested then
    raise exception using errcode = 'P0001', message = 'only validated artifacts with checksums can be finalized';
  end if;
  return v_promoted;
end;
$$;

create or replace function public.request_kyozai_job_cancellation(p_job_id uuid)
returns public.kyozai_job_status
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.jobs%rowtype;
begin
  select * into v_job from public.jobs where id = p_job_id for update;
  if not found then raise exception using errcode = 'P0001', message = 'job not found'; end if;
  if v_job.status = 'queued' then
    update public.jobs set status = 'cancelled', current_stage = null where id = v_job.id;
    update public.workflow_dispatches set status = 'cancelled' where job_id = v_job.id and status = 'pending';
    return 'cancelled';
  end if;
  if v_job.status = 'running' then
    update public.jobs set status = 'cancelling' where id = v_job.id;
    return 'cancelling';
  end if;
  return v_job.status;
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
begin
  select * into v_job from public.jobs where id = p_job_id for update;
  if not found or v_job.status <> 'cancelling' then return false; end if;
  if exists (select 1 from public.stage_runs where job_id = p_job_id and status = 'running') then return false; end if;
  update public.jobs set status = 'cancelled', current_stage = null where id = p_job_id;
  return true;
end;
$$;

create or replace function public.claim_next_kyozai_workflow_dispatch()
returns table (id uuid, job_id uuid, revision_id uuid, attempts integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dispatch public.workflow_dispatches%rowtype;
begin
  select * into v_dispatch from public.workflow_dispatches
  where status = 'pending' and next_attempt_at <= timezone('utc', now())
  order by next_attempt_at, created_at
  for update skip locked
  limit 1;
  if not found then return; end if;
  update public.workflow_dispatches
  set status = 'dispatched', attempts = v_dispatch.attempts + 1, dispatched_at = timezone('utc', now())
  where workflow_dispatches.id = v_dispatch.id;
  return query select v_dispatch.id, v_dispatch.job_id, v_dispatch.revision_id, v_dispatch.attempts + 1;
end;
$$;

create or replace function public.requeue_kyozai_workflow_dispatch(
  p_dispatch_id uuid,
  p_error_code text,
  p_delay_seconds integer default 30,
  p_max_attempts integer default 5
)
returns public.kyozai_dispatch_status
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dispatch public.workflow_dispatches%rowtype;
  v_job public.jobs%rowtype;
begin
  if coalesce(length(trim(p_error_code)), 0) = 0 or p_delay_seconds not between 1 and 3600 or p_max_attempts not between 1 and 20 then
    raise exception using errcode = '22023', message = 'invalid dispatch retry';
  end if;
  select * into v_dispatch from public.workflow_dispatches where id = p_dispatch_id for update;
  if not found then raise exception using errcode = 'P0001', message = 'dispatch not found'; end if;
  select * into v_job from public.jobs where id = v_dispatch.job_id for update;
  if v_dispatch.status <> 'dispatched' then return v_dispatch.status; end if;
  if v_job.status in ('cancelling', 'cancelled', 'deleting', 'deleted') then
    update public.workflow_dispatches set status = 'cancelled', last_error_code = p_error_code where id = v_dispatch.id;
    return 'cancelled';
  end if;
  if v_dispatch.attempts >= p_max_attempts then
    update public.workflow_dispatches set status = 'failed', last_error_code = p_error_code where id = v_dispatch.id;
    update public.jobs set status = 'failed', error_code = 'workflow_dispatch_failed' where id = v_job.id and status in ('queued', 'running');
    return 'failed';
  end if;
  update public.workflow_dispatches
  set status = 'pending', last_error_code = p_error_code,
      next_attempt_at = timezone('utc', now()) + make_interval(secs => p_delay_seconds)
  where id = v_dispatch.id;
  return 'pending';
end;
$$;

revoke all on function public.claim_kyozai_stage_run(uuid, text, integer) from public, anon, authenticated;
revoke all on function public.pass_kyozai_stage_run(uuid, text, uuid[], text, jsonb) from public, anon, authenticated;
revoke all on function public.fail_kyozai_stage_run(uuid, text, text, text, boolean) from public, anon, authenticated;
revoke all on function public.promote_kyozai_artifacts_to_final(uuid, uuid, uuid[]) from public, anon, authenticated;
revoke all on function public.request_kyozai_job_cancellation(uuid) from public, anon, authenticated;
revoke all on function public.settle_kyozai_job_cancellation(uuid) from public, anon, authenticated;
revoke all on function public.claim_next_kyozai_workflow_dispatch() from public, anon, authenticated;
revoke all on function public.requeue_kyozai_workflow_dispatch(uuid, text, integer, integer) from public, anon, authenticated;

grant execute on function public.claim_kyozai_stage_run(uuid, text, integer) to service_role;
grant execute on function public.pass_kyozai_stage_run(uuid, text, uuid[], text, jsonb) to service_role;
grant execute on function public.fail_kyozai_stage_run(uuid, text, text, text, boolean) to service_role;
grant execute on function public.promote_kyozai_artifacts_to_final(uuid, uuid, uuid[]) to service_role;
grant execute on function public.request_kyozai_job_cancellation(uuid) to service_role;
grant execute on function public.settle_kyozai_job_cancellation(uuid) to service_role;
grant execute on function public.claim_next_kyozai_workflow_dispatch() to service_role;
grant execute on function public.requeue_kyozai_workflow_dispatch(uuid, text, integer, integer) to service_role;

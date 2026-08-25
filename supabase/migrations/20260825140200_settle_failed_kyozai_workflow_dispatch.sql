-- A worker can mark its job failed before returning an error to the durable
-- workflow. Settle that outbox row immediately: retrying a terminal job would
-- only leave a later dispatch permanently `dispatched`.

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
  if v_job.status = 'failed' then
    update public.workflow_dispatches set status = 'failed', last_error_code = p_error_code where id = v_dispatch.id;
    return 'failed';
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

revoke all on function public.requeue_kyozai_workflow_dispatch(uuid, text, integer, integer) from public, anon, authenticated;
grant execute on function public.requeue_kyozai_workflow_dispatch(uuid, text, integer, integer) to service_role;

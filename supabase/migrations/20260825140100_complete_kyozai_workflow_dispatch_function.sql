-- A claimed outbox row must reach a terminal state after the worker returns.
-- Without this acknowledgement, every successful job remains `dispatched` forever
-- and the outbox cannot distinguish completed work from a crashed worker.

create or replace function public.complete_kyozai_workflow_dispatch(p_dispatch_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dispatch public.workflow_dispatches%rowtype;
  v_job public.jobs%rowtype;
begin
  select * into v_dispatch from public.workflow_dispatches where id = p_dispatch_id for update;
  if not found or v_dispatch.status <> 'dispatched' then return false; end if;

  select * into v_job from public.jobs where id = v_dispatch.job_id for update;
  if not found then return false; end if;

  -- A cancelled or failed job is a valid terminal worker result, but it must not
  -- be recorded as a successful outbox dispatch.
  if v_job.status = 'completed' then
    update public.workflow_dispatches
    set status = 'completed', last_error_code = null
    where id = v_dispatch.id;
    return true;
  end if;

  if v_job.status in ('cancelled', 'cancelling') then
    update public.workflow_dispatches
    set status = 'cancelled', last_error_code = null
    where id = v_dispatch.id;
    return true;
  end if;

  return false;
end;
$$;

revoke all on function public.complete_kyozai_workflow_dispatch(uuid) from public, anon, authenticated;
grant execute on function public.complete_kyozai_workflow_dispatch(uuid) to service_role;

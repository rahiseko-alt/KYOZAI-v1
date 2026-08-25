-- A started stage retains its start timestamp after it becomes terminal. The initial
-- constraint accidentally required started_at to be null for every non-running state.
do $$
declare
  v_constraint text;
begin
  for v_constraint in
    select conname
    from pg_constraint
    where conrelid = 'public.stage_runs'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%started_at%'
  loop
    execute format('alter table public.stage_runs drop constraint %I', v_constraint);
  end loop;
end;
$$;

alter table public.stage_runs
  add constraint stage_runs_started_at_lifecycle_check
  check (
    (status = 'pending' and started_at is null)
    or (status in ('running', 'passed', 'failed', 'skipped') and started_at is not null)
  );

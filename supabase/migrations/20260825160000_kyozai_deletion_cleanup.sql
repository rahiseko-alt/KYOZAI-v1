-- Deletion is a leased worker operation: the user loses access immediately,
-- while private objects are removed before the row reaches its terminal state.
alter table public.jobs
  add column if not exists deletion_lease_owner text,
  add column if not exists deletion_lease_expires_at timestamptz;

create index if not exists jobs_deletion_cleanup_idx
  on public.jobs (status, deletion_lease_expires_at)
  where status = 'deleting';

create or replace function public.claim_kyozai_deletion_cleanup(p_lease_owner text)
returns table (job_id uuid, source_paths text[], artifact_paths text[])
language plpgsql security definer set search_path = public as $$
declare v_job public.jobs%rowtype;
begin
  select * into v_job from public.jobs
  where status = 'deleting'
    and (deletion_lease_expires_at is null or deletion_lease_expires_at <= timezone('utc', now()))
  order by deleted_at nulls first, created_at
  for update skip locked limit 1;
  if not found then return; end if;
  update public.jobs set deletion_lease_owner = p_lease_owner,
    deletion_lease_expires_at = timezone('utc', now()) + interval '10 minutes'
  where id = v_job.id;
  return query select v_job.id,
    coalesce(array(select storage_path from public.upload_sessions where consumed_by_job_id = v_job.id), '{}'::text[]),
    coalesce(array(select storage_path from public.artifacts where job_id = v_job.id), '{}'::text[]);
end; $$;

create or replace function public.complete_kyozai_deletion_cleanup(p_job_id uuid, p_lease_owner text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  update public.jobs set status = 'deleted', deletion_lease_owner = null, deletion_lease_expires_at = null
  where id = p_job_id and status = 'deleting' and deletion_lease_owner = p_lease_owner;
  return found;
end; $$;

revoke all on function public.claim_kyozai_deletion_cleanup(text) from public, anon, authenticated;
revoke all on function public.complete_kyozai_deletion_cleanup(uuid, text) from public, anon, authenticated;
grant execute on function public.claim_kyozai_deletion_cleanup(text) to service_role;
grant execute on function public.complete_kyozai_deletion_cleanup(uuid, text) to service_role;

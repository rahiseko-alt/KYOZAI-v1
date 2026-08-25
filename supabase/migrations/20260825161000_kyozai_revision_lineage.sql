-- Candidate revisions never overwrite final artifacts. Unchanged material is
-- referenced by SHA through this lineage table until a revision worker replaces
-- only its declared targets.
create table public.revision_artifact_refs (
  revision_id uuid not null references public.job_revisions(id) on delete cascade,
  artifact_id uuid not null references public.artifacts(id) on delete restrict,
  reason text not null check (reason in ('inherited', 'revalidated')),
  created_at timestamptz not null default timezone('utc', now()),
  primary key (revision_id, artifact_id)
);
alter table public.revision_artifact_refs enable row level security;
create policy revision_artifact_refs_owner_select on public.revision_artifact_refs for select using (
  exists (select 1 from public.job_revisions r join public.jobs j on j.id = r.job_id where r.id = revision_artifact_refs.revision_id and j.owner_id = (select auth.uid()))
);

create or replace function public.create_kyozai_revision_plan(
  p_owner_id uuid, p_job_id uuid, p_base_revision_number integer, p_instruction text, p_impact_scope text
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_job public.jobs%rowtype; v_base public.job_revisions%rowtype; v_revision_id uuid; v_next integer;
begin
  if p_owner_id is null or coalesce(length(trim(p_instruction)), 0) not between 3 and 600 then raise exception using errcode = '22023', message = 'invalid revision instruction'; end if;
  if p_impact_scope not in ('visual_only', 'local_content', 'structural') then raise exception using errcode = '22023', message = 'invalid revision scope'; end if;
  select * into v_job from public.jobs where id = p_job_id for update;
  if not found or v_job.owner_id <> p_owner_id or v_job.status <> 'completed' then raise exception using errcode = 'P0001', message = 'job is not revisable'; end if;
  if v_job.active_revision_number <> p_base_revision_number then raise exception using errcode = '40001', message = 'revision conflict'; end if;
  select * into v_base from public.job_revisions where job_id = p_job_id and revision_number = p_base_revision_number and status = 'completed';
  if not found then raise exception using errcode = 'P0001', message = 'base revision is unavailable'; end if;
  select coalesce(max(revision_number), 0) + 1 into v_next from public.job_revisions where job_id = p_job_id;
  insert into public.job_revisions (job_id, revision_number, base_revision_number, instruction, impact_scope, status)
  values (p_job_id, v_next, p_base_revision_number, p_instruction, p_impact_scope, 'queued') returning id into v_revision_id;
  insert into public.revision_artifact_refs (revision_id, artifact_id, reason)
  select v_revision_id, id, 'inherited' from public.artifacts where revision_id = v_base.id and lifecycle = 'final';
  return v_revision_id;
end; $$;

revoke all on function public.create_kyozai_revision_plan(uuid, uuid, integer, text, text) from public, anon, authenticated;
grant execute on function public.create_kyozai_revision_plan(uuid, uuid, integer, text, text) to service_role;

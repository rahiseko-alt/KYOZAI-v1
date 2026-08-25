-- Durable, private KYOZAI generation jobs. All application data is owner-scoped;
-- service-role access is reserved for route handlers and workflow workers.
create extension if not exists pgcrypto;

create type public.kyozai_job_status as enum (
  'queued', 'running', 'completed', 'failed', 'cancelling', 'cancelled', 'deleting', 'deleted'
);
create type public.kyozai_stage_status as enum ('pending', 'running', 'passed', 'failed', 'skipped');
create type public.kyozai_artifact_status as enum ('draft', 'validated', 'final', 'deleted');
create type public.kyozai_input_kind as enum ('text', 'url', 'attachments', 'mixed');
create type public.kyozai_revision_status as enum ('queued', 'running', 'completed', 'failed', 'cancelled');
create type public.kyozai_dispatch_status as enum ('pending', 'dispatched', 'failed', 'cancelled');
create type public.kyozai_charge_state as enum ('reserved', 'confirmed', 'ambiguous', 'released');

create or replace function public.set_kyozai_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete restrict,
  status public.kyozai_job_status not null default 'queued',
  current_stage text check (current_stage in ('source_ingest', 'analysis', 'slide_map', 'script_timing', 'content_freeze', 'design', 'image_generate', 'image_validate', 'package', 'revision')),
  active_revision_number integer not null default 1 check (active_revision_number > 0),
  workflow_version text not null,
  input_kind public.kyozai_input_kind not null,
  request_json jsonb not null default '{}'::jsonb,
  image_model text,
  idempotency_key text not null,
  error_code text,
  expires_at timestamptz not null default timezone('utc', now()) + interval '7 days',
  deleted_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (owner_id, idempotency_key)
);

create table public.job_revisions (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  revision_number integer not null check (revision_number > 0),
  base_revision_number integer check (base_revision_number is null or base_revision_number > 0),
  instruction text,
  impact_scope text check (impact_scope in ('visual_only', 'local_content', 'structural')),
  status public.kyozai_revision_status not null default 'queued',
  created_at timestamptz not null default timezone('utc', now()),
  completed_at timestamptz,
  unique (job_id, revision_number),
  check ((revision_number = 1 and base_revision_number is null) or (revision_number > 1 and base_revision_number is not null and base_revision_number < revision_number))
);

create table public.artifacts (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  revision_id uuid not null references public.job_revisions(id) on delete cascade,
  kind text not null check (kind in ('source', 'attachment_original', 'attachment_normalized', 'deck_spec', 'deck_content_and_script', 'source_info', 'design_profile', 'image_prompt', 'image_prompts', 'slide_image', 'image_validation', 'montage', 'manifest', 'package_zip', 'revision_request', 'revision_plan', 'revision_validation')),
  lifecycle public.kyozai_artifact_status not null default 'draft',
  storage_bucket text not null check (storage_bucket in ('kyozai-sources', 'kyozai-artifacts')),
  storage_path text not null,
  sha256 text check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  media_type text not null,
  byte_size bigint not null check (byte_size >= 0),
  slide_number integer check (slide_number is null or slide_number > 0),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  finalized_at timestamptz,
  unique (storage_bucket, storage_path),
  check ((lifecycle in ('validated', 'final')) = (sha256 is not null)),
  check ((lifecycle = 'final') = (finalized_at is not null))
);

create table public.stage_runs (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  revision_id uuid not null references public.job_revisions(id) on delete cascade,
  stage text not null check (stage in ('source_ingest', 'analysis', 'slide_map', 'script_timing', 'content_freeze', 'design', 'image_generate', 'image_validate', 'package', 'revision')),
  slide_number integer not null default 0 check (slide_number >= 0),
  attempt integer not null default 0 check (attempt >= 0),
  status public.kyozai_stage_status not null default 'pending',
  input_artifact_ids uuid[] not null default '{}',
  output_artifact_ids uuid[] not null default '{}',
  validator text not null,
  model text,
  usage jsonb not null default '{}'::jsonb,
  retry_reason text,
  error_code text,
  lease_owner text,
  lease_expires_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  unique (revision_id, stage, slide_number, attempt),
  check ((status = 'running') = (started_at is not null)),
  check ((status in ('passed', 'failed', 'skipped')) = (completed_at is not null))
);

create table public.upload_sessions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  storage_path text not null unique,
  media_type text not null check (media_type in ('application/pdf', 'text/plain', 'text/markdown')),
  byte_limit bigint not null check (byte_limit > 0 and byte_limit <= 26214400),
  byte_size bigint check (byte_size is null or byte_size between 0 and byte_limit),
  sha256 text check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  consumed_by_job_id uuid references public.jobs(id) on delete set null,
  expires_at timestamptz not null,
  created_at timestamptz not null default timezone('utc', now()),
  check ((consumed_by_job_id is null) or (byte_size is not null and sha256 is not null))
);

create table public.quota_reservations (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null unique references public.jobs(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete restrict,
  reserved_image_calls integer not null check (reserved_image_calls between 0 and 24),
  confirmed_image_calls integer not null default 0 check (confirmed_image_calls >= 0),
  reserved_cost_units integer not null check (reserved_cost_units >= 0),
  confirmed_cost_units integer not null default 0 check (confirmed_cost_units >= 0),
  charge_state public.kyozai_charge_state not null default 'reserved',
  expires_at timestamptz not null,
  released_at timestamptz,
  created_at timestamptz not null default timezone('utc', now())
);

create table public.usage_events (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  revision_id uuid references public.job_revisions(id) on delete set null,
  stage_run_id uuid references public.stage_runs(id) on delete set null,
  provider text not null,
  model text,
  request_fingerprint text not null,
  image_count integer not null default 0 check (image_count >= 0),
  input_units integer check (input_units is null or input_units >= 0),
  output_units integer check (output_units is null or output_units >= 0),
  estimated_cost_units integer not null default 0 check (estimated_cost_units >= 0),
  actual_cost_units integer check (actual_cost_units is null or actual_cost_units >= 0),
  charge_state public.kyozai_charge_state not null default 'reserved',
  created_at timestamptz not null default timezone('utc', now()),
  unique (job_id, request_fingerprint)
);

create table public.workflow_dispatches (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null unique references public.jobs(id) on delete cascade,
  revision_id uuid not null references public.job_revisions(id) on delete cascade,
  status public.kyozai_dispatch_status not null default 'pending',
  attempts integer not null default 0 check (attempts >= 0),
  last_error_code text,
  next_attempt_at timestamptz not null default timezone('utc', now()),
  dispatched_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.system_controls (
  id boolean primary key default true check (id),
  accept_new_jobs boolean not null default false,
  monthly_image_call_limit integer not null default 0 check (monthly_image_call_limit >= 0),
  allowed_models jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default timezone('utc', now())
);

insert into public.system_controls (id) values (true) on conflict (id) do nothing;

-- The API authenticates the caller before invoking this service-role-only RPC. Keeping
-- acceptance, quota reservation, attachment consumption, and outbox insertion in one
-- transaction prevents concurrent requests from oversubscribing a generation budget.
create or replace function public.create_kyozai_job(
  p_owner_id uuid,
  p_idempotency_key text,
  p_input_kind public.kyozai_input_kind,
  p_request_json jsonb,
  p_image_model text,
  p_attachment_ids uuid[],
  p_workflow_version text,
  p_reserved_image_calls integer,
  p_reserved_cost_units integer
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing public.jobs%rowtype;
  v_control public.system_controls%rowtype;
  v_attachment_count integer;
  v_month_reserved integer;
  v_job_id uuid;
  v_revision_id uuid;
  v_day_start timestamptz := date_trunc('day', now() at time zone 'utc') at time zone 'utc';
  v_month_start timestamptz := date_trunc('month', now() at time zone 'utc') at time zone 'utc';
begin
  if p_owner_id is null or coalesce(length(trim(p_idempotency_key)), 0) = 0 then
    raise exception using errcode = '22023', message = 'owner and idempotency key are required';
  end if;
  if coalesce(length(trim(p_workflow_version)), 0) = 0 or coalesce(length(trim(p_image_model)), 0) = 0 then
    raise exception using errcode = '22023', message = 'workflow version and image model are required';
  end if;
  if p_reserved_image_calls not between 0 and 24 or p_reserved_cost_units < 0 then
    raise exception using errcode = '22023', message = 'invalid quota reservation';
  end if;
  if coalesce(cardinality(p_attachment_ids), 0) > 2 then
    raise exception using errcode = '22023', message = 'at most two attachments are allowed';
  end if;

  select * into v_existing from public.jobs
  where owner_id = p_owner_id and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.input_kind = p_input_kind
      and v_existing.request_json = coalesce(p_request_json, '{}'::jsonb)
      and v_existing.image_model = p_image_model then
      return v_existing.id;
    end if;
    raise exception using errcode = '23505', message = 'idempotency key was already used with different input';
  end if;

  -- A row lock serializes the global budget check without trusting a client-side count.
  select * into v_control from public.system_controls where id = true for update;
  if not found or not v_control.accept_new_jobs then
    raise exception using errcode = 'P0001', message = 'new jobs are disabled';
  end if;
  if not (v_control.allowed_models ? p_image_model) then
    raise exception using errcode = 'P0001', message = 'image model is not allowed';
  end if;

  select coalesce(sum(reserved_image_calls), 0) into v_month_reserved
  from public.quota_reservations
  where created_at >= v_month_start and charge_state <> 'released';
  if v_month_reserved + p_reserved_image_calls > v_control.monthly_image_call_limit then
    raise exception using errcode = 'P0001', message = 'monthly image quota exceeded';
  end if;
  if (select count(*) from public.jobs where owner_id = p_owner_id and created_at >= v_day_start) >= 3 then
    raise exception using errcode = 'P0001', message = 'daily job quota exceeded';
  end if;
  if exists (select 1 from public.jobs where owner_id = p_owner_id and status in ('queued', 'running', 'cancelling')) then
    raise exception using errcode = 'P0001', message = 'an active job already exists';
  end if;

  if coalesce(cardinality(p_attachment_ids), 0) > 0 then
    perform 1 from public.upload_sessions
    where id = any(p_attachment_ids)
      and owner_id = p_owner_id
      and consumed_by_job_id is null
      and expires_at > timezone('utc', now())
      and byte_size is not null
      and sha256 is not null
    for update;
    get diagnostics v_attachment_count = row_count;
    if v_attachment_count <> cardinality(p_attachment_ids) then
      raise exception using errcode = 'P0001', message = 'attachment is unavailable';
    end if;
  end if;

  insert into public.jobs (owner_id, workflow_version, input_kind, request_json, image_model, idempotency_key)
  values (p_owner_id, p_workflow_version, p_input_kind, coalesce(p_request_json, '{}'::jsonb), p_image_model, p_idempotency_key)
  returning id into v_job_id;

  insert into public.job_revisions (job_id, revision_number, status)
  values (v_job_id, 1, 'queued')
  returning id into v_revision_id;

  insert into public.quota_reservations (job_id, owner_id, reserved_image_calls, reserved_cost_units, expires_at)
  values (v_job_id, p_owner_id, p_reserved_image_calls, p_reserved_cost_units, timezone('utc', now()) + interval '1 day');

  if coalesce(cardinality(p_attachment_ids), 0) > 0 then
    update public.upload_sessions set consumed_by_job_id = v_job_id where id = any(p_attachment_ids);
  end if;

  insert into public.workflow_dispatches (job_id, revision_id)
  values (v_job_id, v_revision_id);
  return v_job_id;
end;
$$;

revoke all on function public.create_kyozai_job(uuid, text, public.kyozai_input_kind, jsonb, text, uuid[], text, integer, integer) from public, anon, authenticated;
grant execute on function public.create_kyozai_job(uuid, text, public.kyozai_input_kind, jsonb, text, uuid[], text, integer, integer) to service_role;

create index jobs_owner_created_idx on public.jobs (owner_id, created_at desc);
create index jobs_active_idx on public.jobs (status, expires_at) where status in ('queued', 'running', 'cancelling');
create index revisions_job_idx on public.job_revisions (job_id, revision_number desc);
create index artifacts_job_revision_idx on public.artifacts (job_id, revision_id, lifecycle);
create index stage_runs_lease_idx on public.stage_runs (status, lease_expires_at) where status = 'running';
create index upload_sessions_owner_expiry_idx on public.upload_sessions (owner_id, expires_at);
create index quota_owner_created_idx on public.quota_reservations (owner_id, created_at desc);
create index usage_events_job_idx on public.usage_events (job_id, created_at desc);
create index workflow_dispatches_ready_idx on public.workflow_dispatches (status, next_attempt_at) where status = 'pending';

create trigger jobs_set_updated_at before update on public.jobs for each row execute function public.set_kyozai_updated_at();
create trigger workflow_dispatches_set_updated_at before update on public.workflow_dispatches for each row execute function public.set_kyozai_updated_at();
create trigger system_controls_set_updated_at before update on public.system_controls for each row execute function public.set_kyozai_updated_at();

alter table public.jobs enable row level security;
alter table public.job_revisions enable row level security;
alter table public.artifacts enable row level security;
alter table public.stage_runs enable row level security;
alter table public.upload_sessions enable row level security;
alter table public.quota_reservations enable row level security;
alter table public.usage_events enable row level security;
alter table public.workflow_dispatches enable row level security;
alter table public.system_controls enable row level security;

create policy jobs_owner_all on public.jobs for all using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
create policy revisions_owner_all on public.job_revisions for all using (exists (select 1 from public.jobs where jobs.id = job_revisions.job_id and jobs.owner_id = (select auth.uid()))) with check (exists (select 1 from public.jobs where jobs.id = job_revisions.job_id and jobs.owner_id = (select auth.uid())));
create policy artifacts_owner_select on public.artifacts for select using (exists (select 1 from public.jobs where jobs.id = artifacts.job_id and jobs.owner_id = (select auth.uid())));
create policy stage_runs_owner_select on public.stage_runs for select using (exists (select 1 from public.jobs where jobs.id = stage_runs.job_id and jobs.owner_id = (select auth.uid())));
create policy upload_sessions_owner_all on public.upload_sessions for all using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
create policy quota_reservations_owner_select on public.quota_reservations for select using ((select auth.uid()) = owner_id);
create policy usage_events_owner_select on public.usage_events for select using (exists (select 1 from public.jobs where jobs.id = usage_events.job_id and jobs.owner_id = (select auth.uid())));
create policy workflow_dispatches_owner_select on public.workflow_dispatches for select using (exists (select 1 from public.jobs where jobs.id = workflow_dispatches.job_id and jobs.owner_id = (select auth.uid())));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('kyozai-sources', 'kyozai-sources', false, 26214400, array['application/pdf', 'text/plain', 'text/markdown'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

insert into storage.buckets (id, name, public, file_size_limit)
values ('kyozai-artifacts', 'kyozai-artifacts', false, 52428800)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

create policy kyozai_sources_owner_insert on storage.objects for insert to authenticated with check (
  bucket_id = 'kyozai-sources' and (storage.foldername(name))[1] = (select auth.uid()::text)
);
create policy kyozai_sources_owner_select on storage.objects for select to authenticated using (
  bucket_id = 'kyozai-sources' and (storage.foldername(name))[1] = (select auth.uid()::text)
);
create policy kyozai_sources_owner_delete on storage.objects for delete to authenticated using (
  bucket_id = 'kyozai-sources' and (storage.foldername(name))[1] = (select auth.uid()::text)
);

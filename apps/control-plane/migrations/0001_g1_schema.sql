-- G1 durable state. IDs and timestamps stay textual so the existing public API
-- contract is portable from Postgres to D1/SQLite without changing its values.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS system_controls (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  accept_new_jobs INTEGER NOT NULL DEFAULT 0 CHECK (accept_new_jobs IN (0, 1)),
  cloudflare_usage_within_budget INTEGER NOT NULL DEFAULT 0 CHECK (cloudflare_usage_within_budget IN (0, 1)),
  monthly_image_call_limit INTEGER NOT NULL DEFAULT 0 CHECK (monthly_image_call_limit >= 0),
  allowed_models_json TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL
);
INSERT OR IGNORE INTO system_controls (id, updated_at) VALUES (1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelling', 'cancelled', 'deleting', 'deleted')),
  current_stage TEXT,
  active_revision_number INTEGER NOT NULL DEFAULT 1 CHECK (active_revision_number > 0),
  workflow_version TEXT NOT NULL,
  input_kind TEXT NOT NULL CHECK (input_kind IN ('text', 'url', 'attachments', 'mixed')),
  request_json TEXT NOT NULL,
  image_model TEXT,
  idempotency_key TEXT NOT NULL,
  error_code TEXT,
  expires_at TEXT NOT NULL,
  deleted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (owner_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS jobs_owner_created_idx ON jobs (owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS jobs_active_idx ON jobs (status, expires_at);

CREATE TABLE IF NOT EXISTS job_revisions (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  revision_number INTEGER NOT NULL CHECK (revision_number > 0),
  base_revision_number INTEGER,
  instruction TEXT,
  impact_scope TEXT CHECK (impact_scope IN ('visual_only', 'local_content', 'structural')),
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
  created_at TEXT NOT NULL,
  completed_at TEXT,
  UNIQUE (job_id, revision_number),
  CHECK ((revision_number = 1 AND base_revision_number IS NULL) OR (revision_number > 1 AND base_revision_number BETWEEN 1 AND revision_number - 1))
);
CREATE INDEX IF NOT EXISTS revisions_job_idx ON job_revisions (job_id, revision_number DESC);

CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  revision_id TEXT NOT NULL REFERENCES job_revisions(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  lifecycle TEXT NOT NULL CHECK (lifecycle IN ('draft', 'validated', 'final', 'deleted')),
  storage_bucket TEXT NOT NULL CHECK (storage_bucket IN ('kyozai-sources', 'kyozai-artifacts')),
  storage_path TEXT NOT NULL,
  sha256 TEXT,
  media_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
  slide_number INTEGER,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  finalized_at TEXT,
  UNIQUE (storage_bucket, storage_path),
  CHECK ((lifecycle IN ('validated', 'final')) = (sha256 IS NOT NULL)),
  CHECK ((lifecycle = 'final') = (finalized_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS artifacts_job_revision_idx ON artifacts (job_id, revision_id, lifecycle);

CREATE TABLE IF NOT EXISTS stage_runs (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  revision_id TEXT NOT NULL REFERENCES job_revisions(id) ON DELETE CASCADE,
  stage TEXT NOT NULL,
  slide_number INTEGER NOT NULL DEFAULT 0 CHECK (slide_number >= 0),
  attempt INTEGER NOT NULL DEFAULT 0 CHECK (attempt >= 0),
  status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'passed', 'failed', 'skipped')),
  input_artifact_ids_json TEXT NOT NULL DEFAULT '[]',
  output_artifact_ids_json TEXT NOT NULL DEFAULT '[]',
  validator TEXT NOT NULL,
  model TEXT,
  usage_json TEXT NOT NULL DEFAULT '{}',
  retry_reason TEXT,
  error_code TEXT,
  lease_owner TEXT,
  lease_expires_at TEXT,
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (revision_id, stage, slide_number, attempt),
  CHECK (status <> 'running' OR started_at IS NOT NULL),
  CHECK ((status IN ('passed', 'failed', 'skipped')) = (completed_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS stage_runs_lease_idx ON stage_runs (status, lease_expires_at);

CREATE TABLE IF NOT EXISTS upload_sessions (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  storage_path TEXT NOT NULL UNIQUE,
  media_type TEXT NOT NULL CHECK (media_type IN ('application/pdf', 'text/plain', 'text/markdown')),
  byte_limit INTEGER NOT NULL CHECK (byte_limit BETWEEN 1 AND 26214400),
  byte_size INTEGER,
  sha256 TEXT,
  consumed_by_job_id TEXT REFERENCES jobs(id) ON DELETE SET NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  CHECK (consumed_by_job_id IS NULL OR (byte_size IS NOT NULL AND sha256 IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS upload_sessions_owner_expiry_idx ON upload_sessions (owner_id, expires_at);

CREATE TABLE IF NOT EXISTS quota_reservations (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL UNIQUE REFERENCES jobs(id) ON DELETE CASCADE,
  owner_id TEXT NOT NULL,
  reserved_image_calls INTEGER NOT NULL CHECK (reserved_image_calls BETWEEN 0 AND 24),
  confirmed_image_calls INTEGER NOT NULL DEFAULT 0 CHECK (confirmed_image_calls >= 0),
  reserved_cost_units INTEGER NOT NULL CHECK (reserved_cost_units >= 0),
  confirmed_cost_units INTEGER NOT NULL DEFAULT 0 CHECK (confirmed_cost_units >= 0),
  charge_state TEXT NOT NULL CHECK (charge_state IN ('reserved', 'confirmed', 'ambiguous', 'released')),
  expires_at TEXT NOT NULL,
  released_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS quota_owner_created_idx ON quota_reservations (owner_id, created_at DESC);

CREATE TABLE IF NOT EXISTS usage_events (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  revision_id TEXT REFERENCES job_revisions(id) ON DELETE SET NULL,
  stage_run_id TEXT REFERENCES stage_runs(id) ON DELETE SET NULL,
  provider TEXT NOT NULL,
  model TEXT,
  request_fingerprint TEXT NOT NULL,
  image_count INTEGER NOT NULL DEFAULT 0 CHECK (image_count >= 0),
  input_units INTEGER,
  output_units INTEGER,
  estimated_cost_units INTEGER NOT NULL DEFAULT 0 CHECK (estimated_cost_units >= 0),
  actual_cost_units INTEGER,
  charge_state TEXT NOT NULL CHECK (charge_state IN ('reserved', 'confirmed', 'ambiguous', 'released')),
  result_storage_path TEXT,
  result_sha256 TEXT,
  result_byte_size INTEGER,
  created_at TEXT NOT NULL,
  UNIQUE (job_id, request_fingerprint),
  CHECK (
    (result_storage_path IS NULL AND result_sha256 IS NULL AND result_byte_size IS NULL)
    OR (result_storage_path IS NOT NULL AND length(result_sha256) = 64 AND result_byte_size > 0)
  )
);
CREATE INDEX IF NOT EXISTS usage_events_job_idx ON usage_events (job_id, created_at DESC);
CREATE INDEX IF NOT EXISTS usage_events_recovery_idx ON usage_events (charge_state, result_storage_path);

CREATE TABLE IF NOT EXISTS workflow_dispatches (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL UNIQUE REFERENCES jobs(id) ON DELETE CASCADE,
  revision_id TEXT NOT NULL REFERENCES job_revisions(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('pending', 'dispatched', 'completed', 'failed', 'cancelled')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error_code TEXT,
  next_attempt_at TEXT NOT NULL,
  dispatched_at TEXT,
  workflow_run_id TEXT,
  lease_owner TEXT,
  lease_expires_at TEXT,
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS workflow_dispatches_ready_idx ON workflow_dispatches (status, next_attempt_at);
CREATE INDEX IF NOT EXISTS workflow_dispatches_recovery_idx ON workflow_dispatches (status, lease_expires_at);

CREATE TABLE IF NOT EXISTS revision_artifact_refs (
  revision_id TEXT NOT NULL REFERENCES job_revisions(id) ON DELETE CASCADE,
  artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE RESTRICT,
  role TEXT NOT NULL CHECK (role IN ('base_deck', 'reused', 'replaced')),
  created_at TEXT NOT NULL,
  PRIMARY KEY (revision_id, artifact_id)
);

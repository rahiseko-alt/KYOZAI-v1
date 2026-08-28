-- A completed stage retains its original start time. The first schema used an
-- equivalence check that incorrectly rejected terminal rows with started_at.
PRAGMA foreign_keys = OFF;

CREATE TABLE stage_runs_rebuilt (
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
INSERT INTO stage_runs_rebuilt SELECT * FROM stage_runs;
DROP TABLE stage_runs;
ALTER TABLE stage_runs_rebuilt RENAME TO stage_runs;
CREATE INDEX stage_runs_lease_idx ON stage_runs (status, lease_expires_at);
PRAGMA foreign_keys = ON;

PRAGMA foreign_keys = OFF;
CREATE TABLE workflow_dispatches_rebuilt (
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
INSERT INTO workflow_dispatches_rebuilt (id, job_id, revision_id, status, attempts, last_error_code, next_attempt_at, dispatched_at, workflow_run_id, lease_owner, lease_expires_at, started_at, completed_at, created_at, updated_at)
  SELECT id, job_id, revision_id, status, attempts, last_error_code, next_attempt_at, dispatched_at, workflow_run_id, lease_owner, lease_expires_at, started_at, completed_at, created_at, updated_at FROM workflow_dispatches;
DROP TABLE workflow_dispatches;
ALTER TABLE workflow_dispatches_rebuilt RENAME TO workflow_dispatches;
CREATE INDEX workflow_dispatches_ready_idx ON workflow_dispatches (status, next_attempt_at);
CREATE INDEX workflow_dispatches_recovery_idx ON workflow_dispatches (status, lease_expires_at);
PRAGMA foreign_keys = ON;

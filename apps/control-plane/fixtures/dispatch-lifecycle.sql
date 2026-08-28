-- Local D1 fixture: expired workflow recovery, terminal no-op settlement, and
-- retry-budget exhaustion keep the outbox, job, and revision in agreement.
INSERT INTO jobs (id, owner_id, status, workflow_version, input_kind, request_json, image_model, idempotency_key, expires_at, created_at, updated_at)
VALUES
  ('fixture-dispatch-recover-job', 'fixture-dispatch-owner', 'queued', 'kyozai-workflow@1', 'text', '{"request":"recover fixture"}', 'gpt-image-1', 'fixture-dispatch-recover', '2026-09-05T00:00:00.000Z', '2026-08-28T00:00:00.000Z', '2026-08-28T00:00:00.000Z'),
  ('fixture-dispatch-terminal-job', 'fixture-dispatch-owner', 'completed', 'kyozai-workflow@1', 'text', '{"request":"terminal fixture"}', 'gpt-image-1', 'fixture-dispatch-terminal', '2026-09-05T00:00:00.000Z', '2026-08-28T00:00:00.000Z', '2026-08-28T00:00:00.000Z'),
  ('fixture-dispatch-fail-job', 'fixture-dispatch-owner', 'running', 'kyozai-workflow@1', 'text', '{"request":"failure fixture"}', 'gpt-image-1', 'fixture-dispatch-fail', '2026-09-05T00:00:00.000Z', '2026-08-28T00:00:00.000Z', '2026-08-28T00:00:00.000Z');
INSERT INTO job_revisions (id, job_id, revision_number, status, created_at)
VALUES
  ('fixture-dispatch-recover-revision', 'fixture-dispatch-recover-job', 1, 'queued', '2026-08-28T00:00:00.000Z'),
  ('fixture-dispatch-terminal-revision', 'fixture-dispatch-terminal-job', 1, 'completed', '2026-08-28T00:00:00.000Z'),
  ('fixture-dispatch-fail-revision', 'fixture-dispatch-fail-job', 1, 'running', '2026-08-28T00:00:00.000Z');
INSERT INTO workflow_dispatches (id, job_id, revision_id, status, attempts, next_attempt_at, dispatched_at, workflow_run_id, lease_owner, lease_expires_at, started_at, created_at, updated_at)
VALUES
  ('fixture-dispatch-recover', 'fixture-dispatch-recover-job', 'fixture-dispatch-recover-revision', 'dispatched', 1, '2026-08-28T00:00:00.000Z', '2026-08-28T00:00:00.000Z', 'old-run', 'old-lease', '2026-08-28T00:01:00.000Z', '2026-08-28T00:00:00.000Z', '2026-08-28T00:00:00.000Z', '2026-08-28T00:00:00.000Z'),
  ('fixture-dispatch-terminal', 'fixture-dispatch-terminal-job', 'fixture-dispatch-terminal-revision', 'pending', 0, '2026-08-28T00:00:00.000Z', NULL, NULL, NULL, NULL, NULL, '2026-08-28T00:00:00.000Z', '2026-08-28T00:00:00.000Z'),
  ('fixture-dispatch-fail', 'fixture-dispatch-fail-job', 'fixture-dispatch-fail-revision', 'dispatched', 2, '2026-08-28T00:00:00.000Z', '2026-08-28T00:00:00.000Z', 'failing-run', 'failing-lease', '2026-08-28T00:15:00.000Z', '2026-08-28T00:00:00.000Z', '2026-08-28T00:00:00.000Z', '2026-08-28T00:00:00.000Z');

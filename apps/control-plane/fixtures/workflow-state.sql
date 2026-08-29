-- Local D1 fixture for internal Workflow job state commands.
INSERT INTO jobs (id, owner_id, status, workflow_version, input_kind, request_json, image_model, idempotency_key, expires_at, created_at, updated_at)
VALUES
  ('fixture-workflow-complete-job', 'fixture-workflow-owner', 'queued', 'kyozai-workflow@1', 'text', '{"request":"complete fixture"}', 'gpt-image-1', 'fixture-workflow-complete', '2026-09-05T00:00:00.000Z', '2026-08-28T00:00:00.000Z', '2026-08-28T00:00:00.000Z'),
  ('fixture-workflow-fail-job', 'fixture-workflow-owner', 'running', 'kyozai-workflow@1', 'text', '{"request":"fail fixture"}', 'gpt-image-1', 'fixture-workflow-fail', '2026-09-05T00:00:00.000Z', '2026-08-28T00:00:00.000Z', '2026-08-28T00:00:00.000Z');
INSERT INTO job_revisions (id, job_id, revision_number, status, created_at)
VALUES
  ('fixture-workflow-complete-revision', 'fixture-workflow-complete-job', 1, 'queued', '2026-08-28T00:00:00.000Z'),
  ('fixture-workflow-fail-revision', 'fixture-workflow-fail-job', 1, 'running', '2026-08-28T00:00:00.000Z');
INSERT INTO quota_reservations (id, job_id, owner_id, reserved_image_calls, reserved_cost_units, charge_state, expires_at, created_at)
VALUES ('fixture-workflow-fail-quota', 'fixture-workflow-fail-job', 'fixture-workflow-owner', 1, 10, 'reserved', '2026-08-29T00:00:00.000Z', '2026-08-28T00:00:00.000Z');

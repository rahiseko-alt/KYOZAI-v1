-- Local D1 fixture for the internal cancellation settlement command.
INSERT INTO jobs (id, owner_id, status, workflow_version, input_kind, request_json, image_model, idempotency_key, expires_at, created_at, updated_at)
VALUES ('fixture-cancel-job', 'fixture-owner', 'cancelling', 'kyozai-workflow@1', 'text', '{"request":"fixture"}', 'gpt-image-1', 'fixture-cancel-request', '2026-09-05T00:00:00.000Z', '2026-08-28T00:00:00.000Z', '2026-08-28T00:00:00.000Z');
INSERT INTO job_revisions (id, job_id, revision_number, status, created_at)
VALUES ('fixture-cancel-revision', 'fixture-cancel-job', 1, 'running', '2026-08-28T00:00:00.000Z');
INSERT INTO quota_reservations (id, job_id, owner_id, reserved_image_calls, confirmed_image_calls, inflight_image_calls, reserved_cost_units, confirmed_cost_units, inflight_cost_units, charge_state, expires_at, created_at)
VALUES ('fixture-cancel-quota', 'fixture-cancel-job', 'fixture-owner', 3, 0, 2, 30, 0, 20, 'reserved', '2026-08-29T00:00:00.000Z', '2026-08-28T00:00:00.000Z');
INSERT INTO stage_runs (id, job_id, revision_id, stage, status, validator, lease_owner, lease_expires_at, started_at, created_at)
VALUES ('fixture-cancel-stage', 'fixture-cancel-job', 'fixture-cancel-revision', 'image_generate', 'running', 'fixture-validator', 'expired-worker', '2026-08-28T00:01:00.000Z', '2026-08-28T00:00:00.000Z', '2026-08-28T00:00:00.000Z');
INSERT INTO usage_events (id, job_id, revision_id, stage_run_id, operation, provider, model, request_fingerprint, image_count, estimated_cost_units, charge_state, created_at)
VALUES ('fixture-cancel-usage', 'fixture-cancel-job', 'fixture-cancel-revision', 'fixture-cancel-stage', 'image_generation', 'fixture-provider', 'gpt-image-1', 'fixture-cancel-fingerprint', 2, 20, 'reserved', '2026-08-28T00:00:00.000Z');
INSERT INTO workflow_dispatches (id, job_id, revision_id, status, next_attempt_at, created_at, updated_at)
VALUES ('fixture-cancel-dispatch', 'fixture-cancel-job', 'fixture-cancel-revision', 'pending', '2026-08-28T00:00:00.000Z', '2026-08-28T00:00:00.000Z', '2026-08-28T00:00:00.000Z');

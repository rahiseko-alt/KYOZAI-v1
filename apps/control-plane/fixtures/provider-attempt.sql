-- Local D1 fixture for provider reservation idempotency and quota settlement.
UPDATE system_controls SET accept_new_jobs = 1, cloudflare_usage_within_budget = 1, monthly_image_call_limit = 100, allowed_models_json = '["gpt-image-1"]', updated_at = '2026-08-28T00:00:00.000Z' WHERE id = 1;
INSERT INTO jobs (id, owner_id, status, workflow_version, input_kind, request_json, image_model, idempotency_key, expires_at, created_at, updated_at)
VALUES ('fixture-provider-job', 'fixture-owner', 'running', 'kyozai-workflow@1', 'text', '{"request":"provider fixture"}', 'gpt-image-1', 'fixture-provider-request', '2026-09-05T00:00:00.000Z', '2026-08-28T00:00:00.000Z', '2026-08-28T00:00:00.000Z');
INSERT INTO job_revisions (id, job_id, revision_number, status, created_at)
VALUES ('fixture-provider-revision', 'fixture-provider-job', 1, 'running', '2026-08-28T00:00:00.000Z');
INSERT INTO quota_reservations (id, job_id, owner_id, reserved_image_calls, reserved_cost_units, charge_state, expires_at, created_at)
VALUES ('fixture-provider-quota', 'fixture-provider-job', 'fixture-owner', 2, 20, 'reserved', '2026-08-29T00:00:00.000Z', '2026-08-28T00:00:00.000Z');
INSERT INTO stage_runs (id, job_id, revision_id, stage, status, validator, lease_owner, lease_expires_at, started_at, created_at)
VALUES ('fixture-provider-stage', 'fixture-provider-job', 'fixture-provider-revision', 'image_generate', 'running', 'fixture-validator', 'fixture-worker', '2026-08-28T00:15:00.000Z', '2026-08-28T00:00:00.000Z', '2026-08-28T00:00:00.000Z');

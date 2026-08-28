-- A live worker lease must prevent cancellation settlement from finalizing
-- state before that worker can report its provider outcome.
INSERT INTO jobs (id, owner_id, status, workflow_version, input_kind, request_json, image_model, idempotency_key, expires_at, created_at, updated_at)
VALUES ('fixture-live-cancel-job', 'fixture-owner', 'cancelling', 'kyozai-workflow@1', 'text', '{"request":"fixture live lease"}', 'gpt-image-1', 'fixture-live-cancel-request', '2026-09-05T00:00:00.000Z', '2026-08-28T00:00:00.000Z', '2026-08-28T00:00:00.000Z');
INSERT INTO job_revisions (id, job_id, revision_number, status, created_at)
VALUES ('fixture-live-cancel-revision', 'fixture-live-cancel-job', 1, 'running', '2026-08-28T00:00:00.000Z');
INSERT INTO quota_reservations (id, job_id, owner_id, reserved_image_calls, reserved_cost_units, charge_state, expires_at, created_at)
VALUES ('fixture-live-cancel-quota', 'fixture-live-cancel-job', 'fixture-owner', 1, 10, 'reserved', '2026-08-29T00:00:00.000Z', '2026-08-28T00:00:00.000Z');
INSERT INTO stage_runs (id, job_id, revision_id, stage, status, validator, lease_owner, lease_expires_at, started_at, created_at)
VALUES ('fixture-live-cancel-stage', 'fixture-live-cancel-job', 'fixture-live-cancel-revision', 'image_generate', 'running', 'fixture-validator', 'live-worker', '2026-08-28T00:10:00.000Z', '2026-08-28T00:00:00.000Z', '2026-08-28T00:00:00.000Z');

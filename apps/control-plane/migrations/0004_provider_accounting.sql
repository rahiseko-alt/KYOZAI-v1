-- Keep cancelled jobs financially conservative: a reservation whose worker
-- lease expired may already have reached a provider, so it must settle as
-- ambiguous instead of disappearing with the cancellation.
ALTER TABLE quota_reservations ADD COLUMN inflight_image_calls INTEGER NOT NULL DEFAULT 0 CHECK (inflight_image_calls >= 0);
ALTER TABLE quota_reservations ADD COLUMN inflight_cost_units INTEGER NOT NULL DEFAULT 0 CHECK (inflight_cost_units >= 0);
ALTER TABLE usage_events ADD COLUMN operation TEXT NOT NULL DEFAULT 'image_generation' CHECK (operation IN ('text_generation', 'image_generation', 'image_qa'));
CREATE INDEX IF NOT EXISTS usage_events_operation_recovery_idx ON usage_events (job_id, operation, request_fingerprint, charge_state);

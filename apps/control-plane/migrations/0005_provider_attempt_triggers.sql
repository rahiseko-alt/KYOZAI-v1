-- Provider reservations and their quota transitions must be one SQLite
-- transaction.  Triggers keep a duplicate Workflow delivery from charging the
-- same request fingerprint twice between a read and a later quota update.
CREATE TRIGGER IF NOT EXISTS usage_events_reserve_before_insert
BEFORE INSERT ON usage_events
WHEN NEW.charge_state = 'reserved'
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM system_controls c JOIN jobs j ON j.id = NEW.job_id
    JOIN quota_reservations q ON q.job_id = NEW.job_id
    WHERE c.id = 1 AND c.accept_new_jobs = 1 AND c.cloudflare_usage_within_budget = 1
      AND j.status IN ('queued', 'running') AND q.charge_state <> 'released'
      AND q.confirmed_cost_units + q.inflight_cost_units + NEW.estimated_cost_units <= q.reserved_cost_units
      AND EXISTS (SELECT 1 FROM job_revisions r WHERE r.id = NEW.revision_id AND r.job_id = NEW.job_id)
      AND EXISTS (SELECT 1 FROM stage_runs s WHERE s.id = NEW.stage_run_id AND s.job_id = NEW.job_id AND s.revision_id = NEW.revision_id)
      AND (NEW.operation <> 'image_generation' OR (
        EXISTS (SELECT 1 FROM json_each(c.allowed_models_json) WHERE value = NEW.model)
        AND j.image_model = NEW.model
        AND q.confirmed_image_calls + q.inflight_image_calls + NEW.image_count <= q.reserved_image_calls
      ))
  ) THEN RAISE(ABORT, 'provider_attempt_unavailable') END;
  UPDATE quota_reservations SET
    inflight_image_calls = inflight_image_calls + NEW.image_count,
    inflight_cost_units = inflight_cost_units + NEW.estimated_cost_units
  WHERE job_id = NEW.job_id;
END;

CREATE TRIGGER IF NOT EXISTS usage_events_settle_after_update
AFTER UPDATE OF charge_state ON usage_events
WHEN OLD.charge_state = 'reserved' AND NEW.charge_state IN ('confirmed', 'ambiguous', 'released')
BEGIN
  UPDATE quota_reservations SET
    inflight_image_calls = MAX(0, inflight_image_calls - OLD.image_count),
    inflight_cost_units = MAX(0, inflight_cost_units - OLD.estimated_cost_units),
    confirmed_image_calls = confirmed_image_calls + CASE WHEN NEW.charge_state <> 'released' THEN OLD.image_count ELSE 0 END,
    confirmed_cost_units = confirmed_cost_units + CASE WHEN NEW.charge_state <> 'released' THEN NEW.actual_cost_units ELSE 0 END,
    charge_state = CASE WHEN NEW.charge_state = 'ambiguous' THEN 'ambiguous' ELSE charge_state END
  WHERE job_id = NEW.job_id;
END;

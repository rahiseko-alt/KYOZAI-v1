-- Local D1 fixture for reading a validated output from a passed stage.
INSERT INTO artifacts (id, job_id, revision_id, kind, lifecycle, storage_bucket, storage_path, sha256, media_type, byte_size, metadata_json, created_at)
VALUES ('fixture-provider-final-analysis-artifact', 'fixture-provider-final-job', 'fixture-provider-final-revision', 'source_info', 'validated', 'kyozai-artifacts', 'fixture/analysis.json', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'application/json', 2, '{"fixture":true}', '2026-08-28T00:03:00.000Z');
UPDATE stage_runs SET status = 'passed', output_artifact_ids_json = '["fixture-provider-final-analysis-artifact"]', completed_at = '2026-08-28T00:03:00.000Z'
WHERE id = 'fixture-provider-final-analysis';

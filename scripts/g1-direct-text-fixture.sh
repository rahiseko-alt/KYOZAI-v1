#!/usr/bin/env bash
#
# G1 direct-text control-plane fixture. It starts the actual local Worker and
# D1 binding, then checks the public-facing state transitions through the
# authenticated internal gateway. It intentionally uses an isolated Wrangler
# state directory, so it cannot mutate a developer's normal local fixture.
#
# Run: bash scripts/g1-direct-text-fixture.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${REPO_ROOT}"

PORT="${G1_FIXTURE_PORT:-8791}"
BASE="http://127.0.0.1:${PORT}"
WORK="$(mktemp -d "${REPO_ROOT}/outputs/tmp/g1-direct-text-fixture.XXXXXX")"
STATE_DIR="${WORK}/wrangler-state"
RESPONSE="${WORK}/response.json"
TOKEN="g1-fixture-control-token"
PNPM_RUNNER="${REPO_ROOT}/scripts/run-pnpm.sh"
PROCESS_PID=""

if command -v wslpath >/dev/null 2>&1; then
  WRANGLER_STATE_DIR="$(wslpath -w "${STATE_DIR}")"
  HTTP_RESPONSE="$(wslpath -w "${RESPONSE}")"
  HTTP_CURL="curl.exe"
  HTTP_NULL="NUL"
  NODE_BIN="node.exe"
else
  WRANGLER_STATE_DIR="${STATE_DIR}"
  HTTP_RESPONSE="${RESPONSE}"
  HTTP_CURL="curl"
  HTTP_NULL="/dev/null"
  NODE_BIN="node"
fi

cleanup() {
  stop_worker
  if command -v wslpath >/dev/null 2>&1; then
    powershell.exe -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { \$_.CommandLine -like '*g1-direct-text-fixture*' } | ForEach-Object { cmd.exe /C taskkill /PID \$_.ProcessId /T /F | Out-Null }" >/dev/null 2>&1 || true
    listener_pid="$(netstat.exe -ano | awk -v port=":${PORT}" '$1 == "TCP" && $2 ~ port && $4 == "LISTENING" { print $5; exit }')"
    if [ -n "${listener_pid}" ]; then
      taskkill.exe /PID "${listener_pid}" /T /F >/dev/null 2>&1 || true
    fi
    for _ in $(seq 1 10); do
      if ! netstat.exe -ano | awk -v port=":${PORT}" '$1 == "TCP" && $2 ~ port && $4 == "LISTENING" { found = 1 } END { exit found }'; then break; fi
      sleep 1
    done
    cmd.exe /C rmdir /S /Q "$(wslpath -w "${WORK}")" >/dev/null 2>&1 || true
  else
    rm -rf "${WORK}"
  fi
}
trap cleanup EXIT

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

stop_worker() {
  if [ -n "${PROCESS_PID}" ]; then
    kill "${PROCESS_PID}" 2>/dev/null || true
    wait "${PROCESS_PID}" 2>/dev/null || true
    PROCESS_PID=""
  fi
  if command -v wslpath >/dev/null 2>&1; then
    listener_pid="$(netstat.exe -ano | awk -v port=":${PORT}" '$1 == "TCP" && $2 ~ port && $4 == "LISTENING" { print $5; exit }')"
    if [ -n "${listener_pid}" ]; then
      taskkill.exe /PID "${listener_pid}" /T /F >/dev/null 2>&1 || true
    fi
  fi
}

start_worker() {
  bash "${PNPM_RUNNER}" --filter @kyozai/control-plane exec wrangler dev --local --port "${PORT}" --persist-to "${WRANGLER_STATE_DIR}" --var "KYOZAI_CONTROL_PLANE_TOKEN:${TOKEN}" >"${WORK}/worker.log" 2>&1 &
  PROCESS_PID="$!"
  for _ in $(seq 1 30); do
    if [ "$("${HTTP_CURL}" --silent --output "${HTTP_NULL}" --max-time 2 --write-out "%{http_code}" "${BASE}/health" || true)" = "200" ]; then return; fi
    sleep 1
  done
  cat "${WORK}/worker.log" >&2
  fail "local Worker did not become ready"
}

expect_status() {
  local label="$1" expected="$2" actual="$3"
  [ "${expected}" = "${actual}" ] || fail "${label}: expected HTTP ${expected}, got ${actual}"
  echo "  OK   ${label}"
}

expect_json() {
  local label="$1" path="$2" expected="$3"
  "${NODE_BIN}" - "${HTTP_RESPONSE}" "${path}" "${expected}" <<'NODE'
const [file, path, expected] = process.argv.slice(2);
const value = path.split(".").reduce((item, part) => item?.[part], JSON.parse(require("node:fs").readFileSync(file, "utf8")));
if (JSON.stringify(value) !== JSON.stringify(JSON.parse(expected))) process.exitCode = 1;
NODE
  [ "$?" -eq 0 ] || fail "${label}: ${path} did not equal ${expected}; response=$(tr -d '\n' < "${RESPONSE}")"
  echo "  OK   ${label}"
}

post_job_command() {
  local payload="$1"
  "${HTTP_CURL}" --silent --show-error --max-time 15 --output "${HTTP_RESPONSE}" --write-out "%{http_code}" \
    --request POST "${BASE}/internal/v1/jobs/commands" \
    --header "Authorization: Bearer ${TOKEN}" \
    --header "Content-Type: application/json" \
    --data "${payload}"
}

if "${HTTP_CURL}" --silent --output "${HTTP_NULL}" --max-time 2 "${BASE}/health"; then
  fail "port ${PORT} is already in use; choose G1_FIXTURE_PORT"
fi

mkdir -p "${STATE_DIR}"
bash "${PNPM_RUNNER}" --filter @kyozai/control-plane exec wrangler d1 migrations apply kyozai-preview --local --persist-to "${WRANGLER_STATE_DIR}" >/dev/null
bash "${PNPM_RUNNER}" --filter @kyozai/control-plane exec wrangler d1 execute kyozai-preview --local --persist-to "${WRANGLER_STATE_DIR}" --command "UPDATE system_controls SET accept_new_jobs = 1, cloudflare_usage_within_budget = 1, monthly_image_call_limit = 100, allowed_models_json = '[\"gpt-image-1\"]', updated_at = '2026-08-28T00:00:00.000Z' WHERE id = 1;" >/dev/null

start_worker

NOW="2026-08-28T00:00:00.000Z"
CREATE_A='{"command":"create","ownerId":"fixture-owner-a","jobId":"fixture-job-a","revisionId":"fixture-revision-a","dispatchId":"fixture-dispatch-a","reservationId":"fixture-reservation-a","idempotencyKey":"fixture-direct-text-a","inputKind":"text","requestJson":"{\"request\":\"fixture\",\"sourceText\":\"direct text\",\"sourceUrl\":null,\"attachmentIds\":[]}","imageModel":"gpt-image-1","workflowVersion":"kyozai-workflow@1","now":"2026-08-28T00:00:00.000Z","expiresAt":"2026-09-04T00:00:00.000Z","reservationExpiresAt":"2026-08-29T00:00:00.000Z","reservedImageCalls":1,"reservedCostUnits":1}'

status="$(post_job_command "${CREATE_A}")"; expect_status "direct-text create" 200 "${status}"; expect_json "created job id" jobId '"fixture-job-a"'; expect_json "first create is non-idempotent" idempotent false
status="$(post_job_command "${CREATE_A}")"; expect_status "same idempotency create" 200 "${status}"; expect_json "same job is returned" jobId '"fixture-job-a"'; expect_json "same request is idempotent" idempotent true

status="$(post_job_command '{"command":"list","ownerId":"fixture-owner-a"}')"; expect_status "owner A list" 200 "${status}"; expect_json "owner A sees its job" jobs.0.id '"fixture-job-a"'
status="$(post_job_command '{"command":"list","ownerId":"fixture-owner-b"}')"; expect_status "owner B list" 200 "${status}"; expect_json "owner B sees no job" jobs '[]'
status="$(post_job_command '{"command":"read","ownerId":"fixture-owner-b","jobId":"fixture-job-a"}')"; expect_status "owner B read is non-existent" 404 "${status}"

stop_worker
bash "${PNPM_RUNNER}" --filter @kyozai/control-plane exec wrangler d1 execute kyozai-preview --local --persist-to "${WRANGLER_STATE_DIR}" --command "INSERT INTO stage_runs (id, job_id, revision_id, stage, slide_number, attempt, status, input_artifact_ids_json, output_artifact_ids_json, validator, usage_json, created_at, completed_at) VALUES ('fixture-stage-a', 'fixture-job-a', 'fixture-revision-a', 'analysis', 0, 0, 'passed', '[\"fixture-source-a\"]', '[\"fixture-artifact-a\"]', 'fixture', '{\"inputTokens\":12}', '2026-08-28T00:00:00.000Z', '2026-08-28T00:00:01.000Z'); INSERT INTO artifacts (id, job_id, revision_id, kind, lifecycle, storage_bucket, storage_path, sha256, media_type, byte_size, created_at, finalized_at) VALUES ('fixture-artifact-a', 'fixture-job-a', 'fixture-revision-a', 'analysis', 'final', 'kyozai-artifacts', 'fixture/job-a/analysis.json', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'application/json', 12, '2026-08-28T00:00:00.000Z', '2026-08-28T00:00:01.000Z');" || fail "fixture stage/artifact insertion failed"
start_worker
status="$(post_job_command '{"command":"read","ownerId":"fixture-owner-a","jobId":"fixture-job-a"}')"; expect_status "owner A snapshot read" 200 "${status}"; expect_json "D1 input artifact JSON is preserved" stages.0.input_artifact_ids_json '["fixture-source-a"]'; expect_json "D1 output artifact JSON is preserved" stages.0.output_artifact_ids_json '["fixture-artifact-a"]'; expect_json "D1 usage JSON is preserved" stages.0.usage_json '{"inputTokens":12}'

status="$(post_job_command '{"command":"cancel","ownerId":"fixture-owner-a","jobId":"fixture-job-a","now":"2026-08-28T00:01:00.000Z"}')"; expect_status "queued cancellation" 200 "${status}"; expect_json "queued cancellation is terminal" status '"cancelled"'
status="$(post_job_command '{"command":"delete","ownerId":"fixture-owner-a","jobId":"fixture-job-a","now":"2026-08-28T00:02:00.000Z"}')"; expect_status "cancelled deletion" 200 "${status}"; expect_json "logical deletion starts" status '"deleting"'
status="$(post_job_command '{"command":"list","ownerId":"fixture-owner-a"}')"; expect_status "deleted job list" 200 "${status}"; expect_json "deleted job is hidden" jobs '[]'

echo "G1 direct-text Worker/D1 fixture passed"

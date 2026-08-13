#!/usr/bin/env bash
#
# 起動スモーク。ビルド済みのアプリを実際に起動し、外から HTTP で叩いて受け入れ条件を機械判定する。
# CI（.github/workflows/ci.yml の smoke ジョブ）と手元の両方から、同じこのファイルを実行する
# （AGENTS.md「結合を増やさない」2：同じ処理を呼ぶ入口は1つにする）。
#
# 手元で動かす:  bash scripts/smoke.sh
#
# これは「見本（apps/web）が最小の状態でも、渡し方とチェックが本当に動いている」ことの
# 証拠にするための検査。setup skill 手順2で見本を消したら、その案件の受け入れ条件に
# 合わせてこのファイルを書き直す。

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${REPO_ROOT}" || {
  echo "FAIL: リポジトリルートへ移動できない: ${REPO_ROOT}"
  exit 1
}

PORT="${SMOKE_PORT:-3123}"
BASE_HOST="localhost"
IS_WSL=0
if grep -qi microsoft /proc/version 2>/dev/null; then
  IS_WSL=1
  BASE_HOST="$(ip route show default | sed -nE 's/^default via ([^ ]+).*/\1/p' | head -n 1)"
fi
BASE="http://${BASE_HOST}:${PORT}"
WORK="$(mktemp -d)"
PNPM_RUNNER="${REPO_ROOT}/scripts/run-pnpm.sh"

export NODE_ENV=production

FAILURES=0

check() {
  local label="$1" expected="$2" actual="$3"
  if [ "$expected" = "$actual" ]; then
    echo "  OK   ${label}  (${actual})"
  else
    echo "  FAIL ${label}  期待=${expected} 実際=${actual}"
    FAILURES=$((FAILURES + 1))
  fi
}

expect_contains() {
  local label="$1" needle="$2" file="$3"
  if grep -qF -- "${needle}" "${file}"; then
    echo "  OK   ${label}"
  else
    echo "  FAIL ${label}"
    FAILURES=$((FAILURES + 1))
  fi
}

# 先客がいると、そのプロセスを検査してしまい結果の意味が無くなる。必ず落とす。
if curl -s -o /dev/null --max-time 2 "${BASE}/" 2>/dev/null; then
  echo "FAIL: ポート ${PORT} は既に使われている。"
  echo "      別のプロセスを検査してしまうので中止する。SMOKE_PORT で別のポートを指定するか、先客を止めること。"
  rm -rf "${WORK}"
  exit 1
fi

# Linuxでは独立プロセスグループ、Git BashではWindowsのプロセスツリーとして起動する。
# pnpmだけを止めるとnext-serverが残るため、どちらも子孫をまとめて終了できるIDを保存する。
PROCESS_MODE="group"
if [ "${IS_WSL}" = "1" ]; then
  PROCESS_MODE="windows-tree"
  bash "${PNPM_RUNNER}" --filter web start --port "${PORT}" --hostname 0.0.0.0 >"${WORK}/server.log" 2>&1 &
  echo $! >"${WORK}/pgid"
elif command -v setsid >/dev/null 2>&1; then
  setsid bash -c 'echo $$ > "$1"; exec bash "$3" --filter web start --port "$2" --hostname 0.0.0.0' \
    _ "${WORK}/pgid" "${PORT}" "${PNPM_RUNNER}" >"${WORK}/server.log" 2>&1 &
else
  PROCESS_MODE="windows-tree"
  bash "${PNPM_RUNNER}" --filter web start --port "${PORT}" --hostname 0.0.0.0 >"${WORK}/server.log" 2>&1 &
  echo $! >"${WORK}/pgid"
fi

cleanup() {
  local pgid
  pgid="$(cat "${WORK}/pgid" 2>/dev/null || true)"
  if [ -n "${pgid}" ]; then
    if [ "${IS_WSL}" = "1" ]; then
      powershell.exe -NoProfile -Command "\$connection = Get-NetTCPConnection -LocalPort ${PORT} -State Listen -ErrorAction SilentlyContinue; if (\$connection) { Stop-Process -Id \$connection.OwningProcess -Force -ErrorAction SilentlyContinue }" >/dev/null 2>&1 || true
    elif [ "${PROCESS_MODE}" = "windows-tree" ]; then
      taskkill.exe /PID "${pgid}" /T /F >/dev/null 2>&1 || true
    else
      kill -TERM "-${pgid}" 2>/dev/null || true
      sleep 1
      kill -KILL "-${pgid}" 2>/dev/null || true
    fi
  fi
  rm -rf "${WORK}"
}
trap cleanup EXIT

ready=0
for _ in $(seq 1 30); do
  code=$(curl -s -o /dev/null -w '%{http_code}' "${BASE}/" || true)
  if [ "${code}" = "200" ]; then ready=1; break; fi
  sleep 2
done
if [ "${ready}" != "1" ]; then
  echo "FAIL: サーバが起動しない（最後の応答コード: ${code:-なし}）"
  cat "${WORK}/server.log"
  exit 1
fi

# 見出しのマーカーは apps/web/lib/content.ts の HOME_HEADING と同じ値。片方だけ変えると落ちる。
MARKER="資料を入れたら、教材準備は終わり。"

echo "== 誰でも開けるページ =="
# ブラウザと同じ GET で見る。HEAD では proxy が付けるヘッダが返らない。
HEADERS=$(curl -s -D - -o "${WORK}/home.html" "${BASE}/")
check "GET /" 200 "$(curl -s -o /dev/null -w '%{http_code}' "${BASE}/")"
expect_contains "本文にマーカー '${MARKER}'" "${MARKER}" "${WORK}/home.html"
check "GET /api/health" 200 "$(curl -s -o /dev/null -w '%{http_code}' "${BASE}/api/health")"

echo "== セキュリティヘッダ =="
for header in "strict-transport-security" "x-frame-options" "x-content-type-options" "referrer-policy" "content-security-policy"; do
  if printf '%s' "${HEADERS}" | grep -iq "^${header}:"; then
    echo "  OK   ${header}"
  else
    echo "  FAIL ${header} が無い"
    FAILURES=$((FAILURES + 1))
  fi
done

# CSP は proxy.ts が nonce を作って返す。ヘッダに nonce が「ある」ことと
# HTML の script タグに「その nonce と同じ値」が付いていることの両方を確かめる。
# 値を突き合わせない検査だと、値が食い違って本番で全スクリプトが止まる状態でも
# 両方「ある」なので緑になってしまう。
csp=$(printf '%s' "${HEADERS}" | grep -i '^content-security-policy:' | tr -d '\r')
if [ -z "${csp}" ]; then
  echo "  FAIL content-security-policy が無い"
  FAILURES=$((FAILURES + 1))
else
  nonce=$(printf '%s\n' "${csp}" | sed -nE "s/.*'nonce-([^']+)'.*/\1/p" | head -n 1)
  if [ -z "${nonce}" ]; then
    echo "  FAIL CSP に nonce が無い"
    FAILURES=$((FAILURES + 1))
  else
    echo "  OK   CSP が nonce を使っている"
  fi

  script_src=$(printf '%s' "${csp}" | tr ';' '\n' | grep 'script-src')
  case "${script_src}" in
    *unsafe-inline*)
      echo "  FAIL script-src に 'unsafe-inline' がある"
      FAILURES=$((FAILURES + 1))
      ;;
    *) echo "  OK   script-src に 'unsafe-inline' が無い" ;;
  esac

  case "${csp}" in
    *"frame-ancestors 'none'"*) echo "  OK   frame-ancestors 'none'" ;;
    *) echo "  FAIL frame-ancestors が無い"; FAILURES=$((FAILURES + 1)) ;;
  esac

  # 「nonce が何か付いている」だけでは、CSP の nonce と値が違っていても通る。
  # 値そのものが一致していることまで見る。
  if [ -n "${nonce}" ] && grep -qF "nonce=\"${nonce}\"" "${WORK}/home.html"; then
    echo "  OK   HTML の script が CSP の nonce と一致している"
  else
    echo "  FAIL CSP の nonce と一致する script が無い（ブラウザで JS が動かなくなる）"
    FAILURES=$((FAILURES + 1))
  fi
fi

echo
if [ "${FAILURES}" -eq 0 ]; then
  echo "SMOKE OK: すべて期待どおり"
  exit 0
fi
echo "SMOKE FAIL: ${FAILURES} 件"
exit 1

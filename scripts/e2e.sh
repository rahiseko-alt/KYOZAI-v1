#!/usr/bin/env bash
#
# E2E検査。実ブラウザ（Playwright）で、画面の操作を実際に行って検証する。
# CI（.github/workflows/ci.yml の e2e ジョブ）と手元の両方から、同じこのファイルを実行する
# （AGENTS.md「結合を増やさない」2：同じ処理を呼ぶ入口は1つにする）。
#
# 手元で動かす: bash scripts/e2e.sh
# （先に `pnpm -r build` と、Playwright のブラウザ導入
#   `pnpm --filter web exec playwright install --with-deps chromium` が要る）
#
# アプリの起動・停止自体は Playwright の webServer（apps/web/playwright.config.ts）に任せる。
# データの保存先（Supabase 等）を使う案件になったら、ここでその起動と投入を行う
# （scripts/smoke.sh と同じ形にする）。

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${REPO_ROOT}" || {
  echo "FAIL: リポジトリルートへ移動できない: ${REPO_ROOT}"
  exit 1
}

export E2E_PORT="${E2E_PORT:-3125}"
export NODE_ENV=production

# 先客がいると、そのプロセスを検査してしまい結果の意味が無くなる（scripts/smoke.sh と同じ理由）。
if curl -s -o /dev/null --max-time 2 "http://localhost:${E2E_PORT}/" 2>/dev/null; then
  echo "FAIL: ポート ${E2E_PORT} は既に使われている。"
  echo "      別のプロセスを検査してしまうので中止する。E2E_PORT で別のポートを指定するか、先客を止めること。"
  exit 1
fi

echo "== Playwright で一連の操作を検証 =="
pnpm --filter web exec playwright test

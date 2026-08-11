#!/usr/bin/env bash

set -uo pipefail

if command -v pnpm >/dev/null 2>&1; then
  exec pnpm "$@"
fi

if command -v corepack >/dev/null 2>&1; then
  exec corepack pnpm "$@"
fi

echo "FAIL: pnpmまたはcorepackがPATHに無い。" >&2
exit 127

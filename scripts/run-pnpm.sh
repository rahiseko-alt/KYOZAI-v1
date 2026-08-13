#!/usr/bin/env bash

set -uo pipefail

# Git Bashはcmdラッパーを直接起動できる。WSLではBashがbatch本文を読まないようcmd.exeを使う。
if command -v corepack.cmd >/dev/null 2>&1; then
  case "$(uname -s)" in
    MINGW*|MSYS*|CYGWIN*) exec corepack.cmd pnpm@10.33.0 "$@" ;;
  esac
  if grep -qi microsoft /proc/version 2>/dev/null && command -v cmd.exe >/dev/null 2>&1; then
    exec cmd.exe /d /c corepack.cmd pnpm@10.33.0 "$@"
  fi
fi

if command -v pnpm >/dev/null 2>&1; then
  exec pnpm "$@"
fi

if command -v corepack >/dev/null 2>&1; then
  exec corepack pnpm "$@"
fi

echo "FAIL: pnpmまたはcorepackがPATHに無い。" >&2
exit 127

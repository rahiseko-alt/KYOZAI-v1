#!/usr/bin/env bash

set -uo pipefail

if command -v pnpm >/dev/null 2>&1; then
  exec pnpm "$@"
fi

# Git Bashはcmdラッパーを直接起動できる。WSLではBashがbatch本文を読まないようcmd.exeを使う。
if command -v corepack.cmd >/dev/null 2>&1; then
  case "$(uname -s)" in
    MINGW*|MSYS*|CYGWIN*) exec corepack.cmd pnpm@10.33.0 "$@" ;;
  esac
  if grep -qi microsoft /proc/version 2>/dev/null && command -v cmd.exe >/dev/null 2>&1; then
    command_line='corepack.cmd pnpm@10.33.0'
    for argument in "$@"; do
      escaped=${argument//\"/\"\"}
      command_line="${command_line} \"${escaped}\""
    done
    exec cmd.exe /d /s /c "${command_line}"
  fi
fi

if command -v corepack >/dev/null 2>&1; then
  exec corepack pnpm "$@"
fi

echo "FAIL: pnpmまたはcorepackがPATHに無い。" >&2
exit 127

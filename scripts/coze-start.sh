#!/usr/bin/env bash
set -euo pipefail

if [ ! -s ".next/BUILD_ID" ]; then
  echo "[coze-start] Missing production build. The Coze build phase must complete before runtime startup." >&2
  exit 1
fi

if [ ! -x "node_modules/.bin/next" ]; then
  echo "[coze-start] Missing production dependencies. The Coze build phase must install dependencies before runtime startup." >&2
  exit 1
fi

exec ./node_modules/.bin/next start -p "${PORT:-5000}" -H 0.0.0.0

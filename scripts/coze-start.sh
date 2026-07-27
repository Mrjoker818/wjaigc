#!/usr/bin/env bash
set -euo pipefail

if [ ! -s ".next/BUILD_ID" ]; then
  echo "[coze-start] Production build is missing; installing dependencies and rebuilding."
  pnpm install --frozen-lockfile
  pnpm run build
elif [ ! -d "node_modules" ]; then
  echo "[coze-start] Dependencies are missing; installing before startup."
  pnpm install --frozen-lockfile
fi

pnpm run doctor -- --startup
exec pnpm run start

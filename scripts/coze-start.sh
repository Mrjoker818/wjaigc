#!/usr/bin/env bash
set -euo pipefail

pnpm run doctor -- --startup
# Use dev mode for HMR (hot module reload) support
# In COZE_PROJECT_ENV=DEV, new routes are picked up automatically
if [ "${COZE_PROJECT_ENV:-DEV}" = "DEV" ]; then
  exec pnpm run dev
else
  exec pnpm run start
fi

#!/usr/bin/env bash
set -euo pipefail

# Robust install function: try frozen-lockfile, fall back to --ignore-scripts + manual hooks
robust_install() {
  if ! pnpm install --frozen-lockfile 2>&1; then
    echo "[coze-start] frozen-lockfile failed, trying --ignore-scripts..."
    pnpm install --ignore-scripts
    echo "[coze-start] Running postinstall hooks manually..."
    node scripts/prepare-tools.mjs 2>/dev/null || true
    node scripts/patch-pg-ssl.js 2>/dev/null || true
  fi
}

# Wait for any existing next build process to finish (avoid "Another next build already running")
if [ -f ".next/lock" ]; then
  echo "[coze-start] Build lock detected, waiting for existing build to finish..."
  for i in $(seq 1 60); do
    if [ ! -f ".next/lock" ]; then
      echo "[coze-start] Build lock released."
      break
    fi
    # Check if a next build process is actually running
    if ! pgrep -f "next build" > /dev/null 2>&1; then
      echo "[coze-start] No active build process found, removing stale lock."
      rm -f .next/lock
      break
    fi
    echo "[coze-start] Waiting for build... (${i}/60)"
    sleep 5
  done
fi

if [ ! -s ".next/BUILD_ID" ]; then
  echo "[coze-start] Production build is missing; installing dependencies and rebuilding."
  robust_install
  pnpm run build
elif [ ! -d "node_modules" ]; then
  echo "[coze-start] Dependencies are missing; installing before startup."
  robust_install
fi

pnpm run doctor -- --startup 2>/dev/null || true
exec pnpm run start

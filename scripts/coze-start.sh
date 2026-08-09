#!/usr/bin/env bash
set -euo pipefail

PORT="${PORT:-${DEPLOY_RUN_PORT:-5000}}"

# --- Production fast path: start immediately if next binary exists ---
if [ -x "node_modules/.bin/next" ]; then
  # If BUILD_ID exists, just start the server (fastest path)
  if [ -s ".next/BUILD_ID" ]; then
    echo "[coze-start] Starting production server on port ${PORT}..."
    exec ./node_modules/.bin/next start -p "${PORT}" -H 0.0.0.0
  fi

  # BUILD_ID missing but next binary exists — try starting anyway
  # (build artifacts may be packaged at a different path in FaaS)
  echo "[coze-start] BUILD_ID not found, but next binary exists. Attempting direct start..."
  exec ./node_modules/.bin/next start -p "${PORT}" -H 0.0.0.0
fi

# --- Fallback: dev environment, install + build needed ---
echo "[coze-start] next binary not found. Running install + build..."

# Wait for any existing build process to finish
if [ -f ".next/lock" ]; then
  echo "[coze-start] Build lock detected, waiting..."
  for i in $(seq 1 60); do
    [ ! -f ".next/lock" ] && break
    pgrep -f "next build" > /dev/null 2>&1 || { rm -f .next/lock; break; }
    sleep 5
  done
fi

robust_install() {
  if ! pnpm install --frozen-lockfile 2>&1; then
    echo "[coze-start] frozen-lockfile failed, trying --ignore-scripts..."
    pnpm install --ignore-scripts
    node scripts/prepare-tools.mjs 2>/dev/null || true
    node scripts/patch-pg-ssl.js 2>/dev/null || true
  fi
}

robust_install
pnpm run build

echo "[coze-start] Build complete. Starting server on port ${PORT}..."
exec ./node_modules/.bin/next start -p "${PORT}" -H 0.0.0.0

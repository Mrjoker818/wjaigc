#!/usr/bin/env bash
set -euo pipefail

PORT="${PORT:-${DEPLOY_RUN_PORT:-5000}}"

# --- Fast path: BUILD_ID exists, start immediately ---
if [ -s ".next/BUILD_ID" ]; then
  echo "[coze-start] Starting production server on port ${PORT}..."
  exec ./node_modules/.bin/next start -p "${PORT}" -H 0.0.0.0
fi

# --- Restore from dist/ backup if .next is missing ---
# (FaaS packaging may exclude .next via .dockerignore; dist/ is not ignored)
if [ -s "dist/BUILD_ID" ]; then
  echo "[coze-start] Restoring build artifacts from dist/..."
  rm -rf .next
  cp -r dist .next
  echo "[coze-start] Restore complete. Starting production server on port ${PORT}..."
  exec ./node_modules/.bin/next start -p "${PORT}" -H 0.0.0.0
fi

# --- Fallback: build from scratch (dev environment or cold start) ---
echo "[coze-start] No build artifacts found. Building..."

# Wait for any existing build process to finish
if [ -f ".next/lock" ]; then
  echo "[coze-start] Build lock detected, waiting..."
  for i in $(seq 1 60); do
    [ ! -f ".next/lock" ] && break
    pgrep -f "next build" > /dev/null 2>&1 || { rm -f .next/lock; break; }
    sleep 5
  done
fi

# Install dependencies if needed
if [ ! -x "node_modules/.bin/next" ]; then
  echo "[coze-start] Installing dependencies..."
  if ! pnpm install --frozen-lockfile 2>&1; then
    echo "[coze-start] frozen-lockfile failed, trying --ignore-scripts..."
    pnpm install --ignore-scripts
    node scripts/prepare-tools.mjs 2>/dev/null || true
    node scripts/patch-pg-ssl.js 2>/dev/null || true
  fi
fi

# Build
echo "[coze-start] Running next build..."
pnpm run build

echo "[coze-start] Build complete. Starting server on port ${PORT}..."
exec ./node_modules/.bin/next start -p "${PORT}" -H 0.0.0.0

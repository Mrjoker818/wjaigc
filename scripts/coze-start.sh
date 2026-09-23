#!/usr/bin/env bash
set -euo pipefail

PORT="${PORT:-${DEPLOY_RUN_PORT:-5000}}"

# A BUILD_ID can be written before a concurrent build finishes its other files.
# Never start or restore artifacts while Next still holds its build lock.
if [ -f ".next/lock" ]; then
  echo "[coze-start] Build lock detected, waiting..."
  for i in $(seq 1 60); do
    [ ! -f ".next/lock" ] && break
    sleep 5
  done
  if [ -f ".next/lock" ]; then
    echo "[coze-start] Timed out waiting for the existing build; refusing to remove its lock." >&2
    exit 1
  fi
fi

# A clean checkout can prove which source tree produced a Next build. Packaged
# runtimes without Git retain the existing artifact path but cannot attest it.
GIT_PRESENT=0
SOURCE_TREE=""
if git rev-parse --is-inside-work-tree > /dev/null 2>&1; then
  GIT_PRESENT=1
  if [ -z "$(git status --porcelain --untracked-files=normal)" ]; then
    SOURCE_TREE="$(git rev-parse 'HEAD^{tree}')"
  fi
fi

artifact_matches_source() {
  [ -s "$1/BUILD_ID" ] || return 1
  if [ "$GIT_PRESENT" -eq 0 ]; then
    return 0
  fi
  [ -n "$SOURCE_TREE" ] \
    && [ "$(cat "$1/BUILD_ID")" = "$SOURCE_TREE" ] \
    && [ -s "$1/WUJIE_BUILD_COMPLETE" ] \
    && [ "$(cat "$1/WUJIE_BUILD_COMPLETE")" = "$SOURCE_TREE" ]
}

# --- Fast path: the build belongs to the current clean source tree ---
if artifact_matches_source ".next"; then
  echo "[coze-start] Starting production server on port ${PORT}..."
  exec ./node_modules/.bin/next start -p "${PORT}" -H 0.0.0.0
fi

# --- Restore from dist/ backup if .next is missing ---
# (FaaS packaging may exclude .next via .dockerignore; dist/ is not ignored)
if artifact_matches_source "dist"; then
  echo "[coze-start] Restoring build artifacts from dist/..."
  rm -rf .next
  cp -r dist .next
  echo "[coze-start] Restore complete. Starting production server on port ${PORT}..."
  exec ./node_modules/.bin/next start -p "${PORT}" -H 0.0.0.0
fi

# --- Fallback: build from scratch (dev environment or cold start) ---
echo "[coze-start] No matching build artifacts found. Building..."

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

if [ -n "$SOURCE_TREE" ] && ! artifact_matches_source ".next"; then
  echo "[coze-start] Build ID does not match clean source tree; refusing to start." >&2
  exit 1
fi

echo "[coze-start] Build complete. Starting server on port ${PORT}..."
exec ./node_modules/.bin/next start -p "${PORT}" -H 0.0.0.0

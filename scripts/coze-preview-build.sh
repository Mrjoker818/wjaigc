#!/usr/bin/env bash
set -euo pipefail

echo "[coze-preview-build] Starting build process..."

# Step 1: Install dependencies
# Try frozen-lockfile first (fast, reproducible), fall back to normal install
if ! pnpm install --frozen-lockfile 2>&1; then
  echo "[coze-preview-build] frozen-lockfile failed, trying normal install with --ignore-scripts..."
  pnpm install --ignore-scripts
  # Manually run postinstall hooks that --ignore-scripts skipped
  echo "[coze-preview-build] Running postinstall hooks manually..."
  node scripts/prepare-tools.mjs 2>/dev/null || true
  node scripts/patch-pg-ssl.js 2>/dev/null || true
fi

# Apply checksum-managed migrations during the build phase so the runtime
# fast path can remain within Coze's cold-start budget.
if [ -n "${DATABASE_URL:-${PGDATABASE_URL:-}}" ]; then
  echo "[coze-preview-build] Applying database migrations..."
  pnpm run migrate
else
  echo "[coze-preview-build] Database URL is not configured; skipping migrations."
fi

# Step 2: Build the project
echo "[coze-preview-build] Building Next.js project..."

EXPECTED_TREE=""
if git rev-parse --is-inside-work-tree > /dev/null 2>&1 \
  && [ -z "$(git status --porcelain --untracked-files=normal)" ]; then
  EXPECTED_TREE="$(git rev-parse 'HEAD^{tree}')"
fi

if [ -f ".next/lock" ]; then
  echo "[coze-preview-build] Another build holds the Next lock; waiting..."
  for i in $(seq 1 60); do
    [ ! -f ".next/lock" ] && break
    sleep 5
  done
  if [ -f ".next/lock" ]; then
    echo "[coze-preview-build] Timed out waiting for the existing build; refusing a concurrent build." >&2
    exit 1
  fi
fi

if [ -n "$EXPECTED_TREE" ] && [ -s ".next/BUILD_ID" ] \
  && [ "$(cat .next/BUILD_ID)" = "$EXPECTED_TREE" ] \
  && [ -s ".next/WUJIE_BUILD_COMPLETE" ] \
  && [ "$(cat .next/WUJIE_BUILD_COMPLETE)" = "$EXPECTED_TREE" ]; then
  echo "[coze-preview-build] Reusing completed build for the current source tree."
else
  pnpm run build
fi

if [ -n "$EXPECTED_TREE" ] \
  && { [ "$(cat .next/BUILD_ID 2>/dev/null || true)" != "$EXPECTED_TREE" ] \
    || [ "$(cat .next/WUJIE_BUILD_COMPLETE 2>/dev/null || true)" != "$EXPECTED_TREE" ]; }; then
  echo "[coze-preview-build] Completed build does not match clean source tree." >&2
  exit 1
fi

echo "[coze-preview-build] Build completed successfully."

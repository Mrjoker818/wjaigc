#!/usr/bin/env bash
set -euo pipefail

echo "[coze-deploy-build] Starting production build process..."

# Step 1: Install dependencies
# Try frozen-lockfile first (fast, reproducible), fall back to normal install
if ! pnpm install --frozen-lockfile 2>&1; then
  echo "[coze-deploy-build] frozen-lockfile failed, trying normal install with --ignore-scripts..."
  pnpm install --ignore-scripts
  # Manually run postinstall hooks that --ignore-scripts skipped
  echo "[coze-deploy-build] Running postinstall hooks manually..."
  node scripts/prepare-tools.mjs 2>/dev/null || true
  node scripts/patch-pg-ssl.js 2>/dev/null || true
fi

# Apply checksum-managed migrations during the build phase so the runtime
# fast path can remain within Coze's cold-start budget.
if [ -n "${DATABASE_URL:-${PGDATABASE_URL:-}}" ]; then
  echo "[coze-deploy-build] Applying database migrations..."
  pnpm run migrate
else
  echo "[coze-deploy-build] Database URL is not configured; skipping migrations."
fi

# Step 2: Build the project
echo "[coze-deploy-build] Building Next.js project..."
pnpm run build

# Step 3: Backup build artifacts to dist/ (not in .dockerignore)
# This ensures FaaS runtime can access the build output even if .next is excluded
echo "[coze-deploy-build] Backing up build artifacts to dist/..."
rm -rf dist
cp -r .next dist

echo "[coze-deploy-build] Build completed successfully."

#!/usr/bin/env bash
set -euo pipefail

unset WUJIE_BOOTSTRAP_PROVIDERS_JSON WUJIE_ADMIN_PASSWORD

echo "[coze-deploy-build] Starting production build process..."

node scripts/verify-deploy-package.mjs --source

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
if [ -n "${DATABASE_URL:+configured}${PGDATABASE_URL:+configured}" ]; then
  echo "[coze-deploy-build] Applying database migrations..."
  pnpm run migrate
else
  echo "[coze-deploy-build] Database URL is not configured; skipping migrations."
fi

# Step 2: Build the project
echo "[coze-deploy-build] Building Next.js project..."
pnpm run build

node scripts/verify-deploy-package.mjs --built

# Step 3: Keep .next as the sole build artifact; drop the build cache.
# The Turbopack build cache (.next/cache) is build-only and is by far the
# largest artifact (~400M). It is never read at runtime (next start serves
# .next/server + .next/static), so removing it here keeps both the build-time
# disk usage and the FaaS runtime package small. A dist/ backup copy was
# removed: .next ships in the package (.dockerignore does not exclude it) and
# coze-start.sh can rebuild from source as a last-resort fallback.
rm -rf .next/cache

echo "[coze-deploy-build] Build completed successfully."

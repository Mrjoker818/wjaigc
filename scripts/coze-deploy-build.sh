#!/usr/bin/env bash
set -euo pipefail

unset WUJIE_BOOTSTRAP_PROVIDERS_JSON WUJIE_ADMIN_PASSWORD

echo "[coze-deploy-build] Starting production build process..."

node scripts/verify-deploy-package.mjs --source

# Step 1: Install dependencies
# Retry without lifecycle scripts if needed, always keeping the lock frozen.
if ! pnpm install --frozen-lockfile 2>&1; then
  echo "[coze-deploy-build] frozen-lockfile failed, retrying frozen install with --ignore-scripts..."
  pnpm install --ignore-scripts --frozen-lockfile
  # Manually run postinstall hooks that --ignore-scripts skipped
  echo "[coze-deploy-build] Running postinstall hooks manually..."
  node scripts/prepare-tools.mjs 2>/dev/null || true
  node scripts/patch-pg-ssl.js 2>/dev/null || true
fi

# Apply checksum-managed migrations during the build phase so the runtime
# fast path can remain within Coze's cold-start budget.
# SAFETY BOUNDARY: migrations must not run automatically. In particular
# migrations/20261118_wj_remove_node_workflows.sql deletes saved workflows and
# drops tables; it may only run after an explicit decision
# (WUJIE_RUN_MIGRATIONS=1), never via an ambient build.
# Detect a platform-bound database in any injection form the Coze sandbox uses
# (URL, libpq split variables, or the Supabase integration surface). Keep in
# mind that these are configuration signals, not proof of a PG connection source.
# coze-start.sh --deployment separately requires URL/libpq; db-client's HTTP
# signal continues to retain fail-closed DB_ONLY authentication.
if [ -n "${DATABASE_URL:+configured}${PGDATABASE_URL:+configured}" ] \
  || { [ -n "${PGHOST:+configured}" ] && [ -n "${PGDATABASE:+configured}" ] && [ -n "${PGUSER:+configured}" ]; } \
  || { [ -n "${COZE_SUPABASE_URL:+configured}" ] && [ -n "${COZE_SUPABASE_SERVICE_ROLE_KEY:+configured}${COZE_SUPABASE_ANON_KEY:+configured}" ]; }; then
  if [ "${WUJIE_RUN_MIGRATIONS:-0}" = "1" ]; then
    echo "[coze-deploy-build] Applying database migrations..."
    pnpm run migrate
  else
    echo "[coze-deploy-build] DB env present but WUJIE_RUN_MIGRATIONS!=1; skipping migrations (safety guard)."
  fi
else
  echo "[coze-deploy-build] No database binding detected; skipping migrations."
fi

MEDIA_GUARD=()
if [ "$(uname -s)" = Linux ]; then
  bash scripts/stage-coze-media-tools.sh
  MEDIA_GUARD=(--coze-media)
fi

# Step 2: Build the project
# Use the previously successful Webpack artifact format at Coze's legacy
# deployment boundary. Keep the normal build unchanged for local/VPS use.
echo "[coze-deploy-build] Building Next.js project with Webpack..."
pnpm run build:coze

node scripts/verify-deploy-package.mjs --built "${MEDIA_GUARD[@]}"

# Step 3: Keep the Next output and traced media tools; drop the build cache.
# The compiler build cache (.next/cache) is build-only and is by far the
# largest artifact (~400M). It is never read at runtime (next start serves
# .next/server + .next/static), so removing it here keeps both the build-time
# disk usage and the FaaS runtime package small. A dist/ backup copy was
# removed: .next ships in the package (.dockerignore does not exclude it) and
# coze-start.sh can rebuild from source as a last-resort fallback.
rm -rf .next/cache

echo "[coze-deploy-build] Build completed successfully."

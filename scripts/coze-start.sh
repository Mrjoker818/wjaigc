#!/usr/bin/env bash
set -euo pipefail

# Detect a PostgreSQL connection source the pg driver can actually consume:
#   1. DATABASE_URL / PGDATABASE_URL (canonical connection string)
#   2. libpq split variables: PGHOST + PGPORT + PGDATABASE + PGUSER (+ PGPASSWORD)
#
# Supabase HTTP markers still keep application auth fail-closed in DB_ONLY,
# but cannot satisfy this startup check without a separate PG connection source.
pg_connection_source_present() {
  if [ -n "${DATABASE_URL:+configured}${PGDATABASE_URL:+configured}" ]; then
    return 0
  fi
  local host="${PGHOST:-}" database="${PGDATABASE:-}" user="${PGUSER:-}"
  if [ -n "${host//[[:space:]]/}" ] && [ -n "${database//[[:space:]]/}" ] && [ -n "${user//[[:space:]]/}" ]; then
    return 0
  fi
  return 1
}

DEPLOYMENT=0
if [ "${1:-}" = "--deployment" ]; then
  DEPLOYMENT=1
  if ! pg_connection_source_present; then
    # An HTTP binding (including incomplete configuration) is a deployment
    # misconfiguration, never the no-DB development/validation exception.
    if [ -n "${COZE_SUPABASE_URL:+configured}${COZE_SUPABASE_SERVICE_ROLE_KEY:+configured}${COZE_SUPABASE_ANON_KEY:+configured}" ]; then
      echo "[coze-start] Supabase HTTP binding does not provide a PostgreSQL connection source. Configure DATABASE_URL, PGDATABASE_URL, or PGHOST + PGDATABASE + PGUSER before --deployment." >&2
      exit 1
    fi
    # Hard-fail only for a packaged production runtime (no Git checkout,
    # COZE_PROJECT_ENV=PROD) whose database binding is missing. Build and
    # validation sandboxes are Git checkouts and intentionally run without the
    # binding; they boot without DB enforcement so the pipeline can exercise
    # the start command. See AGENTS.md (认证与部署).
    if [ "${COZE_PROJECT_ENV:-}" = "PROD" ] && ! git rev-parse --is-inside-work-tree > /dev/null 2>&1; then
      echo "[coze-start] Deployment requires a PostgreSQL connection source (DATABASE_URL, PGDATABASE_URL, or libpq split variables)." >&2
      exit 1
    fi
    echo "[coze-start] No database binding detected; starting without deployment DB enforcement."
    DEPLOYMENT=0
  fi
fi

PORT="${PORT:-${DEPLOY_RUN_PORT:-5000}}"
export PORT

# Coze reserves COZE_* configuration keys. Pin the independent preview origin
# explicitly in DEV only; deployed runtimes keep their platform-owned origin.
if [ "$DEPLOYMENT" -eq 0 ] && [ "${COZE_PROJECT_ENV:-}" = "DEV" ] && [ -n "${WUJIE_PREVIEW_ORIGIN:-}" ]; then
  export COZE_PROJECT_DOMAIN_DEFAULT="${WUJIE_PREVIEW_ORIGIN}"
fi

# The FaaS runtime package follows .dockerignore, which excludes node_modules.
# A packaged runtime therefore takes the artifact fast path (no Git, BUILD_ID
# present) but has no dependency tree to exec. Install it before starting so a
# first boot self-provisions instead of failing on a missing next binary.
ensure_runtime_deps() {
  if [ ! -x "node_modules/.bin/next" ]; then
    echo "[coze-start] node_modules missing in packaged runtime; installing dependencies..."
    if ! pnpm install --frozen-lockfile 2>&1; then
      echo "[coze-start] Retrying dependency install without lifecycle scripts..."
      pnpm install --ignore-scripts --frozen-lockfile 2>&1
      node scripts/prepare-tools.mjs 2>/dev/null || true
      node scripts/patch-pg-ssl.js 2>/dev/null || true
    fi
  fi
}

start_server() {
  ensure_runtime_deps
  if [ "$DEPLOYMENT" -eq 1 ]; then
    export WUJIE_DEPLOYMENT_DB_ONLY=1
    export WUJIE_AUTH_PERSISTENCE_MODE=DB_ONLY
    if [ "$(uname -s)" = Linux ]; then
      local media_arch=""
      case "$(uname -m)" in
        x86_64) media_arch=x64 ;;
        aarch64) media_arch=arm64 ;;
      esac
      local media_dir="$PWD/assets/wujie-coze-media/${media_arch}"
      if [ -n "$media_arch" ] && [ -f "$media_dir/ffmpeg" ] && [ -x "$media_dir/ffmpeg" ] \
        && [ -f "$media_dir/ffprobe" ] && [ -x "$media_dir/ffprobe" ]; then
        export PATH="$media_dir:$PATH"
      fi
    fi
  fi
  if [ "${WUJIE_PRESENCE_ENABLED:-}" = "true" ] || [ "${WUJIE_YJS_ENABLED:-}" = "true" ]; then
    echo "[coze-start] Starting production server with collaboration on port ${PORT}..."
    export NODE_ENV=production
    exec node --require next/dist/server/node-environment --conditions=react-server --import tsx scripts/presence-server.ts
  fi
  echo "[coze-start] Starting production server on port ${PORT}..."
  exec ./node_modules/.bin/next start -p "${PORT}" -H 0.0.0.0
}

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
  if [ "$DEPLOYMENT" -eq 1 ]; then
    node scripts/verify-deploy-package.mjs --source
  fi
  start_server
fi

# --- Fallback: build from scratch (dev environment or cold start) ---
# Note: the former dist/ backup restore path was removed (dist/ is no longer
# produced by coze-deploy-build.sh). If .next is missing or stale, we rebuild
# from source right here as the last-resort fallback.
echo "[coze-start] No matching build artifacts found. Building..."

# Scope bootstrap credentials to the server process.
(
  unset WUJIE_BOOTSTRAP_PROVIDERS_JSON WUJIE_ADMIN_PASSWORD
  if [ "$DEPLOYMENT" -eq 1 ]; then
    node scripts/verify-deploy-package.mjs --source
  fi

  if [ ! -x "node_modules/.bin/next" ]; then
    echo "[coze-start] Installing dependencies..."
    if ! pnpm install --frozen-lockfile 2>&1; then
      echo "[coze-start] frozen-lockfile failed, trying --ignore-scripts..."
      pnpm install --ignore-scripts --frozen-lockfile
      node scripts/prepare-tools.mjs 2>/dev/null || true
      node scripts/patch-pg-ssl.js 2>/dev/null || true
    fi
  fi

  echo "[coze-start] Running next build..."
  pnpm run build
  if [ "$DEPLOYMENT" -eq 1 ]; then
    node scripts/verify-deploy-package.mjs --built
  fi
)

if [ -n "$SOURCE_TREE" ] && ! artifact_matches_source ".next"; then
  echo "[coze-start] Build ID does not match clean source tree; refusing to start." >&2
  exit 1
fi

echo "[coze-start] Build complete."
start_server

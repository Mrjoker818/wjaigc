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

# Step 2: Build the project
echo "[coze-preview-build] Building Next.js project..."
pnpm run build

echo "[coze-preview-build] Build completed successfully."

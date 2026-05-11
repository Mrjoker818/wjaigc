#!/bin/bash
set -e

echo "[DEV] Starting upscale server on port 8081..."
(cd /workspace/projects && nohup python3 scripts/upscale-server.py --port 8081 > /app/work/logs/bypass/upscale.log 2>&1 &)
sleep 2

echo "[DEV] Starting development server..."
pnpm dev

#!/bin/bash
set -e

echo "[BUILD] Installing dependencies..."
pnpm install

echo "[BUILD] Building project..."
pnpm build

echo "[BUILD] Build completed successfully!"

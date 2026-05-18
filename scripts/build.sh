#!/bin/bash
set -e

echo "[BUILD] Installing dependencies..."
pnpm install

echo "[BUILD] Installing SVG trace tools (vtracer, potrace, ImageMagick)..."
pip3 install vtracer 2>/dev/null || echo "[BUILD] Warning: vtracer install skipped, SVG color trace may not work in production"
apt-get install -y potrace imagemagick 2>/dev/null || echo "[BUILD] Warning: potrace/imagemagick install skipped, SVG B&W trace may not work in production"

echo "[BUILD] Building project..."
pnpm build

echo "[BUILD] Build completed successfully!"

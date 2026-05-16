#!/bin/bash
set -e

echo "[BUILD] Installing dependencies..."
pnpm install

echo "[BUILD] Installing SVG trace tools (vtracer, potrace, ImageMagick)..."
pip3 install vtracer 2>/dev/null || echo "[BUILD] Warning: vtracer install failed, SVG color trace may not work"
apt-get install -y potrace imagemagick 2>/dev/null || echo "[BUILD] Warning: potrace/imagemagick install failed, SVG B&W trace may not work"

echo "[BUILD] Building project..."
pnpm build

echo "[BUILD] Build completed successfully!"

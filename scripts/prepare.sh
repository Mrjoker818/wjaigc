#!/bin/bash
set -e

echo "[PREPARE] Installing dependencies..."
pnpm install

echo "[PREPARE] Installing SVG trace tools (vtracer, potrace, ImageMagick)..."
pip3 install vtracer 2>/dev/null || echo "[PREPARE] Warning: vtracer install failed, SVG color trace may not work"
apt-get install -y potrace imagemagick 2>/dev/null || echo "[PREPARE] Warning: potrace/imagemagick install failed, SVG B&W trace may not work"

echo "[PREPARE] Done"

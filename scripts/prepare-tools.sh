#!/bin/bash
# SVG trace tools installation (runs as postinstall after pnpm install)
# Failures are non-blocking — SVG trace has API fallback chain

echo "[PREPARE-TOOLS] Installing SVG trace tools..."

echo "[PREPARE-TOOLS] Installing vtracer (Python)..."
pip3 install vtracer 2>/dev/null || echo "[PREPARE-TOOLS] Warning: vtracer install skipped, SVG color trace will use API fallback"

echo "[PREPARE-TOOLS] Installing potrace + ImageMagick..."
apt-get install -y potrace imagemagick 2>/dev/null || echo "[PREPARE-TOOLS] Warning: potrace/imagemagick install skipped, SVG B&W trace will use API fallback"

echo "[PREPARE-TOOLS] Done"

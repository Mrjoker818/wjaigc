#!/bin/bash
# ============================================================
# build-with-python-check.sh — 开发环境构建入口
# 1. 安装 Node.js 依赖
# 2. 检查 Python AI 环境（缺失时自动安装）
# ============================================================

set -e

echo "[BUILD] Installing Node.js dependencies..."
pnpm install

echo "[BUILD] Checking Python AI environment..."
bash scripts/ensure-python-env.sh --check 2>/dev/null || {
  echo "[BUILD] Python AI environment missing, installing (background)..."
  # 在后台安装 Python 依赖，不阻塞开发服务启动
  (bash scripts/ensure-python-env.sh > /app/work/logs/bypass/python-env-install.log 2>&1 &) || true
}

echo "[BUILD] Build complete"

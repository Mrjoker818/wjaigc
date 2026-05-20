#!/usr/bin/env bash
# ============================================================
# 启动 IOPaint LaMa 本地修图服务
# ============================================================
# 注意：现在也支持 Python 子进程模式（无需启动独立服务）
# 此脚本用于启动 IOPaint REST API 服务（兼容旧版）
# ============================================================
set -e

MODEL_DIR="${IOPAINT_MODEL_DIR:-./models/iopaint}"
PORT="${IOPAINT_PORT:-8080}"
DEVICE="${IOPAINT_DEVICE:-cpu}"

mkdir -p "$MODEL_DIR"

echo "启动 IOPaint LaMa 服务..."
echo "  模型目录: $MODEL_DIR"
echo "  端口: $PORT"
echo "  设备: $DEVICE"
echo ""
echo "注意：如使用 Python 子进程模式（推荐），无需启动此服务"
echo "  擦除: 自动调用 scripts/iopaint_erase.py"
echo "  去背景: 自动调用 scripts/iopaint_removebg.py"

iopaint start \
  --model=lama \
  --device="$DEVICE" \
  --port="$PORT" \
  --model-dir="$MODEL_DIR"

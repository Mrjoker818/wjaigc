#!/usr/bin/env bash
# ============================================================
# 启动 IOPaint LaMa 本地修图服务
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

iopaint start \
  --model=lama \
  --device="$DEVICE" \
  --port="$PORT" \
  --model-dir="$MODEL_DIR"

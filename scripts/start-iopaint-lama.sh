#!/usr/bin/env bash
# ============================================================
# 启动 IOPaint 本地修图服务 (兼容旧版 HTTP 模式)
# ============================================================
# 注意：现在推荐使用 Python 子进程模式（无需启动独立服务）
# 此脚本用于启动 IOPaint REST API 服务（兼容旧版）
# ============================================================
set -e

MODEL_DIR="${IOPAINT_MODEL_DIR:-./models/iopaint}"
PORT="${IOPAINT_PORT:-8080}"
DEVICE="${IOPAINT_DEVICE:-cpu}"
MODEL="${IOPAINT_MODEL:-lama}"

mkdir -p "$MODEL_DIR"

echo "启动 IOPaint 服务..."
echo "  模型: $MODEL"
echo "  模型目录: $MODEL_DIR"
echo "  端口: $PORT"
echo "  设备: $DEVICE"
echo ""
echo "可用模型: lama (默认) / anime-lama / zits / mat / fcf / ldm / manga / cv2"
echo ""
echo "注意：如使用 Python 子进程模式（推荐），无需启动此服务"
echo "  擦除: 自动调用 scripts/iopaint_erase.py"
echo "  去背景: 自动调用 scripts/iopaint_removebg.py"

iopaint start \
  --model="$MODEL" \
  --device="$DEVICE" \
  --port="$PORT" \
  --model-dir="$MODEL_DIR"

#!/usr/bin/env bash
# ============================================================
# Real-ESRGAN ONNX 模型下载脚本（CPU 无损放大）
# 模型: realesrgan-x4plus.onnx (~64MB)
# 目录: /space/upscayl-models（持久化）或项目 onnx-models
# ============================================================
set -e

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if [ -n "${UPSCAYL_MODELS_DIR}" ]; then
  MODEL_DIR="${UPSCAYL_MODELS_DIR}"
elif [ -d "/space/upscayl-models" ]; then
  MODEL_DIR="/space/upscayl-models"
else
  MODEL_DIR="${ONNX_MODELS_DIR:-$PROJECT_ROOT/onnx-models}"
fi

mkdir -p "$MODEL_DIR"

GH_PROXY="${GH_PROXY:-https://gh-proxy.com/}"
MODEL_FILE="realesrgan-x4plus.onnx"
TARGET="$MODEL_DIR/$MODEL_FILE"

echo "============================================"
echo " Real-ESRGAN ONNX 模型下载"
echo " 目标目录: $MODEL_DIR"
echo "============================================"

if [ -f "$TARGET" ] && [ "$(stat -c%s "$TARGET" 2>/dev/null || echo 0)" -gt 10000000 ]; then
  echo "[就绪] $MODEL_FILE: $(du -h "$TARGET" | cut -f1)"
  exit 0
fi

URLS=(
  "https://huggingface.co/fernandotonon/QtMeshEditor-realesrgan-onnx/resolve/main/RealESRGAN_x4plus.onnx"
  "https://hf-mirror.com/fernandotonon/QtMeshEditor-realesrgan-onnx/resolve/main/RealESRGAN_x4plus.onnx"
)

for url in "${URLS[@]}"; do
  echo "  尝试: $url"
  if curl -L --max-time 600 --progress-bar -o "$TARGET" "$url"; then
    SIZE=$(stat -c%s "$TARGET" 2>/dev/null || echo 0)
    if [ "$SIZE" -gt 10000000 ]; then
      echo "[OK] $MODEL_FILE 下载完成: $(du -h "$TARGET" | cut -f1)"
      exit 0
    fi
    echo "[WARN] 下载文件过小 (${SIZE} bytes)，删除重试"
    rm -f "$TARGET"
  fi
done

echo "[FAIL] $MODEL_FILE 自动下载失败，请手动下载到: $TARGET"
exit 1

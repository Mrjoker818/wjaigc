#!/bin/bash
# Download RemoveBG ONNX models for IOPaint
# 3 models (精简版): birefnet-general-lite, u2netp, silueta
# Total: ~274MB

set -e

# ─── 持久化目录策略 ─────────────────────────────────────
# 优先使用 /space/removebg-models (S3 持久存储)
# 回退到项目 models/removebg 目录
if [ -d "/space/removebg-models" ]; then
  MODEL_DIR="/space/removebg-models"
else
  MODEL_DIR="${REMOVEBG_MODELS_DIR:-$(cd "$(dirname "$0")/.." && pwd)/models/removebg}"
fi

# Model definitions: name | filename | url | md5 | size
MODELS=(
  "birefnet-general-lite|birefnet-general-lite.onnx|https://github.com/danielgatis/rembg/releases/download/v0.0.0/BiRefNet-general-bb_swin_v1_tiny-epoch_232.onnx|4fab47adc4ff364be1713e97b7e66334|224MB"
  "u2netp|u2netp.onnx|https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2netp.onnx|8e83ca70e441ab06c318d82300c84806|4.5MB"
  "silueta|silueta.onnx|https://github.com/danielgatis/rembg/releases/download/v0.0.0/silueta.onnx|55e59e0d8062d2f5d013f4725ee84782|45MB"
)

mkdir -p "$MODEL_DIR"

echo "============================================"
echo "  RemoveBG 模型下载脚本 (精简版 3 模型)"
echo "  目标目录: $MODEL_DIR"
echo "============================================"
echo ""

for model_def in "${MODELS[@]}"; do
  IFS='|' read -r name filename url md5 expected_size <<< "$model_def"
  target="$MODEL_DIR/$filename"

  echo "--- $name ($expected_size) ---"
  echo "  文件: $filename"

  # Check if already exists and MD5 matches
  if [ -f "$target" ]; then
    current_md5=$(md5sum "$target" | awk '{print $1}')
    if [ "$current_md5" = "$md5" ]; then
      echo "  ✅ 已存在且 MD5 校验通过，跳过"
      continue
    else
      echo "  ⚠️  已存在但 MD5 不匹配，重新下载"
      rm -f "$target"
    fi
  fi

  # Download with resume support
  echo "  下载中..."
  curl -L -C - -o "$target" "$url" --progress-bar

  # Verify MD5
  if [ -f "$target" ]; then
    actual_md5=$(md5sum "$target" | awk '{print $1}')
    if [ "$actual_md5" = "$md5" ]; then
      echo "  ✅ 下载完成，MD5 校验通过"
    else
      echo "  ❌ MD5 校验失败!"
      echo "     期望: $md5"
      echo "     实际: $actual_md5"
    fi
  else
    echo "  ❌ 下载失败"
  fi
  echo ""
done

echo "============================================"
echo "  下载完成"
echo "============================================"
echo ""
echo "模型列表:"
for model_def in "${MODELS[@]}"; do
  IFS='|' read -r name filename url md5 expected_size <<< "$model_def"
  target="$MODEL_DIR/$filename"
  if [ -f "$target" ]; then
    actual_md5=$(md5sum "$target" | awk '{print $1}')
    status="✅"
    [ "$actual_md5" != "$md5" ] && status="❌ MD5不匹配"
    echo "  $status $name ($filename) - $(ls -lh "$target" | awk '{print $5}')"
  else
    echo "  ❌ $name ($filename) - 未下载"
  fi
done

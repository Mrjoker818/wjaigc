#!/usr/bin/env bash
# ============================================================
# IOPaint RemoveBG 模型下载脚本
# 模型存放路径: /root/.cache/torch/hub/checkpoints/
# 与擦除模型 (LaMa/ZITS/Anime-Lama) 放在同一目录
# ============================================================

set -e

MODEL_DIR="/root/.cache/torch/hub/checkpoints"
mkdir -p "$MODEL_DIR"

# 颜色定义
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

# 模型定义: 文件名|URL|MD5|大小描述
# BiRefNet 系列 (通过 rembg 使用)
# BriaAI 系列 (通过 rembg ONNX + PyTorch 双模式)
# rembg 经典系列

MODELS=(
  # BiRefNet 系列 — 推荐
  "birefnet-general-lite.onnx|https://github.com/danielgatis/rembg/releases/download/v0.0.0/BiRefNet-general-bb_swin_v1_tiny-epoch_232.onnx|4fab47adc4ff364be1713e97b7e66334|224MB|BiRefNet通用轻量(推荐默认)"
  "birefnet-general.onnx|https://github.com/danielgatis/rembg/releases/download/v0.0.0/BiRefNet-general-epoch_244.onnx|7a35a0141cbbc80de11d9c9a28f52697|537MB|BiRefNet通用高精度"
  "birefnet-portrait.onnx|https://github.com/danielgatis/rembg/releases/download/v0.0.0/BiRefNet-portrait-epoch_150.onnx|c3a64a6abf20250d090cd055f12a3b67|537MB|BiRefNet人像专用"
  "birefnet-dis.onnx|https://github.com/danielgatis/rembg/releases/download/v0.0.0/BiRefNet-DIS-epoch_590.onnx|2d4d44102b446f33a4ebb2e56c051f2b|537MB|BiRefNet显著性检测"
  "birefnet-hrsod.onnx|https://github.com/danielgatis/rembg/releases/download/v0.0.0/BiRefNet-HRSOD_DHU-epoch_115.onnx|c017ade5de8a50ff0fd74d790d268dda|537MB|BiRefNet高精度"
  "birefnet-cod.onnx|https://github.com/danielgatis/rembg/releases/download/v0.0.0/BiRefNet-COD-epoch_125.onnx|f6d0d21ca89d287f17e7afe9f5fd3b45|537MB|BiRefNet伪装目标检测"
  "birefnet-massive.onnx|https://github.com/danielgatis/rembg/releases/download/v0.0.0/BiRefNet-massive-TR_DIS5K_TR_TEs-epoch_420.onnx|33e726a2136a3d59eb0fdf613e31e3e9|537MB|BiRefNet大规模"

  # BriaAI 系列 — 商用级 (ONNX 模式 + PyTorch 模式)
  "bria-rmbg.onnx|https://github.com/danielgatis/rembg/releases/download/v0.0.0/bria-rmbg-2.0.onnx|sha256:5b486f08200f513f460da46dd701db5fbb47d79b4be4b708a19444bcd4e79958|326MB|BriaAI RMBG-2.0商用级(ONNX)"

  # rembg 经典系列
  "u2net.onnx|https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2net.onnx|60024c5c889badc19c04ad937298a77b|176MB|U2Net通用去背景"
  "u2netp.onnx|https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2netp.onnx|8e83ca70e441ab06c318d82300c84806|4.5MB|U2Net轻量快速"
  "u2net_human_seg.onnx|https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2net_human_seg.onnx|c09ddc2e0104f800e3e1bb4652583d1f|176MB|U2Net人体分割"
  "u2net_cloth_seg.onnx|https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2net_cloth_seg.onnx|2434d1f3cb744e0e49386c906e5a08bb|176MB|U2Net衣服分割"
  "silueta.onnx|https://github.com/danielgatis/rembg/releases/download/v0.0.0/silueta.onnx|55e59e0d8062d2f5d013f4725ee84782|45MB|Silueta轻量去背景"
  "isnet-general-use.onnx|https://github.com/danielgatis/rembg/releases/download/v0.0.0/isnet-general-use.onnx|fc16ebd8b0c10d971d3513d564d01e29|176MB|ISNet通用高精度"
)

# PyTorch 模型 (BriaAI RMBG-1.4, 通过 huggingface_hub 下载)
# 这个模型不通过本脚本下载，首次使用时由 iopaint 自动从 HuggingFace 下载
PYTORCH_MODELS=(
  "briaai/RMBG-1.4 model.pth|HuggingFace|BriaAI RMBG-1.4 商用级(PyTorch,首次使用自动下载)"
  "briaai/RMBG-2.0 pytorch|HuggingFace|BriaAI RMBG-2.0 商用级(PyTorch,首次使用自动下载)"
)

echo "============================================================"
echo "  IOPaint RemoveBG 模型下载工具"
echo "  模型存放路径: $MODEL_DIR"
echo "============================================================"
echo ""

# 参数处理
SPECIFIC_MODEL="${1:-}"
if [ -n "$SPECIFIC_MODEL" ]; then
  echo -e "${YELLOW}仅下载: $SPECIFIC_MODEL${NC}"
  echo ""
fi

# 统计
TOTAL=0
EXISTING=0
DOWNLOADED=0
FAILED=0

for entry in "${MODELS[@]}"; do
  IFS='|' read -r fname url md5 size desc <<< "$entry"

  # 如果指定了特定模型，只下载匹配的
  if [ -n "$SPECIFIC_MODEL" ] && [[ "$fname" != *"$SPECIFIC_MODEL"* ]]; then
    continue
  fi

  TOTAL=$((TOTAL + 1))
  target="$MODEL_DIR/$fname"

  # 检查文件是否已存在且 MD5 匹配
  if [ -f "$target" ]; then
    if echo "$md5" | grep -q "^sha256:"; then
      # SHA256 校验
      expected_sha=$(echo "$md5" | sed 's/sha256://')
      actual_sha=$(sha256sum "$target" | awk '{print $1}')
      if [ "$actual_sha" = "$expected_sha" ]; then
        echo -e "${GREEN}✅ $fname${NC} — 已存在且校验通过 ($desc)"
        EXISTING=$((EXISTING + 1))
        continue
      fi
    else
      # MD5 校验
      actual_md5=$(md5sum "$target" | awk '{print $1}')
      if [ "$actual_md5" = "$md5" ]; then
        echo -e "${GREEN}✅ $fname${NC} — 已存在且校验通过 ($desc)"
        EXISTING=$((EXISTING + 1))
        continue
      fi
    fi
    echo -e "${YELLOW}⚠️  $fname${NC} — 已存在但校验不匹配，重新下载"
    rm -f "$target"
  fi

  echo -e "${YELLOW}⬇️  下载 $fname${NC} ($size, $desc)..."
  echo "   URL: $url"

  # 使用 curl 下载（支持断点续传）
  if curl -L -C - -o "$target" "$url" 2>&1; then
    # 下载后校验
    if echo "$md5" | grep -q "^sha256:"; then
      expected_sha=$(echo "$md5" | sed 's/sha256://')
      actual_sha=$(sha256sum "$target" | awk '{print $1}')
      if [ "$actual_sha" = "$expected_sha" ]; then
        echo -e "${GREEN}✅ $fname${NC} — 下载完成且校验通过"
        DOWNLOADED=$((DOWNLOADED + 1))
      else
        echo -e "${RED}❌ $fname${NC} — 下载完成但校验失败 (SHA256 不匹配)"
        FAILED=$((FAILED + 1))
      fi
    else
      actual_md5=$(md5sum "$target" | awk '{print $1}')
      if [ "$actual_md5" = "$md5" ]; then
        echo -e "${GREEN}✅ $fname${NC} — 下载完成且校验通过"
        DOWNLOADED=$((DOWNLOADED + 1))
      else
        echo -e "${RED}❌ $fname${NC} — 下载完成但校验失败 (期望: $md5, 实际: $actual_md5)"
        FAILED=$((FAILED + 1))
      fi
    fi
  else
    echo -e "${RED}❌ $fname${NC} — 下载失败"
    rm -f "$target"
    FAILED=$((FAILED + 1))
  fi
  echo ""
done

# PyTorch 模型提示
echo "============================================================"
echo "  PyTorch 模型 (首次使用时自动从 HuggingFace 下载)"
echo "============================================================"
for entry in "${PYTORCH_MODELS[@]}"; do
  IFS='|' read -r fname source desc <<< "$entry"
  echo -e "  ${YELLOW}⏳ $fname${NC} — $desc ($source)"
done
echo ""

# 汇总
echo "============================================================"
echo "  下载汇总"
echo "============================================================"
echo "  总计: $TOTAL 个模型"
echo -e "  ${GREEN}已存在: $EXISTING${NC}"
echo -e "  ${YELLOW}新下载: $DOWNLOADED${NC}"
if [ "$FAILED" -gt 0 ]; then
  echo -e "  ${RED}失败: $FAILED${NC}"
fi
echo ""
echo "  提示: 也可以通过文件目录上传模型文件到 models/removebg/"
echo "  然后执行: cp models/removebg/*.onnx $MODEL_DIR/"
echo "============================================================"

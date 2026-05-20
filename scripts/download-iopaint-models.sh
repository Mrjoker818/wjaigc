#!/usr/bin/env bash
# ============================================================
# 下载 IOPaint 所需模型文件
# 用法: bash scripts/download-iopaint-models.sh
# ============================================================
set -e

MODEL_DIR="${IOPAINT_MODEL_DIR:-./models/iopaint}"
LAMA_CHECKPOINT="${HOME}/.cache/torch/hub/checkpoints/big-lama.pt"

echo "============================================"
echo " IOPaint 模型下载工具"
echo "============================================"

# 1. 下载 LaMa 擦除模型
if [ -f "$LAMA_CHECKPOINT" ] && [ "$(stat -c%s "$LAMA_CHECKPOINT" 2>/dev/null || echo 0)" -gt 1000000 ]; then
    echo "[OK] LaMa 模型已存在: $LAMA_CHECKPOINT ($(du -h "$LAMA_CHECKPOINT" | cut -f1))"
else
    echo "[下载] LaMa 擦除模型 (big-lama.pt, ~200MB)..."
    mkdir -p "$(dirname "$LAMA_CHECKPOINT")"
    
    # 尝试多个下载源
    URLS=(
        "https://huggingface.co/datasets/sancker/big-lama/resolve/main/big-lama.pt"
        "https://hf-mirror.com/datasets/sancker/big-lama/resolve/main/big-lama.pt"
    )
    
    DOWNLOADED=false
    for url in "${URLS[@]}"; do
        echo "  尝试: $url"
        if curl -L --max-time 600 --progress-bar -o "$LAMA_CHECKPOINT" "$url" 2>&1; then
            SIZE=$(stat -c%s "$LAMA_CHECKPOINT" 2>/dev/null || echo 0)
            if [ "$SIZE" -gt 1000000 ]; then
                echo "[OK] LaMa 模型下载完成: $(du -h "$LAMA_CHECKPOINT" | cut -f1)"
                DOWNLOADED=true
                break
            else
                echo "[WARN] 下载文件过小 (${SIZE} bytes)，可能不完整，删除重试"
                rm -f "$LAMA_CHECKPOINT"
            fi
        fi
    done
    
    if [ "$DOWNLOADED" = false ]; then
        echo "[FAIL] LaMa 模型自动下载失败"
        echo "  请手动下载 big-lama.pt 并放置到: $LAMA_CHECKPOINT"
        echo "  下载地址: https://huggingface.co/datasets/sancker/big-lama"
    fi
fi

# 2. 验证模型
echo ""
echo "============================================"
echo " 模型验证"
echo "============================================"

if [ -f "$LAMA_CHECKPOINT" ] && [ "$(stat -c%s "$LAMA_CHECKPOINT" 2>/dev/null || echo 0)" -gt 1000000 ]; then
    echo "LaMa 擦除模型: [就绪]"
else
    echo "LaMa 擦除模型: [缺失] - 擦除功能将使用 AI API 兜底"
fi

echo ""
echo "RemoveBG 去背景模型: 首次使用时自动下载 (rembg/u2net)"
echo "  - 模型会缓存到 ~/.u2net/ 目录"
echo ""
echo "============================================"
echo " 下载完成！启动 IOPaint 服务后即可使用本地擦除和去背景功能"
echo " 启动命令: bash scripts/start-iopaint-lama.sh"
echo "============================================"

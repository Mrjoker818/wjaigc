#!/usr/bin/env bash
# ============================================================
# 下载 IOPaint 所需模型文件
# 用法: bash scripts/download-iopaint-models.sh [模型名]
# 模型名: lama / anime-lama / zits / all (默认all)
# ============================================================
set -e

MODEL_DIR="${IOPAINT_MODEL_DIR:-./models/iopaint}"
CHECKPOINT_DIR="${HOME}/.cache/torch/hub/checkpoints"
DOWNLOAD_MODEL="${1:-all}"

echo "============================================"
echo " IOPaint 模型下载工具"
echo " 下载范围: $DOWNLOAD_MODEL"
echo "============================================"

mkdir -p "$CHECKPOINT_DIR"

# --- 下载函数 ---
download_with_fallback() {
    local name="$1"
    local dest="$2"
    shift 2
    local urls=("$@")
    
    if [ -f "$dest" ] && [ "$(stat -c%s "$dest" 2>/dev/null || echo 0)" -gt 100000 ]; then
        echo "[OK] $name 已存在: $dest ($(du -h "$dest" | cut -f1))"
        return 0
    fi
    
    echo "[下载] $name..."
    mkdir -p "$(dirname "$dest")"
    
    local DOWNLOADED=false
    for url in "${urls[@]}"; do
        echo "  尝试: $url"
        if curl -L --max-time 600 --progress-bar -o "$dest" "$url" 2>&1; then
            SIZE=$(stat -c%s "$dest" 2>/dev/null || echo 0)
            if [ "$SIZE" -gt 100000 ]; then
                echo "[OK] $name 下载完成: $(du -h "$dest" | cut -f1)"
                DOWNLOADED=true
                break
            else
                echo "[WARN] 下载文件过小 (${SIZE} bytes)，可能不完整，删除重试"
                rm -f "$dest"
            fi
        fi
    done
    
    if [ "$DOWNLOADED" = false ]; then
        echo "[FAIL] $name 自动下载失败"
        echo "  请手动下载并放置到: $dest"
        return 1
    fi
    return 0
}

# --- 1. LaMa 擦除模型 (~200MB) ---
if [ "$DOWNLOAD_MODEL" = "all" ] || [ "$DOWNLOAD_MODEL" = "lama" ]; then
    echo ""
    echo "--- LaMa 擦除模型 ---"
    download_with_fallback \
        "LaMa 擦除模型 (big-lama.pt)" \
        "$CHECKPOINT_DIR/big-lama.pt" \
        "https://github.com/Sanster/models/releases/download/add_big_lama/big-lama.pt" \
        "https://huggingface.co/datasets/sancker/big-lama/resolve/main/big-lama.pt" \
        "https://hf-mirror.com/datasets/sancker/big-lama/resolve/main/big-lama.pt"
fi

# --- 2. Anime-Lama 擦除模型 (~200MB, 动漫专用) ---
if [ "$DOWNLOAD_MODEL" = "all" ] || [ "$DOWNLOAD_MODEL" = "anime-lama" ]; then
    echo ""
    echo "--- Anime-Lama 动漫擦除模型 ---"
    download_with_fallback \
        "Anime-Lama 动漫擦除模型 (anime-manga-big-lama.pt)" \
        "$CHECKPOINT_DIR/anime-manga-big-lama.pt" \
        "https://github.com/Sanster/models/releases/download/AnimeMangaInpainting/anime-manga-big-lama.pt"
fi

# --- 3. ZITS 擦除模型 (4个文件, 结构感知修复) ---
if [ "$DOWNLOAD_MODEL" = "all" ] || [ "$DOWNLOAD_MODEL" = "zits" ]; then
    echo ""
    echo "--- ZITS 结构感知修复模型 (4个文件) ---"
    
    download_with_fallback \
        "ZITS 线框模型 (zits-wireframe)" \
        "$CHECKPOINT_DIR/zits-wireframe-0717.pt" \
        "https://github.com/Sanster/models/releases/download/add_zits/zits-wireframe-0717.pt"
    
    download_with_fallback \
        "ZITS 边缘线模型 (zits-edge-line)" \
        "$CHECKPOINT_DIR/zits-edge-line-0717.pt" \
        "https://github.com/Sanster/models/releases/download/add_zits/zits-edge-line-0717.pt"
    
    download_with_fallback \
        "ZITS 结构上采样模型 (zits-structure-upsample)" \
        "$CHECKPOINT_DIR/zits-structure-upsample-0717.pt" \
        "https://github.com/Sanster/models/releases/download/add_zits/zits-structure-upsample-0717.pt"
    
    download_with_fallback \
        "ZITS 修复模型 (zits-inpaint)" \
        "$CHECKPOINT_DIR/zits-inpaint-0717.pt" \
        "https://github.com/Sanster/models/releases/download/add_zits/zits-inpaint-0717.pt"
fi

# --- 验证 ---
echo ""
echo "============================================"
echo " 模型验证"
echo "============================================"

check_model() {
    local name="$1"
    local path="$2"
    local min_size="${3:-100000}"
    
    if [ -f "$path" ] && [ "$(stat -c%s "$path" 2>/dev/null || echo 0)" -gt "$min_size" ]; then
        echo "$name: [就绪] $(du -h "$path" | cut -f1)"
    else
        echo "$name: [缺失] - 将使用 AI API 兜底"
    fi
}

check_model "LaMa 擦除" "$CHECKPOINT_DIR/big-lama.pt" 1000000
check_model "Anime-Lama 动漫擦除" "$CHECKPOINT_DIR/anime-manga-big-lama.pt" 1000000
check_model "ZITS 线框" "$CHECKPOINT_DIR/zits-wireframe-0717.pt" 100000
check_model "ZITS 边缘线" "$CHECKPOINT_DIR/zits-edge-line-0717.pt" 100000
check_model "ZITS 结构上采样" "$CHECKPOINT_DIR/zits-structure-upsample-0717.pt" 100000
check_model "ZITS 修复" "$CHECKPOINT_DIR/zits-inpaint-0717.pt" 100000

echo ""
echo "RemoveBG 去背景模型: 首次使用时自动下载 (默认 birefnet-general-lite)"
echo "  - rembg 系列模型缓存到 ~/.u2net/ 目录"
echo "  - briaai 系列模型由 IOPaint 自动管理"
echo ""
echo "============================================"
echo " 下载完成！"
echo " 可选下载: bash scripts/download-iopaint-models.sh lama"
echo "           bash scripts/download-iopaint-models.sh anime-lama"
echo "           bash scripts/download-iopaint-models.sh zits"
echo "           bash scripts/download-iopaint-models.sh all"
echo "============================================"

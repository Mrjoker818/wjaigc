#!/usr/bin/env bash
# ============================================================
# IOPaint + RemoveBG 模型自动检查与下载脚本
# 用法: bash scripts/ensure-models.sh [选项]
# 选项:
#   --check   仅检查，不下载 (默认)
#   --download 检查并下载缺失模型
#   --force   强制重新下载所有模型
#
# 模型存储在项目持久化目录，不受沙箱重启影响:
#   IOPaint:  <PROJECT_ROOT>/models/iopaint/
#   RemoveBG: <PROJECT_ROOT>/models/removebg/
# ============================================================
# 不使用 set -e，因为个别模型缺失不应终止整个脚本

# 项目根目录
PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
IOPAINT_DIR="${IOPAINT_MODELS_DIR:-$PROJECT_ROOT/models/iopaint}"
REMOVEBG_DIR="${REMOVEBG_MODELS_DIR:-$PROJECT_ROOT/models/removebg}"

ACTION="${1:---check}"

# GitHub 下载加速镜像 (ghproxy.cc SSL 过期，使用 ghfast.top)
GH_PROXY="${GH_PROXY:-https://gh-proxy.com/}"

echo "============================================"
echo " IOPaint + RemoveBG 模型检查工具"
echo " IOPaint 目录: $IOPAINT_DIR"
echo " RemoveBG 目录: $REMOVEBG_DIR"
echo " 操作: $ACTION"
echo "============================================"

mkdir -p "$IOPAINT_DIR" "$REMOVEBG_DIR"

# --- 下载函数 ---
# 返回 0=就绪/下载成功, 1=缺失/下载失败 (不触发 set -e)
download_with_fallback() {
    local name="$1"
    local dest="$2"
    local min_size="${3:-1000000}"
    shift 3
    local urls=("$@")
    
    # 检查文件是否存在且有效
    if [ -f "$dest" ] && [ "$(stat -c%s "$dest" 2>/dev/null || echo 0)" -gt "$min_size" ]; then
        echo "[就绪] $name: $(du -h "$dest" | cut -f1)"
        return 0
    fi

    # 如果只检查不下载，报告缺失
    if [ "$ACTION" = "--check" ]; then
        echo "[缺失] $name"
        return 1
    fi
    
    echo "[下载] $name..."
    mkdir -p "$(dirname "$dest")"
    
    local DOWNLOADED=false
    for url in "${urls[@]}"; do
        echo "  尝试: $url"
        if curl -L --max-time 600 --progress-bar -o "$dest" "$url" 2>&1; then
            SIZE=$(stat -c%s "$dest" 2>/dev/null || echo 0)
            if [ "$SIZE" -gt "$min_size" ]; then
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
        echo "[FAIL] $name 自动下载失败，请手动下载到: $dest"
        return 1
    fi
    return 0
}

# --- 如果是 --force，先删除已有模型 ---
if [ "$ACTION" = "--force" ]; then
    echo ""
    echo "--- 强制重新下载模式，删除已有模型文件 ---"
    rm -f "$IOPAINT_DIR"/big-lama.pt "$IOPAINT_DIR"/anime-manga-big-lama.pt
    rm -f "$IOPAINT_DIR"/zits-*.pt
    rm -f "$REMOVEBG_DIR"/*.onnx
    echo "已清理旧模型文件"
fi

# ============================================================
# IOPaint 擦除模型
# ============================================================
echo ""
echo "--- IOPaint 擦除模型 ---"

# 1. LaMa 擦除模型 (~200MB) - 必需
download_with_fallback \
    "LaMa 擦除模型 (big-lama.pt)" \
    "$IOPAINT_DIR/big-lama.pt" \
    1000000 \
    "https://github.com/Sanster/models/releases/download/add_big_lama/big-lama.pt" \
    "${GH_PROXY}https://github.com/Sanster/models/releases/download/add_big_lama/big-lama.pt" \
    "https://huggingface.co/datasets/sancker/big-lama/resolve/main/big-lama.pt" \
    "https://hf-mirror.com/datasets/sancker/big-lama/resolve/main/big-lama.pt"

# 2. Anime-Lama 动漫擦除模型 (~200MB) - 可选
download_with_fallback \
    "Anime-Lama 动漫擦除 (anime-manga-big-lama.pt)" \
    "$IOPAINT_DIR/anime-manga-big-lama.pt" \
    1000000 \
    "https://github.com/Sanster/models/releases/download/AnimeMangaInpainting/anime-manga-big-lama.pt" \
    "${GH_PROXY}https://github.com/Sanster/models/releases/download/AnimeMangaInpainting/anime-manga-big-lama.pt"

# 3. ZITS 结构感知修复 (4个文件) - 可选
download_with_fallback \
    "ZITS 线框 (zits-wireframe)" \
    "$IOPAINT_DIR/zits-wireframe-0717.pt" \
    100000 \
    "https://github.com/Sanster/models/releases/download/add_zits/zits-wireframe-0717.pt" \
    "${GH_PROXY}https://github.com/Sanster/models/releases/download/add_zits/zits-wireframe-0717.pt"

download_with_fallback \
    "ZITS 边缘线 (zits-edge-line)" \
    "$IOPAINT_DIR/zits-edge-line-0717.pt" \
    100000 \
    "https://github.com/Sanster/models/releases/download/add_zits/zits-edge-line-0717.pt" \
    "${GH_PROXY}https://github.com/Sanster/models/releases/download/add_zits/zits-edge-line-0717.pt"

download_with_fallback \
    "ZITS 结构上采样 (zits-structure-upsample)" \
    "$IOPAINT_DIR/zits-structure-upsample-0717.pt" \
    100000 \
    "https://github.com/Sanster/models/releases/download/add_zits/zits-structure-upsample-0717.pt" \
    "${GH_PROXY}https://github.com/Sanster/models/releases/download/add_zits/zits-structure-upsample-0717.pt"

download_with_fallback \
    "ZITS 修复 (zits-inpaint)" \
    "$IOPAINT_DIR/zits-inpaint-0717.pt" \
    100000 \
    "https://github.com/Sanster/models/releases/download/add_zits/zits-inpaint-0717.pt" \
    "${GH_PROXY}https://github.com/Sanster/models/releases/download/add_zits/zits-inpaint-0717.pt"

# ============================================================
# RemoveBG 去背景模型
# ============================================================
echo ""
echo "--- RemoveBG 去背景模型 ---"

# u2netp (~4.5MB) - 轻量快速，精度较低
download_with_fallback \
    "U2NetP 轻量去背景 (u2netp.onnx)" \
    "$REMOVEBG_DIR/u2netp.onnx" \
    1000000 \
    "https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2netp.onnx" \
    "${GH_PROXY}https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2netp.onnx"

	# u2net (~176MB) - 推荐，精度最高
	download_with_fallback \
	    "U2Net 去背景 (u2net.onnx)" \
	    "$REMOVEBG_DIR/u2net.onnx" \
	    100000000 \
	    "https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2net.onnx" \
	    "${GH_PROXY}https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2net.onnx"

# silueta (~45MB) - 轻量人像
download_with_fallback \
    "Silueta 人像去背景 (silueta.onnx)" \
    "$REMOVEBG_DIR/silueta.onnx" \
    10000000 \
    "https://github.com/danielgatis/rembg/releases/download/v0.0.0/silueta.onnx" \
    "${GH_PROXY}https://github.com/danielgatis/rembg/releases/download/v0.0.0/silueta.onnx"


# ============================================================
# 迁移旧路径模型文件（如果存在）
# ============================================================
echo ""
echo "--- 检查旧路径模型文件 ---"

OLD_TORCH_CACHE="${HOME}/.cache/torch/hub/checkpoints"
OLD_U2NET_HOME="${HOME}/.u2net"

# 迁移 IOPaint 模型
if [ -d "$OLD_TORCH_CACHE" ]; then
    for f in big-lama.pt anime-manga-big-lama.pt zits-wireframe-0717.pt zits-edge-line-0717.pt zits-structure-upsample-0717.pt zits-inpaint-0717.pt; do
        src="$OLD_TORCH_CACHE/$f"
        dest="$IOPAINT_DIR/$f"
        if [ -f "$src" ] && [ "$(stat -c%s "$src" 2>/dev/null || echo 0)" -gt 100000 ] && [ ! -f "$dest" ]; then
            echo "[迁移] $f: 旧缓存 -> 持久化目录"
            cp "$src" "$dest"
        fi
    done
fi

# 迁移 RemoveBG 模型
if [ -d "$OLD_U2NET_HOME" ]; then
    for f in u2netp.onnx u2net.onnx silueta.onnx; do
        src="$OLD_U2NET_HOME/$f"
        dest="$REMOVEBG_DIR/$f"
        if [ -f "$src" ] && [ "$(stat -c%s "$src" 2>/dev/null || echo 0)" -gt 100000 ] && [ ! -f "$dest" ]; then
            echo "[迁移] $f: 旧缓存 -> 持久化目录"
            cp "$src" "$dest"
        fi
    done
fi

# ============================================================
# 创建 torch hub 兼容符号链接
# iopaint 的 get_cache_path_by_url 查找 TORCH_HOME/hub/checkpoints/<filename>
# ============================================================
echo ""
echo "--- 创建 torch hub 兼容符号链接 ---"

HUB_CKPT_DIR="$IOPAINT_DIR/hub/checkpoints"
mkdir -p "$HUB_CKPT_DIR"

for f in big-lama.pt anime-manga-big-lama.pt zits-wireframe-0717.pt zits-edge-line-0717.pt zits-structure-upsample-0717.pt zits-inpaint-0717.pt; do
    src="$IOPAINT_DIR/$f"
    dst="$HUB_CKPT_DIR/$f"
    if [ -f "$src" ] && [ ! -e "$dst" ]; then
        ln -sf "$src" "$dst"
        echo "[链接] $f -> hub/checkpoints/"
    fi
done

# RemoveBG 模型也需要链接到 hub/checkpoints/
# 因为 iopaint RemoveBG 插件设置 U2NET_HOME = TORCH_HOME/hub/checkpoints/
for f in u2netp.onnx u2net.onnx silueta.onnx; do
    src="$REMOVEBG_DIR/$f"
    dst="$HUB_CKPT_DIR/$f"
    if [ -f "$src" ] && [ ! -e "$dst" ]; then
        ln -sf "$src" "$dst"
        echo "[链接] $f -> hub/checkpoints/ (RemoveBG)"
    fi
done

# ============================================================
# 汇总
# ============================================================
echo ""
echo "============================================"
echo " 模型状态汇总"
echo "============================================"

check_status() {
    local name="$1"
    local path="$2"
    local min_size="${3:-1000000}"
    
    if [ -f "$path" ] && [ "$(stat -c%s "$path" 2>/dev/null || echo 0)" -gt "$min_size" ]; then
        echo "  [就绪] $name"
    else
        echo "  [缺失] $name - 将使用 AI API 兜底"
    fi
}

check_status "LaMa 擦除" "$IOPAINT_DIR/big-lama.pt" 1000000
check_status "Anime-Lama 动漫擦除" "$IOPAINT_DIR/anime-manga-big-lama.pt" 1000000
check_status "ZITS 结构修复" "$IOPAINT_DIR/zits-inpaint-0717.pt" 100000
check_status "U2NetP 去背景" "$REMOVEBG_DIR/u2netp.onnx" 1000000
check_status "U2Net 去背景" "$REMOVEBG_DIR/u2net.onnx" 100000000
check_status "Silueta 去背景" "$REMOVEBG_DIR/silueta.onnx" 10000000

echo ""
echo "模型目录:"
echo "  IOPaint:  $IOPAINT_DIR"
echo "  RemoveBG: $REMOVEBG_DIR"
echo ""
echo "提示:"
echo "  检查: bash scripts/ensure-models.sh --check"
echo "  下载: bash scripts/ensure-models.sh --download"
echo "  强制: bash scripts/ensure-models.sh --force"
echo "============================================"

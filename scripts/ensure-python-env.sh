#!/bin/bash
# ============================================================
# ensure-python-env.sh — 自动检查和恢复 Python AI 环境
#
# 策略：检查 /space 持久存储和系统 Python 环境，
# 按需安装缺失的依赖，确保本地 AI 功能可用
#
# 调用方式：
#   bash scripts/ensure-python-env.sh         # 检查并安装
#   bash scripts/ensure-python-env.sh --check  # 仅检查
# ============================================================

set -e

MODE="${1:---install}"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0n'

log_info()  { echo -e "${GREEN}[PYTHON-ENV]${NC} $1"; }
log_warn()  { echo -e "${YELLOW}[PYTHON-ENV]${NC} $1"; }
log_error() { echo -e "${RED}[PYTHON-ENV]${NC} $1"; }

# ─── 检查函数 ──────────────────────────────────────────

check_system_python() {
  python3 -c "import torch; import iopaint; import rembg" 2>/dev/null
}

check_space_venv() {
  [ -x "/space/python-venv/bin/python3" ] && \
  /space/python-venv/bin/python3 -c "import torch; import iopaint; import rembg" 2>/dev/null
}

check_models() {
  local iopaint_dir="/space/iopaint-models"
  local removebg_dir="/space/removebg-models"
  
  # 回退到项目目录
  [ -d "$iopaint_dir" ] || iopaint_dir="${COZE_WORKSPACE_PATH:-/workspace/projects}/models/iopaint"
  [ -d "$removebg_dir" ] || removebg_dir="${COZE_WORKSPACE_PATH:-/workspace/projects}/models/removebg"
  
  local missing=0
  [ -f "$iopaint_dir/big-lama.pt" ] || { log_warn "LaMa 模型缺失: $iopaint_dir/big-lama.pt"; missing=$((missing+1)); }
  [ -f "$removebg_dir/u2net.onnx" ] || { log_warn "U2Net 模型缺失: $removebg_dir/u2net.onnx"; missing=$((missing+1)); }
  
  return $missing
}

# ─── 安装函数（最小化，仅安装缺失的关键依赖） ──────────

install_minimal_deps() {
  log_info "安装最小 Python AI 依赖..."
  
  # 使用 pip3 直接安装到系统 site-packages（最快，跳过 venv 开销）
  pip3 install --no-cache-dir --quiet \
    torch torchvision --index-url https://download.pytorch.org/whl/cpu 2>/dev/null || \
  pip3 install --no-cache-dir --quiet torch torchvision 2>/dev/null || \
  log_warn "torch 安装失败"
  
  pip3 install --no-cache-dir --quiet \
    opencv-python-headless onnxruntime loguru scipy scikit-image \
    pillow huggingface_hub transformers 2>/dev/null || \
  log_warn "核心依赖安装部分失败"
  
  # iopaint 使用 --no-deps 避免拉取 diffusers/gradio 等大依赖
  pip3 install --no-cache-dir --quiet --no-deps iopaint 2>/dev/null || \
  log_warn "iopaint 安装失败"
  
  # rembg
  pip3 install --no-cache-dir --quiet rembg 2>/dev/null || \
  log_warn "rembg 安装失败"
  
  # 补丁 iopaint 懒加载（避免 diffusers 导入报错）
  local site_packages=$(python3 -c "import site; print(site.getsitepackages()[0])")
  local init_file="$site_packages/iopaint/model/__init__.py"
  if [ -f "$init_file" ] && ! grep -q "__getattr__" "$init_file" 2>/dev/null; then
    python3 << 'PYEOF'
import site
sp = site.getsitepackages()[0]
init_path = f"{sp}/iopaint/model/__init__.py"
with open(init_path, 'w') as f:
    f.write("""import importlib

_LAZY_MODELS = {
    "LaMa": "iopaint.model.lama",
    "MAT": "iopaint.model.mat",
    "ZITS": "iopaint.model.zits",
    "MAE": "iopaint.model.mae",
    "FCF": "iopaint.model.fcf",
    "BrushNet": "iopaint.model.brushnet",
    "AnyText": "iopaint.model.anytext",
    "MI_GAN": "iopaint.model.mi_gan",
    "SD": "iopaint.model.sd",
    "SDXL": "iopaint.model.sdxl",
    "SDInpaint": "iopaint.model.sd_inpaint",
    "OpenPaint": "iopaint.model.openpaint",
    "InstructPix2Pix": "iopaint.model.instruct_pix2pix",
    "StableDiffusion": "iopaint.model.sd",
    "StableDiffusionXL": "iopaint.model.sdxl",
}

def __getattr__(name):
    if name in _LAZY_MODELS:
        module = importlib.import_module(_LAZY_MODELS[name])
        return getattr(module, name)
    raise AttributeError(f"module 'iopaint.model' has no attribute {name}")
""")
print("iopaint lazy-load patch applied")
PYEOF
    log_info "iopaint 懒加载补丁已应用"
  fi
}

# ─── 主流程 ──────────────────────────────────────────

echo "=== Python AI 环境检查 ==="

# 1. 检查 Python 环境
if check_system_python; then
  log_info "系统 Python 环境完整 (torch + iopaint + rembg)"
elif check_space_venv; then
  log_info "/space 持久 Python 环境完整"
else
  if [ "$MODE" = "--check" ]; then
    log_warn "Python AI 环境缺失 (torch/iopaint/rembg)"
    log_warn "运行 'bash scripts/ensure-python-env.sh' 安装"
    log_warn "或运行 'bash scripts/setup-venv.sh' 安装到持久虚拟环境"
  else
    log_warn "Python AI 环境缺失，开始安装..."
    install_minimal_deps
    
    # 验证安装
    if check_system_python; then
      log_info "Python AI 环境安装成功!"
    else
      log_error "Python AI 环境安装失败，本地 AI 功能将降级到 API 兜底"
    fi
  fi
fi

# 2. 检查模型文件
if check_models; then
  log_info "AI 模型文件就绪"
else
  if [ "$MODE" = "--check" ]; then
    log_warn "部分模型文件缺失，运行 'bash scripts/ensure-models.sh --download' 下载"
  else
    log_warn "部分模型文件缺失，尝试下载..."
    bash "$(dirname "$0")/ensure-models.sh" --download 2>/dev/null || \
    log_warn "模型下载失败，本地 AI 功能将降级到 API 兜底"
  fi
fi

echo "=== Python AI 环境检查完成 ==="

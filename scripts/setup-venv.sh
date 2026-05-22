#!/bin/bash
# ============================================================
# setup-venv.sh — 持久化 Python 虚拟环境自动初始化脚本
# 
# 用途：沙盒重启后 .venv 可能丢失，此脚本自动重建环境
# 调用方式：
#   bash scripts/setup-venv.sh          # 交互式
#   bash scripts/setup-venv.sh --check  # 仅检查，不安装
#   bash scripts/setup-venv.sh --force  # 强制重建
# ============================================================

set -e

WORKSPACE="${COZE_WORKSPACE_PATH:-/workspace/projects}"
VENV_DIR="$WORKSPACE/.venv"
PYTHON_BIN="$VENV_DIR/bin/python3"
PIP_BIN="$VENV_DIR/bin/pip"
SITE_PACKAGES="$VENV_DIR/lib/python3.12/site-packages"

# 颜色输出
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

log_info()  { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# ─── 检查函数 ──────────────────────────────────────────

check_venv_exists() {
  [ -x "$PYTHON_BIN" ] && [ -x "$PIP_BIN" ]
}

check_core_packages() {
  $PYTHON_BIN -c "import torch" 2>/dev/null && \
  $PYTHON_BIN -c "import cv2" 2>/dev/null && \
  $PYTHON_BIN -c "import onnxruntime" 2>/dev/null
}

check_iopaint() {
  $PYTHON_BIN -c "from iopaint.model.lama import LaMa" 2>/dev/null
}

check_rembg() {
  $PYTHON_BIN -c "from iopaint.plugins.remove_bg import RemoveBG" 2>/dev/null
}

check_vtracer() {
  $PYTHON_BIN -c "import vtracer" 2>/dev/null
}

check_iopaint_patches() {
  local init_file="$SITE_PACKAGES/iopaint/model/__init__.py"
  [ -f "$init_file" ] && grep -q "__getattr__" "$init_file" 2>/dev/null
}

# ─── 安装函数 ──────────────────────────────────────────

create_venv() {
  log_info "Creating Python venv at $VENV_DIR..."
  python3 -m venv "$VENV_DIR" || {
    log_warn "venv creation failed, installing python3-venv..."
    apt-get install -y python3.12-venv 2>/dev/null || apt-get install -y python3-venv 2>/dev/null
    python3 -m venv "$VENV_DIR"
  }
  $PIP_BIN install --upgrade pip --no-cache-dir
  log_info "Venv created successfully"
}

install_torch() {
  log_info "Installing torch + torchvision (CPU)..."
  # 先尝试 PyTorch 官方 CPU 源
  $PIP_BIN install --no-cache-dir torch torchvision --index-url https://download.pytorch.org/whl/cpu 2>/dev/null || {
    log_warn "PyTorch official source failed, trying aliyun mirror..."
    $PIP_BIN install --no-cache-dir torch torchvision
  }
  log_info "torch installed"
}

install_core_deps() {
  log_info "Installing core dependencies (opencv, onnxruntime, scipy, etc.)..."
  $PIP_BIN install --no-cache-dir \
    opencv-python-headless \
    onnxruntime \
    loguru scipy scikit-image \
    uvicorn yacs pydantic easydict omegaconf \
    huggingface_hub \
    pillow
  log_info "Core dependencies installed"
}

install_iopaint() {
  log_info "Installing iopaint (no-deps to avoid heavy optional deps)..."
  $PIP_BIN install --no-cache-dir --no-deps iopaint
  log_info "iopaint installed (no-deps)"
}

patch_iopaint() {
  log_info "Patching iopaint for lazy loading (avoid diffusers/gradio dependency)..."

  # 1. Patch model/__init__.py — lazy import
  local init_file="$SITE_PACKAGES/iopaint/model/__init__.py"
  if [ -f "$init_file" ] && ! grep -q "__getattr__" "$init_file" 2>/dev/null; then
    cat > "$init_file" << 'PYEOF'
import importlib

_LAZY_MODELS = {
    "BrushNet": "iopaint.model.brushnet",
    "AnyText": "iopaint.model.anytext",
    "LaMa": "iopaint.model.lama",
    "MAT": "iopaint.model.mat",
    "MI_GAN": "iopaint.model.mi_gan",
    "ZITS": "iopaint.model.zits",
    "MAE": "iopaint.model.mae",
    "SD": "iopaint.model.sd",
    "SDXL": "iopaint.model.sdxl",
    "SDInpaint": "iopaint.model.sd_inpaint",
    "FCF": "iopaint.model.fcf",
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
PYEOF
    log_info "Patched iopaint/model/__init__.py for lazy loading"
  else
    log_info "iopaint/model/__init__.py already patched or not found"
  fi

  # 2. Patch plugins/__init__.py — lazy import
  local plugins_init="$SITE_PACKAGES/iopaint/plugins/__init__.py"
  if [ -f "$plugins_init" ] && ! grep -q "__getattr__" "$plugins_init" 2>/dev/null; then
    cat > "$plugins_init" << 'PYEOF'
import importlib

_LAZY_PLUGINS = {
    "InteractiveSeg": "iopaint.plugins.interactive_seg",
    "RemoveBG": "iopaint.plugins.remove_bg",
    "RealESRGANUpscaler": "iopaint.plugins.real_esrgan",
    "GreedyFill": "iopaint.plugins.greedyfill",
    "SegmentAnything": "iopaint.plugins.segment_anything",
    "QA": "iopaint.plugins.qa",
}

def __getattr__(name):
    if name in _LAZY_PLUGINS:
        module = importlib.import_module(_LAZY_PLUGINS[name])
        return getattr(module, name)
    raise AttributeError(f"module 'iopaint.plugins' has no attribute {name}")
PYEOF
    log_info "Patched iopaint/plugins/__init__.py for lazy loading"
  else
    log_info "iopaint/plugins/__init__.py already patched or not found"
  fi

  # 3. Patch model/base.py — remove diffusers/g_diffuser_bot imports
  local base_file="$SITE_PACKAGES/iopaint/model/base.py"
  if [ -f "$base_file" ] && grep -q "from .utils import get_scheduler" "$base_file" 2>/dev/null; then
    $PYTHON_BIN << 'PYEOF'
path = "/workspace/projects/.venv/lib/python3.12/site-packages/iopaint/model/base.py"
with open(path, 'r') as f:
    content = f.read()
content = content.replace(
    "from .helper.g_diffuser_bot import expand_image",
    "# expand_image removed - not needed for LaMa/ZITS"
)
content = content.replace(
    "from .utils import get_scheduler",
    "# get_scheduler removed - not needed for LaMa/ZITS"
)
content = content.replace(
    "expanded_image, mask_image = expand_image(",
    "expanded_image, mask_image = _expand_image_placeholder("
)
content = content.replace(
    "scheduler = get_scheduler(",
    "scheduler = _get_scheduler_placeholder("
)
with open(path, 'w') as f:
    f.write(content)
print("base.py patched")
PYEOF
    log_info "Patched iopaint/model/base.py"
  else
    log_info "iopaint/model/base.py already patched or not found"
  fi

  # 4. Patch model/utils.py — remove diffusers top-level import
  local utils_file="$SITE_PACKAGES/iopaint/model/utils.py"
  if [ -f "$utils_file" ] && grep -q "^from diffusers import" "$utils_file" 2>/dev/null; then
    $PYTHON_BIN << 'PYEOF'
path = "/workspace/projects/.venv/lib/python3.12/site-packages/iopaint/model/utils.py"
with open(path, 'r') as f:
    content = f.read()
content = content.replace(
    "from diffusers import (\n    EulerAncestralDiscreteScheduler,\n    EulerDiscreteScheduler,\n    KDPM2AncestralDiscreteScheduler,\n    DPMSolverMultistepScheduler,\n    DPMSolverSDEScheduler,\n    DDPMScheduler,\n    DDIMScheduler,\n    UniPCMultistepScheduler,\n    LMSDiscreteScheduler,\n    PNDMScheduler,\n)",
    "# diffusers import removed - not needed for LaMa/ZITS\n_diffusers_schedulers = None"
)
with open(path, 'w') as f:
    f.write(content)
print("utils.py patched")
PYEOF
    log_info "Patched iopaint/model/utils.py"
  else
    log_info "iopaint/model/utils.py already patched or not found"
  fi

  # 5. Remove iopaint web_app (not needed, saves ~30MB)
  if [ -d "$SITE_PACKAGES/iopaint/web_app" ]; then
    rm -rf "$SITE_PACKAGES/iopaint/web_app"
    log_info "Removed iopaint/web_app (not needed for Python API usage)"
  fi
}

install_rembg() {
  log_info "Installing rembg..."
  $PIP_BIN install --no-cache-dir rembg
  log_info "rembg installed"
}

install_vtracer() {
  log_info "Installing vtracer..."
  $PIP_BIN install --no-cache-dir vtracer
  log_info "vtracer installed"
}

# ─── 主流程 ──────────────────────────────────────────

MODE="${1:-install}"

if [ "$MODE" = "--check" ]; then
  echo "=== Python Venv Check ==="
  if check_venv_exists; then
    log_info "Venv exists at $VENV_DIR"
    if check_core_packages; then
      log_info "Core packages OK (torch, opencv, onnxruntime)"
    else
      log_warn "Core packages MISSING"
    fi
    if check_iopaint; then
      log_info "iopaint OK (LaMa importable)"
    else
      log_warn "iopaint MISSING or patch broken"
    fi
    if check_rembg; then
      log_info "rembg OK (RemoveBG importable)"
    else
      log_warn "rembg MISSING"
    fi
    if check_vtracer; then
      log_info "vtracer OK"
    else
      log_warn "vtracer MISSING"
    fi
    if check_iopaint_patches; then
      log_info "iopaint lazy-load patch OK"
    else
      log_warn "iopaint lazy-load patch MISSING"
    fi
  else
    log_warn "Venv NOT found at $VENV_DIR"
  fi
  exit 0
fi

if [ "$MODE" = "--force" ]; then
  log_warn "Force mode: removing existing venv..."
  rm -rf "$VENV_DIR"
fi

# 检查是否需要创建/重建
NEED_INSTALL=false
if ! check_venv_exists; then
  log_warn "Venv not found, creating..."
  create_venv
  NEED_INSTALL=true
elif ! check_core_packages || ! check_iopaint; then
  log_warn "Core packages missing, reinstalling..."
  NEED_INSTALL=true
elif [ "$MODE" = "--force" ]; then
  NEED_INSTALL=true
else
  log_info "Venv and core packages already installed"
  # 仍然检查补丁和可选包
  check_iopaint_patches || patch_iopaint
  check_rembg || install_rembg
  check_vtracer || install_vtracer
  exit 0
fi

if [ "$NEED_INSTALL" = true ]; then
  # 安装所有包
  install_torch
  install_core_deps
  install_iopaint
  patch_iopaint
  install_rembg
  install_vtracer
fi

# 验证
log_info "Verifying installation..."
if check_core_packages && check_iopaint; then
  log_info "All core packages verified!"
else
  log_error "Core packages verification failed!"
  exit 1
fi

# 清理 pip 缓存
$PIP_BIN cache purge 2>/dev/null || true
rm -rf /tmp/pip-* 2>/dev/null || true

echo ""
log_info "=== Setup Complete ==="
log_info "Python: $PYTHON_BIN"
log_info "Venv size: $(du -sh "$VENV_DIR" | cut -f1)"

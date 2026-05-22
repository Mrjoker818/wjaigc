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
  $PYTHON_BIN -c "import iopaint" 2>/dev/null && \
  $PYTHON_BIN -c "import cv2" 2>/dev/null && \
  $PYTHON_BIN -c "import onnxruntime" 2>/dev/null
}

check_remBg() {
  $PYTHON_BIN -c "import rembg" 2>/dev/null
}

check_vtracer() {
  $PYTHON_BIN -c "import vtracer" 2>/dev/null
}

check_iopaint_patch() {
  # 检查 iopaint __init__.py 是否已被修补为懒加载
  local init_file="$VENV_DIR/lib/python3.12/site-packages/iopaint/model/__init__.py"
  if [ -f "$init_file" ]; then
    grep -q "def __getattr__" "$init_file" 2>/dev/null
  else
    return 1
  fi
}

# ─── 安装函数 ──────────────────────────────────────────

create_venv() {
  log_info "Creating Python venv at $VENV_DIR..."
  python3 -m venv "$VENV_DIR"
  $PIP_BIN install --upgrade pip --no-cache-dir
  log_info "Venv created successfully"
}

install_core_packages() {
  log_info "Installing core packages (torch, opencv, onnxruntime)..."
  $PIP_BIN install --no-cache-dir \
    torch torchvision --index-url https://download.pytorch.org/whl/cpu 2>/dev/null || \
  $PIP_BIN install --no-cache-dir torch torchvision

  $PIP_BIN install --no-cache-dir \
    opencv-python-headless \
    onnxruntime \
    loguru scipy scikit-image \
    uvicorn yacs pydantic easydict omegaconf \
    huggingface_hub \
    pillow
  log_info "Core packages installed"
}

install_iopaint() {
  log_info "Installing iopaint (no-deps)..."
  $PIP_BIN install --no-cache-dir --no-deps iopaint
  log_info "iopaint installed (no-deps)"
}

patch_iopaint() {
  log_info "Patching iopaint for lazy loading (avoid diffusers/gradio dependency)..."
  local init_file="$VENV_DIR/lib/python3.12/site-packages/iopaint/model/__init__.py"
  local base_file="$VENV_DIR/lib/python3.12/site-packages/iopaint/model/base.py"

  if [ -f "$init_file" ]; then
    if ! grep -q "__getattr__" "$init_file" 2>/dev/null; then
      cat > "$init_file" << 'PYEOF'
# Lazy loading — avoid importing heavy models (diffusers/gradio) unless needed
import importlib as _importlib

_MODEL_MAP = {
    "LaMa": ".lama:LaMa",
    "ZITS": ".zits:ZITS",
    "MAT": ".mat:MAT",
    "FcF": ".fcf:FcF",
    "Manga": ".manga:Manga",
    "AnyObject": ".anyobject:AnyObject",
    "RealESRGANUpscaler": ".real_esrgan:RealESRGANUpscaler",
    "SDInpaint": ".sd_sdnet:SDInpaint",
    "SDUpscaler": ".sd_sdnet:SDUpscaler",
    "StableDiffusion": ".sd_sdnet:StableDiffusion",
    "StableDiffusionXL": ".sdxl:StableDiffusionXL",
    "BrushNet": ".brushnet:BrushNet",
    "ControlNet": ".controlnet:ControlNet",
    "PowerPaint": ".powerpaint:PowerPaint",
    "AnyText": ".anytext:AnyText",
    "TextDim": ".textdim:TextDim",
}

def __getattr__(name):
    if name in _MODEL_MAP:
        module_path, cls_name = _MODEL_MAP[name].rsplit(":", 1)
        mod = _importlib.import_module(module_path, __package__)
        return getattr(mod, cls_name)
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")

def __dir__():
    return list(_MODEL_MAP.keys())
PYEOF
      log_info "Patched iopaint/model/__init__.py for lazy loading"
    else
      log_info "iopaint __init__.py already patched"
    fi
  fi

  if [ -f "$base_file" ]; then
    if ! grep -q "_get_scheduler\|_get_expand_image" "$base_file" 2>/dev/null; then
      # Replace imports
      sed -i 's/from .utils import get_scheduler/# get_scheduler lazy loaded/' "$base_file"
      sed -i 's/from .helper.g_diffuser_bot import expand_image/# expand_image lazy loaded/' "$base_file"
      # Add lazy functions
      if ! grep -q "def _get_scheduler" "$base_file"; then
        echo '
def _get_scheduler(*args, **kwargs):
    from .utils import get_scheduler
    return get_scheduler(*args, **kwargs)

def _get_expand_image()():
    from .helper.g_diffuser_bot import expand_image
    return expand_image
' >> "$base_file"
      fi
      # Replace direct calls
      sed -i 's/expanded_image, mask_image = expand_image(/expanded_image, mask_image = _get_expand_image()(/' "$base_file"
      sed -i 's/scheduler = get_scheduler(/scheduler = _get_scheduler(/' "$base_file"
      log_info "Patched iopaint/model/base.py for lazy imports"
    else
      log_info "iopaint base.py already patched"
    fi
  fi
}

install_remBg() {
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
      log_info "Core packages OK (torch, iopaint, opencv, onnxruntime)"
    else
      log_warn "Core packages MISSING"
    fi
    if check_remBg; then
      log_info "rembg OK"
    else
      log_warn "rembg MISSING"
    fi
    if check_vtracer; then
      log_info "vtracer OK"
    else
      log_warn "vtracer MISSING"
    fi
    if check_iopaint_patch; then
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
if ! check_venv_exists; then
  log_warn "Venv not found, creating..."
  create_venv
elif ! check_core_packages; then
  log_warn "Core packages missing, reinstalling..."
  # 不重建 venv，只重新安装包
elif [ "$MODE" = "--force" ]; then
  create_venv
else
  log_info "Venv and core packages already installed, nothing to do"
  # 仍然检查补丁
  check_iopaint_patch || patch_iopaint
  check_remBg || install_remBg
  check_vtracer || install_vtracer
  exit 0
fi

# 安装所有包
install_core_packages
install_iopaint
patch_iopaint
install_remBg
install_vtracer

# 验证
log_info "Verifying installation..."
if check_core_packages; then
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

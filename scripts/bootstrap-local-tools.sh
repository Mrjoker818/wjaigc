#!/bin/bash
# 本地 Python 工具依赖持久化引导脚本
# 因为沙箱系统盘 overlay 在实例重建后会重置，pip 装到系统路径会丢失
# 持久化策略：
#   1. 系统预装依赖（apt 装的 potrace 等）若丢失，脚本自动重装
#   2. pip 包装到持久化目录 /space/python-libs，通过 PYTHONPATH 挂载
#   3. 模型文件存放在 /space/iopaint-models /space/removebg-models /space/onnx-models（这些目录天然持久化）
#
# 此脚本在 dev server 启动前被 .coze 调用，确保运行时依赖就绪

set -e

SPACE_DIR="/space"
PY_LIBS_DIR="$SPACE_DIR/python-libs"
MARKER_FILE="$PY_LIBS_DIR/.bootstrap-ok-v2"
LOG_FILE="/tmp/bootstrap-python-tools.log"

# 镜像源（国内加速）
PIP_INDEX="https://pypi.tuna.tsinghua.edu.cn/simple"

log() { echo "[$(date +%H:%M:%S)] $*" | tee -a "$LOG_FILE"; }

mkdir -p "$PY_LIBS_DIR"

# 1) 系统级依赖 (apt 装到系统盘会丢，每次启动检测并重装)
if ! command -v potrace >/dev/null 2>&1; then
  log "potrace 未安装，尝试 apt 安装..."
  (apt-get update -qq && apt-get install -y -qq potrace 2>&1 | tail -3) >> "$LOG_FILE" || log "  apt 安装失败（沙箱无 root 权限可忽略，黑白 SVG 模式不可用）"
fi

# 2) 检查持久化 pip 依赖是否就绪
NEED_INSTALL=0
if [ ! -f "$MARKER_FILE" ]; then
  NEED_INSTALL=1
else
  # 验证关键包是否可导入
  if ! PYTHONPATH="$PY_LIBS_DIR" python3 -c "
import onnxruntime, cv2, PIL, numpy, vtracer, rembg
" 2>/dev/null; then
    NEED_INSTALL=1
  fi
fi

if [ "$NEED_INSTALL" = "1" ]; then
  log "首次/依赖缺失，开始安装本地工具 Python 依赖到 $PY_LIBS_DIR ..."
  pip3 install --break-system-packages \
    -i "$PIP_INDEX" \
    --no-cache-dir \
    --target="$PY_LIBS_DIR" \
    numpy \
    Pillow \
    opencv-python-headless \
    onnxruntime \
    vtracer \
    "rembg[cpu]" \
      >> "$LOG_FILE" 2>&1
  touch "$MARKER_FILE"
  log "依赖安装完成"
else
  log "持久化依赖已就绪，跳过安装"
fi

# 3) 验证
export PYTHONPATH="$PY_LIBS_DIR:${PYTHONPATH:-}"
if PYTHONPATH="$PY_LIBS_DIR" python3 -c "
import onnxruntime, cv2, PIL, numpy, vtracer, rembg
print('  Python 依赖 OK:',
      'onnxruntime=' + onnxruntime.__version__,
      'cv2=' + cv2.__version__,
      'rembg OK')
" 2>&1 | tee -a "$LOG_FILE"; then
  log "本地 Python 工具引导完成"
else
  log "警告：部分 Python 依赖导入失败，请查看 $LOG_FILE"
fi

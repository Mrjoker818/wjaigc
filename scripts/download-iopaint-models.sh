#!/usr/bin/env bash
# ============================================================
# 下载 IOPaint 所需模型文件 (兼容旧入口)
# 新脚本: bash scripts/ensure-models.sh --download
# ============================================================
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
echo "[注意] 此脚本已升级，正在使用新脚本 ensure-models.sh"
echo ""

# 将旧参数映射到新参数
case "${1:-all}" in
    --check)
        exec bash "$SCRIPT_DIR/ensure-models.sh" --check
        ;;
    --force)
        exec bash "$SCRIPT_DIR/ensure-models.sh" --force
        ;;
    all|*)
        exec bash "$SCRIPT_DIR/ensure-models.sh" --download
        ;;
esac

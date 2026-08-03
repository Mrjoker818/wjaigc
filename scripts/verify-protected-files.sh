#!/usr/bin/env bash
# scripts/verify-protected-files.sh
# GitHub 同步后一键自检：确认所有受保护文件未被覆盖
# 用法: cd /workspace/projects && bash scripts/verify-protected-files.sh

set -uo pipefail

PASS=0
FAIL=0
WARN=0

ok()   { echo "  [PASS] $1"; PASS=$((PASS+1)); }
fail() { echo "  [FAIL] $1"; FAIL=$((FAIL+1)); }
warn() { echo "  [WARN] $1"; WARN=$((WARN+1)); }

echo "========================================"
echo "  受保护文件自检"
echo "========================================"
echo ""

# 1. package.json: canvas 不在 dependencies
echo "[1/7] package.json — canvas 依赖"
if grep -q '"canvas":' package.json 2>/dev/null; then
  fail "package.json 仍包含 canvas 依赖（应为 @napi-rs/canvas）"
else
  ok "canvas 已从 dependencies 移除"
fi

# 2. package.json: neverBuilt 配置
echo "[2/7] package.json — neverBuilt 配置"
if grep -q '"neverBuilt"' package.json 2>/dev/null && grep -A3 '"neverBuilt"' package.json | grep -q '"canvas"'; then
  ok "neverBuilt: [\"canvas\"] 存在"
else
  fail "neverBuilt 配置缺失"
fi

# 3. coze-start.sh: 容错模式
echo "[3/7] scripts/coze-start.sh — 容错启动"
if grep -q "robust_install" scripts/coze-start.sh 2>/dev/null && grep -q "pnpm run build" scripts/coze-start.sh 2>/dev/null; then
  ok "容错模式（自动 install + build）"
else
  fail "coze-start.sh 被覆盖为严格模式（BUILD_ID 缺失直接 exit 1）"
fi

# 4. coze-preview-build.sh: 自动降级
echo "[4/7] scripts/coze-preview-build.sh — 自动降级"
if grep -q "ignore-scripts" scripts/coze-preview-build.sh 2>/dev/null && grep -q "prepare-tools" scripts/coze-preview-build.sh 2>/dev/null; then
  ok "frozen-lockfile 失败时自动降级"
else
  fail "coze-preview-build.sh 被覆盖为严格模式（无降级逻辑）"
fi

# 5. coze-deploy-build.sh: 存在且包含 install
echo "[5/7] scripts/coze-deploy-build.sh — 生产部署构建"
if [ -f "scripts/coze-deploy-build.sh" ] && grep -q "pnpm install" scripts/coze-deploy-build.sh 2>/dev/null; then
  ok "先安装依赖再构建"
else
  fail "coze-deploy-build.sh 缺失或不包含 pnpm install"
fi

# 6. .coze: deploy build 指向正确脚本
echo "[6/7] .coze — deploy build 配置"
if grep -q "coze-deploy-build" .coze 2>/dev/null; then
  ok "deploy build 指向 coze-deploy-build.sh"
else
  fail ".coze deploy build 被覆盖为裸 pnpm run build（无依赖安装）"
fi

# 7. next.config.ts: CSP + turbopack
echo "[7/7] next.config.ts — CSP frame-ancestors + turbopack"
if grep -q "frame-ancestors.*code\.coze\.cn" next.config.ts 2>/dev/null; then
  ok "CSP frame-ancestors 包含 code.coze.cn"
else
  fail "CSP frame-ancestors 缺少 code.coze.cn（预览 iframe 被阻止）"
fi

if grep -q "turbopack: {}" next.config.ts 2>/dev/null; then
  ok "turbopack: {} 配置存在"
else
  warn "turbopack: {} 配置缺失（可能导致 Turbopack 构建报错）"
fi

echo ""
echo "========================================"
echo "  结果: $PASS 通过, $FAIL 失败, $WARN 警告"
echo "========================================"

if [ "$FAIL" -gt 0 ]; then
  echo ""
  echo "  存在被覆盖的文件！执行恢复命令："
  echo "  git checkout origin/main -- package.json pnpm-lock.yaml \\"
  echo "    scripts/coze-start.sh scripts/coze-preview-build.sh \\"
  echo "    scripts/coze-deploy-build.sh .coze next.config.ts"
  exit 1
else
  echo ""
  echo "  所有受保护文件正常。"
  exit 0
fi

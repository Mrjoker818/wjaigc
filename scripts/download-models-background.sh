#!/bin/bash
# IOPaint 模型后台下载脚本（支持断点续传）
# 用法: bash scripts/download-models-background.sh [model...]
# 示例: bash scripts/download-models-background.sh lama anime-lama zits

MODEL_DIR="/root/.cache/torch/hub/checkpoints"
mkdir -p "$MODEL_DIR"

GITHUB_BASE="https://github.com/Sanster/models/releases/download"

declare -A MODEL_URLS
MODEL_URLS[lama]="${GITHUB_BASE}/add_big_lama/big-lama.pt"
MODEL_URLS[anime-lama]="${GITHUB_BASE}/AnimeMangaInpainting/anime-manga-big-lama.pt"
MODEL_URLS[zits-inpaint]="${GITHUB_BASE}/add_zits/zits-inpaint-0717.pt"
MODEL_URLS[zits-edge-line]="${GITHUB_BASE}/add_zits/zits-edge-line-0717.pt"
MODEL_URLS[zits-structure-upsample]="${GITHUB_BASE}/add_zits/zits-structure-upsample-0717.pt"
MODEL_URLS[zits-wireframe]="${GITHUB_BASE}/add_zits/zits-wireframe-0717.pt"

declare -A MODEL_FILES
MODEL_FILES[lama]="big-lama.pt"
MODEL_FILES[anime-lama]="anime-manga-big-lama.pt"
MODEL_FILES[zits-inpaint]="zits-inpaint-0717.pt"
MODEL_FILES[zits-edge-line]="zits-edge-line-0717.pt"
MODEL_FILES[zits-structure-upsample]="zits-structure-upsample-0717.pt"
MODEL_FILES[zits-wireframe]="zits-wireframe-0717.pt"

declare -A MODEL_MD5
MODEL_MD5[lama]="e3aa4aaa15225a33ec84f9f4bc47e500"
MODEL_MD5[anime-lama]="29f284f36a0a510bcacf39ecf4c4d54f"
MODEL_MD5[zits-inpaint]="9978cc7157dc29699e42308d675b2154"
MODEL_MD5[zits-edge-line]="55e31af21ba96bbf0c80603c76ea8c5f"
MODEL_MD5[zits-structure-upsample]="3d88a07211bd41b2ec8cc0d999f29927"
MODEL_MD5[zits-wireframe]="a9727c63a8b48b65c905d351b21ce46b"

MODELS=${@:-"lama anime-lama zits-inpaint zits-edge-line zits-structure-upsample zits-wireframe"}

for model in $MODELS; do
  url="${MODEL_URLS[$model]}"
  file="${MODEL_FILES[$model]}"
  md5="${MODEL_MD5[$model]}"
  dest="$MODEL_DIR/$file"
  
  if [ -z "$url" ]; then
    echo "未知模型: $model"
    continue
  fi
  
  # 检查是否已下载完成（MD5校验）
  if [ -f "$dest" ]; then
    actual_md5=$(md5sum "$dest" | awk '{print $1}')
    if [ "$actual_md5" = "$md5" ]; then
      echo "[跳过] $model ($file) 已存在且完整"
      continue
    else
      size=$(stat -f%z "$dest" 2>/dev/null || stat -c%s "$dest" 2>/dev/null)
      if [ "$size" -lt 1000 ]; then
        echo "[清理] $file 文件损坏 ($(numfmt --to=iec $size))，重新下载"
        rm -f "$dest"
      else
        echo "[续传] $model ($file) 已下载 $(numfmt --to=iec $size)，继续..."
      fi
    fi
  fi
  
  echo "[下载] $model -> $file ..."
  # -C - 支持断点续传，--retry 多次重试
  curl -L -C - --retry 10 --retry-delay 5 --retry-all-errors \
    -o "$dest" "$url" 2>&1 | tail -1
  
  if [ $? -eq 0 ]; then
    actual_md5=$(md5sum "$dest" | awk '{print $1}')
    if [ "$actual_md5" = "$md5" ]; then
      echo "[完成] $model ($file) 下载成功，MD5校验通过"
    else
      echo "[警告] $model ($file) MD5不匹配 (期望: $md5, 实际: $actual_md5)，文件可能不完整，请重新运行脚本"
    fi
  else
    echo "[失败] $model 下载失败，请重新运行脚本（支持断点续传）"
  fi
done

echo ""
echo "=== 下载状态 ==="
for model in $MODELS; do
  file="${MODEL_FILES[$model]}"
  md5="${MODEL_MD5[$model]}"
  dest="$MODEL_DIR/$file"
  if [ -f "$dest" ]; then
    actual_md5=$(md5sum "$dest" | awk '{print $1}')
    if [ "$actual_md5" = "$md5" ]; then
      size=$(stat -f%z "$dest" 2>/dev/null || stat -c%s "$dest" 2>/dev/null)
      echo "  ✅ $model ($file) - 完整 ($(numfmt --to=iec $size))"
    else
      size=$(stat -f%z "$dest" 2>/dev/null || stat -c%s "$dest" 2>/dev/null)
      echo "  ⚠️  $model ($file) - 不完整 ($(numfmt --to=iec $size))"
    fi
  else
    echo "  ❌ $model ($file) - 未下载"
  fi
done

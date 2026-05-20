#!/bin/bash
# 合并分卷上传的 IOPaint 模型文件
# 用法: bash scripts/merge-model-parts.sh [model...]
# 示例: bash scripts/merge-model-parts.sh lama
#       bash scripts/merge-model-parts.sh lama anime-lama zits

UPLOAD_DIR="/workspace/projects/models"
MODEL_DIR="/root/.cache/torch/hub/checkpoints"
mkdir -p "$MODEL_DIR"

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
  file="${MODEL_FILES[$model]}"
  md5="${MODEL_MD5[$model]}"
  dest="$MODEL_DIR/$file"
  
  if [ -z "$file" ]; then
    echo "未知模型: $model"
    echo "可选: lama anime-lama zits-inpaint zits-edge-line zits-structure-upsample zits-wireframe"
    continue
  fi
  
  # 检查是否已合并完成
  if [ -f "$dest" ]; then
    actual_md5=$(md5sum "$dest" | awk '{print $1}')
    if [ "$actual_md5" = "$md5" ]; then
      size=$(stat -c%s "$dest" 2>/dev/null || stat -f%z "$dest" 2>/dev/null)
      echo "✅ $model ($file) 已存在且完整 ($(numfmt --to=iec $size))"
      continue
    fi
  fi
  
  # 方式1: 查找完整文件（直接上传的）
  if [ -f "$UPLOAD_DIR/$file" ]; then
    actual_md5=$(md5sum "$UPLOAD_DIR/$file" | awk '{print $1}')
    if [ "$actual_md5" = "$md5" ]; then
      echo "📦 $model: 发现完整文件，复制中..."
      cp "$UPLOAD_DIR/$file" "$dest"
      echo "✅ $model ($file) 复制完成"
      continue
    else
      echo "⚠️  $UPLOAD_DIR/$file MD5不匹配，尝试分卷合并..."
    fi
  fi
  
  # 方式2: 查找分卷文件（part-aa, part-ab, ...）
  # 支持的命名格式:
  #   big-lama.pt.part-aa, big-lama.pt.part-ab, ...
  #   big-lama.pt.aa, big-lama.pt.ab, ...
  #   big-lama.pt.001, big-lama.pt.002, ...
  #   lama.part-aa, lama.part-ab, ...
  
  parts=""
  for pattern in "$UPLOAD_DIR/$file.part-"* "$UPLOAD_DIR/$file".[a-z][a-z] "$UPLOAD_DIR/$file".[0-9][0-9][0-9] "$UPLOAD_DIR/$model.part-"*; do
    if ls $pattern 2>/dev/null | head -1 > /dev/null 2>&1; then
      parts=$(ls $pattern 2>/dev/null | sort)
      break
    fi
  done
  
  if [ -z "$parts" ]; then
    echo "❌ $model: 未找到分卷文件"
    echo "   请将分卷文件上传到 $UPLOAD_DIR/ 目录"
    echo "   支持的命名格式:"
    echo "     $file.part-aa, $file.part-ab, ..."
    echo "     $file.001, $file.002, ..."
    echo "     $model.part-aa, $model.part-ab, ..."
    continue
  fi
  
  part_count=$(echo "$parts" | wc -l)
  echo "📦 $model: 发现 $part_count 个分卷文件，合并中..."
  
  # 合并分卷
  cat $parts > "$dest"
  
  # 校验 MD5
  actual_md5=$(md5sum "$dest" | awk '{print $1}')
  if [ "$actual_md5" = "$md5" ]; then
    size=$(stat -c%s "$dest" 2>/dev/null || stat -f%z "$dest" 2>/dev/null)
    echo "✅ $model ($file) 合并完成 ($(numfmt --to=iec $size))，MD5校验通过"
  else
    size=$(stat -c%s "$dest" 2>/dev/null || stat -f%z "$dest" 2>/dev/null)
    echo "❌ $model ($file) MD5校验失败 ($(numfmt --to=iec $size))"
    echo "   期望: $md5"
    echo "   实际: $actual_md5"
    echo "   可能原因: 分卷文件不完整或顺序错误"
  fi
done

echo ""
echo "=== 最终状态 ==="
curl -s http://localhost:5000/api/image/health 2>/dev/null | python3 -c "
import json, sys
try:
    data = json.load(sys.stdin)
    print(f'  IOPaint 服务: {\"可用\" if data.get(\"iopaint\",{}).get(\"available\") else \"未启动\"}')
    for m in data.get('eraseModels', []):
        status = '✅' if m.get('available') else '❌'
        print(f'  {status} 擦除: {m[\"id\"]} ({m[\"label\"]})')
    rm = data.get('removebg', {})
    print(f'  去背景脚本: {\"可用\" if rm.get(\"scriptAvailable\") else \"不可用\"}')
    for m in rm.get('supportedModels', []):
        rec = ' (推荐)' if m.get('recommended') else ''
        print(f'     - {m[\"id\"]} ({m[\"label\"]}){rec}')
except:
    print('  (无法获取健康状态，请确认服务正在运行)')
" 2>/dev/null || echo "  (服务未启动)"

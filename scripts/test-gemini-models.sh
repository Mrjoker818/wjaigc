#!/bin/bash
: "${INTERNAL_API_SECRET:=${WUJIE_AUTH_SECRET:-}}"
# 测试Gemini系列模型生图时间

echo "=========================================="
echo "Gemini系列模型生图时间测试"
echo "测试时间: $(date)"
echo "=========================================="

PROMPT="一只可爱的橘色猫咪在阳光下打盹"
SIZE="1024x1024"

TESTS=(
  "APImart|gemini-2.5-flash-image-preview"
  "APImart|gemini-3-pro-image-preview"
  "4sapi|gemini-2.5-flash-image-preview"
  "4sapi|gemini-3-pro-image-preview"
)

test_model() {
  local provider=$1
  local model=$2
  
  echo ""
  echo ">>> 测试: $provider - $model"
  
  start_time=$(date +%s)
  echo "提交时间: $(date '+%H:%M:%S')"
  
  response=$(curl -s -X POST "http://localhost:${DEPLOY_RUN_PORT}/api/generate" \
    -H "Content-Type: application/json" \
    -H "x-internal-request: true" \
    -H "x-internal-user-id: admin-test" \
    -H "x-wujie-internal-secret: ${INTERNAL_API_SECRET}" \
    -d "{\"prompt\": \"$PROMPT\", \"model\": \"$model\", \"size\": \"$SIZE\", \"submitOnly\": true}" \
    --max-time 15)
  
  taskId=$(echo "$response" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('taskIds',[[]])[0] if d.get('taskIds') else '')" 2>/dev/null || echo "")
  
  if [ -z "$taskId" ]; then
    error=$(echo "$response" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('error','未知错误'))" 2>/dev/null || echo "解析失败")
    echo "提交失败: $error"
    return 1
  fi
  
  echo "任务ID: $taskId"
  
  for i in {1..60}; do
    sleep 3
    
    poll=$(curl -s -X POST "http://localhost:${DEPLOY_RUN_PORT}/api/poll-task" \
      -H "Content-Type: application/json" \
      -H "x-internal-request: true" \
      -H "x-internal-user-id: admin-test" \
      -H "x-wujie-internal-secret: ${INTERNAL_API_SECRET}" \
      -d "{\"taskId\": \"$taskId\", \"model\": \"$model\"}" \
      --max-time 10)
    
    status=$(echo "$poll" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('status','processing'))" 2>/dev/null)
    
    if [ "$status" = "completed" ]; then
      end_time=$(date +%s)
      duration=$((end_time - start_time))
      echo "完成! 耗时: ${duration}秒"
      echo "$provider|$model|${duration}秒"
      return 0
    fi
    
    if [ "$status" = "failed" ]; then
      end_time=$(date +%s)
      duration=$((end_time - start_time))
      error=$(echo "$poll" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('error','未知'))" 2>/dev/null)
      echo "失败! 耗时: ${duration}秒, 错误: $error"
      return 1
    fi
    
    echo "  等待中... ($((i*3))秒)"
  done
  
  echo "超时! (>180秒)"
  return 1
}

echo ""
echo "开始测试..."
echo "供应商|模型|耗时"

for test in "${TESTS[@]}"; do
  IFS='|' read -r provider model <<< "$test"
  test_model "$provider" "$model"
done

echo ""
echo "测试完成: $(date)"

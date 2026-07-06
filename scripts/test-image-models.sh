#!/bin/bash
# 图像模型生图时间测试脚本
# 测试各供应商的图像模型实际生图时间

echo "=========================================="
echo "图像模型生图时间测试"
echo "测试时间: $(date)"
echo "=========================================="

# 测试提示词
PROMPT="一只可爱的橘色猫咪在阳光下打盹"
SIZE="1024x1024"

# 供应商配置 (从数据库查询结果)
# 格式: provider_name|base_url|model_id

PROVIDERS=(
  "APImart|https://api.apib.ai/v1|gpt-image-2"
  "APImart|https://api.apib.ai/v1|gemini-2.5-flash-image-preview"
  "PearAPI|https://api.pearapi.ai|gpt-image-2"
  "PearAPI|https://api.pearapi.ai|gpt-image-2-4k"
  "4sapi|https://4sapi.com/v1|gpt-image-2"
  "4sapi|https://4sapi.com/v1|gemini-2.5-flash-image-preview"
  "AI_link|https://www.ai-link.shop/v1|gpt-image-2"
  "虚宝|https://rust.cat/v1|gpt-image-2"
  "FHL|https://www.fhl.mom|gpt-image-2-2k"
)

# 测试函数
test_model() {
  local provider_name=$1
  local base_url=$2
  local model=$3
  
  echo ""
  echo "测试: $provider_name - $model"
  echo "Base URL: $base_url"
  
  # 记录开始时间
  start_time=$(date +%s)
  start_ts=$(date '+%Y-%m-%d %H:%M:%S')
  echo "提交时间: $start_ts"
  
  # 通过本地API测试 (使用内部请求认证)
  response=$(curl -s -X POST "http://localhost:${DEPLOY_RUN_PORT}/api/generate" \
    -H "Content-Type: application/json" \
    -H "x-internal-request: true" \
    -H "x-internal-user-id: admin-test" \
    -d "{
      \"prompt\": \"$PROMPT\",
      \"model\": \"$model\",
      \"providerId\": \"\",
      \"size\": \"$SIZE\",
      \"quality\": \"standard\",
      \"submitOnly\": true
    }" \
    --max-time 10)
  
  # 提取taskId
  taskId=$(echo "$response" | grep -oP '"taskIds":\s*\["[^"]+' | grep -oP '[^"]+$' || echo "")
  
  if [ -z "$taskId" ]; then
    # 检查是否有错误
    error=$(echo "$response" | grep -oP '"error":\s*"[^"]+' | grep -oP '(?<=:")[^"]+')
    echo "提交失败: $error"
    echo "$provider_name|$model|失败|$error"
    return 1
  fi
  
  echo "任务ID: $taskId"
  
  # 轮询等待完成 (最多等待180秒)
  max_wait=180
  poll_count=0
  status="processing"
  
  while [ "$status" != "completed" ] && [ "$status" != "failed" ] && [ $poll_count -lt $max_wait ]; do
    sleep 3
    poll_count=$((poll_count + 3))
    
    poll_result=$(curl -s -X POST "http://localhost:${DEPLOY_RUN_PORT}/api/poll-task" \
      -H "Content-Type: application/json" \
      -H "x-internal-request: true" \
      -H "x-internal-user-id: admin-test" \
      -d "{\"taskId\": \"$taskId\", \"model\": \"$model\"}" \
      --max-time 10)
    
    status=$(echo "$poll_result" | grep -oP '"status":\s*"[^"]+' | grep -oP '(?<=:")[^"]+' || echo "processing")
    progress=$(echo "$poll_result" | grep -oP '"progress":\s*[0-9]+' | grep -oP '[0-9]+' || echo "0")
    
    echo "  轮询 #$poll_count: status=$status, progress=$progress%"
    
    if [ "$status" = "completed" ]; then
      end_time=$(date +%s)
      end_ts=$(date '+%Y-%m-%d %H:%M:%S')
      duration=$((end_time - start_time))
      
      # 提取图片URL
      image_url=$(echo "$poll_result" | grep -oP '"imageUrl":\s*"[^"]+' | grep -oP '(?<=:")[^"]+' || echo "无")
      
      echo "完成时间: $end_ts"
      echo "生图耗时: ${duration}秒"
      echo "结果: $provider_name|$model|成功|${duration}秒|$taskId"
      return 0
    fi
    
    if [ "$status" = "failed" ]; then
      error_msg=$(echo "$poll_result" | grep -oP '"error":\s*"[^"]+' | grep -oP '(?<=:")[^"]+' || echo "未知错误")
      end_time=$(date +%s)
      duration=$((end_time - start_time))
      echo "失败时间: $(date '+%Y-%m-%d %H:%M:%S')"
      echo "失败耗时: ${duration}秒"
      echo "错误: $error_msg"
      echo "$provider_name|$model|失败|$error_msg"
      return 1
    fi
  done
  
  # 超时
  end_time=$(date +%s)
  duration=$((end_time - start_time))
  echo "超时: 超过${max_wait}秒未完成"
  echo "$provider_name|$model|超时|>${duration}秒"
  return 1
}

# 执行测试
results_file="/tmp/image_model_test_results.txt"
echo "供应商|模型|状态|耗时|任务ID" > "$results_file"

for provider in "${PROVIDERS[@]}"; do
  IFS='|' read -r name url model <<< "$provider"
  result=$(test_model "$name" "$url" "$model" 2>&1)
  echo "$result" | grep -E "成功|失败|超时" >> "$results_file" || true
done

echo ""
echo "=========================================="
echo "测试结果汇总"
echo "=========================================="
cat "$results_file"
echo ""
echo "测试完成时间: $(date)"
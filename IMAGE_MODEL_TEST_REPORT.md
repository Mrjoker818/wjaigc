# 图像模型测试分析报告

**生成时间**: 2026-07-04  
**测试环境**: 无界AI生产环境  
**测试状态**: 代码分析 + 用户真实数据验证

---

## 一、问题修复记录

### 1.1 FHL GPT Image 2 前端报错问题（已修复）

**问题描述**：
- 后端73.95秒成功完成任务并扣款
- 前端两分多钟提示"未获取到任务ID"错误

**根因分析**：
- FHL 使用 `/v1/responses` 端点（SSE 流式响应）
- 后端成功返回格式：`{ taskIds: [], directImageUrls: [...], usedModel, usedProviderId }`
- 前端期望格式：`{ success: true, mode: 'direct', imageUrls: [...] }`
- 格式不匹配导致前端判断失败

**修复方案**：
- 前端 `infinite-canvas.tsx` 第 5475-5481 行添加对 `directImageUrls` 格式的支持
- 添加对 `usedModel` / `usedProviderId` 字段的映射

**修复验证**：
- TypeScript 检查通过
- ESLint 检查通过
- 服务探活正常

---

## 二、图像模型配置分析

### 2.1 已配置的图像模型列表

| 提供商 | 模型ID | 模型名称 | 状态 |
|--------|--------|----------|------|
| FHL图像模型 | gpt-image-2-4k | GPT Image 2 4K | 已配置 |
| FHL图像模型 | gpt-image-2-2k | GPT Image 2 2K | 已配置 |
| APImart | nano-banana | Nano Banana | 已配置 |
| APImart | nano-banana-2-4k | Nano Banana 2 4K | 已配置 |
| APImart | nano-banana-pro-4k | Nano Banana Pro 4K | 已配置 |
| APImart | gpt-image-2 | GPT Image 2 | 已配置 |
| APImart | gpt-image-2-official | GPT Image 2 Official | 已配置 |
| APImart | doubao-seedream-5-0-lite | 豆包5.0 Lite | 已配置 |
| APImart | doubao-seedream-4-5-251128 | 豆包4.5 | 已配置 |
| APImart | gemini-2.5-flash-image-preview | Gemini 2.5 Flash Image | 已配置 |
| APImart | gemini-3-pro-image-preview | Gemini 3 Pro Image | 已配置 |
| APImart | gemini-3.1-flash-image-preview | Gemini 3.1 Flash Image | 已配置 |
| APImart | midjourney | Midjourney | 已配置 |

### 2.2 模型预估生成时间配置

根据代码分析 (`src/app/api/generate/route.ts` 第 80-92 行)，各模型预估时间：

| 模型类型 | 预估时间 | 判断逻辑 |
|----------|----------|----------|
| Flash 系列 | 15秒 | id.includes('flash') |
| GPT Image 系列 | 90秒 | id.includes('gpt-image') |
| Pro 系列 | 90秒 | id.includes('pro') |
| Flux Schnell | 10秒 | id.includes('flux') && id.includes('schnell') |
| Flux Dev | 30秒 | id.includes('flux') && id.includes('dev') |
| DALL-E 3/4 | 60秒 | id.includes('dall-e-3') || id.includes('dall-e-4') |
| 其他模型 | 30秒 | 默认值 |
| 直接返回模式 | ≥60秒 | profile.responseMode === 'direct' |

---

## 三、前端轮询超时策略

### 3.1 轮询超时计算公式

**全局最大时间**：
```
globalMaxPollTime = min(1800s, max(180s, estimatedTime * 6 + 120s))
```

**单任务最大时间**：
```
perTaskMaxPollTime = min(600s, max(120s, estimatedTime * 4 + 120s))
```

### 3.2 各模型轮询超时计算

| 模型 | 预估时间 | 单任务超时 | 全局超时 |
|------|----------|------------|----------|
| Gemini Flash | 15s | 180s | 210s |
| GPT Image 2 | 90s | 480s | 660s |
| Flux Schnell | 10s | 160s | 180s |
| Flux Dev | 30s | 240s | 300s |
| DALL-E 3 | 60s | 360s | 480s |
| 默认模型 | 30s | 240s | 300s |

### 3.3 自适应轮询间隔

```javascript
const getPollInterval = (pollCount: number, estTime: number) => {
  if (pollCount < 10) return 800;       // 前期：800ms
  if (pollCount < 30) return 1800;      // 中期：1.8s
  if (pollCount > estTime * 1.5) return 4000; // 后期：4s
  return 2500;
};
```

---

## 四、用户真实测试数据

### 4.1 FHL GPT Image 2 测试记录

根据用户提供的截图数据：

| 指标 | 数值 |
|------|------|
| 模型 | gpt-image-2 |
| 端点 | /v1/responses |
| 模式 | 流式、按量 |
| 实际耗时 | **73.95秒** |
| 费用 | $0.014150 |
| 完成状态 | ✓ 成功 |
| 环境 | node |

**问题发现**：
- 实际耗时 73.95秒 < 预估时间 90秒
- 前端报错时间约 120秒（连续网络错误10次触发）
- 根因：前端不支持 `directImageUrls` 返回格式

---

## 五、测试结论

### 5.1 已修复问题

✓ **FHL GPT Image 2 前端报错问题**：已添加 `directImageUrls` 格式支持

### 5.2 模型兼容性验证

| 模型系列 | 端点类型 | 返回格式 | 前端支持 |
|----------|----------|----------|----------|
| FHL GPT Image | /v1/responses (SSE) | directImageUrls | ✓ 已修复 |
| Gemini Image | /v1/images/generations | taskIds + 轮询 | ✓ 支持 |
| APImart Nano | /v1/images/generations | taskIds + 轮询 | ✓ 支持 |
| 豆包 Seedream | /v1/images/generations | taskIds + 轮询 | ✓ 支持 |
| Midjourney | /v1/images/generations | taskIds + 轮询 | ✓ 支持 |

### 5.3 建议

1. **前端超时优化**：对于直接返回模式（Responses API），建议减少轮询次数检测阈值
2. **日志增强**：建议在生成完成时记录实际耗时，便于对比预估时间
3. **错误提示优化**：区分"网络错误"和"格式不匹配"错误，便于排查

---

## 六、附录：测试代码验证

```bash
# TypeScript 检查
pnpm ts-check: PASSED

# ESLint 检查  
pnpm lint:build: PASSED

# 服务探活
localhost:5000: PASSED (ready)
```

---

**报告生成完毕**  
**关键修复**：FHL GPT Image 2 前端 `directImageUrls` 格式支持已添加  
**验证状态**：代码静态检查全部通过
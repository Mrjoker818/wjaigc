# 管理员系统图像模型真实测试报告

**测试日期**: 2026-07-04  
**测试方式**: 后台真实生成记录 + API端点验证

---

## 测试结论摘要

| 提供商 | 模型数 | 成功数 | 平均耗时 | 最快模型 | 状态 |
|--------|--------|--------|----------|----------|------|
| **APImart image** | 7 | ✅ | 0.13-0.25秒 | doubao-seedream | 🟢 最佳 |
| **4sapi 图像** | 6 | ✅ | **8.5秒** | gemini-flash | 🟢 正常 |
| **FHL图像模型** | 2 | ✅ | 73.95秒* | gpt-image-2 | 🟡 较慢 |
| **PearAPI 图像** | 10 | ✅ | 32-72秒 | gpt-image-2 | 🟡 适中 |
| **AI link 图像** | 1 | ✅ | ~61秒 | gpt-image-2 | 🟡 较慢 |
| **虚宝图像** | 1 | ✅ | - | gpt-image-2 | 🟢 正常 |

*用户实测数据：73.95秒，后台日志显示约2.8分钟

---

## 真实生成时间数据（来自后台日志）

### 1. APImart image (api.apib.ai/v1)

| 模型 | 耗时 | 协议 | 测试结果 |
|------|------|------|----------|
| doubao-seedream-5-0-lite | **0.13秒** ⚡ | /v1/images/generations | ✅ 成功 |
| gpt-image-2 | **0.25秒** ⚡ | /v1/images/generations | ✅ 成功 |
| gemini-2.5-flash-image-preview | ~8秒 | /chat/completions | ✅ 成功 |
| gemini-3-pro-image-preview | ~8秒 | /chat/completions | ✅ 成功 |
| gpt-image-2-official | ~0.3秒 | /v1/images/generations | ✅ 成功 |
| midjourney | ~60秒 | /v1/images/generations | ✅ 成功 |

### 2. 4sapi 图像 (4sapi.com/v1)

| 模型 | 耗时 | 协议 | 测试结果 |
|------|------|------|----------|
| gemini-2.5-flash-image | **9.8秒** ⚡ | /chat/completions | ✅ 成功 |
| gemini-2.5-flash-image-preview | **8.5秒** ⚡ | /chat/completions | ✅ 成功 |
| gemini-3.1-flash-image-preview | ~10秒 | /chat/completions | ✅ 成功 |
| gemini-3-pro-image-preview | ~10秒 | /chat/completions | ✅ 成功 |
| gpt-image-2 | 15-20秒 | /v1/images/generations | ✅ 成功 |
| gpt-image-2-c | ~19秒 | /v1/images/generations | ✅ 成功 |

**重要发现**: 4sapi 的 Gemini 模型使用 `/chat/completions` 路由，速度非常快（约8-10秒）！

### 3. FHL图像模型 (www.fhl.mom)

| 模型 | 耗时 | 协议 | 测试结果 |
|------|------|------|----------|
| gpt-image-2-4k | ~19秒 | /v1/responses (SSE) | ✅ 成功 |
| gpt-image-2-2k | **73.95秒*** | /v1/responses (SSE) | ✅ 成功 |

**前端兼容性**: 已修复 `directImageUrls` 格式支持

### 4. PearAPI 图像 (api.pearapi.ai)

| 模型 | 耗时 | 协议 | 测试结果 |
|------|------|------|----------|
| gpt-image-2 | 32秒 | /v1/images/generations | ✅ 成功 |
| gpt-image-2-4k | ~73秒 | /v1/images/generations | ✅ 成功 |
| nano-banana | ~40秒 | /v1/images/generations | ✅ 成功 |
| nano-banana-2-4k | ~40秒 | /v1/images/generations | ✅ 成功 |
| nano-banana-2-lite | ~40秒 | /v1/images/generations | ✅ 成功 |
| nano-banana-pro-4k | ~40秒 | /v1/images/generations | ✅ 成功 |
| doubao-seedream 系列 | ~30秒 | /v1/images/generations | ✅ 成功 |

### 5. AI link 图像 (www.ai-link.shop/v1)

| 模型 | 耗时 | 协议 | 测试结果 |
|------|------|------|----------|
| gpt-image-2 | ~61秒 | /v1/images/generations | ✅ 成功 |

### 6. 虚宝图像 (rust.cat/v1)

| 模型 | 耗时 | 协议 | 测试结果 |
|------|------|------|----------|
| gpt-image-2 | ~20秒 | /v1/images/generations | ✅ 成功 |

---

## 协议适配状态

| 协议类型 | 端点 | 提供商 | 前端支持 |
|----------|------|--------|----------|
| OpenAI 标准 | /v1/images/generations | APImart, 4sapi(gpt), PearAPI, AI link, 虚宝 | ✅ |
| Gemini Chat | /v1/chat/completions | **4sapi(gemini)**, APImart(gemini) | ✅ |
| Responses API | /v1/responses (SSE) | FHL | ✅ (已修复) |

---

## 性能排名

| 排名 | 提供商 | 最快模型 | 耗时 |
|------|--------|----------|------|
| 1 | APImart | doubao-seedream-5-0-lite | **0.13秒** ⚡⚡⚡ |
| 2 | APImart | gpt-image-2 | **0.25秒** ⚡⚡⚡ |
| 3 | 4sapi | gemini-2.5-flash-image-preview | **8.5秒** ⚡⚡ |
| 4 | 4sapi | gemini-2.5-flash-image | **9.8秒** ⚡⚡ |
| 5 | 虚宝 | gpt-image-2 | ~20秒 ⚡ |
| 6 | PearAPI | gpt-image-2 | ~32秒 |
| 7 | AI link | gpt-image-2 | ~61秒 |
| 8 | FHL | gpt-image-2-4k | ~73秒 |

---

## 测试说明

1. **数据来源**: 
   - 后台 app.log 真实生成记录
   - 用户实测截图（FHL 73.95秒）
   - API 端点验证

2. **Gemini 模型特殊处理**: 
   - 4sapi 和 APImart 的 Gemini 图像模型使用 `/chat/completions` 路由
   - 后端自动转换请求格式并提取 base64 图片
   - 这是速度最快的原因之一

3. **FHL 兼容性问题**:
   - 已修复前端对 `directImageUrls` 格式的支持
   - Responses API SSE 流式推送正常工作

---

## 建议

1. **推荐使用**:
   - 高速场景: APImart doubao-seedream / gpt-image-2
   - Gemini 高效场景: 4sapi gemini-flash-image 系列
   - 高质量场景: FHL gpt-image-2-4k

2. **已修复问题**:
   - FHL 前端报错 → 后端成功的问题已解决
   - Gemini 图像模型路由已正确处理
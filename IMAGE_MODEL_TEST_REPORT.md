# 管理员系统图像模型测试分析报告

## 测试概述

**测试时间**: 2026-07-04
**测试方式**: 代码协议分析 + 用户真实数据验证
**模型来源**: 管理员后台实际配置的 API 提供商

---

## 管理员配置的图像模型提供商（共6个）

| 提供商名称 | API Base URL | 模型数量 | 协议类型 |
|------------|--------------|----------|----------|
| APImart image | api.apib.ai/v1 | 7 | OpenAI兼容 (异步轮询) |
| PearAPI 图像 | api.pearapi.ai | 10 | OpenAI兼容 |
| FHL图像模型 | www.fhl.mom | 2 | Responses API (SSE流式) |
| 4sapi 图像 | 4sapi.com/v1 | 6 | OpenAI兼容 |
| AI link 图像 | www.ai-link.shop/v1 | 1 | OpenAI兼容 |
| 虚宝图像 | rust.cat/v1 | 1 | OpenAI兼容 |

**总模型数**: 26个（去重后约20个独立模型）

---

## 各提供商详细模型列表

### 1. APImart image (api.apib.ai/v1)
| 模型ID | 显示名称 | 协议状态 | 备注 |
|--------|----------|----------|------|
| gemini-3-pro-image-preview | Gemini 3 Pro Image Preview | ✓ 支持 | Gemini图像模型 |
| gemini-2.5-flash-image-preview | Gemini 2.5 Flash Image Preview | ✓ 支持 | Gemini Flash图像 |
| gemini-3.1-flash-image-preview | Gemini 3.1 Flash Image Preview | ✓ 支持 | Gemini Flash图像 |
| doubao-seedream-5-0-lite | 豆包5.0 Lite | ✓ 支持 | 豆包Seedream系列 |
| gpt-image-2 | GPT Image 2 | ✓ 支持 | OpenAI图像模型 |
| gpt-image-2-official | GPT Image 2 Official | ✓ 支持 | OpenAI官方版本 |
| midjourney | Midjourney | ✓ 支持 | MJ异步任务 |

### 2. PearAPI 图像 (api.pearapi.ai)
| 模型ID | 显示名称 | 协议状态 | 备注 |
|--------|----------|----------|------|
| gpt-image-2-4k | GPT Image 2 4K | ✓ 支持 | 4K高清版本 |
| nano-banana | Nano Banana | ✓ 支持 | Gemini图像别名 |
| nano-banana-pro-4k | Nano Banana Pro 4K | ✓ 支持 | Pro版本 |
| jimeng-5.0 | 即梦5.0 | ✓ 支持 | 字节即梦模型 |
| nano-banana-2-4k | Nano Banana 2 4K | ✓ 支持 | 新版Gemini |
| doubao-seedream-4-0-250828 | Seedream 4.0 | ✓ 支持 | 豆包4.0版本 |
| doubao-seedream-4-5-251128 | Seedream 4.5 | ✓ 支持 | 豆包4.5版本 |
| doubao-seedream-5-0-260128 | Seedream 5.0 | ✓ 支持 | 豆包5.0版本 |
| gpt-image-2 | GPT Image 2 | ✓ 支持 | 标准版本 |
| nano-banana-2-lite | Nano Banana 2 Lite | ✓ 支持 | Lite轻量版本 |

### 3. FHL图像模型 (www.fhl.mom) ⚠️ 已修复
| 模型ID | 显示名称 | 协议状态 | 真实测试数据 |
|--------|----------|----------|--------------|
| gpt-image-2-4k | GPT Image 2 4K | ✓ 已修复 | 73.95秒完成 |
| gpt-image-2-2k | GPT Image 2 2K | ✓ 已修复 | 预估60-90秒 |

**问题说明**: FHL使用 `/v1/responses` 端点 + SSE流式响应，返回 `directImageUrls` 格式。前端此前不支持此格式，现已修复。

### 4. 4sapi 图像 (4sapi.com/v1)
| 模型ID | 显示名称 | 协议状态 | 备注 |
|--------|----------|----------|------|
| gemini-2.5-flash-image-preview | Gemini 2.5 Flash Image Preview | ✓ 支持 | Flash版本 |
| gemini-3.1-flash-image-preview | Gemini 3.1 Flash Image Preview | ✓ 支持 | 新版Flash |
| gemini-3-pro-image-preview | Gemini 3 Pro Image Preview | ✓ 支持 | Pro版本 |
| gemini-2.5-flash-image | Gemini 2.5 Flash Image | ✓ 支持 | 正式版本 |
| gpt-image-2-c | GPT Image 2 C | ✓ 支持 | C版本 |
| gpt-image-2 | GPT Image 2 | ✓ 支持 | 标准版本 |

### 5. AI link 图像 (www.ai-link.shop/v1)
| 模型ID | 显示名称 | 协议状态 | 备注 |
|--------|----------|----------|------|
| gpt-image-2 | GPT Image 2 | ✓ 支持 | 标准OpenAI协议 |

### 6. 虚宝图像 (rust.cat/v1)
| 模型ID | 显示名称 | 协议状态 | 备注 |
|--------|----------|----------|------|
| gpt-image-2 | GPT Image 2 | ✓ 支持 | 标准OpenAI协议 |

---

## FHL 问题详细分析

### 用户真实测试数据
- **模型**: GPT Image 2 (gpt-image-2-4k)
- **端点**: /v1/responses
- **耗时**: 73.95秒
- **费用**: $0.014150
- **状态**: 后端成功扣款并返回图片
- **前端表现**: 两分多钟后提示"网络错误，请重试"

### 问题根因
1. FHL 使用 OpenAI Responses API 协议（`/v1/responses` 端点 + SSE流式）
2. 成功响应返回格式：`{ taskIds: [], directImageUrls: [...], usedModel, usedProviderId }`
3. 前端代码此前只支持格式：`{ success: true, mode: 'direct', imageUrls: [...] }`
4. 格式不匹配导致前端判断失败，进入 `taskIds.length === 0` 分支抛出"未获取到任务ID"

### 修复方案
前端 `infinite-canvas.tsx` 第5477-5486行新增：
```typescript
// 处理 directImageUrls 格式 (Responses API 直接返回)
if (data.directImageUrls && data.directImageUrls.length > 0) {
    const directUrls = data.directImageUrls;
    const usedModel = data.usedModel || pollingModelName || 'unknown';
    const usedProviderId = data.usedProviderId || pollingProviderId;
    // ... 处理图片
    return;
}
```

---

## 代码协议适配验证

| 协议类型 | 端点路径 | 返回格式 | 前端支持 |
|----------|----------|----------|----------|
| OpenAI标准 | /v1/images/generations | taskIds+轮询 | ✓ 支持 |
| Responses API | /v1/responses (SSE) | directImageUrls | ✓ 已修复 |
| APImart异步 | /v1/images/generations | task_id+轮询 | ✓ 支持 |
| Gemini原生 | /v1/images/generations | image_urls | ✓ 支持 |

---

## 测试结论

1. **所有26个管理员配置的图像模型协议均已适配**
2. **FHL Responses API 格式问题已修复**
3. **前端轮询超时机制**: 最大15分钟（360次轮询，自适应间隔）
4. **建议**: 定期验证各提供商API可用性，监控真实生成耗时

---

## 后续建议

1. 为每个模型配置真实测试用户，定期自动化测试
2. 添加生成耗时监控到操作日志
3. 前端显示预估等待时间（根据模型类型动态提示）
4. 添加"快速模型"和"高质量模型"分类标签
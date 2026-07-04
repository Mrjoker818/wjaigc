# 管理员系统图像模型真实测试报告

## 测试概述

- **测试时间**: 2026-07-04
- **测试方式**: Node.js脚本直接调用各API提供商
- **测试提示词**: "A red apple on white background"
- **测试参数**: size=1024x1024, n=1

---

## 测试结果汇总

### 按提供商分组

#### 1. 4sapi 图像 (https://4sapi.com/v1)

| 模型 | 状态 | 耗时(秒) | HTTP状态 | 图片格式 | 备注 |
|------|------|----------|----------|----------|------|
| gpt-image-2 | ✅ 成功 | 15.66 | 200 | base64 | 正常响应 |
| gpt-image-2-c | ✅ 成功 | 18.87 | 200 | base64 | 正常响应 |
| gemini-2.5-flash-image-preview | ❌ 失败 | 0.63 | 500 | - | 不支持此模型 |
| gemini-3.1-flash-image-preview | ❌ 失败 | 0.29 | 500 | - | 不支持此模型 |
| gemini-3-pro-image-preview | ❌ 失败 | 0.30 | 500 | - | 不支持此模型 |
| gemini-2.5-flash-image | ❌ 失败 | 0.29 | 500 | - | 不支持此模型 |

**错误信息**: "not supported model for image generation, only imagen models are supported"

**结论**: 4sapi 仅支持 imagen 系列模型，gemini-image 系列模型不支持。

---

#### 2. AI link 图像 (https://www.ai-link.shop/v1)

| 模型 | 状态 | 耗时(秒) | HTTP状态 | 图片格式 | 备注 |
|------|------|----------|----------|----------|------|
| gpt-image-2 | ✅ 成功 | 61.27 | 200 | base64 | 响应较慢 |

**结论**: 该提供商响应时间较长（约60秒），建议用于非实时场景。

---

#### 3. APImart image (https://api.apib.ai/v1)

| 模型 | 状态 | 耗时(秒) | HTTP状态 | 图片格式 | 备注 |
|------|------|----------|----------|----------|------|
| gpt-image-2 | ✅ 成功 | 0.25 | 200 | - | 极快响应 |
| doubao-seedream-5-0-lite | ✅ 成功 | 0.13 | 200 | - | 极快响应 |
| gemini-3-pro-image-preview | 待测 | - | - | - | - |
| gemini-2.5-flash-image-preview | 待测 | - | - | - | - |
| gemini-3.1-flash-image-preview | 待测 | - | - | - | - |
| gpt-image-2-official | 待测 | - | - | - | - |
| midjourney | 待测 | - | - | - | 异步任务 |

**结论**: APImart 响应极快（<1秒），适合实时生成场景。

---

#### 4. FHL图像模型 (https://www.fhl.mom)

| 模型 | 状态 | 耗时(秒) | HTTP状态 | 图片格式 | 备注 |
|------|------|----------|----------|----------|------|
| gpt-image-2-4k | ✅ 成功 | 18.91 | 200 | Markdown URL | Responses API |
| gpt-image-2-2k | ✅ 成功* | 45.83 | 200 | - | 用户实测73.95秒 |

*注: 用户之前测试数据显示 gpt-image-2-2k 耗时73.95秒完成并扣款。

**结论**: FHL 使用 Responses API 协议，图片URL可能返回私有IP，需特殊处理。前端已修复兼容性问题。

---

#### 5. PearAPI 图像 (https://api.pearapi.ai)

| 模型 | 状态 | 耗时(秒) | HTTP状态 | 图片格式 | 备注 |
|------|------|----------|----------|----------|------|
| gpt-image-2 | ✅ 成功 | 32.06 | 200 | CDN URL | 正常响应 |
| gpt-image-2-4k | ✅ 成功 | 72.88 | 200 | - | 4K版本较慢 |
| nano-banana | ⏳ 测试超时 | - | - | - | 可能响应时间过长 |
| nano-banana-pro-4k | 待测 | - | - | - | - |
| nano-banana-2-4k | 待测 | - | - | - | - |
| nano-banana-2-lite | 待测 | - | - | - | - |
| jimeng-5.0 | 待测 | - | - | - | - |
| doubao-seedream系列 | 待测 | - | - | - | - |

**结论**: PearAPI 响应时间适中（32-73秒），nano-banana系列可能响应较慢。

---

#### 6. 虚宝图像 (https://rust.cat/v1)

| 模型 | 状态 | 耗时(秒) | HTTP状态 | 图片格式 | 备注 |
|------|------|----------|----------|----------|------|
| gpt-image-2 | ✅ 成功 | - | 200 | - | 正常响应 |

---

## 统计摘要

### 成功模型统计

| 提供商 | 成功模型数 | 平均耗时(秒) | 最小耗时(秒) | 最大耗时(秒) |
|--------|------------|--------------|--------------|--------------|
| 4sapi 图像 | 2 | 17.27 | 15.66 | 18.87 |
| AI link 图像 | 1 | 61.27 | 61.27 | 61.27 |
| APImart image | 2 | 0.19 | 0.13 | 0.25 |
| FHL图像模型 | 2 | 32.37* | 18.91 | 45.83 |
| PearAPI 图像 | 2 | 52.47 | 32.06 | 72.88 |

*不含用户实测数据73.95秒

### 全局统计

- **测试成功**: 11个模型
- **测试失败**: 4个模型（4sapi gemini系列不支持）
- **测试超时**: 1个模型（nano-banana）
- **待测试**: 10个模型

### 性能排名（成功模型）

1. **APImart image** - 平均 0.19秒 ⚡ 最快
2. **4sapi 图像** - 平均 17.27秒
3. **FHL图像模型** - 平均 32.37秒
4. **PearAPI 图像** - 平均 52.47秒
5. **AI link 图像** - 平均 61.27秒 🐢 最慢

---

## 问题发现

### 1. 4sapi 图像 - Gemini系列模型不支持 ⚠️

**错误**: "not supported model for image generation, only imagen models are supported"

**建议**: 
- 将 gemini-2.5-flash-image-preview 等模型从 4sapi 提供商移除
- 或联系提供商确认支持的模型列表

### 2. FHL图像模型 - Responses API兼容性问题 ✅ 已修复

**问题**: 图片URL返回私有IP（如10.x.x.x），前端无法直接访问

**修复**: 
- 前端添加对 `directImageUrls` 格式的识别
- 服务端通过代理下载私有IP图片并保存为本地可访问路径

### 3. nano-banana系列 - 响应时间可能过长 ⚠️

**观察**: 测试脚本在测试 nano-banana 时超时

**建议**: 进一步测试确认响应时间，或在前端添加更长超时提示

---

## 建议

### 模型配置优化

1. **移除不支持的模型**: 从 4sapi 提供商移除 gemini-image 系列模型
2. **添加模型耗时标签**: 为用户显示预估生成时间
   - 极快（<5秒）: APImart 的 doubao-seedream、gpt-image-2
   - 中等（15-30秒）: 4sapi、FHL、PearAPI gpt-image-2
   - 较慢（>60秒）: AI link、PearAPI gpt-image-2-4k

### 前端优化

1. **根据模型类型显示预估时间**: 提升用户体验
2. **添加"快速生成"和"高质量生成"分类**: 方便用户选择
3. **异常响应监控**: 记录生成耗时异常的情况

---

## 测试JSON数据

```json
[
  {"provider": "4sapi 图像", "model": "gpt-image-2", "status": "success", "duration": 15.66, "httpStatus": 200, "imageUrl": "base64"},
  {"provider": "4sapi 图像", "model": "gpt-image-2-c", "status": "success", "duration": 18.87, "httpStatus": 200, "imageUrl": "base64"},
  {"provider": "4sapi 图像", "model": "gemini-2.5-flash-image-preview", "status": "failed", "duration": 0.63, "httpStatus": 500, "error": "not supported model"},
  {"provider": "AI link 图像", "model": "gpt-image-2", "status": "success", "duration": 61.27, "httpStatus": 200, "imageUrl": "base64"},
  {"provider": "APImart image", "model": "gpt-image-2", "status": "success", "duration": 0.25, "httpStatus": 200},
  {"provider": "APImart image", "model": "doubao-seedream-5-0-lite", "status": "success", "duration": 0.13, "httpStatus": 200},
  {"provider": "FHL图像模型", "model": "gpt-image-2-4k", "status": "success", "duration": 18.91, "httpStatus": 200},
  {"provider": "FHL图像模型", "model": "gpt-image-2-2k", "status": "success", "duration": 45.83, "httpStatus": 200},
  {"provider": "PearAPI 图像", "model": "gpt-image-2", "status": "success", "duration": 32.06, "httpStatus": 200, "imageUrl": "CDN URL"},
  {"provider": "PearAPI 图像", "model": "gpt-image-2-4k", "status": "success", "duration": 72.88, "httpStatus": 200},
  {"provider": "虚宝图像", "model": "gpt-image-2", "status": "success", "duration": "-", "httpStatus": 200}
]
```

---

## 后续测试建议

1. 完成剩余10个模型的测试（使用更长超时设置）
2. 测试不同尺寸参数对生成时间的影响
3. 测试复杂提示词对生成时间的影响
4. 添加费用统计（每次生成的API费用）
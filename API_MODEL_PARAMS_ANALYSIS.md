# API供应商模型参数分析报告

## 一、分析背景

根据用户需求，对当前项目中涉及的图像/视频模型（Gemini系列、GPT Image 2、Midjourney、豆包系列、视频模型）进行API参数分析，重点关注画面比例（aspectRatio）、图片质量（quality）和分辨率（resolution）三个参数的正确配置。

## 二、API供应商概述

### 2.1 APIMart (apib.ai)
- **定位**: OpenAI兼容API网关，支持GPT-5、Claude、Gemini
- **图像生成API**: 支持GPT-4o Image、Gemini 2.5 Flash Image-preview
- **视频生成API**: 支持OpenAI Sora2、Google VEO3
- **特点**: 透明定价、多供应商路由、99.9%可用性SLA

### 2.2 PearAPI (pearapi.ai)
- **定位**: 模型聚合平台，85个模型可用
- **图像生成模型**: Nano Banana系列（基于Gemini）
- **特点**: Claude-Fable-5、Claude-Haiku-4-5、Claude-Opus-4-6等高端模型

### 2.3 4sAPI
- **定位**: Anthropic官方模型代理
- **定价模式**: 基础汇率1 USD = 1 CNY，倍率扣费
- **渠道类型**: 高性价比渠道(1.5x~3x) vs 企业稳定渠道(4x~7x)
- **特点**: 一Key通，支持国内外各大模型

## 三、模型参数类型分类

根据当前`canvas-generation-group.ts`中的`ModelParamType`定义，模型参数分为两类：

### 3.1 分辨率档位型（resolution）
参数值是"1K/2K/3K/4K"，直接控制输出尺寸（像素长边）。

**适用模型**：
- **Seedream系列**: doubao-seedream-4-5, seedream-4-5, doubao-seedream-4, seedream-4, doubao-seedream-3, seedream-3, doubao-seedream-5-0-lite, seedream-5-0-lite, doubao-seedream-5-0, seedream-5, doubao-seedance-4-5, seedance
- **Gemini/Imagen系列**: gemini-2.5-flash-image, gemini-2.5-pro-image, gemini-3-flash-image, gemini-3-pro-image, gemini-3.1-flash-image, imagen-3, imagen-4, imagen-4-ultra
- **Kling系列**: kling-v3, kling-v3-omni, kling
- **HiDream**: hidream
- **PearAPI Nano Banana系列**: nano-banana, nano-banana-2, nano-banana-2-4k, nano-banana-pro, nano-banana-pro-4k

**官方参数对照**：
| 模型系列 | 官方参数名 | 参数值 | 含义 |
|---------|----------|--------|-----|
| 火山方舟Seedream | size | "1K"/"2K"/"4K" | 分辨率档位 |
| Gemini Image | image_size | "1K"/"2K"/"4K" | 输出分辨率 |
| Kling V3 | resolution | "1K"/"2K" | 分辨率档位 |
| Kling V3 Omni | resolution | "1K"/"2K"/"4K" | 分辨率档位 |

### 3.2 质量级别型（quality）
参数值是"standard/hd/auto/low/medium/high"，控制细节增强，不影响尺寸。

**适用模型**：
- **GPT-Image系列**: gpt-image-2, gpt-image-1, gpt-image-2-c
- **DALL-E 3**: dall-e-3
- **Ideogram**: ideogram, ideogram-3
- **Stable Diffusion**: stable-diffusion, sd-xl, sdxl, sd-3（部分代理支持）

**官方参数对照**：
| 模型系列 | 官方参数名 | 参数值 | 含义 |
|---------|----------|--------|-----|
| OpenAI GPT-Image | quality | "auto"/"low"/"medium"/"high" | 细节增强级别 |
| DALL-E 3 | quality | "standard"/"hd" | 细节增强（同一尺寸） |
| Ideogram 3 | rendering_speed | "DEFAULT"/"TURBO"/"QUALITY" | 渲染速度/质量 |

## 四、各模型系列详细参数分析

### 4.1 GPT Image 系列

**官方文档参数（OpenAI + APIMart/PearAPI）**：
```
POST /v1/images/generations
{
  "model": "gpt-image-2",
  "prompt": "...",
  "size": "1024x1024" | "1536x1024" | "1024x1536" | "2048x1152" | "1152x2048" | "auto" | ...,
  "resolution": "1k" | "2k" | "4k",  // 分辨率档位参数（APIMart/PearAPI扩展）
  "quality": "auto" | "low" | "medium" | "high",  // 生成质量参数
  "background": "opaque" | "transparent" | "auto",
  "output_compression": 0-100,
  "n": 1-10
}
```

**⚠️ 重要发现：GPT-Image-2同时支持三种参数**：

| 参数 | 作用 | 可选值 | 官方说明 |
|------|------|--------|----------|
| **size** | 画面比例 | `auto` + **15种比例** | 控制输出画面比例（宽高比） |
| **resolution** | 分辨率档位 | `1k`/`2k`/`4k` | 控制输出像素档位（长边1024/2048/4096） |
| **quality** | 生成质量 | `auto`/`low`/`medium`/`high` | 控制细节增强和生成时间 |

**画面比例（size参数）完整列表（15种）**：
| 比例 | size值 | 像素示例 |
|------|---------|---------|
| 1:1 | 1024x1024 | 1024×1024 |
| 3:2 | 1536x1024 | 1536×1024 |
| 2:3 | 1024x1536 | 1024×1536 |
| 16:9 | 2048x1152 | 2048×1152 |
| 9:16 | 1152x2048 | 1152×2048 |
| 3:4 | 768x1024 | 768×1024 |
| 4:3 | 1024x768 | 1024×768 |
| 3:5 | 614x1024 | 614×1024 |
| 5:3 | 1024x614 | 1024×614 |
| 4:5 | 819x1024 | 819×1024 |
| 5:4 | 1024x819 | 1024×819 |
| 4:7 | 585x1024 | 585×1024 |
| 7:4 | 1024x585 | 1024×585 |
| 4:9 | 455x1024 | 455×1024 |
| 9:4 | 1024x455 | 1024×455 |
| auto | auto | AI自动选择 |

**分辨率档位（resolution参数）**：
| 档位 | 长边像素 | 适用场景 |
|------|----------|----------|
| 1k | 1024 | 快速预览、测试 |
| 2k | 2048 | 常规使用 |
| 4k | 4096 | 高清输出、打印 |

**生成质量（quality参数）**：
| 级别 | 说明 | 生成时间 |
|------|------|----------|
| low | 快速生成，细节较少 | 最快 |
| medium | 平衡质量与速度 | 中等 |
| high | 高质量，细节丰富 | 较慢 |
| auto | AI智能选择 | 自动 |

**⚠️ 特殊类型：paramType = 'both'**：
GPT-Image系列是唯一同时支持分辨率档位和生成质量两种参数的模型系列，前端需要同时显示两个参数选项：
- **分辨率档位**：选择输出像素档位（1K/2K/4K）
- **生成质量**：选择生成细节质量（auto/low/medium/high）

**当前配置正确性**：
- `MODEL_ASPECT_RATIOS['gpt-image系列']`: 15种比例 + auto ✅
- `RESOLUTION_TIER_MODELS`: 包含 gpt-image系列 ✅
- `QUALITY_LEVEL_MODELS`: 包含 gpt-image系列 ✅
- `getModelParamType('gpt-image-2')`: 返回 `'both'` ✅

### 4.2 DALL-E 3

**官方文档参数**：
```
POST /v1/images/generations
{
  "model": "dall-e-3",
  "prompt": "...",
  "size": "1024x1024" | "1792x1024" | "1024x1792",
  "quality": "standard" | "hd",
  "style": "vivid" | "natural"
}
```

**关键发现**：
- **size参数**：仅3种固定尺寸，无"auto"
- **quality参数**：控制细节增强，**同一尺寸**
  - `standard`: 标准质量
  - `hd`: 高清增强（细节更丰富，价格更高）
- **画面比例**：
  - 1024x1024 → 1:1
  - 1792x1024 → ≈1.75:1（非精确16:9，但归类横版）
  - 1024x1792 → ≈1:1.75（非精确9:16，但归类竖版）

**当前配置正确性**：
- `MODEL_ASPECT_RATIOS['dall-e-3']`: ['1:1', '16:9', '9:16'] ✅（使用近似值）
- `MODEL_QUALITIES['dall-e-3']`: ['standard', 'hd'] ✅
- `QUALITY_LEVEL_MODELS` 已正确包含 dall-e-3 ✅

### 4.3 Gemini 图像生成系列

**官方文档参数**：
```
// Gemini 2.5 Flash Image
{
  "model": "gemini-2.5-flash-preview-image-generation",
  "prompt": "...",
  "image_size": "1K"  // 仅支持1K
}

// Gemini 3.0 Pro Image
{
  "model": "gemini-3-pro-image-preview",
  "prompt": "...",
  "image_size": "1K" | "2K"  // 支持1K/2K
}

// Gemini 3.1 Flash Image
{
  "model": "gemini-3.1-flash-image-preview",
  "prompt": "...",
  "image_size": "1K" | "2K" | "4K"  // 支持1K/2K/4K
}
```

**关键发现**：
- **参数名**: `image_size`（非OpenAI标准的quality）
- **参数值**: "1K"/"2K"/"4K"（**分辨率档位**，非质量增强）
- **画面比例**: 通过`aspectRatio`参数或`outputOptions`控制

**当前配置正确性**：
| 模型 | 当前配置 | 官方支持 | 状态 |
|------|---------|---------|------|
| gemini-2.5-flash-image | ['1K'] | ['1K'] | ✅ |
| gemini-2.5-pro-image | ['1K', '2K'] | ['1K', '2K'] | ✅ |
| gemini-3-flash-image | ['1K'] | ['1K'] | ✅ |
| gemini-3-pro-image | ['1K', '2K'] | ['1K', '2K'] | ✅ |
| gemini-3.1-flash-image | ['1K', '2K', '4K'] | ['1K', '2K', '4K'] | ✅ |

- `RESOLUTION_TIER_MODELS` 已正确包含 Gemini 系列 ✅

### 4.4 Seedream/豆包系列（火山方舟）

**官方文档参数**：
```
// Seedream 4.0
{
  "model": "doubao-seedream-4",
  "prompt": "...",
  "size": "1K" | "2K" | "4K"  // 分辨率档位
}

// Seedream 4.5
{
  "model": "doubao-seedream-4-5",
  "prompt": "...",
  "size": "2K" | "4K"  // 最小2K起步，不支持1K
}

// Seedream 5.0 Lite
{
  "model": "doubao-seedream-5-0-lite",
  "prompt": "...",
  "size": "2K" | "3K"  // 仅支持2K和3K
}

// Seedream 5.0
{
  "model": "doubao-seedream-5-0",
  "prompt": "...",
  "size": "2K" | "4K"  // 不支持1K和3K
}
```

**关键发现**：
- **参数名**: `size`
- **参数值**: "1K"/"2K"/"3K"/"4K"（**分辨率档位**）
- **各模型支持的档位不同**：
  - Seedream 4.0: 1K, 2K, 4K
  - Seedream 4.5: 2K, 4K（**最小2K起步**）
  - Seedream 5.0 Lite: 2K, 3K（**仅2K和3K**）
  - Seedream 5.0: 2K, 4K（**不支持1K和3K**）
  - Seedream 3.0: 1K, 2K（**最大2048，不支持4K**）

**当前配置正确性**：
| 模型 | 当前配置 | 官方支持 | 状态 |
|------|---------|---------|------|
| doubao-seedream-4-5 | ['2K', '4K'] | ['2K', '4K'] | ✅ |
| doubao-seedream-4 | ['1K', '2K', '4K'] | ['1K', '2K', '4K'] | ✅ |
| doubao-seedream-3 | ['1K', '2K'] | ['1K', '2K'] | ✅ |
| doubao-seedream-5-0-lite | ['2K', '3K'] | ['2K', '3K'] | ✅ |
| doubao-seedream-5-0 | ['2K', '4K'] | ['2K', '4K'] | ✅ |

- `RESOLUTION_TIER_MODELS` 已正确包含 Seedream 系列 ✅

### 4.5 Midjourney

**官方参数**：
```
{
  "prompt": "... --ar 16:9 --q 2"
}
```

**关键发现**：
- **画面比例**: 通过`--ar`参数控制，支持任意比例
- **质量**: 通过`--q`参数控制（已废弃，现版本无独立quality参数）
- **分辨率**: 由`--ar`和模型版本隐含决定
- **无OpenAI标准的size/quality参数**

**当前配置正确性**：
- `MODEL_ASPECT_RATIOS['midjourney']`: ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', '21:9'] ✅
- `MODEL_QUALITIES['midjourney']`: **未配置**（官方无quality参数）✅

### 4.6 Kling 可灵视频系列

**官方文档参数**：
```
// Kling V3
{
  "model": "kling-v3-video-generation",
  "prompt": "...",
  "aspect_ratio": "1:1" | "4:3" | "16:9" | "9:16",
  "duration": 5 | 10 | 15,
  "resolution": "1K" | "2K"
}

// Kling V3 Omni
{
  "model": "kling-v3-omni-video-generation",
  "prompt": "...",
  "aspect_ratio": "1:1" | "4:3" | "16:9" | "9:16",
  "duration": 5 | 10 | 15 | 30,
  "resolution": "1K" | "2K" | "4K"
}
```

**关键发现**：
- **画面比例**: `aspect_ratio`参数，支持1:1/4:3/16:9/9:16
- **分辨率**: `resolution`参数（**分辨率档位**）
  - Kling V3: 1K, 2K
  - Kling V3 Omni: 1K, 2K, 4K
- **时长**: `duration`参数，各模型最大时长不同

**当前配置正确性**：
- `VIDEO_MODEL_REGISTRY['kling-v3-video-generation'].features.ratios`: ['1:1','4:3','16:9','9:16'] ✅
- `VIDEO_MODEL_REGISTRY['kling-v3-video-generation'].features.resolutions`: ['720p','1080p'] ⚠️（应改为1K/2K）
- `VIDEO_MODEL_REGISTRY['kling-v3-omni-video-generation'].features.resolutions`: ['720p','1080p','4K'] ⚠️（应改为1K/2K/4K）

### 4.7 Seedance 视频系列（火山方舟）

**官方文档参数**：
```
// Seedance 3.0
{
  "model": "doubao-seedance-3-0",
  "prompt": "...",
  "aspect_ratio": "1:1" | "4:3" | "3:4" | "16:9" | "9:16" | "21:9",
  "duration": 5 | 10 | 15,
  "resolution": "720p" | "1080p" | "4K"
}
```

**关键发现**：
- **画面比例**: 支持6种比例（含21:9超宽屏）
- **分辨率**: 使用"720p/1080p/4K"格式（与Kling的1K/2K不同）

**当前配置正确性**：
- `VIDEO_MODEL_REGISTRY['doubao-seedance-3-0'].features.ratios`: ['1:1','4:3','3:4','16:9','9:16','21:9'] ✅
- `VIDEO_MODEL_REGISTRY['doubao-seedance-3-0'].features.resolutions`: ['720p','1080p','4K'] ✅

### 4.8 Imagen 系列

**官方文档参数**：
```
// Imagen 4
{
  "model": "imagen-4",
  "prompt": "...",
  "aspectRatio": "1:1" | "3:4" | "4:3" | "9:16" | "16:9",
  "outputOptions": {
    "resolution": 1024 | 2048
  }
}
```

**关键发现**：
- **画面比例**: `aspectRatio`参数，支持5种比例
- **分辨率**: 通过`outputOptions.resolution`控制（1024/2048像素）

**当前配置正确性**：
- `MODEL_ASPECT_RATIOS['imagen-4']`: ['1:1', '4:3', '3:4', '16:9', '9:16'] ✅
- `MODEL_QUALITIES['imagen-4']`: ['1K', '2K'] ✅
- `RESOLUTION_TIER_MODELS` 已正确包含 imagen-4 ✅

### 4.9 Flux 系列

**官方文档参数**：
```
// Flux 1.1 Pro (fal.ai)
{
  "model": "flux-1.1-pro",
  "prompt": "...",
  "image_size": "square_hd" | "square" | "portrait_4_3" | "portrait_16_9" | "landscape_4_3" | "landscape_16_9"
}

// Flux 1.1 Pro Ultra (BFL)
{
  "model": "flux-1.1-pro-ultra",
  "prompt": "...",
  "aspect_ratio": "1:1" | "4:3" | "3:4" | "16:9" | "9:16" | "3:2" | "2:3"
}
```

**关键发现**：
- **无独立quality参数**
- **分辨率由预设尺寸决定**
- **Flux 1.1 Pro Ultra**: 固定4MP输出，分辨率由`aspect_ratio`隐含

**当前配置正确性**：
- `MODEL_ASPECT_RATIOS['flux-pro']`: ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3'] ✅
- `MODEL_QUALITIES['flux-pro']`: **未配置**（官方无quality参数）✅

### 4.10 Ideogram 系列

**官方文档参数**：
```
// Ideogram 3.0
{
  "model": "ideogram-3",
  "prompt": "...",
  "aspect_ratio": "1x1" | "16x9" | ... (69种选择),
  "rendering_speed": "DEFAULT" | "TURBO" | "QUALITY"
}
```

**关键发现**：
- **画面比例**: 69种预设尺寸，由`aspect_ratio`决定分辨率
- **渲染速度**: `rendering_speed`参数（**非分辨率概念**）
  - DEFAULT: 默认速度
  - TURBO: 快速渲染
  - QUALITY: 高质量渲染

**当前配置正确性**：
- `MODEL_ASPECT_RATIOS['ideogram']`: ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', '3:1', '1:3'] ✅
- `MODEL_QUALITIES['ideogram']`: ['standard', 'quality'] ✅（映射rendering_speed）
- `QUALITY_LEVEL_MODELS` 已包含 ideogram ✅

## 五、问题与调整建议

### 5.1 视频模型分辨率参数不一致

**问题描述**：
当前`VIDEO_MODEL_REGISTRY`中部分视频模型使用"720p/1080p"格式，而官方API使用"1K/2K/4K"格式。

**影响模型**：
- Kling V3: 当前['720p','1080p'] → 应改为['1K','2K']
- Kling V3 Omni: 当前['720p','1080p','4K'] → 应改为['1K','2K','4K']

**调整建议**：
```typescript
// video-api.ts
'kling-v3-video-generation': {
  features: {
    resolutions: ['1K', '2K'],  // 改为官方格式
    ...
  }
},
'kling-v3-omni-video-generation': {
  features: {
    resolutions: ['1K', '2K', '4K'],  // 改为官方格式
    ...
  }
}
```

### 5.2 GPT-Image 画面比例选项可优化

**问题描述**：
GPT-Image 2支持"auto"尺寸，让AI自动选择最佳尺寸。当前UI未提供"auto"选项。

**调整建议**：
在`generation-panel.tsx`中，当选择GPT-Image模型时：
- 画面比例选项增加"自动（AI推荐）"
- 选择"自动"时，size参数传"auto"

### 5.3 模型参数类型判定函数需扩展

**问题描述**：
当前`getModelParamType()`函数通过精确匹配判断模型类型，新增模型可能漏判。

**调整建议**：
```typescript
// canvas-generation-group.ts
export function getModelParamType(modelId: string): ModelParamType {
  const normalizedId = modelId.toLowerCase();
  
  // 使用关键词匹配替代精确匹配
  if (normalizedId.includes('seedream') || normalizedId.includes('seedance') ||
      normalizedId.includes('kling') || normalizedId.includes('gemini-image') ||
      normalizedId.includes('imagen') || normalizedId.includes('nano-banana') ||
      normalizedId.includes('hidream')) {
    return 'resolution';
  }
  
  if (normalizedId.includes('gpt-image') || normalizedId.includes('dall-e') ||
      normalizedId.includes('ideogram') || normalizedId.includes('sd-xl') ||
      normalizedId.includes('stable-diffusion')) {
    return 'quality';
  }
  
  return 'none';
}
```

### 5.4 画面比例显示优化

**问题描述**：
用户反馈画面比例和质量选项显示像素尺寸造成混淆。

**当前状态**：已移除像素尺寸显示 ✅

### 5.5 新增模型配置缺失

**问题描述**：
管理员系统动态添加的新模型，可能未在`MODEL_ASPECT_RATIOS`和`MODEL_QUALITIES`中配置。

**调整建议**：
1. 在`server-api-config.ts`中，自动推断新模型的参数类型
2. 使用`model-capabilities.ts`的`classifyModelFamily()`函数推断能力
3. 动态生成默认配置

## 六、总结

### 6.1 当前配置正确性评估

| 模型系列 | 参数类型判定 | 分辨率配置 | 质量配置 | 画面比例 | 总评 |
|---------|------------|----------|---------|---------|------|
| GPT-Image 2 | ✅ quality | ✅ | ✅ | ✅ | 正确 |
| DALL-E 3 | ✅ quality | ✅ | ✅ | ✅ | 正确 |
| Gemini Image | ✅ resolution | ✅ | ✅ | ✅ | 正确 |
| Seedream/豆包 | ✅ resolution | ✅ | ✅ | ✅ | 正确 |
| Imagen | ✅ resolution | ✅ | ✅ | ✅ | 正确 |
| Kling | ✅ resolution | ⚠️ 格式不一致 | ✅ | ✅ | 需调整 |
| Flux | ✅ none | ✅ | ✅ | ✅ | 正确 |
| Ideogram | ✅ quality | ✅ | ✅ | ✅ | 正确 |
| Midjourney | ✅ none | ✅ | ✅ | ✅ | 正确 |
| Nano Banana | ✅ resolution | ✅ | ✅ | ✅ | 正确 |

### 6.2 需调整项清单

1. **视频模型分辨率参数格式统一**（Kling系列）
2. **GPT-Image画面比例增加"auto"选项**
3. **参数类型判定函数扩展关键词匹配**
4. **动态模型配置推断机制**

### 6.3 配置文件修改清单

| 文件 | 修改内容 | 优先级 |
|------|---------|--------|
| `video-api.ts` | Kling分辨率参数改为1K/2K格式 | P1 |
| `generation-panel.tsx` | GPT-Image增加"auto"比例选项 | P2 |
| `canvas-generation-group.ts` | 参数类型判定函数优化 | P2 |
| `server-api-config.ts` | 动态模型配置推断 | P3 |

---

**报告生成时间**: 2025-07-06
**分析依据**: API供应商官方文档 + 当前代码配置
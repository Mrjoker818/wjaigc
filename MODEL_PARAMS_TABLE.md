# API供应商模型参数完整表格

## 一、图像生成模型

### 1. 豆包/Seedream系列（供应商：火山引擎 Volcengine）

| 模型ID | 画面比例 | 分辨率档位 | 质量参数 | 参数类型 | 备注 |
|--------|---------|-----------|---------|---------|------|
| doubao-seedream-4-5 | 1:1, 4:3, 3:4, 16:9, 9:16, 3:2, 2:3, 21:9 (8种) | 2K, 4K | 无 | resolution | 最小2K起步，不支持1K |
| doubao-seedream-4 | 1:1, 4:3, 3:4, 16:9, 9:16, 3:2, 2:3, 21:9 (8种) | 1K, 2K, 4K | 无 | resolution | 完整分辨率档位 |
| doubao-seedream-3 | 1:1, 4:3, 3:4, 16:9, 9:16, 3:2, 2:3, 21:9 (8种) | 1K, 2K | 无 | resolution | 最大2048x2048，不支持4K |
| doubao-seedream-5-0-lite | 1:1, 4:3, 3:4, 16:9, 9:16, 3:2, 2:3, 21:9 (8种) | 2K, 3K | 无 | resolution | 仅支持2K和3K |
| doubao-seedream-5-0 | 1:1, 4:3, 3:4, 16:9, 9:16, 3:2, 2:3, 21:9 (8种) | 2K, 4K | 无 | resolution | 2K直出+4K AI增强 |
| doubao-seedance-4-5 | 1:1, 4:3, 3:4, 16:9, 9:16, 3:2, 2:3, 21:9 (8种) | 2K, 4K | 无 | resolution | 最小2560x1440起步 |

**别名映射**：seedream-4-5, seedream-4, seedream-3, seedream-5-0-lite, seedream-5, seedance

---

### 2. GPT Image系列（供应商：APIMart/PearAPI）

| 模型ID | 画面比例 | 分辨率档位 | 质量参数 | 参数类型 | 备注 |
|--------|---------|-----------|---------|---------|------|
| gpt-image-2 | auto, 1:1, 3:2, 2:3, 4:3, 3:4, 5:4, 4:5, 16:9, 9:16, 2:1, 1:2, 3:1, 1:3, 21:9, 9:21 (16种) | 1K, 2K, 4K | auto, low, medium, high | both | 同时支持resolution和quality |
| gpt-image-1 | auto, 1:1, 3:2, 2:3, 4:3, 3:4, 5:4, 4:5, 16:9, 9:16, 2:1, 1:2, 3:1, 1:3, 21:9, 9:21 (16种) | 1K, 2K, 4K | auto, low, medium, high | both | 同gpt-image-2 |
| gpt-image-1-mini | auto, 1:1, 3:2, 2:3, 4:3, 3:4, 5:4, 4:5, 16:9, 9:16, 2:1, 1:2, 3:1, 1:3, 21:9, 9:21 (16种) | 1K, 2K, 4K | auto, low, medium, high | both | 轻量版 |
| gpt-image-1.5 | auto, 1:1, 3:2, 2:3, 4:3, 3:4, 5:4, 4:5, 16:9, 9:16, 2:1, 1:2, 3:1, 1:3, 21:9, 9:21 (16种) | 1K, 2K, 4K | auto, low, medium, high | both | 中间版本 |
| chatgpt-image-latest | auto, 1:1, 3:2, 2:3, 4:3, 3:4, 5:4, 4:5, 16:9, 9:16, 2:1, 1:2, 3:1, 1:3, 21:9, 9:21 (16种) | 1K, 2K, 4K | auto, low, medium, high | both | 最新版本别名 |

**官方文档参考**：https://docs.apimart.ai/cn/api-reference/images/gpt-image-2/generation

---

### 3. DALL-E 3（供应商：OpenAI/APIMart/PearAPI）

| 模型ID | 画面比例 | 分辨率档位 | 质量参数 | 参数类型 | 备注 |
|--------|---------|-----------|---------|---------|------|
| dall-e-3 | 1:1, 16:9, 9:16 (3种) | 无 | standard, hd | quality | 像素尺寸: 1024x1024, 1792x1024, 1024x1792 |

**注意**：1792x1024约为1.75:1，不是精确16:9，但OpenAI将其归类为横版

---

### 4. Gemini系列（供应商：Google/APIMart/PearAPI）

| 模型ID | 画面比例 | 分辨率档位 | 质量参数 | 参数类型 | 备注 |
|--------|---------|-----------|---------|---------|------|
| gemini-2.5-flash-preview-image-generation | 1:1, 4:3, 3:4, 16:9, 9:16, 3:2, 2:3, 5:4, 4:5, 21:9, 9:21 (11种) | 1K | 无 | resolution | 仅支持1024px |
| gemini-2.5-pro-preview-image-generation | 1:1, 4:3, 3:4, 16:9, 9:16, 3:2, 2:3, 5:4, 4:5, 21:9, 9:21 (11种) | 1K, 2K | 无 | resolution | 支持1024和2048 |
| gemini-3-pro-image-preview | 1:1, 4:3, 3:4, 16:9, 9:16, 3:2, 2:3, 5:4, 4:5, 21:9, 9:21 (11种) | 1K, 2K | 无 | resolution | Gemini 3.0 Pro |
| gemini-3-flash-image-preview | 1:1, 4:3, 3:4, 16:9, 9:16, 3:2, 2:3, 5:4, 4:5, 21:9, 9:21 (11种) | 1K | 无 | resolution | 仅支持1024px |
| gemini-3.1-flash-image-preview | 1:1, 4:3, 3:4, 16:9, 9:16, 3:2, 2:3, 5:4, 4:5, 21:9, 9:21 (11种) | 1K, 2K, 4K | 无 | resolution | 完整分辨率档位 |

**官方文档参考**：https://ai.google.dev/gemini-api/docs/image-generation

---

### 5. Imagen系列（供应商：Google Vertex AI）

| 模型ID | 画面比例 | 分辨率档位 | 质量参数 | 参数类型 | 备注 |
|--------|---------|-----------|---------|---------|------|
| imagen-4-ultra | 1:1, 4:3, 3:4, 16:9, 9:16 (5种) | 1K, 2K | 无 | resolution | 高端版本 |
| imagen-4 | 1:1, 4:3, 3:4, 16:9, 9:16 (5种) | 1K, 2K | 无 | resolution | 标准版本 |
| imagen-3 | 1:1, 4:3, 3:4, 16:9, 9:16 (5种) | 1K | 无 | resolution | 仅支持1024px |

**官方文档参考**：https://cloud.google.com/vertex-ai/generative-ai/docs/image-generation

---

### 6. Flux系列（供应商：fal.ai/BFL/PearAPI）

| 模型ID | 画面比例 | 分辨率档位 | 质量参数 | 参数类型 | 备注 |
|--------|---------|-----------|---------|---------|------|
| flux-pro | 1:1, 4:3, 3:4, 16:9, 9:16, 3:2, 2:3, 21:9, 9:21 (9种) | 无 | 无 | none | 分辨率由width/height控制 |
| flux-1.1-pro | 1:1, 4:3, 3:4, 16:9, 9:16, 3:2, 2:3, 21:9, 9:21 (9种) | 无 | 无 | none | 升级版本 |
| flux-pro-ultra | 1:1, 4:3, 3:4, 16:9, 9:16, 3:2, 2:3, 21:9, 9:21 (9种) | 无 | 无 | none | 4MP输出 |
| flux-pro-ultra-fast | 1:1, 4:3, 3:4, 16:9, 9:16, 3:2, 2:3 (8种) | 无 | 无 | none | 快速版本 |
| flux-1.1-pro-ultra | 1:1, 4:3, 3:4, 16:9, 9:16, 3:2, 2:3 (8种) | 无 | 无 | none | 4MP输出 |
| flux-2 | 1:1, 4:3, 3:4, 16:9, 9:16, 3:2, 2:3 (8种) | 无 | 无 | none | Flux第二代 |
| flux-dev | 1:1, 4:3, 3:4, 16:9, 9:16, 3:2, 2:3 (8种) | 无 | 无 | none | 开发版本 |
| flux-schnell | 1:1, 4:3, 3:4, 16:9, 9:16, 3:2, 2:3 (8种) | 无 | 无 | none | 快速版本 |
| flux | 1:1, 4:3, 3:4, 16:9, 9:16, 3:2, 2:3 (8种) | 无 | 无 | none | 基础版本 |

**注意**：Flux系列通过image_size预设或width/height自由控制分辨率，无独立resolution参数

---

### 7. Stable Diffusion系列（供应商：APIMart/PearAPI/第三方代理）

| 模型ID | 画面比例 | 分辨率档位 | 质量参数 | 参数类型 | 备注 |
|--------|---------|-----------|---------|---------|------|
| stable-diffusion | 1:1, 4:3, 3:4, 16:9, 9:16, 3:2, 2:3 (7种) | 无 | standard, hd | quality | 第三方代理扩展参数 |
| sd-xl | 1:1, 4:3, 3:4, 16:9, 9:16, 3:2, 2:3 (7种) | 无 | standard, hd | quality | SDXL版本 |
| sdxl | 1:1, 4:3, 3:4, 16:9, 9:16, 3:2, 2:3 (7种) | 无 | standard, hd | quality | 别名 |
| sd-3 | 1:1, 4:3, 3:4, 16:9, 9:16, 3:2, 2:3 (7种) | 无 | standard, hd | quality | SD3版本 |

**注意**：SDXL官方分辨率: 1024x1024, 1152x896, 1216x832, 1344x768, 1536x640。standard/hd为第三方代理扩展参数。

---

### 8. Midjourney（供应商：APIMart/第三方代理）

| 模型ID | 画面比例 | 分辨率档位 | 质量参数 | 参数类型 | 备注 |
|--------|---------|-----------|---------|---------|------|
| midjourney | 1:1, 4:3, 3:4, 16:9, 9:16, 3:2, 2:3, 21:9 (8种) | 无 | 无 | none | 通过--ar参数控制比例 |

**注意**：Midjourney通过--ar参数支持任意比例，分辨率由比例自动计算

---

### 9. 可灵Kling（供应商：快手/火山引擎）

| 模型ID | 画面比例 | 分辨率档位 | 质量参数 | 参数类型 | 备注 |
|--------|---------|-----------|---------|---------|------|
| kling | 1:1, 4:3, 3:4, 16:9, 9:16, 3:2, 2:3 (8种) | 1K, 2K | 无 | resolution | 图像生成模型 |
| kling-v3 | 16:9, 9:16, 1:1 (3种) | 1K, 2K | 无 | resolution | 视频生成模型 |
| kling-v3-omni | 16:9, 9:16, 1:1 (3种) | 1K, 2K, 4K | 无 | resolution | 视频生成高端版本 |

**官方文档参考**：https://platform.kuaishou.com/docs/image-generation

---

### 10. Ideogram系列（供应商：PearAPI/APIMart）

| 模型ID | 画面比例 | 分辨率档位 | 质量参数 | 参数类型 | 备注 |
|--------|---------|-----------|---------|---------|------|
| ideogram | 1:1, 4:3, 3:4, 5:4, 4:5, 16:9, 9:16, 3:2, 2:3, 21:9, 9:21, 1:2, 2:1, 1:3, 3:1 (15种) | 无 | turbo, default, quality | quality | rendering_speed参数 |
| ideogram-3 | 1:1, 4:3, 3:4, 5:4, 4:5, 16:9, 9:16, 3:2, 2:3, 21:9, 9:21, 1:2, 2:1, 1:3, 3:1 (15种) | 无 | turbo, default, quality | quality | Ideogram 3.0版本 |

**注意**：Ideogram的"质量"参数实际是rendering_speed，控制生成速度而非画质。分辨率由aspect_ratio自动决定，支持69种尺寸组合。

---

### 11. HiDream（供应商：APIMart/PearAPI）

| 模型ID | 画面比例 | 分辨率档位 | 质量参数 | 参数类型 | 备注 |
|--------|---------|-----------|---------|---------|------|
| hidream | 1:1, 4:3, 3:4, 16:9, 9:16, 3:2, 2:3 (7种) | 1K, 2K | 无 | resolution | 最大2048x2048 |

---

### 12. PearAPI Nano Banana系列（供应商：PearAPI）

| 模型ID | 画面比例 | 分辨率档位 | 质量参数 | 参数类型 | 备注 |
|--------|---------|-----------|---------|---------|------|
| nano-banana | 1:1, 4:3, 3:4, 16:9, 9:16, 3:2, 2:3 (8种) | 1K | 无 | resolution | 基础版(Gemini 2.5 Flash Image) |
| nano-banana-2 | 1:1, 4:3, 3:4, 16:9, 9:16, 3:2, 2:3 (8种) | 1K, 2K | 无 | resolution | 进阶版(Gemini 3.1 Flash Image) |
| nano-banana-2-4k | 1:1, 4:3, 3:4, 16:9, 9:16, 3:2, 2:3 (8种) | 1K, 2K, 4K | 无 | resolution | 4K版 |
| nano-banana-pro | 1:1, 4:3, 3:4, 16:9, 9:16, 3:2, 2:3 (8种) | 1K, 2K | 无 | resolution | 专业版(Gemini 3 Pro Image) |
| nano-banana-pro-4k | 1:1, 4:3, 3:4, 16:9, 9:16, 3:2, 2:3 (8种) | 1K, 2K, 4K | 无 | resolution | 专业4K版 |

---

## 二、视频生成模型

### 可灵Kling视频（供应商：快手/火山引擎）

| 模型ID | 画面比例 | 分辨率档位 | 时长 | 备注 |
|--------|---------|-----------|------|------|
| kling-v3 | 16:9, 9:16, 1:1 (3种) | 1K, 2K | 3-15秒 | 标准版 |
| kling-v3-omni | 16:9, 9:16, 1:1 (3种) | 1K, 2K, 4K | 3-15秒 | 高端版 |

---

## 三、参数类型说明

| 参数类型 | 含义 | UI显示标签 | 示例模型 |
|---------|------|-----------|---------|
| resolution | 分辨率档位型 | "输出分辨率" | Seedream, Gemini, Kling |
| quality | 质量级别型 | "生成质量" | DALL-E 3, SDXL, Ideogram |
| both | 双参数型 | 同时显示两个选项 | GPT-Image系列 |
| none | 无参数型 | 不显示额外选项 | Flux, Midjourney |

---

## 四、分辨率档位对照表

| 档位 | 像素范围 | 适用模型 |
|------|---------|---------|
| 1K | 1024px级别 | Seedream 3/4, Gemini 2.5/3, Imagen 3, Kling, HiDream, Nano Banana |
| 2K | 2048px级别 | Seedream 4/4.5/5, Gemini 3 Pro/3.1, Imagen 4, Kling V3 Omni |
| 3K | 3072px级别 | Seedream 5.0 Lite |
| 4K | 4096px级别 | Seedream 4/5, Gemini 3.1 Flash, Kling V3 Omni, Nano Banana 4K |

---

## 五、供应商汇总

| 供应商 | 主要模型系列 | API域名 | 备注 |
|--------|-------------|---------|------|
| 火山引擎 Volcengine | Seedream, Seedance, Kling | volcengine.com | 国内主要图像/视频供应商 |
| APIMart | GPT-Image, DALL-E, Gemini, MJ | api.apimart.ai | OpenAI兼容网关 |
| PearAPI | GPT-Image, Nano Banana, Ideogram | api.pearapi.ai | 国内代理供应商 |
| Google | Gemini, Imagen | ai.google.dev | 官方直连 |
| OpenAI | GPT-Image, DALL-E | api.openai.com | 官方直连 |
| fal.ai | Flux | fal.ai | Flux官方API |
| 快手 | Kling | platform.kuaishou.com | 视频生成 |

---

**文档生成时间**: 2024年
**数据来源**: 各供应商官方API文档 + 管理员系统配置
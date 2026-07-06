# 模型参数传递路径分析报告

## 分析概述

本报告分析了当前程序中画面比例和图片分辨率/质量参数从前端UI到后端API调用的完整传递路径，检查是否能正确采用最新调整的配置。

## 分析结论

### ✅ 正确传递的部分

1. **前端UI（generation-panel.tsx）**
   - 正确导入并使用 `MODEL_ASPECT_RATIOS`、`MODEL_QUALITIES`、`getModelParamType`
   - 根据 `getModelParamType` 动态显示正确的参数类型标签
   - 当 `paramType === 'both'` 时，同时显示分辨率档位和生成质量两个参数
   - 使用 `findModelConfig` 动态获取当前模型支持的比例和质量选项

2. **API路由（generate/route.ts）**
   - 第68行：正确使用 `getModelParamType(modelId)` 判断参数类型
   - 第820-830行：根据参数类型正确处理参数传递
     - `'quality'` → 传递 `quality` 参数
     - `'resolution'` → 传递 `resolution` 参数（使用档位值）
     - `'both'` → 同时传递 `resolution` 和 `quality` 参数

3. **节点编辑器（node-editor.tsx）**
   - 正确导入 `MODEL_ASPECT_RATIOS` 和 `MODEL_QUALITIES`
   - 第3976行：动态获取模型支持的比例选项

### ⚠️ 发现的问题

#### 问题1：workflow-engine.ts 使用独立配置（中等风险）

**文件位置**：`src/lib/workflow-engine.ts`

**问题描述**：
- 第1236-1249行定义了独立的 `SHARED_ASPECT_RATIOS` 常量
- 该常量只有11种基础比例，遗漏了最新添加的比例：
  - `3:5`, `5:3`
  - `4:7`, `7:4`
  - `4:9`, `9:4`
  - `auto`（GPT-Image系列特有）

**影响范围**：工作流节点模式的画面比例选项不完整

**改进建议**：
```typescript
// 删除独立的SHARED_ASPECT_RATIOS定义
// 改为直接使用导入的MODEL_ASPECT_RATIOS
import { MODEL_ASPECT_RATIOS, getModelParamType } from './canvas-generation-group';

// 在buildNodeExecutionRequest中添加参数类型判断
const paramType = getModelParamType(modelId);
if (paramType === 'resolution') {
  body.resolution = quality; // 分辨率档位
} else if (paramType === 'quality') {
  body.quality = qualityMap[quality]; // 质量级别
} else if (paramType === 'both') {
  body.resolution = resolution;
  body.quality = qualityMap[quality];
}
```

#### 问题2：workflow-engine.ts 未使用参数类型判断（中等风险）

**文件位置**：`src/lib/workflow-engine.ts` 第1315-1350行

**问题描述**：
- `buildNodeExecutionRequest` 函数直接传递 `quality` 参数
- 没有根据 `getModelParamType` 判断参数类型
- 对于 GPT-Image 系列（`'both'` 类型），可能缺少 `resolution` 参数传递

**改进建议**：在 `buildNodeExecutionRequest` 中添加参数类型判断逻辑

#### 问题3：视频模型分辨率格式不一致（低风险）

**文件位置**：`src/lib/video-api.ts`

**问题描述**：
- Kling系列使用：`['1K', '2K', '4K']` 格式 ✅
- Seedance系列使用：`['720p', '1080p', '4K']` 格式 ⚠️（混合格式）

**影响范围**：前端视频生成面板的分辨率选项显示可能不一致

**改进建议**：统一视频模型分辨率格式为档位格式（`'1K', '2K', '4K'`）

## 参数传递路径图

```
┌─────────────────────────────────────────────────────────────────┐
│                    前端UI层 (generation-panel.tsx)              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐             │
│  │ aspectRatio │  │   quality   │  │ resolution  │             │
│  │   (比例)    │  │  (质量/档位)│  │  (档位)     │             │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘             │
│         │                │                │                     │
│         │    getModelParamType(modelId)   │                     │
│         │    判断参数类型: resolution/quality/both              │
│         │                │                │                     │
│         └────────────────┼────────────────┘                     │
│                          │                                      │
│                          ▼                                      │
│              onGenerate(params) → page.tsx                      │
└─────────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                 页面层 (page.tsx)                               │
│  handleGenerate(params) {                                       │
│    fetch('/api/generate', {                                     │
│      body: JSON.stringify({                                     │
│        ...params, // aspectRatio, quality, resolution           │
│        userId                                                   │
│      })                                                         │
│    })                                                           │
│  }                                                              │
└─────────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                 API路由层 (generate/route.ts)                   │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ inferModelConfig() → getModelParamType(modelId)          │  │
│  │ 返回: { paramType, supportedSizes, ... }                 │  │
│  └──────────────────────────────────────────────────────────┘  │
│                          │                                      │
│                          ▼                                      │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ 根据paramType处理参数:                                   │  │
│  │                                                          │  │
│  │ if (paramType === 'quality') {                           │  │
│  │   requestBody.quality = qualityMap[quality]              │  │
│  │ }                                                        │  │
│  │ if (paramType === 'resolution') {                        │  │
│  │   requestBody.resolution = quality                       │  │
│  │ }                                                        │  │
│  │ if (paramType === 'both') {                              │  │
│  │   requestBody.resolution = resolutionTier                │  │
│  │   requestBody.quality = qualityMap[quality]              │  │
│  │ }                                                        │  │
│  └──────────────────────────────────────────────────────────┘  │
│                          │                                      │
│                          ▼                                      │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ calculateActualPixels(aspectRatio, paramType, quality)   │  │
│  │ → requestBody.size = { width, height }                   │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                 模型API调用                                     │
│  requestBody = {                                                │
│    model: modelId,                                              │
│    prompt,                                                      │
│    size: { width, height },  // 像素尺寸                        │
│    resolution: '2K',          // 分辨率档位（部分模型）          │
│    quality: 'auto',           // 质量级别（部分模型）            │
│    ...                                                          │
│  }                                                              │
│  → 第三方API供应商                                              │
└─────────────────────────────────────────────────────────────────┘
```

## 验证检查清单

### 已验证 ✅

| 检查项 | 状态 | 说明 |
|--------|------|------|
| MODEL_ASPECT_RATIOS配置完整性 | ✅ | 包含所有模型的完整比例列表 |
| MODEL_QUALITIES配置完整性 | ✅ | 包含所有模型的完整质量/分辨率档位 |
| getModelParamType函数正确性 | ✅ | 正确返回 resolution/quality/both/none |
| generation-panel.tsx参数传递 | ✅ | 正确根据paramType传递参数 |
| generate/route.ts参数处理 | ✅ | 正确根据paramType处理参数 |
| node-editor.tsx配置使用 | ✅ | 正确导入和使用MODEL_ASPECT_RATIOS |

### 待改进 ⚠️

| 检查项 | 状态 | 说明 |
|--------|------|------|
| workflow-engine.ts配置使用 | ⚠️ | 使用独立的SHARED_ASPECT_RATIOS，遗漏新比例 |
| workflow-engine.ts参数类型判断 | ⚠️ | 未使用getModelParamType判断参数类型 |
| video-api.ts分辨率格式一致性 | ⚠️ | Seedance系列使用混合格式 |

## 改进方案

### 方案概述

修复上述3个问题，确保所有模块正确使用最新配置。

### 任务列表

#### 任务1：修复workflow-engine.ts配置使用
- 删除独立的SHARED_ASPECT_RATIOS定义
- 导入并使用MODEL_ASPECT_RATIOS
- 预估范围：小（1-2文件）

#### 任务2：添加workflow-engine.ts参数类型判断
- 在buildNodeExecutionRequest中添加getModelParamType判断
- 根据参数类型正确传递resolution/quality参数
- 预估范围：小（1文件）

#### 任务3：统一视频模型分辨率格式
- 将Seedance系列的'720p', '1080p'改为'1K', '2K'
- 预估范围：小（1文件）

### 验证步骤

1. TypeScript检查：`pnpm ts-check`
2. Lint检查：`pnpm lint`
3. 功能测试：在画布中测试不同模型的参数传递
4. 工作流测试：在工作流节点中测试参数传递

## 总结

当前程序**大部分功能可以正确采用最新调整的画面比例和分辨率质量配置**，主要问题集中在：

1. **workflow-engine.ts** 使用了独立的配置，需要统一
2. **workflow-engine.ts** 缺少参数类型判断，需要补充
3. **video-api.ts** 分辨率格式不一致，需要统一

建议按优先级修复：
- **P1**：任务1和任务2（影响工作流节点模式）
- **P2**：任务3（影响视频生成面板显示一致性）
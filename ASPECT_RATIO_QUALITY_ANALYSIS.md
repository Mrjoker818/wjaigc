# 画面比例与图片质量参数冲突分析报告

## 问题概述

用户反馈：画面比例包含尺寸，图片质量也包含尺寸，两者存在冲突。

## 当前系统实现分析

### 1. 画面比例 (aspectRatio) 的定义

**文件**: `src/lib/canvas-generation-group.ts`

```typescript
// 画面比例映射为像素尺寸
const ASPECT_RATIO_TO_PIXELS = {
  '1:1': { width: 1024, height: 1024 },
  '16:9': { width: 2048, height: 1152 },
  '4:3': { width: 2048, height: 1536 },
  ...
}
```

**问题**: 每个比例已经隐含了具体的像素尺寸！

### 2. 图片质量 (quality) 的定义

**文件**: `src/lib/canvas-generation-group.ts` (第748-752行)

```typescript
const qualityPixels: Record<string, number> = {
  '1K': 1024, '2K': 2048, '3K': 3072, '4K': 4096,
  'standard': 1024, 'hd': 1792, 'high': 1792,
  'low': 1024, 'medium': 1024, 'auto': 1024,
};
```

**问题**: quality 参数被当作"长边像素"处理，与画面比例的像素定义冲突！

### 3. 冲突场景示例

| 用户选择 | 当前系统计算 | 实际API期望 | 问题 |
|---------|-------------|------------|------|
| 16:9 + 2K | 从 `qualityPixels['2K']=2048` 计算 → 2048x1152 | Seedream: `size="2K"` + `ratio="16:9"` | 参数转换错误 |
| 1:1 + hd | 从 `qualityPixels['hd']=1792` 计算 → 1792x1792 | DALL-E 3: `quality="hd"` (固定1024x1024) | hd 是质量增强，不是尺寸 |
| 4:3 + standard | 从比例表 → 2048x1536 | GPT-Image: `quality="standard"` + size 另传 | standard 是质量级别，不是尺寸 |

## 不同模型API的参数差异

### 模型类型A：分辨率档位型 (Seedream, Flux 等)

**API参数格式**:
```json
{
  "size": "2K",           // 直接传分辨率档位字符串
  "aspectRatio": "16:9"   // 比例参数
}
```

**特点**: API 自己根据 size + aspectRatio 计算像素尺寸

### 模型类型B：质量增强型 (DALL-E 3, GPT-Image-1)

**API参数格式**:
```json
{
  "quality": "hd",        // 质量/细节级别 (standard/hd)
  "size": "1024x1024"     // 固定尺寸或自定义尺寸
}
```

**特点**: quality 是质量增强选项，与尺寸无关

### 模型类型C：纯像素尺寸型 (Flux, Stable Diffusion)

**API参数格式**:
```json
{
  "width": 1024,
  "height": 1024
}
```

**特点**: 直接传像素数值，无 quality 参数

## 参考项目对比

### 行业最佳实践（OpenClaw 文档）

```typescript
// 清晰分离四个概念
size: "1024x1024" | "1536x1024" | "2048x2048" ...  // 具体像素尺寸
aspectRatio: "1:1" | "16:9" | "4:3" ...            // 画面比例
resolution: "1K" | "2K" | "4K"                     // 分辨率档位
quality: "low" | "medium" | "high" | "auto"        // 质量/细节级别
```

**核心原则**: 不同概念应该分离，由前端智能组合后传给API。

### 常见误区

❌ **错误做法**: 将 resolution(1K/2K) 和 quality(low/high) 混为同一个参数
❌ **错误做法**: 在比例已经定义像素的情况下，再用 quality 覆盖尺寸

## 当前系统的问题根源

### 代码层面

**文件**: `src/lib/canvas-generation-group.ts` 第697-722行

```typescript
export function calculateActualPixels(
  aspectRatio: string,
  quality: string = 'standard',
  modelId?: string
): string {
  // 委托给规范数据源...
  if (modelId) {
    const result = getModelSpecificPixelSize(aspectRatio, quality, modelId);
    if (result) return result;
  }

  // 问题: 默认回退逻辑把 quality 当作像素长边
  const ratioMap = { '1:1': [1, 1], '16:9': [16, 9], ... };
  const [rw, rh] = ratioMap[aspectRatio] || [1, 1];
  const base = 1024;  // 固定基准
  // ... 计算
}
```

**问题**: 当模型不匹配时，fallback 逻辑错误地把 quality 理解为像素长边。

### UI层面

**文件**: `src/components/generation-panel.tsx`

- 画面比例和图片质量作为两个独立下拉框显示
- 用户可能选择冲突的组合（如 16:9 + 4K）
- 系统没有智能提示哪些组合对当前模型有效

## 调整方案

### 方案A：参数概念分离（推荐）

**改动范围**: 中等

**核心改动**:

1. **定义清晰的参数类型**

```typescript
// 新增类型定义
type ResolutionTier = '1K' | '2K' | '4K';           // 分辨率档位（部分模型）
type QualityLevel = 'low' | 'medium' | 'high' | 'standard' | 'hd';  // 质量级别
type AspectRatio = '1:1' | '4:3' | '16:9' | ...;    // 画面比例
type PixelSize = `${number}x${number}`;             // 具体像素尺寸
```

2. **模型能力注册表增强**

```typescript
// 在 model-capabilities.ts 中明确每个模型的参数类型
{
  modelId: 'seedream-5-0-lite',
  params: {
    resolution: { type: 'tier', values: ['1K', '2K', '4K'] },  // 分辨率档位
    aspectRatio: { type: 'ratio', values: ['1:1', '16:9', ...] },
    // 无 quality 参数
  }
}

{
  modelId: 'dall-e-3',
  params: {
    quality: { type: 'level', values: ['standard', 'hd'] },  // 质量级别
    size: { type: 'fixed', values: ['1024x1024'] },          // 固定尺寸
    // 无 aspectRatio 参数
  }
}

{
  modelId: 'gpt-image-1',
  params: {
    quality: { type: 'level', values: ['low', 'medium', 'high', 'auto'] },
    size: { type: 'pixels', values: ['1024x1024', '1024x1536', ...] },
    aspectRatio: { type: 'ratio', values: ['1:1', '4:3', ...] },
  }
}
```

3. **UI智能联动**

- 当选择 DALL-E 3 时：隐藏画面比例选项（固定1024x1024），只显示 quality
- 当选择 Seedream 时：隐藏质量选项，显示分辨率档位 + 画面比例
- 当选择 GPT-Image 时：显示画面比例 + 质量，尺寸由系统自动计算

### 方案B：保持现状但优化映射（最小改动）

**改动范围**: 小

**核心改动**:

1. **优化 `getModelSpecificPixelSize` 函数**

确保每个模型都有正确的参数映射，不再依赖错误的 fallback 逻辑。

2. **增加 UI 提示**

当用户选择冲突组合时显示警告："当前模型不支持此质量/比例组合"

### 方案C：简化为单一"尺寸"参数

**改动范围**: 大

**核心改动**:

- 移除画面比例和质量两个独立参数
- 改为直接选择"尺寸"：1024x1024、2048x1536 等
- 后端根据模型API格式自动转换

## 推荐实施顺序

| 优先级 | 方案 | 说明 |
|-------|------|------|
| P0 | 方案B | 最小改动，快速修复当前问题 |
| P1 | 方案A | 长期解决方案，参数概念清晰分离 |
| P2 | 方案C | 可选简化方案，降低用户理解成本 |

## 验收标准

### P0 修复验收

- [ ] 选择 Seedream + 16:9 + 2K 时，API 参数正确传递 `size="2K"`
- [ ] 选择 DALL-E 3 + hd 时，API 参数正确传递 `quality="hd"` (不传尺寸)
- [ ] 选择 GPT-Image + 16:9 + high 时，参数正确组合传递

### P1 重构验收

- [ ] 每个模型的参数类型在注册表中明确定义
- [ ] UI 根据模型能力动态显示/隐藏参数选项
- [ ] 无冲突组合的情况，用户无需理解底层参数差异

---

**报告日期**: 2026-01-04
**分析工具**: Planning Skill
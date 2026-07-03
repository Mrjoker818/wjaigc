# 无界AI升级计划（最终版）

> 基于 Planning 技能方法论制定 | 方案A：渐进式升级 | 排除GPU依赖功能 | **画布+节点双模式统一升级**

---

## 一、现状盘点

### 1.1 无界AI现有云端API能力（无需GPU）

| 能力类别 | 云端API支持 | 模型数量 | 状态 |
|---------|------------|---------|------|
| **图像生成** | OpenAI/DALL-E/Flux/Midjourney/国产 | 30+ | ✅ 完善 |
| **视频生成** | 可灵V3/Seedance/Vidu/Runway/Sora | 20+ | ✅ 完善 |
| **LLM聊天** | Gemini/GPT-4/DeepSeek/Kimi | 10+ | ✅ 完善 |
| **3D生成** | Meshy/Tripo/Hunyuan3D/Rodin | 4提供商 | ✅ 完善 |
| **图像编辑** | OpenAI images.edits + Gemini | 2提供商 | ✅ 完善 |
| **矢量生成** | 管理员矢量模型API + LLM fallback | 动态配置 | ✅ 完善 |
| **工作流节点** | DAG编排执行 | 30+节点类型 | ✅ 完善 |
| **积分系统** | PostgreSQL事务管理 | - | ✅ 完善 |

### 1.2 GPU依赖功能（可禁用，非核心）

| 功能 | 环境变量控制 | 禁用后替代 |
|------|-------------|-----------|
| IOPaint擦除(LaMa) | `LOCAL_AI_ENABLED=false` | AI云端API编辑 |
| RemoveBG去背景 | `LOCAL_AI_ENABLED=false` | AI云端API透明化 |
| Upscayl放大 | `LOCAL_AI_ENABLED=false` | AI云端API放大 |

**结论**：无界AI核心能力完全依赖云端API，不依赖GPU。

### 1.3 双模式架构分析

无界AI有两种操作模式，需要统一升级：

#### **画布模式（Canvas Mode）**

| 组件 | 文件 | 功能 |
|------|------|------|
| InfiniteCanvas | `infinite-canvas.tsx` | 无限画布、图片拖拽/缩放/编辑 |
| GenerationPanel | `generation-panel.tsx` | 图像生成控制面板 |
| VideoGenerationPanel | `video-generation-panel.tsx` | 视频生成控制面板 |
| ChatPanel | `chat-panel.tsx` | AI聊天、提示词优化、Skill模板 |
| ImageEditor | `image-editor.tsx` | 语言修图、蒙版编辑 |
| AgentEditor | `agent-editor.tsx` | Agent编排编辑 |

**核心特点**：直观、所见即所得、适合快速创作

#### **节点模式（Node Mode）**

| 组件 | 文件 | 功能 |
|------|------|------|
| NodeEditor | `node-editor.tsx` | 工作流节点编辑器、DAG拓扑 |
| WorkflowEngine | `workflow-engine.ts` | DAG执行引擎、节点类型定义 |
| WorkflowExecute API | `api/workflow/execute/route.ts` | 工作流执行API |

**已有30+节点类型**：

| 类别 | 节点类型 | 状态 |
|------|---------|------|
| 输入 | input-text, input-image, audio-input | ✅ 已有 |
| AI图像 | ai-generate, ai-remove-bg, ai-upscale, ai-retouch, ai-font-design, ai-refine-engine, ai-brand-ecommerce, ai-segment, ai-multi-angle, ai-3d-model | ✅ 已有 |
| AI视频 | ai-video-generate, ai-video-i2v | ✅ 已有 |
| AI音频 | ai-audio | ⚠️ 节点定义已有，API占位实现 |
| 控制 | condition, loop, agent, storyboard-sequence | ✅ 已有 |
| 输出 | output-image, output-export, output-image-group, output-video, output-audio | ✅ 已有 |

**核心特点**：可编程、可复用、适合批量处理和复杂流程

---

## 二、竞品功能对比矩阵

### 2.1 四大平台核心能力对比

| 功能维度 | 无界AI | Lovart | 即梦 | 星流AI |
|---------|--------|--------|------|--------|
| **无限画布** | ✅ 完整实现 | ❌ | ✅ 智能画布 | ❌ |
| **图生图** | ✅ 6类别强度滑块 | ✅ Touch Edit | ✅ | ✅ |
| **工作流节点** | ✅ DAG + AI建图 | ❌ | ❌ | ❌ |
| **视频生成** | ✅ 20+模型 | ❌ | ✅ 核心能力 | ❌ |
| **3D生成** | ✅ 4提供商 | ❌ | ❌ | ❌ |
| **风格一致性** | ❌ **缺失** | ✅ Style Consistency | ❌ | ❌ |
| **文字分层编辑** | ❌ **缺失** | ✅ Text Edit | ❌ | ❌ |
| **实时参考搜索** | ❌ **缺失** | ✅ Visual Insights | ❌ | ❌ |
| **中文提示词理解** | ✅ 基础支持 | ❌ | ✅ **核心优势** | ✅ |
| **Agent主动操作** | ⚠️ 被动建议 | ✅ Agentic Intelligence | ❌ | ❌ |
| **品牌资产沉淀** | ⚠️ 基础版 | ✅ Brand World | ❌ | ❌ |

### 2.2 无界AI优势与差距

**优势（领先竞品）**：
1. **工作流节点模式**：竞品均无此能力，是无界AI独特优势
2. **无限画布+节点双模式**：两种模式互补，覆盖不同用户场景
3. **3D生成**：4个云端提供商，竞品均无
4. **模型数量**：30+图像+20+视频，覆盖最广

**差距（需补齐）**：
1. **风格一致性**：Lovart核心能力，跨项目保持风格统一
2. **Agent主动操作**：AI从"建议者"升级为"执行者"
3. **品牌资产沉淀**：系统性存储品牌DNA，跨项目复用
4. **音频生成**：节点模式已有基础，画布模式需补充

---

## 三、P0升级计划（双模式统一升级）

### 3.0 升级原则：双模式统一

每个P0功能升级需同时考虑两个模式：

| 升级内容 | 画布模式影响 | 节点模式影响 |
|---------|-------------|-------------|
| ChatCanvas | chat-panel增强 | 新增ai-chat-canvas节点 |
| 预测性交互 | chat-panel增强 | 节点助手增强 |
| 风格一致性 | StyleDNA注入 | 节点Session绑定 |
| 品牌资产 | @品牌引用 | 节点BrandDNA参数 |
| 音频生成 | 新增面板 | 现有节点完善 |

---

### P0-1: ChatCanvas对话画布（AI队友模式）

#### 目标

将AI从"被动建议者"升级为"主动画布操作者"，用户说"把这张图放大"，AI直接执行而非文字建议。

#### 任务分解

| Task | 描述 | 验收标准 | 模式 |
|------|------|---------|------|
| **Task 1** | 创建CanvasActionExecutor | 能解析画布操作指令并执行 | 画布模式 |
| **Task 2** | 扩展chat-panel handleSend | 支持操作指令识别与执行 | 画布模式 |
| **Task 3** | 添加ai-chat-canvas节点 | 节点模式也能用对话驱动画布 | 节点模式 |
| **Task 4** | 双模式状态同步 | 节点执行结果同步到画布 | 双模式 |

#### 技术方案

**画布模式（Task 1-2）**：

```typescript
// lib/canvas-action-executor.ts
export const CANVAS_ACTIONS = {
  upscale: { fn: 'submitUpscale', params: ['scale'] },
  removeBg: { fn: 'submitRemoveBg', params: [] },
  img2img: { fn: 'submitImg2img', params: ['prompt', 'strength'] },
  edit: { fn: 'submitEdit', params: ['prompt'] },
  extend: { fn: 'submitExtend', params: ['direction', 'scale'] },
  move: { fn: 'moveImage', params: ['imageId', 'x', 'y'] },
  delete: { fn: 'deleteImage', params: ['imageId'] },
};

export async function executeCanvasAction(
  action: string,
  imageId: string,
  params: Record<string, any>,
  onProgress?: (progress: number) => void
): Promise<{ success: boolean; resultUrl?: string; error?: string }> {
  // 根据action调用对应API并返回结果
}
```

**节点模式（Task 3）**：

```typescript
// workflow-engine.ts 新增节点定义
{
  type: 'ai-chat-canvas',
  label: 'AI对话画布',
  category: 'AI图像',
  icon: 'MessageSquare',
  fields: [
    { key: 'prompt', type: 'textarea', label: '操作指令' },
    { key: 'targetImage', type: 'image-input', label: '目标图片' },
  ],
  inputs: [{ key: 'image', type: 'image', label: '输入图片' }],
  outputs: [{ key: 'result', type: 'image', label: '执行结果' }],
}
```

#### 验证步骤

- [ ] 用户说"放大这张图"，AI自动调用upscale API
- [ ] 用户说"去掉背景"，AI自动调用removeBg API
- [ ] 用户说"换成水彩风格"，AI自动调用img2img API
- [ ] 节点模式中使用ai-chat-canvas节点实现同样效果

---

### P0-2: 预测性交互系统（意图分类+追问+建议）

#### 目标

增强现有的`classifyIntentLevel`，实现模糊意图追问、完成后建议下一步。

#### 任务分解

| Task | 描述 | 验收标准 | 模式 |
|------|------|---------|------|
| **Task 1** | 增强意图分类器 | 支持操作意图识别（不只是生成） | 画布模式 |
| **Task 2** | 模糊追问模板 | 10种常见模糊场景追问模板 | 画布模式 |
| **Task 3** | 完成后建议引擎 | 根据结果类型推荐后续操作 | 画布模式 |
| **Task 4** | 节点助手增强 | 节点编辑时也能追问和建议 | 节点模式 |

#### 技术方案

**增强意图分类（Task 1）**：

```typescript
// chat-panel.tsx
const INTENT_TYPES = {
  generate: { keywords: ['生成', '创建', '画', '制作'], action: 'generate' },
  edit: { keywords: ['修改', '换成', '改成', '调整'], action: 'edit' },
  upscale: { keywords: ['放大', '高清', '提高分辨率'], action: 'upscale' },
  removeBg: { keywords: ['去背景', '抠图', '透明'], action: 'removeBg' },
  style: { keywords: ['风格', '换成', '改成'], action: 'img2img' },
  info: { keywords: ['分析', '描述', '识别'], action: 'analyze' },
};
```

**追问模板（Task 2）**：

```typescript
const CLARIFY_TEMPLATES = {
  no_subject: '您想生成什么内容？比如人物、风景、产品？',
  no_style: '您偏好什么风格？写实、插画、水彩、3D？',
  no_size: '需要什么尺寸？头像、海报、横幅？',
  no_reference: '有参考图片吗？可以@引用画布图片',
  multi_conflict: '您提到了多种风格，请选择其一：{styles}',
};
```

#### 验证步骤

- [ ] 用户输入"生成一张图"，追问"生成什么内容？"
- [ ] 用户输入"把这张图改一下"，追问"您想怎么修改？"
- [ ] 生成完成后，显示"建议下一步：放大/去背景/图生图"

---

### P0-3: 风格一致性系统（StyleDNA）

#### 目标

Session级别的风格绑定，跨生成保持风格统一，对标Lovart Style Consistency。

#### 任务分解

| Task | 描述 | 验收标准 | 模式 |
|------|------|---------|------|
| **Task 1** | StyleDNA数据结构 | 存储风格指纹（色彩/笔触/构图） | 基础设施 |
| **Task 2** | Session绑定机制 | 当前Session绑定一个StyleDNA | 画布模式 |
| **Task 3** | 自动注入提示词 | 生成时自动追加StyleDNA描述 | 画布模式 |
| **Task 4** | 节点Session支持 | 工作流节点也能绑定StyleDNA | 节点模式 |

#### 技术方案

**StyleDNA数据结构（Task 1）**：

```typescript
// types/style-dna.ts
interface StyleDNA {
  id: string;
  name: string;
  sourceImages: string[]; // 参考图片URL
  extractedStyle: {
    colorPalette: string[]; // 色彩方案
    brushStyle: string; // 笔触风格
    compositionPattern: string; // 构图模式
    lightingType: string; // 光照类型
  };
  promptTemplate: string; // 自动生成的风格提示词
}
```

**自动注入（Task 3）**：

```typescript
// 在/api/generate中
if (sessionStyleDNA) {
  const stylePrompt = `[style:${sessionStyleDNA.promptTemplate}]`;
  body.prompt = stylePrompt + ' ' + body.prompt;
}
```

#### 验证步骤

- [ ] 用户上传参考图，系统提取风格DNA
- [ ] 后续生成自动追加风格提示词
- [ ] 多次生成结果风格保持一致

---

### P0-4: 品牌资产系统性沉淀（BrandDNA）

#### 目标

系统性存储品牌DNA（色彩/字体/调性/禁区），@品牌引用自动注入systemPrompt。

#### 任务分解

| Task | 描述 | 验收标准 | 模式 |
|------|------|---------|------|
| **Task 1** | BrandDNA数据结构 | 存储品牌规范 | 基础设施 |
| **Task 2** | @品牌引用UI | 输入框@触发品牌列表 | 画布模式 |
| **Task 3** | systemPrompt注入 | @品牌自动注入品牌规范 | 双模式 |
| **Task 4** | 节点BrandDNA参数 | 节点支持选择品牌绑定 | 节点模式 |

#### 技术方案

**BrandDNA数据结构（Task 1）**：

```typescript
// types/brand-dna.ts
interface BrandDNA {
  id: string;
  name: string;
  logoUrl?: string;
  colorPalette: {
    primary: string;
    secondary: string[];
    accent: string;
  };
  typography: {
    primaryFont: string;
    secondaryFont: string;
    headingStyle: string;
  };
  tone: string; // 品牌调性描述
  restrictions: string[]; // 禁区规则
}
```

---

### P0-5: 音频生成能力完善

#### 目标

完善音频生成API（TTS），节点模式已有基础，画布模式新增音频面板。

#### 任务分解

| Task | 描述 | 验收标准 | 模式 |
|------|------|---------|------|
| **Task 1** | TTS API集成 | 调用云端TTS API（OpenAI/EdgeTTS） | API层 |
| **Task 2** | 音频播放器组件 | 支持播放/暂停/进度控制 | 画布模式 |
| **Task 3** | 画布音频卡片 | 音频在画布显示为卡片 | 画布模式 |
| **Task 4** | 节点ai-audio完善 | 完善现有节点执行逻辑 | 节点模式 |

#### 技术方案

**TTS API集成（Task 1）**：

```typescript
// api/audio/generate/route.ts
// 优先调用配置的TTS API，降级到本地占位音频
if (process.env.OPENAI_TTS_API_KEY) {
  // 调用OpenAI TTS API
} else if (process.env.EDGETTS_ENDPOINT) {
  // 调用EdgeTTS
} else {
  // 生成占位音频（已有实现）
}
```

---

## 四、实施路线

### Week 1：基础+核心交互

| 任务 | 预估时间 | 依赖 |
|------|---------|------|
| P0-2 Task 1-2：意图分类增强+追问模板 | 1天 | 无 |
| P0-2 Task 3：完成后建议引擎 | 1天 | Task 1-2 |
| P0-1 Task 1：CanvasActionExecutor | 2天 | 无 |

### Week 2：核心能力+资产系统

| 任务 | 预估时间 | 依赖 |
|------|---------|------|
| P0-1 Task 2-3：chat-panel扩展+节点 | 2天 | P0-1 Task 1 |
| P0-3 Task 1-3：StyleDNA系统 | 2天 | 无 |
| P0-4 Task 1-2：BrandDNA+@引用 | 1天 | 无 |

### Week 3：完善+验证

| 任务 | 预估时间 | 依赖 |
|------|---------|------|
| P0-3/4 Task 4：节点模式集成 | 2天 | P0-3/4 Task 1-3 |
| P0-5 Task 1-4：音频生成完善 | 2天 | 无 |
| 全量验证 | 1天 | 所有任务 |

---

## 五、风险与缓解

| 集成 | 影响 | 缓解策略 |
|------|------|----------|
| TTS API不可用 | 中 | 多策略降级（OpenAI→EdgeTTS→本地占位） |
| 风格提取不准确 | 中 | 用户可手动编辑StyleDNA描述 |
| 双模式状态同步复杂 | 高 | 使用统一状态管理（page.tsx） |
| CanvasAction覆盖不全 | 中 | 优先实现高频操作（放大/去背景/图生图） |

---

## 六、验收检查点

### 检查点1：Week 1结束

- [ ] chat-panel能识别操作意图并追问
- [ ] CanvasActionExecutor能执行放大/去背景
- [ ] `pnpm ts-check` 通过
- [ ] `pnpm lint` 通过

### 检查点2：Week 2结束

- [ ] AI能主动执行画布操作
- [ ] StyleDNA能提取风格并注入提示词
- [ ] @品牌引用能注入systemPrompt
- [ ] 核心API冒烟测试通过

### 检查点3：Week 3结束

- [ ] 节点模式所有P0功能可用
- [ ] 音频生成完整可用
- [ ] 双模式状态同步正常
- [ ] 用户验收测试通过

---

## 七、总结

本升级计划确保**画布模式**和**节点模式**同步升级，保持无界AI双模式互补的独特优势。所有功能依赖云端API，无需GPU。

**关键成果**：
1. AI从"建议者"升级为"队友"（ChatCanvas）
2. 风格跨项目保持一致（StyleDNA）
3. 品牌资产系统沉淀（BrandDNA）
4. 音频生成完整可用（节点已有，画布新增）
5. 双模式统一体验
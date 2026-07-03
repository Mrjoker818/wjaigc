# 无界AI升级计划（最终版）

> 基于 Planning 技能方法论制定 | 方案A：渐进式升级 | 排除GPU依赖功能

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
| **预测性交互** | ⚠️ 部分实现 | ✅ | ❌ | ❌ |

### 2.2 竞品核心差异化能力分析

#### Lovart核心优势（需对标）

| 能力 | 描述 | 无界AI差距 |
|------|------|-----------|
| **Agentic Intelligence** | AI像设计师一样系统思考，而非单次生成 | 现有AI是"助手"而非"队友" |
| **Touch Edit** | 精准选择区域编辑，保留其他部分不变 | 现有蒙版编辑功能类似，但交互不够直观 |
| **Style Consistency** | 跨迭代、格式、项目保持风格一致 | **完全缺失**，每次生成风格独立 |
| **Text Edit** | 文字分层，可移动/重写而不破坏画面 | **完全缺失**，文字无法独立编辑 |
| **Visual Insights** | 实时搜索设计参考，转为创意方向 | **完全缺失**，无参考搜索能力 |

#### 即梦核心优势（需对标）

| 能力 | 描述 | 无界AI差距 |
|------|------|-----------|
| **中文语义理解** | 更好的中文提示词理解能力 | 现有基础支持，但不如即梦专精 |
| **首尾帧控制** | 精准控制视频首帧到尾帧 | ✅ 已支持 |
| **智能画布** | 多图层编辑、精细化控制 | 无界画布更强，有DAG工作流 |
| **创作同款** | 一键复用社区作品参数 | **缺失**，无社区系统 |

---

## 三、P0升级计划（方案A渐进式）

### 优先级排序原则

1. **用户价值最大化**：直接影响用户体验的功能优先
2. **实现难度适中**：选择可在1-2周完成的任务
3. **云端API可行**：确保不依赖GPU
4. **复用现有架构**：在现有组件基础上增强，而非新建

### P0-1: ChatCanvas对话画布（AI队友模式）

#### 验收标准
- [ ] 用户说"把这张图放大"，AI直接执行放大操作，结果添加到画布
- [ ] 用户说"换成水彩风格"，AI调用图生图API并替换原图
- [ ] 用户说"去掉背景"，AI调用去背景API并添加透明图到画布
- [ ] AI执行操作后显示工具执行记录（ToolExecution）
- [ ] 支持@图片引用 + 自然语言指令组合

#### 实施步骤（方案A：在chat-panel基础上增强）

**Task 1-1: 创建CanvasActionExecutor**
```typescript
// src/lib/canvas-action-executor.ts
interface CanvasAction {
  type: 'upscale' | 'remove_bg' | 'img2img' | 'extend' | 'edit';
  targetImageId: string;
  params: Record<string, unknown>;
}

async function executeCanvasAction(action: CanvasAction): Promise<{
  success: boolean;
  resultImages?: string[];
  error?: string;
}> {
  // 根据action.type调用对应API
  // upscale → /api/image/upscale-pro
  // remove_bg → /api/image-edit (action: removebg)
  // img2img → /api/generate (图生图模式)
  // extend → /api/image-edit (action: extend)
  // edit → /api/edit
}
```

**Task 1-2: 扩展chat-panel handleSend支持画布操作**

在`handleSend`函数中添加：
```typescript
// 解析用户消息中的画布操作意图
const canvasAction = parseCanvasActionIntent(trimmedInput, imageAnchors);
if (canvasAction) {
  // 执行画布操作而非纯对话
  const result = await executeCanvasAction(canvasAction);
  // 将结果图片添加到画布（通过onAddImages回调）
  if (result.resultImages) {
    onAddImages?.(result.resultImages);
  }
  // 返回执行结果而非纯文字回复
  assistantMessage.toolExecutions = [{
    toolName: canvasAction.type,
    status: 'completed',
    resultImages: result.resultImages
  }];
}
```

**Task 1-3: 添加画布操作意图解析器**

```typescript
// src/lib/canvas-action-parser.ts
const CANVAS_ACTION_PATTERNS = {
  upscale: ['放大', 'upscale', '高清', '变清晰', '提升分辨率'],
  remove_bg: ['去掉背景', '移除背景', '抠图', 'remove background', '透明背景'],
  img2img: ['换成.*风格', '变成.*风格', '改.*风格', '风格换成', '变体'],
  extend: ['扩展画面', '扩图', '延伸', 'extend', '扩大画布'],
  edit: ['修改', '编辑', '改一下', '调整', '修图']
};

function parseCanvasActionIntent(
  input: string,
  imageAnchors: ImageAnchor[]
): CanvasAction | null {
  // 匹配操作关键词 + 提取目标图片
  // 返回结构化的CanvasAction对象
}
```

**依赖**：无

**预估范围**：中（3-5文件：canvas-action-executor.ts, canvas-action-parser.ts, chat-panel.tsx, api路由复用）

---

### P0-2: 预测性交互系统（意图分类+追问+建议）

#### 验收标准
- [ ] 极度模糊输入（<10字+无图）→ AI返回追问消息
- [ ] 中等模糊输入 → 自动补全并执行
- [ ] 复杂多步输入 → 拆解流程建议
- [ ] 生成完成后显示"建议下一步"区域（至少3个建议）
- [ ] 建议可点击，自动填充指令并执行

#### 实施步骤

**Task 2-1: 增强classifyIntentLevel函数**

现有代码已有`classifyIntentLevel`，需增强：

```typescript
// src/lib/intent-classifier.ts
interface IntentLevel {
  level: 'extremely_fuzzy' | 'moderately_fuzzy' | 'clear' | 'complex_multi_step';
  missingFields: string[]; // 缺失的信息字段
  suggestedQuestions: string[]; // 追问问题列表
  autoCompletions?: string[]; // 自动补全建议
}

function classifyIntentLevel(
  input: string,
  hasImage: boolean
): IntentLevel {
  // <10字 + 无图 → extremely_fuzzy
  // 有关键词但缺少参数 → moderately_fuzzy
  // 明确指令 → clear
  // 包含"和"/"然后"/"接着" → complex_multi_step
}
```

**Task 2-2: 追问消息渲染（isClarifying消息类型）**

```typescript
// chat-panel.tsx 消息渲染
{message.isClarifying && (
  <ClarifyingMessage
    questions={message.clarifyingQuestions}
    onSelect={(answer) => {
      // 用户回答后自动补全到输入框
      setInput(prev => prev + ' ' + answer);
    }}
  />
)}
```

**Task 2-3: 建议下一步组件增强**

现有`suggestions`字段已实现，需增强：
- 根据生成内容类型智能推荐（图生图/放大/去背景/视频延长等）
- 添加快捷操作按钮（一键执行而非填充输入框）

**依赖**：无

**预估范围**：小（1-2文件：intent-classifier.ts, chat-panel.tsx增强）

---

### P0-3: 风格一致性系统（Style Consistency）

#### 验收标准
- [ ] 用户可设置"当前风格"（颜色/字体/调性描述）
- [ ] 后续生成自动附加风格提示词
- [ ] 同一会话内生成图片风格一致
- [ ] 支持保存风格为模板，跨会话复用

#### 实施步骤

**Task 3-1: StyleDNA数据结构**

```typescript
// src/types/style-dna.ts
interface StyleDNA {
  id: string;
  name: string;
  colors: string[]; // 主色/辅色
  tone: string; // 调性描述（极简/华丽/复古等）
  fontHint?: string; // 字体倾向
  promptSuffix: string; // 附加到每次生成的提示词后缀
  createdAt: number;
}
```

**Task 3-2: Session级别StyleDNA绑定**

```typescript
// chat-panel.tsx ChatSession扩展
interface ChatSession {
  // ...existing fields
  styleDNA?: StyleDNA; // 当前会话绑定的风格
}

// handleSend中自动注入
if (session.styleDNA) {
  enhancedPrompt = `${userPrompt} ${session.styleDNA.promptSuffix}`;
}
```

**Task 3-3: StyleDNA设置面板**

在聊天面板顶部添加风格选择器：
```tsx
<StyleSelector
  currentStyle={session.styleDNA}
  onSetStyle={(style) => {
    updateSession({ styleDNA: style });
  }}
  onSaveStyle={(style) => {
    // 保存到localStorage/数据库
  }}
/>
```

**依赖**：无

**预估范围**：中（3-5文件：types/style-dna.ts, chat-panel.tsx, components/style-selector.tsx）

---

### P0-4: 品牌资产系统性沉淀（BrandDNA）

#### 验收标准
- [ ] 用户可输入品牌描述（名称/行业/调性/色彩/字体/禁区）
- [ ] @品牌引用自动注入BrandDNA到systemPrompt
- [ ] 品牌资产持久化存储（localStorage + 数据库）
- [ ] 品牌资产跨面板可用（聊天/生成/工作流）

#### 实施步骤

**Task 4-1: BrandDNA数据结构**

```typescript
// src/types/brand-dna.ts
interface BrandDNA {
  id: string;
  name: string;
  industry: string;
  tone: string; // 品牌调性
  primaryColors: string[];
  secondaryColors: string[];
  fonts: { heading: string; body: string };
  avoidKeywords: string[]; // 禁区关键词（不使用）
  mustKeywords: string[]; // 必要关键词
  logoGuidelines?: string;
  createdAt: number;
  updatedAt: number;
}
```

**Task 4-2: 品牌工厂面板（BrandFactoryPanel）**

```tsx
// src/components/brand-factory-panel.tsx
<BrandFactoryPanel
  onSave={(brand) => {
    // 存储到localStorage + 数据库
    // 更新@品牌引用列表
  }}
/>
```

**Task 4-3: @品牌引用系统**

```typescript
// chat-panel.tsx activeMentions扩展
interface ActiveMention {
  type: 'canvas-image' | 'brand' | 'model' | 'prompt';
  id: string;
  label: string;
  data?: BrandDNA; // 品牌数据
}

// 发送时注入
if (mention.type === 'brand' && mention.data) {
  systemPrompt += `\n【品牌规范】\n${mention.data.tone}\n色彩：${mention.data.primaryColors.join(',')}`;
}
```

**依赖**：P0-3 StyleDNA（可并行）

**预估范围**：中（3-5文件：types/brand-dna.ts, brand-factory-panel.tsx, chat-panel.tsx）

---

### P0-5: 音频生成能力（云端API）

#### 验收标准
- [ ] 支持音频生成API调用（管理员配置音频模型）
- [ ] 音频播放器组件（播放/暂停/进度条）
- [ ] 视频生成时可选同时生成音效
- [ ] 音频文件添加到画布（音频卡片）

#### 实施步骤

**Task 5-1: 音频API协议层**

```typescript
// src/lib/audio-api.ts
interface AudioGenerateParams {
  prompt: string;
  model: string; // suno/udio/elevenlabs等
  duration?: number;
  providerId?: string;
}

// 管理员后台新增音频模型类型
```

**Task 5-2: 音频生成面板**

```tsx
// src/components/audio-generation-panel.tsx
<AudioGenerationPanel
  onGenerate={(params) => {
    // 调用 /api/audio/generate
  }}
  onAddToCanvas={(audioUrl) => {
    // 添加音频卡片到画布
  }}
/>
```

**Task 5-3: 音频播放器**

```tsx
// src/components/audio-player.tsx
<AudioPlayer
  src={audioUrl}
  onPlay={() => {}}
  onEnded={() => {}}
/>
```

**Task 5-4: CanvasImage扩展音频类型**

```typescript
// user-types.ts
interface CanvasImage {
  // ...existing
  mediaType?: 'image' | 'video' | 'audio';
  audioUrl?: string;
  audioDuration?: number;
}
```

**依赖**：无

**预估范围**：中（4-6文件：audio-api.ts, audio-generation-panel.tsx, audio-player.tsx, api/audio/generate/route.ts）

---

## 四、P1升级计划（次要优化）

### P1-1: 中文提示词理解增强

- 与LLM提供商合作优化中文语义解析
- 添加中文提示词自动优化功能

### P1-2: Skill模板系统增强（21预设→扩展）

- 新增电商/品牌/分镜等专业Skill
- Skill可引用BrandDNA

### P1-3: 实时参考搜索（Visual Insights）

- 集成图片搜索API（Bing/Google）
- 搜索结果转为创意方向提示词

---

## 五、实施路线（方案A）

### 第1阶段：基础能力（1周）

```
Week 1:
  ├─ Day 1-2: P0-2 预测性交互系统（已有基础，增强即可）
  ├─ Day 3-4: P0-1 CanvasActionExecutor + 意图解析器
  └─ Day 5: 检查点：AI可执行画布操作
```

### 检查点1：预测性交互 + 画布操作

- [ ] 用户模糊输入得到追问
- [ ] 用户说"放大这张图"，AI执行并添加结果到画布
- [ ] lint/ts-check/测试通过

### 第2阶段：风格系统（1周）

```
Week 2:
  ├─ Day 1-3: P0-3 风格一致性系统
  ├─ Day 4-5: P0-4 品牌资产沉淀（BrandDNA）
  └─ Day 5: 检查点：风格/品牌可跨生成复用
```

### 检查点2：风格一致性 + 品牌沉淀

- [ ] 设置风格后连续生成风格一致
- [ ] @品牌引用自动注入品牌规范
- [ ] 风格/品牌可保存复用

### 第3阶段：音频能力（1周）

```
Week 3:
  ├─ Day 1-2: 音频API协议层 + 管理员后台
  ├─ Day 3-4: 音频生成面板 + 播放器
  └─ Day 5: 检查点：音频可生成并添加到画布
```

### 检查点3：音频生成完整流程

- [ ] 管理员可配置音频模型
- [ ] 用户可生成音频并播放
- [ ] 音频可添加到画布

---

## 六、风险与缓解

| 风险 | 影响 | 缓解策略 |
|------|------|----------|
| CanvasActionExecutor API调用失败 | 高 | 多策略降级（API→本地→提示用户手动操作） |
| 意图解析准确率低 | 中 | 规则+LLM双重解析，置信度阈值控制 |
| 风格一致性效果不理想 | 中 | 提示词模板优化，用户可调整强度 |
| 音频API提供商不稳定 | 中 | 多提供商配置，自动切换 |

---

## 七、不实施的功能（GPU依赖）

以下功能因无界服务器无GPU，暂时不实施：

| 功能 | 原因 | 替代方案 |
|------|------|---------|
| 本地实时渲染 | 需GPU | 云端API生成 |
| 本地模型推理 | 需GPU | 云端API调用 |
| 高性能视频转码 | 需GPU | 云端API处理 |
| 实时3D渲染 | 需GPU | Three.js基础渲染（已有） |

---

## 八、验收总清单

### P0功能验收

- [ ] **ChatCanvas**：用户说"放大这张图"，AI执行并添加结果
- [ ] **预测性交互**：模糊输入得到追问，清晰输入直接执行
- [ ] **风格一致性**：设置风格后连续生成风格一致
- [ ] **品牌沉淀**：@品牌引用注入规范，跨面板可用
- [ ] **音频生成**：可生成音频，播放器正常，可添加到画布

### 技术验收

- [ ] `pnpm lint` 通过
- [ ] `pnpm ts-check` 通过
- [ ] `pnpm build` 成功
- [ ] 所有新增API路由冒烟测试通过
- [ ] 单元测试覆盖率 ≥ 80%

---

**报告生成时间**：2025-01-XX  
**实施方案**：方案A（渐进式升级）  
**GPU依赖**：无（完全云端API）
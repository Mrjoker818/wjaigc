# 无限画布核心功能真实测试计划

## 概述

对无界 AI 平台的三大核心区域进行**端到端真实测试**（不 mock、不伪造、不伪造成功响应）：① 图像生成面板全部功能（**三大板块全覆盖，无遗漏**：快速创作 / 专业创作 / AI 矢量）；② AI 聊天面板全部功能；③ 无限画布图片操作（先检索功能再逐一测试）。测试覆盖"前端按钮 → 调用函数 → 后端 API → 真实提供商/本地引擎 → 结果"完整链路，最终**输出测试报告**，**不做任何代码调整**，由用户审阅后决定是否修复/升级。

## 技术方案

| 维度 | 选择 | 理由 |
|------|------|------|
| 测试形态 | 真实链路测试（非 mock） | 用户明确要求"不能以可点击就确认没问题，要验证每个功能实实在在可用" |
| 后端验证 | curl 真实调用各功能对应 API（带内网认证头） | 验证服务端对第三方/本地引擎的真实请求与真实响应 |
| 前端交互 | 组件逻辑测试（jest/testing-library，如有）+ 前端→API 链路参数核对 | 画布拖拽/框选/快捷键等交互无法 API 模拟，通过组件行为与状态验证 |
| 素材 | 生成真实测试图片（含透明/多尺寸） | 满足参考图、图生图、擦除、去背景、放大等需要图片输入的功能 |
| 依赖核验 | 启动前确认提供商配置/本地引擎/模型文件状态 | 区分"功能缺陷"与"配置/环境缺失" |
| 报告格式 | 功能矩阵：入口→调用链→测试方式→结果→证据 | 支持逐项验收与根因分类 |

## 功能模块（测试清单）

### A. 图像生成面板 — 三大板块全覆盖（createMode 三 Tab）

> 用户明确要求：**图像生成面板现在有三大板块，都需要真实测试，不能有任何遗漏**。左侧"图像生成"面板由 `canvas-workspace.tsx` 的 `createMode` 切换为三个板块：**快速创作 / 专业创作 / AI 矢量**。测试时逐板块核对、不允许跳项。

#### 板块一：快速创作（QuickCreatePanel，src/components/quick-create-panel.tsx）
- 创作目标分组（GOAL_GROUPS 六组：热门创作/品牌识别/商业营销/空间美陈/内容出版/数字创意，每组含多个预设目标卡片，点击填充提示词）
- 创意描述输入框（自由输入创作需求）
- 意图识别（`classifyIntent` 本地意图分类 → `describeIntent` 意图描述展示，含 action 判定 image/video/chat/extend）
- 提示词编译（`quick-create-compile` LLM 编译 → 正向/负向提示词展示，可复制；编译失败降级"按原始需求提交"提示）
- 参考图上传（`uploadedReferences`，含选中画布图片开关 `includeSelectedImage`）
- 模型/比例/质量/数量覆盖（仅本次生效，不改管理员默认/专业创作最近选择/聊天当前模型）
- 生成按钮 → `onGenerate`（`handleQuickGenerate`：意图判定 → 编译 → `/api/generate` 全链路）
- 生成后快捷动作：生成同系列（跳专业创作）/ 继续优化（跳 AI 聊天）/ 生成视频（跳视频面板）
- 结果展示与复制（正向/负向提示词复制按钮）

#### 板块二：专业创作（GenerationPanel，src/components/generation-panel.tsx）
> 该板块内部又分三个区域，均需真实测试：

**主生成区（文生图核心表单）**
- 图像模型选择（`/api/models?type=image` 加载，5 提供商 20 模型；切换时按模型动态刷新比例/分辨率/质量选项）
- 产品品类（通用/人物/风景/建筑等预设场景）
- 创意描述输入框（可拖拽调整高度；`#N` 锚点引用参考图、`R1/R2` 引用 Alt 参考标记；`/` 触发模板弹窗；Enter/Tab 快捷操作）
- 提示词方程式按钮（打开方程式面板）
- 快速风格标签（按品类动态生成，点击填充描述）
- 设计类型 / 风格预设（按设计类型动态变化）
- 画面比例（含比例图形预览，矩形按宽高比计算）
- 输出参数：分辨率档位 / 生成质量档位（按模型 paramType 动态显示：both/resolution/quality）
- 生图数量
- 生成按钮 → `/api/generate` 提交（taskId）→ 轮询 `/api/poll-task` / SSE `/api/task-events` → 结果入库画布（含 processing frame、进度、取消、排队位置）
- 第三方模型调用对话框

**多图参考区（参考图片）**
- 参考图片槽位（最多 10 张，`MAX_REF_IMAGES=10`）：新增参考图 / 上传参考图 #N / 拖拽上传
- 参考类型标签（REF_CATEGORIES：风格/构图/场景/色彩/主体/细节 六类，可 toggle 多选）
- 强度滑块（0-100%，显示百分比）
- 参考图删除、缩略图 + `#N` 锚点标签
- 参考图标记注入描述（Alt+Click 画布标记 → `R1/R2` 引用、`#N` 锚点解析）
- 生成时参考图随请求提交（服务端解析）

**Ctrl+Click 画布参考融合区（参考融合）**
- Ctrl+Click 画布选图 → 生成面板参考融合区（`ctrlRefSelections`，选中图列表）
- 参考融合关键词输入区、融合描述输入框
- 融合生成按钮 → `onFusionGenerate`（canvas-workspace 的 `handleFusionGenerate`：构建融合提示词 + 设置参考图 + 触发 `/api/generate` 全链路）
- 移除参考图按钮（`onRemoveCtrlRef`）
- 无选中图时该板块不渲染（`ctrlRefSelections.length > 0` 条件）

#### 板块三：AI 矢量（VectorDesignPanel，src/components/vector-design/vector-design-panel.tsx）
- 模式切换（4 种：`generate` 生成矢量设计 / `image-to-image` 参考创作 / `vectorize` 位图描摹 / `explore` 相似方向探索；不支持的模型禁用对应模式）
- Recraft 矢量模型加载（`/api/models` 过滤 Recraft vector，`getVectorModelCapabilities` 能力判定，默认/首选模型自动选中）
- 参考图片（模式需要时显示）：画布图片（选中图）/ 上传图片（格式校验：参考创作支持 PNG/JPG/WEBP/SVG，描摹仅 PNG/JPG/WEBP）
- 创意描述 / 风格预设（`selection`，INITIAL_SELECTION 预设集）
- 画面比例（1:1 等）、生成数量（1-N）
- 生成参数（Recraft 原生风格 `nativeStyle` / 自定义风格 `customStyleId`（从参考图创建，`/api/vector-style` 类端点）/ 相似度 `similarity` / 负向提示词 / 艺术级别 `artisticLevel` / 调色板开关与自定义颜色 / 背景色开关与颜色 / 随机种子）
- 生成按钮 → `/api/vector-design` 或对应端点 → 返回可编辑 SVG 资产列表
- explore 相似方向：一键生成 8 个相似设计方向
- 生成结果：资产列表展示、编辑（打开 VectorEditorDialog）/ 加入画布（`onAddVector` → `handleAddVectorAsset` 插入画布 + 连线 + toast）
- 与画布联动：选中图片作为参考/描摹源

### B. AI 聊天面板（chat-panel.tsx）
- 模型选择（`/api/models?type=chat`）+ 多轮对话（SSE 流式 `/api/chat`，含历史上下文）
- Agent 编排（多 Agent 定义、AgentBuilderDialog、工具执行记录）
- 提示词优化（增强/扩展/精简三模式，优化历史记录复用，一键发送到生成面板）
- Skill 系统（创建/浏览/搜索/调用/删除/导入导出，21 预设 Skill 按类别分类，localStorage 持久化）
- @引用系统（@图片/@品牌/@模型/@提示词，chip 标签可删除，品牌 DNA 注入 systemPrompt）
- Tab 模式（选中画布图片 → 图片上下文模式，缩略图 + 退出按钮）
- Tune 模式（风格强度/创意度/色调偏移三滑块，参数注入上下文）
- 快速命令面板（闪电图标，8 个常用指令模板）
- 模糊意图主动追问（`[CLARIFY]` 标记 + 追问）
- 生成后建议引擎（`💡 建议下一步` 快捷按钮）
- 图像理解（多模态图片 URL 发送）
- 提示词库（模板）/ 第三方模型对话框

### C. 无限画布图片操作（infinite-canvas.tsx）
- 选择体系：单击单选 / Ctrl 多选 / 框选 / 对象识别（智能选择）
- 成组：框选→快捷键成组（Ctrl+G）、组命名/重命名、组内拖拽
- 生成组：Alt+左键 参考图组 / Ctrl+左键 融图组（融图组生图、参考图组生图）
- HexCube 3D 立方体组
- 快捷键：Ctrl+Z 撤回 / Ctrl+Shift+Z 重做 / Delete 删除 / 空格抓手 / ESC 退出 / Ctrl+V 粘贴
- 图片工具栏（选中后顶部）：放大、移除背景、擦除、蒙版、编辑元素、扩展、图生图、裁切、下载（PNG/SVG/PSD）、横竖重组、精修引擎、元素拆解、Agent 编排、3D 模型、语言修图、SVG 智能描摹
- 右键菜单（图片/画布）：全部操作项
- 连线（生成关系 variant/reference/edit/img2img/upscale/trace）
- 底部工具栏：选择/平移/上传/缩放/重置

## 是否有原型设计

否（本计划为现有功能的测试验证，不涉及任何 UI/页面开发）

## 实施步骤

1. **检索功能清单**：读取 quick-create-panel / generation-panel / vector-design / chat-panel / infinite-canvas 及关联 lib，枚举全部功能点、入口、对应 API 与调用链，输出功能矩阵（含已配置的提供商/模型/技能清单）— 涉及 `src/components/quick-create-panel.tsx`、`src/components/generation-panel.tsx`、`src/components/vector-design/vector-design-panel.tsx`、`src/components/chat-panel.tsx`、`src/components/infinite-canvas.tsx`
2. **准备测试环境**：确认认证头、提供商配置（图像/聊天/放大/去背景/矢量模型）、本地引擎状态（torch LaMa / ONNX Real-ESRGAN / BiRefNet）、生成真实测试图片素材、核对 /space 故障影响面 — 涉及 `src/lib/server-api-config.ts`、`src/lib/image-tools/config.ts`、`scripts/*.py`
3. **真实测试图像生成面板（三大板块，无遗漏）**：
   - **板块一 快速创作**：目标分组与预设卡片、自由输入 + 意图识别展示、提示词编译（正向/负向展示与复制、编译失败降级）、参考图上传/画布图开关、模型/比例/质量/数量覆盖、生成→编译→`/api/generate`→结果全链路、生成同系列/继续优化/生成视频跳转
   - **板块二 专业创作**：主生成区（模型加载/切换、品类、描述 `#N`/`/` 模板、提示词方程、快速风格、设计类型/风格预设、比例、分辨率/质量、数量、生成→轮询/SSE→入库画布全链路含取消/队列）+ 多图参考区（上传超 10 张边界、六类 toggle、强度、删除/锚点、随请求生效）+ Ctrl+Click 参考融合区（选图→板块出现、关键词/融合描述、融合生成全链路、移除参考）
   - **板块三 AI 矢量**：4 模式切换与模型能力禁用、Recraft 模型加载、参考图（画布/上传/格式校验）、风格预设、比例/数量、生成参数（原生风格/自定义风格创建/相似度/负向/艺术级/调色板/背景/种子）、生成→可编辑 SVG、explore 8 方向、结果编辑/加入画布
   - 逐项记录结果与证据
4. **真实测试 AI 聊天面板**：逐项真实测试多轮对话（SSE）、Agent 编排、提示词优化三模式、Skill 系统、@引用、Tab/Tune 模式、意图追问、建议引擎、画布操作执行、图像理解，记录结果与证据
5. **真实测试画布图片操作**：按功能矩阵逐项验证选择/框选/成组/快捷键/工具栏各编辑功能（放大/擦除/蒙版/扩展/裁切/下载等）→ 对应 API 真实调用，融图组/参考图组生图全链路，记录结果与证据
6. **汇总输出测试报告**：功能矩阵 + 通过率统计 + 失败项根因分类（代码缺陷 / 依赖缺失 / 环境故障 / 配置缺失）+ 证据链，不做任何代码调整，交付用户审阅

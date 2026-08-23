# 原生透明 PNG 生图能力实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让无界所有生图入口共享原生透明 PNG 能力，并以真实 Alpha 校验、明确失败和无隐藏扣费完成闭环。

**Architecture:** 新增客户端安全的纯函数请求构建器与持久化偏好层，复用现有模型能力表；`/api/generate` 在服务端再次规范化并拒绝不支持的显式透明请求。通用面板、画布直连、工作流和聊天工具分别接入同一领域类型，生成结果使用 Sharp 检查真实 Alpha，并把验证状态随任务结果返回。

**Tech Stack:** Next.js 16、React 19、TypeScript 5、Vitest、Playwright、Sharp。

## Global Constraints

- 所有改动基于 `origin/main` 提交 `6102572bc6ff90e20ef522c79bc5c0b846f7cde7`。
- `stable` 分支不可修改。
- 透明生成失败不得静默调用去背景模型、切换供应商或产生隐藏扣费。
- `auto` 模式保持现有生成行为。
- 多图结果逐张返回、逐张校验，不回退为整批等待。
- 参考图、融图、图生图的现有图片参数不得丢失。
- 不在本轮修改 Pear PSD、本地元素分层或去背景引擎。

---

### Task 1: 统一透明输出领域类型与请求构建器

**Files:**
- Create: `src/lib/image-generation-output.ts`
- Test: `src/__tests__/lib/image-generation-output.test.ts`

**Interfaces:**
- Produces: `ImageBackgroundMode`、`ImageOutputFormat`、`ImageOutputPreference`。
- Produces: `resolveImageOutputPreference(modelId, requested)`。
- Produces: `withImageOutputPreference(body, modelId, requested)`。
- Produces: `detectTransparentBackgroundIntent(text)`。

- [ ] **Step 1: 写失败测试**，覆盖 GPT Image 透明模式强制 PNG、`auto` 不增加多余字段、不支持模型移除自动背景参数但拒绝显式透明请求、中文/英文透明意图识别。
- [ ] **Step 2: 运行 `pnpm exec vitest run src/__tests__/lib/image-generation-output.test.ts`**，确认因模块不存在而失败。
- [ ] **Step 3: 最小实现纯函数**，只依赖 `getModelCapabilities()`，不访问浏览器 API。
- [ ] **Step 4: 重跑测试**，预期全部通过。
- [ ] **Step 5: 提交 `feat: add native transparent output contract`**。

### Task 2: 持久化偏好与共享背景控件

**Files:**
- Create: `src/lib/image-generation-output-preference.ts`
- Create: `src/components/generation-background-control.tsx`
- Modify: `src/components/generation-panel.tsx`
- Test: `src/__tests__/lib/image-generation-output-preference.test.ts`
- Test: `src/__tests__/components/generation-background-control.test.tsx`

**Interfaces:**
- Consumes: Task 1 的领域类型与能力解析。
- Produces: `readImageOutputPreference(modelId)`、`writeImageOutputPreference(modelId, value)`。
- Produces: `<GenerationBackgroundControl modelId value onChange />`。
- Updates: `GenerationParams` 新增 `background?: ImageBackgroundMode` 与 `outputFormat?: ImageOutputFormat`。

- [ ] **Step 1: 写失败测试**，验证按模型保存偏好、损坏存储回退 `auto`、透明选项只在支持模型可用、透明模式显示 PNG 锁定说明。
- [ ] **Step 2: 运行两个聚焦测试并确认 RED**。
- [ ] **Step 3: 实现存储适配器和控件**，使用现有紧凑表单样式，不新增弹窗。
- [ ] **Step 4: 在主生成面板接入控件**，模型变化时读取对应偏好，提交时写入 `GenerationParams`。
- [ ] **Step 5: 重跑聚焦测试并提交 `feat: expose transparent background generation control`**。

### Task 3: 统一客户端画布生图入口

**Files:**
- Modify: `src/components/canvas-workspace.tsx`
- Modify: `src/components/infinite-canvas.tsx`
- Modify: `src/components/chat-panel.tsx`
- Modify: `src/components/scene-studio-panel.tsx`
- Modify: `src/components/sticker-assistant-panel.tsx`
- Test: `src/__tests__/components/generation-output-entry-contract.test.ts`
- Test: `src/__tests__/components/infinite-canvas-direct-generation-contract.test.ts`

**Interfaces:**
- Consumes: `withImageOutputPreference()` 与按模型保存的偏好。
- Produces: 每个客户端 `/api/generate` 请求都包含经能力过滤的规范字段。

- [ ] **Step 1: 写静态契约与行为测试**，枚举当前客户端直连 `/api/generate` 的文件，要求请求体通过统一构建器。
- [ ] **Step 2: 运行测试并确认所有未接入入口失败**。
- [ ] **Step 3: 逐一改造主面板提交、画布直连、参考图组、融图组、图生图、全景、六面体、场景和贴纸入口**，保留原请求体所有字段。
- [ ] **Step 4: 为业务面板生成按钮增加只读“透明 PNG”状态提示，不复制背景模式状态机**。
- [ ] **Step 5: 运行入口契约、多图槽位和参考图契约测试，预期全部通过**。
- [ ] **Step 6: 提交 `feat: propagate transparent output across canvas generation entries`**。

### Task 4: 工作流、聊天与 Agent 接入

**Files:**
- Modify: `src/lib/workflow-engine.ts`
- Modify: `src/lib/chat-tools.ts`
- Modify: `src/lib/agent-runtime/tool-registry.ts`
- Modify: `src/lib/agent-runtime/generate-image-adapter.ts`
- Modify: `src/app/api/simple-chat/chat/route.ts`
- Test: `src/__tests__/lib/workflow-transparent-output.test.ts`
- Test: `src/__tests__/lib/chat-tools-transparent-output.test.ts`
- Test: `src/__tests__/api/chat-agent-transparent-output.test.ts`

**Interfaces:**
- Consumes: `ImageBackgroundMode`、`detectTransparentBackgroundIntent()`、`withImageOutputPreference()`。
- Produces: 图像生成节点的 `background` 字段和 Agent 工具参数 `background`。

- [ ] **Step 1: 写失败测试**，验证工作流字段进入请求、聊天明确透明语义进入工具参数、普通提示词保持 `auto`。
- [ ] **Step 2: 运行测试并确认 RED**。
- [ ] **Step 3: 扩展工作流图像节点字段和请求构建**，透明模式强制 PNG。
- [ ] **Step 4: 扩展 `generate_image` 工具 schema 与适配器**，显式参数优先，文本意图仅在参数缺失时使用。
- [ ] **Step 5: 重跑聚焦测试并提交 `feat: support transparent output in workflow and agent generation`**。

### Task 5: 服务端规范化与供应商兼容错误

**Files:**
- Modify: `src/app/api/generate/route.ts`
- Modify: `src/lib/model-capabilities.ts`
- Test: `src/__tests__/api/generate-transparent-output-contract.test.ts`
- Test: `src/__tests__/api/generate-provider-capabilities.test.ts`

**Interfaces:**
- Consumes: `withImageOutputPreference()`。
- Produces: camelCase 兼容输入转换为 `background` / `output_format`，再进入现有 provider 请求。

- [ ] **Step 1: 写失败测试**，覆盖 camelCase 兼容、透明强制 PNG、显式透明请求对不支持模型返回明确 400、`auto` 不改变旧请求。
- [ ] **Step 2: 运行测试并确认 RED**。
- [ ] **Step 3: 在模型/供应商解析完成后执行一次服务端规范化**，禁止静默切换模型或供应商。
- [ ] **Step 4: 确认 Responses API、OpenAI images 和兼容供应商都读取同一规范字段**。
- [ ] **Step 5: 运行 API 聚焦测试并提交 `fix: normalize transparent image generation requests`**。

### Task 6: 真实 Alpha 校验与结果元数据

**Files:**
- Create: `src/lib/generated-image-alpha.ts`
- Modify: `src/app/api/generate/route.ts`
- Modify: `src/lib/cloud-task-persistence.ts`
- Test: `src/__tests__/lib/generated-image-alpha.test.ts`
- Test: `src/__tests__/api/generate-transparent-result.test.ts`

**Interfaces:**
- Produces: `AlphaVerificationStatus = 'verified' | 'opaque' | 'unverified' | 'invalid'`。
- Produces: `verifyGeneratedImageAlpha(input)`，限制下载字节、像素和超时。
- Adds task result: `alphaVerification?: { requested: boolean; status: AlphaVerificationStatus }`。

- [ ] **Step 1: 用测试夹具生成真透明 PNG、全不透明 PNG、棋盘格 PNG 和损坏文件，写失败测试**。
- [ ] **Step 2: 运行测试并确认 RED**。
- [ ] **Step 3: 用 Sharp 实现通道检测**，远程结果沿用安全下载边界，不信任扩展名或 MIME。
- [ ] **Step 4: 在每张结果完成时独立记录状态**，不得阻塞其他槽位展示。
- [ ] **Step 5: 透明请求返回不透明结果时保留原图并返回明确警告，不创建第二任务**。
- [ ] **Step 6: 重跑聚焦测试并提交 `feat: verify generated PNG alpha channel`**。

### Task 7: 全量回归与真实浏览器验收

**Files:**
- Create: `tests/e2e/native-transparent-generation.spec.ts`
- Modify: `docs/testing/REGRESSION_REPORT.md`
- Modify: `docs/testing/UNVERIFIED_ITEMS.md`

**Interfaces:**
- Consumes: Tasks 1–6 的完整行为。
- Produces: Chromium/Firefox/WebKit 证据和真实供应商待验证项。

- [ ] **Step 1: 写 Playwright 测试**，覆盖支持模型显示控件、不支持模型禁用、透明选择锁定 PNG、请求字段、Alpha 标识、下载后 Alpha 保留。
- [ ] **Step 2: 运行 `pnpm exec vitest run`、`pnpm ts-check`、`pnpm lint`、`pnpm build`**，修复本轮引入的具体失败。
- [ ] **Step 3: 运行 `pnpm exec playwright test tests/e2e/native-transparent-generation.spec.ts --project=chromium --project=firefox --project=webkit`**。
- [ ] **Step 4: 在云端使用真实 `gpt-image-2` 生成透明 PNG**，保存请求、任务、画布结果、下载文件和 Alpha 检测证据；没有真实凭证时标记未验证，不用 Mock 冒充。
- [ ] **Step 5: 更新中文回归报告与未验证项**。
- [ ] **Step 6: 最终提交 `test: verify native transparent generation across entries`**。

## 自检

- 规格覆盖：所有入口、能力控制、服务端兜底、Alpha 检验、失败计费和多图逐张返回均有对应任务。
- 边界控制：分层引擎升级已明确移出本轮，不与透明生成混改。
- 类型一致：客户端使用 camelCase 领域类型，HTTP 统一为 `background` 与 `output_format`。
- 无静默降级：不支持、拒绝或伪透明都返回明确状态，不自动调用去背景。

## 2026-08-24 执行状态

- Task 1–6：已按 TDD 完成并分别提交。
- Task 7 Step 1：真实付费 Playwright 用例已建立，五个浏览器项目可发现。
- Task 7 Step 2：全仓 Vitest、TypeScript、零错误 ESLint 和生产构建通过；PostgreSQL 环境测试保持明确跳过。
- Task 7 Step 3–4：因本地缺少真实登录凭据、精确 GPT Image 2 提供商标识和付费开关，真实浏览器付费生成未执行，保持未验证。
- Task 7 Step 5：中文回归、发布准备度和未验证清单已更新。
- 本轮没有实施非专用模型分层；该能力继续遵循规格中的独立后续架构，不与透明生成混改。

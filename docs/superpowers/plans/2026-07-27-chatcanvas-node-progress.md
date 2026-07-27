# ChatCanvas Node Annotation And Progress Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复节点模式批注拖拽和模型重置，并在共享批注输入栏中显示可信的阶段进度。

**Architecture:** 节点工作区继续复用现有控制器和 Overlay，只让图片退出指针命中；模型选择通过一个纯函数解析首选值；进度由后端阶段更新、客户端归一化和 Composer 展示三层组成。

**Tech Stack:** Next.js 16、React 19、TypeScript、Vitest、Playwright。

## Global Constraints

- 完成状态只能来自后端 `completed` 终态。
- 平滑进度最高为 `95%`，失败、取消和超时必须停止。
- 不按供应商名称硬编码模型黑名单。
- 不改变现有批注请求、幂等、扣费和授权协议。

---

### Task 1: Node Annotation Gesture Regression

**Files:**
- Modify: `tests/e2e/annotation-core.spec.ts`
- Modify: `src/__tests__/components/node-annotation-wiring.test.ts`
- Modify: `src/features/annotations/node-annotation-workspace.tsx`

**Interfaces:**
- Consumes: `NodeAnnotationWorkspace` 根节点 Pointer 事件。
- Produces: 可完成的节点模式 region/brush 手势。

- [ ] **Step 1: Write the failing tests**

在 E2E 打开节点批注工作区后，分别点击 region 和 brush，使用真实鼠标拖动，断言对应的 `[data-annotation-kind][data-annotation-id]` 数量增加。源码测试断言图片包含 `draggable={false}` 和 `pointer-events-none`。

- [ ] **Step 2: Run tests to verify failure**

Run: `pnpm vitest run src/__tests__/components/node-annotation-wiring.test.ts`

Expected: FAIL because the node image is still draggable and pointer-active.

- [ ] **Step 3: Implement the minimal fix**

为节点工作区 `NextImage` 设置 `draggable={false}`、`pointer-events-none select-none object-contain`，并添加 `onDragStart={(event) => event.preventDefault()}`。

- [ ] **Step 4: Run focused tests**

Run: `pnpm vitest run src/__tests__/components/node-annotation-wiring.test.ts`

Expected: PASS.

### Task 2: Stable Preferred Model Selection

**Files:**
- Modify: `src/features/annotations/node-annotation-workspace.tsx`
- Modify: `src/components/node-editor.tsx`
- Modify: `src/__tests__/components/node-annotation-wiring.test.ts`

**Interfaces:**
- Produces: `resolveNodeAnnotationModelId(models, currentId, preferredId, bundleId): string`.
- Consumes: `preferredModelId?: string` from `NodeEditor`.

- [ ] **Step 1: Write model selection tests**

覆盖已有 bundle、当前有效选择、父级首选模型、模型列表 fallback 四种顺序，并断言模型数组刷新时当前有效值不会变化。

- [ ] **Step 2: Run test to verify failure**

Run: `pnpm vitest run src/__tests__/components/node-annotation-wiring.test.ts`

Expected: FAIL because `preferredModelId` and resolver do not exist.

- [ ] **Step 3: Add the resolver and prop wiring**

使用纯函数集中解析模型 ID；Effect 只在当前模型无效或会话来源变化时更新。

- [ ] **Step 4: Run focused tests**

Run: `pnpm vitest run src/__tests__/components/node-annotation-wiring.test.ts`

Expected: PASS.

### Task 3: Shared Annotation Progress UI

**Files:**
- Modify: `src/features/annotations/annotation-composer.tsx`
- Modify: `src/__tests__/components/annotation-tool-wiring.test.ts`
- Modify: `src/components/infinite-canvas.tsx`
- Modify: `src/features/annotations/node-annotation-workspace.tsx`

**Interfaces:**
- Produces: `executionProgress`, `executionStage`, `executionStartedAt` composer props.
- Consumes: normalized progress callbacks from the task client.

- [ ] **Step 1: Write the failing composer test**

渲染执行中的 Composer，断言存在 `role="progressbar"`、`aria-valuenow`、阶段文本、百分比、已用时间和取消按钮。

- [ ] **Step 2: Run test to verify failure**

Run: `pnpm vitest run src/__tests__/components/annotation-tool-wiring.test.ts`

Expected: FAIL because progress props and progressbar are absent.

- [ ] **Step 3: Implement progress props and UI**

在 Composer 的执行操作区加入稳定尺寸的进度展示，保持非执行状态布局不变。

- [ ] **Step 4: Wire infinite canvas execution state**

提交前设置阶段“正在校验批注”，收到 taskId 后记录开始时间；`waitForAnnotationTaskResult.onProgress` 更新进度；完成、失败和取消时清理状态。

- [ ] **Step 5: Run focused tests**

Run: `pnpm vitest run src/__tests__/components/annotation-tool-wiring.test.ts`

Expected: PASS.

### Task 4: Backend Stage Progress

**Files:**
- Modify: `src/app/api/edit/route.ts`
- Modify: `src/features/annotations/annotation-executor.ts`
- Modify: `src/__tests__/features/annotation-executor.test.ts`
- Modify: `src/__tests__/components/annotation-task-client.test.ts`

**Interfaces:**
- Produces: monotonic task progress and human-readable stage labels.
- Consumes: existing `updateTaskProgress` and edit task store.

- [ ] **Step 1: Write failing progress tests**

断言任务进度按 `5 -> 15 -> 30 -> 45 -> 90 -> 100` 单调更新；客户端收到 processing 时上限为 `95`，completed 时为 `100`。

- [ ] **Step 2: Run tests to verify failure**

Run: `pnpm vitest run src/__tests__/features/annotation-executor.test.ts src/__tests__/components/annotation-task-client.test.ts`

Expected: FAIL because intermediate stages are not emitted or normalized.

- [ ] **Step 3: Implement stage updates**

在真实执行边界调用现有任务更新函数；同步型供应商等待阶段保持在模型处理区间，保存结果前设置 `90`。

- [ ] **Step 4: Run focused tests**

Run: `pnpm vitest run src/__tests__/features/annotation-executor.test.ts src/__tests__/components/annotation-task-client.test.ts`

Expected: PASS.

### Task 5: Regression And Build Verification

**Files:**
- Modify: `tests/e2e/annotation-core.spec.ts`
- Update: `docs/testing/REGRESSION_REPORT.md`

**Interfaces:**
- Consumes: all changes from Tasks 1-4.
- Produces: permanent browser evidence and release result.

- [ ] **Step 1: Run annotation unit suite**

Run: `pnpm vitest run src/__tests__/components/node-annotation-wiring.test.ts src/__tests__/components/annotation-tool-wiring.test.ts src/__tests__/features/annotation-executor.test.ts src/__tests__/components/annotation-task-client.test.ts`

Expected: PASS.

- [ ] **Step 2: Run Chromium annotation E2E**

Run: `pnpm playwright test tests/e2e/annotation-core.spec.ts --project=chromium`

Expected: PASS with screenshots, video and trace retained by configured reporters.

- [ ] **Step 3: Run static verification**

Run: `pnpm ts-check`

Expected: PASS.

Run: `pnpm build`

Expected: PASS.

- [ ] **Step 4: Update regression report**

记录 commit、环境、测试命令、结果、未验证的真实供应商范围和证据路径。

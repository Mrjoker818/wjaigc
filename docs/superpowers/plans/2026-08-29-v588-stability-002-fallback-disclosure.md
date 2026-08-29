# V588-STABILITY-002 Fallback Disclosure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让元素拆解准确披露 Pear 远程分层未完成后的退款与本地回退，避免把父任务完成误报为 Pear 成功，也不把供应商超时等其他原因虚构成质量门禁失败。

**Architecture:** 分层子任务从持久化 `CloudTask.creditStatus` 输出事实，元素拆解父任务原样投影，React 界面只基于显式字段显示状态。现有质量门禁、账务和任务终态逻辑保持不变。

**Tech Stack:** TypeScript 5、Next.js 16、React 19、Vitest

## Global Constraints

- 不调整任何分层质量门禁阈值。
- 不修改扣费、退款、取消或终态转换逻辑。
- 不运行新的付费 Pear 任务。
- 只修改并提交 `main`；不得修改 `stable`。

---

### Task 1: 锁定元数据透传契约

**Files:**
- Modify: `src/__tests__/lib/element-decomposition-idempotency.test.ts`
- Modify: `src/__tests__/components/element-decomposition-ui.test.ts`

**Interfaces:**
- Consumes: `LayerTaskResponse` 的 `result.engine`、`fallbackReason`、`providerError`、`creditStatus`
- Produces: 父分支响应与 UI 披露的失败回归测试

- [x] **Step 1: Write the failing service projection test**

模拟已完成的本地回退子任务，断言父任务 `branches.layers` 保留 `fallbackReason`、`providerError` 和 `creditStatus: 'refunded'`。

- [x] **Step 2: Write the failing UI disclosure test**

断言画布源码包含退款回退判断、分支说明和完成 Toast 文案。

- [x] **Step 3: Run RED tests**

Run: `pnpm exec vitest run src/__tests__/lib/element-decomposition-idempotency.test.ts src/__tests__/components/element-decomposition-ui.test.ts`

Expected: 新增断言因元数据尚未透传且界面尚未披露而失败。

### Task 2: 最小实现事实透传

**Files:**
- Modify: `src/lib/layer-decomposition/types.ts`
- Modify: `src/lib/layer-decomposition/service.ts`
- Modify: `src/lib/element-decomposition/service.ts`
- Modify: `src/lib/element-decomposition/client.ts`

**Interfaces:**
- Consumes: `CloudTask.creditStatus`
- Produces: `LayerTaskResponse.creditStatus` 和 `ElementBranchState` 的显式回退元数据

- [x] **Step 1: Add typed credit status to the layer response**

复用 `CloudTaskCreditStatus`，由 `toTaskResponse()` 返回数据库任务的真实状态。

- [x] **Step 2: Project layer metadata into the parent branch**

活动父任务轮询 `layers` 分支时原样写入 `creditStatus`、`fallbackReason` 和 `providerError`；历史终态父任务仅通过纯存储快照在当前响应中投影已终态子任务，不领取 lease、不推进子任务、不回写终态。重试分支时清除上一轮诊断字段。

- [x] **Step 3: Run service tests GREEN**

Run: `pnpm exec vitest run src/__tests__/lib/element-decomposition-idempotency.test.ts`

Expected: PASS。

### Task 3: 明确界面状态

**Files:**
- Modify: `src/components/infinite-canvas.tsx`

**Interfaces:**
- Consumes: `ElementDecomposeBranchResponse.creditStatus`、`fallbackReason`、`result.engine`
- Produces: 分支卡片说明与完成 Toast

- [x] **Step 1: Add a single disclosure predicate**

仅在本地引擎、存在回退原因且已退款三个条件同时满足时生成退款文案。

- [x] **Step 2: Render branch engine and fallback disclosure**

在可编辑图层分支卡片内显示实际引擎和琥珀色说明；诊断原因放入 `title`。

- [x] **Step 3: Use the disclosure for the completed toast**

有退款回退时显示指定警告 Toast，否则保留普通完成 Toast。

- [x] **Step 4: Run UI tests GREEN**

Run: `pnpm exec vitest run src/__tests__/components/element-decomposition-ui.test.ts`

Expected: PASS。

### Task 4: 回归与发布证据

**Files:**
- Modify: `docs/testing/BUG_REGISTER.md`
- Modify: `docs/testing/REGRESSION_REPORT.md`
- Modify: `docs/testing/RELEASE_READINESS_REPORT.md`
- Modify: `docs/testing/UNVERIFIED_ITEMS.md`

**Interfaces:**
- Consumes: 测试和云端验收结果
- Produces: 可追踪发布证据

- [x] **Step 1: Run all gates**

Run: `pnpm ts-check`, `pnpm lint`, `pnpm test`, `pnpm build`

Expected: 全部通过且无新增错误。

- [ ] **Step 2: Commit and push main**

只暂存本计划列出的源码、测试与报告文件；校验 `origin/stable` 未改变。

- [ ] **Step 3: Validate exact SHA in Coze and existing Chrome tabs**

确认 Coze HEAD 为目标提交，强制刷新已有预览标签页，验证界面可加载且状态文案存在；不创建新标签页、不运行付费任务。

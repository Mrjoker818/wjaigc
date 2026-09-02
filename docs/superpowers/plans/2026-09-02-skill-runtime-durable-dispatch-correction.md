# Skill 运行内核持久调度纠偏实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 Skill 首次执行与恢复执行共享数据库调度租约，并统一持久结果、实际计费类型和重试返回语义。

**Architecture:** 在 Task 4 的 `wujie_agent_execution_leases`、generation fence 和同任务执行器上增加 Skill 首次调度及有界恢复，不引入新任务表或第二账务边界。规范化步骤描述同时驱动报价、冻结、registry 和执行；终态保存图片资产与文本输出。

**Tech Stack:** Next.js 16、React 19、TypeScript 5、Vitest、PostgreSQL、现有 Agent Runtime 与 CloudTask 存储。

## Global Constraints

- 只修改 `main`，不得触碰 `stable`。
- 21 个 Canvas Skills 只属于无限画布 AI 对话和工作流/节点模式。
- 16 个 Simple Chat Skills 只属于独立 `simple-chat` 页面。
- 两个 Skill 目录不得串用；只共享 runtime、任务、供应商、积分、资产与结果基础设施。
- 必须复用 Task 4/5 的同一 `taskId`、generation、execution lease、账务和退款边界。
- 不得新增独立队列表、进程内任务真相或第二供应商任务状态机。
- provider/model 使用创建时冻结的精确授权绑定，执行时不得重新自动选择。
- 缺少 `POSTGRES_TEST_DATABASE_URL` 时必须明确标为“未验证”，不得用 Mock 冒充。
- 不修改四个受保护未跟踪项，不整体复制 V5.8.8 文件。

---

### Task 1: 统一步骤执行类型、计费类型与持久结果

**Files:**
- Modify: `src/lib/skill-runtime/types.ts`
- Modify: `src/lib/skill-runtime/cost-estimator.ts`
- Modify: `src/lib/skill-runtime/executor.ts`
- Modify: `src/lib/skill-runtime/service.ts`
- Modify: `src/lib/skill-runtime/step-registry.ts`
- Test: `src/__tests__/lib/skill-runtime-cost-estimator.test.ts`
- Test: `src/__tests__/lib/skill-runtime-executor.test.ts`
- Test: `src/__tests__/api/skill-runs.test.ts`

**Interfaces:**
- Consumes: `skillExecutionSteps(skill)`、`SkillStepResult`、`appendAgentRunEvent()`。
- Produces: `skillStepCreditOperation(step)`、`DurableSkillOutput`、`ExecuteSkillRunResult.outputs`。

- [ ] **Step 1: 写入计费与文本持久化 RED 测试**

```ts
it('prices an orchestrator-role generate_image step as chat', async () => {
  await estimateSkillRunCost(canvasSkill, bindings, dependencies);
  expect(dependencies.calculateCreditCost).toHaveBeenCalledWith(
    'chat', bindings.orchestrator.modelId,
    { providerId: bindings.orchestrator.providerId },
  );
});

it('persists a simple-chat text result in the durable terminal result', async () => {
  const result = await executor.execute(simpleChatInput);
  expect(result.outputs).toEqual([
    { stepId: 'orchestrator', kind: 'text', content: '完成内容' },
  ]);
  expect(appendEvent).toHaveBeenCalledWith(expect.objectContaining({
    type: 'run.completed',
    payload: expect.objectContaining({ result: expect.objectContaining({ outputs: result.outputs }) }),
  }));
});
```

- [ ] **Step 2: 运行测试并确认 RED 原因正确**

Run: `pnpm exec vitest run src/__tests__/lib/skill-runtime-cost-estimator.test.ts src/__tests__/lib/skill-runtime-executor.test.ts src/__tests__/api/skill-runs.test.ts`

Expected: FAIL，当前 orchestrator 被按 `image_generate` 计费，且终态丢弃文本。

- [ ] **Step 3: 实现单一步骤执行描述和持久结果**

```ts
export interface DurableSkillOutput {
  stepId: string;
  kind: 'text' | 'html';
  content: string;
}

export function skillStepCreditOperation(step: SkillStepDefinition): CreditOperation {
  if (step.modelRole === 'orchestrator') return 'chat';
  return toolCostType(step.toolId);
}
```

Executor 按步骤定义顺序合并历史和新增 `outputs`，使用 `stepId + kind` 去重；`run.completed.result` 同时保存 `assetVersionIds` 与 `outputs`。chat adapter 返回普通文本时使用 `kind: 'text'`，只有经过 HTML 净化的结果才使用 `kind: 'html'`。

- [ ] **Step 4: 验证 GREEN 与目录隔离**

Run: `pnpm exec vitest run src/__tests__/lib/skill-runtime-cost-estimator.test.ts src/__tests__/lib/skill-runtime-executor.test.ts src/__tests__/api/skill-runs.test.ts src/__tests__/lib/skill-runtime-catalog.test.ts src/__tests__/lib/skill-runtime-run-request.test.ts`

Expected: PASS；Canvas 与 simple-chat 目录数量及双向隔离保持不变。

- [ ] **Step 5: 提交**

```bash
git add src/lib/skill-runtime src/__tests__/lib/skill-runtime-cost-estimator.test.ts src/__tests__/lib/skill-runtime-executor.test.ts src/__tests__/api/skill-runs.test.ts
git commit -m "fix: persist truthful skill results"
```

### Task 2: 纠正重试返回合同

**Files:**
- Modify: `src/lib/skill-runtime/executor.ts`
- Modify: `src/lib/skill-runtime/service.ts`
- Modify: `src/app/api/skill-runs/[runId]/retry/route.ts`
- Test: `src/__tests__/lib/skill-runtime-executor.test.ts`
- Test: `src/__tests__/api/skill-runs.test.ts`

**Interfaces:**
- Consumes: `selectSkillStepsForExecution()`、持久 `tool.completed` 事件。
- Produces: `selectInitialSkillStepIds()`、`SkillRetryResult`。

- [ ] **Step 1: 写入真实启动集合 RED 测试**

```ts
it('separates the initial started group from the complete retry schedule', async () => {
  const retry = await service.retry({ actorUserId, runId, stepId: 'generate-4' });
  expect(retry.startedStepIds).toEqual(['generate-3', 'generate-4']);
  expect(retry.scheduledStepIds).toEqual(['generate-3', 'generate-4', 'quality-3']);
});
```

同时增加已完成 `generate-3` 的变体，期望两个集合都不再包含它。

- [ ] **Step 2: 运行测试确认 RED**

Run: `pnpm exec vitest run src/__tests__/lib/skill-runtime-executor.test.ts src/__tests__/api/skill-runs.test.ts`

Expected: FAIL，当前 `startedStepIds` 包含尚未启动的顺序步骤，且无 `scheduledStepIds`。

- [ ] **Step 3: 实现首批与完整计划两个集合**

```ts
export interface SkillRetryResult {
  accepted: boolean;
  startedStepIds: string[];
  scheduledStepIds: string[];
}
```

`scheduledStepIds` 复用 executor 的完整恢复选择算法；`startedStepIds` 只取第一个顺序步骤，或第一个连续并行组内的全部未完成步骤。API 原样返回两个字段。

- [ ] **Step 4: 运行 GREEN 与恢复回归**

Run: `pnpm exec vitest run src/__tests__/lib/skill-runtime-executor.test.ts src/__tests__/api/skill-runs.test.ts src/__tests__/api/agent-runs.test.ts`

Expected: PASS；已完成 sibling 不重复执行，后续顺序步骤不再被误报为已启动。

- [ ] **Step 5: 提交**

```bash
git add src/lib/skill-runtime/executor.ts src/lib/skill-runtime/service.ts src/app/api/skill-runs/[runId]/retry/route.ts src/__tests__/lib/skill-runtime-executor.test.ts src/__tests__/api/skill-runs.test.ts
git commit -m "fix: report truthful skill retry state"
```

### Task 3: 首次执行接入数据库调度租约与有界恢复

**Files:**
- Modify: `src/lib/agent-runtime/event-storage.ts`
- Modify: `src/lib/agent-runtime/execution-dispatch.ts`
- Modify: `src/lib/skill-runtime/service.ts`
- Modify: `src/app/api/skill-runs/route.ts`
- Modify: `src/app/api/skill-runs/[runId]/route.ts`
- Test: `src/__tests__/lib/agent-runtime-execution-dispatch.test.ts`
- Test: `src/__tests__/lib/skill-runtime-executor.test.ts`
- Test: `src/__tests__/api/skill-runs.test.ts`
- Test: `src/__tests__/integration/skill-runtime-concurrency-postgres.test.ts`

**Interfaces:**
- Consumes: `claimAdoptedAgentExecution()`、`claimResumedAgentExecutionDispatch()`、`loadPersistedSkillContinuation()`。
- Produces: `dispatchSkillRunExecution()`、`recoverLiveSkillRunExecution()`。

- [ ] **Step 1: 写入进程丢失和幂等唤醒 RED 测试**

```ts
it('reclaims an expired initial dispatch lease through a later GET', async () => {
  await createWithoutRunningCompletion(request);
  advancePastDispatchLease();
  await getSkillRun({ actorUserId, runId });
  expect(dispatchClaims(runId)).toHaveLength(2);
  expect(providerSubmissions(runId)).toHaveLength(1);
  expect(chargeTransactions(runId)).toHaveLength(1);
});

it('same-key create replay wakes but never duplicates execution or billing', async () => {
  await Promise.all(Array.from({ length: 20 }, () => createSkillRun(request)));
  expect(uniqueRunIds()).toHaveLength(1);
  expect(successfulDispatchClaims()).toHaveLength(1);
  expect(chargeTransactions()).toHaveLength(1);
});
```

- [ ] **Step 2: 运行本地测试确认 RED**

Run: `pnpm exec vitest run src/__tests__/lib/agent-runtime-execution-dispatch.test.ts src/__tests__/api/skill-runs.test.ts src/__tests__/lib/skill-runtime-executor.test.ts`

Expected: FAIL，首次执行仍只依赖请求进程内 Promise，GET/list/重放不会恢复。

- [ ] **Step 3: 实现统一数据库调度**

`dispatchSkillRunExecution()` 必须先通过 `claimAdoptedAgentExecution()` 取得 execution fence，再通过现有 dispatch lease 原子 claim 启动 continuation。创建接口在返回前只等待 claim 结果，不等待供应商完成。

`recoverLiveSkillRunExecution()` 仅处理属于当前用户、状态非终态、具有有效 Skill snapshot 且 dispatch lease 已过期的 run。创建重放、单项 GET 和列表 GET 最多唤醒当前响应涉及的 20 个 run；每个 run 仍由数据库 claim 决定是否真正启动。

completion 或失败结算 Promise 必须挂接受控 catch；若持久失败结算本身暂时失败，保留可过期的 dispatch lease 和 `dispatch_error`，由下一次有界恢复重试，不能制造未处理拒绝。

- [ ] **Step 4: 运行本地 GREEN**

Run: `pnpm exec vitest run src/__tests__/lib/agent-runtime-execution-dispatch.test.ts src/__tests__/api/skill-runs.test.ts src/__tests__/lib/skill-runtime-executor.test.ts src/__tests__/lib/agent-runtime-event-storage-fence.test.ts`

Expected: PASS；旧 generation 不能写终态，取消后恢复扫描不能重新启动。

- [ ] **Step 5: 运行 PostgreSQL 并发验证**

Run when configured: `pnpm exec vitest run src/__tests__/integration/skill-runtime-concurrency-postgres.test.ts`

Expected: 20 并发同键只有一个 run、一次扣费、一个有效 dispatch claim；进程丢失后过期 lease 可恢复；取消与迟到完成终态不可逆。未配置隔离库时必须输出 BLOCKED 并记录未验证。

- [ ] **Step 6: 提交**

```bash
git add src/lib/agent-runtime/event-storage.ts src/lib/agent-runtime/execution-dispatch.ts src/lib/skill-runtime/service.ts src/app/api/skill-runs src/__tests__/lib/agent-runtime-execution-dispatch.test.ts src/__tests__/lib/skill-runtime-executor.test.ts src/__tests__/api/skill-runs.test.ts src/__tests__/integration/skill-runtime-concurrency-postgres.test.ts
git commit -m "fix: durably dispatch skill execution"
```

### Task 4: 全面回归、独立评审与阶段记录

**Files:**
- Modify: `.superpowers/sdd/task-6-report.md`
- Modify: `.superpowers/sdd/progress.md`
- Modify: `docs/testing/REGRESSION_REPORT.md`
- Modify: `docs/testing/UNVERIFIED_ITEMS.md`
- Modify outside repository: `F:/AIGC/vault-template/无界计划/11-阶段进度看板.md`
- Modify outside repository: `F:/AIGC/vault-template/无界计划/16-V5.8.8选择性吸收.md`

**Interfaces:**
- Consumes: Task 1-3 的提交和测试证据。
- Produces: Task 6 最终验收记录及下一阶段可恢复检查点。

- [ ] **Step 1: 运行 Task 4/5/6 专项回归**

Run: `pnpm exec vitest run src/__tests__/lib/skill-runtime-executor.test.ts src/__tests__/api/skill-runs.test.ts src/__tests__/api/agent-runtime-accounting.test.ts src/__tests__/lib/agent-runtime-same-task-adapter.test.ts src/__tests__/lib/agent-runtime-execution-dispatch.test.ts src/__tests__/lib/agent-runtime-event-storage-fence.test.ts src/__tests__/api/agent-runs.test.ts`

Expected: 0 failed。

- [ ] **Step 2: 运行全量工程门禁**

Run: `pnpm test`

Run: `pnpm ts-check`

Run: `pnpm lint`

Run: `pnpm build`

Run: `pnpm check:protected-baseline`

Expected: 所有已配置门禁 0 failed；环境依赖跳过项逐条写入 `UNVERIFIED_ITEMS.md`。

- [ ] **Step 3: 生成完整评审包并取得独立批准**

Run: `review-package ed2ed997 HEAD`

Expected: 独立评审 `Spec compliance: PASS`、`Code quality: APPROVED`、`Critical/Important/Minor: 0/0/0`。

- [ ] **Step 4: 更新阶段记录**

报告必须记录当前 commit、命令、通过/失败/跳过数量、PostgreSQL 未验证原因、`stable` 指针和四个受保护未跟踪项。只有独立评审通过后，才能在 `.superpowers/sdd/progress.md`、`F:/AIGC/vault-template/无界计划/11-阶段进度看板.md` 与 `F:/AIGC/vault-template/无界计划/16-V5.8.8选择性吸收.md` 中标记 Task 6 完成。

- [ ] **Step 5: 提交记录**

```bash
git add .superpowers/sdd/task-6-report.md .superpowers/sdd/progress.md docs/testing/REGRESSION_REPORT.md docs/testing/UNVERIFIED_ITEMS.md
git commit -m "docs: close durable skill runtime task"
```

# PSD 分层取消竞态 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 PSD 分层提交尚未返回 `taskId` 时取消或关闭导致的孤儿任务，并以稳定幂等键恢复响应不确定的提交。

**Architecture:** 保留现有 `/api/layered-decompose` 创建、查询和删除协议。编辑器增加一次操作级取消协调状态，初始提交在任务注册前不被取消；获得 `taskId` 后统一执行最多一次 DELETE。响应不确定时复用同一幂等键恢复任务标识，不生成第二个付费任务。

**Tech Stack:** Next.js 16、React 19、TypeScript 5、Vitest、Testing Library、PostgreSQL 幂等任务。

## Global Constraints

- 仅修改 `main` 候选工作树，不触碰 `stable` 和 V5.8.8 donor。
- 严格 TDD：先稳定复现，再最小修复，再模块和全量回归。
- 不修改供应商、模型、积分价格、退款数据库规则和 PSD ZIP 解析。
- 取消失败不得降级为“已取消”，不得吞掉错误。
- 不使用固定长时间 sleep 掩盖竞态。

---

### Task 1: 建立组件竞态回归测试

**Files:**
- Create: `src/__tests__/components/psd-layer-editor-cancellation.test.tsx`
- Read: `src/components/psd-editor/PsdLayerEditor.tsx`

**Interfaces:**
- Consumes: `runLayerDecomposition(options)`、`cancelLayerDecomposition(taskId)`。
- Produces: 取消前注册、关闭前注册、重复点击和取消失败重试的 RED 证据。

- [x] **Step 1: 编写响应延迟测试桩**

```ts
let deliverTaskId: ((taskId: string) => Promise<void>) | undefined;
runLayerDecomposition.mockImplementation(async (options) => {
  deliverTaskId = async (taskId) => { await options.onTaskId?.(taskId); };
  return await new Promise<never>(() => undefined);
});
```

- [x] **Step 2: 编写取消、关闭、重复点击、卸载、终态竞争和恢复行为测试**

```ts
it('queues cancel until the submitted task id arrives', async () => {
  render(<PsdLayerEditor imageUrl="/uploads/source.png" onClose={vi.fn()} />);
  fireEvent.click(screen.getByTestId('layer-start'));
  fireEvent.click(await screen.findByTestId('layer-cancel'));
  expect(cancelLayerDecomposition).not.toHaveBeenCalled();
  await act(() => deliverTaskId?.('layer-task-1'));
  await waitFor(() => expect(cancelLayerDecomposition).toHaveBeenCalledTimes(1));
});

it('waits for server cancellation before closing', async () => {
  const onClose = vi.fn();
  render(<PsdLayerEditor imageUrl="/uploads/source.png" onClose={onClose} />);
  fireEvent.click(screen.getByTestId('layer-start'));
  fireEvent.click(screen.getByRole('button', { name: '关闭' }));
  expect(onClose).not.toHaveBeenCalled();
  await act(() => deliverTaskId?.('layer-task-2'));
  await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
});

it('deduplicates repeated cancellation requests', async () => {
  render(<PsdLayerEditor imageUrl="/uploads/source.png" onClose={vi.fn()} />);
  fireEvent.click(screen.getByTestId('layer-start'));
  await act(() => deliverTaskId?.('layer-task-3'));
  fireEvent.click(screen.getByTestId('layer-cancel'));
  fireEvent.click(screen.getByTestId('layer-cancel'));
  await waitFor(() => expect(cancelLayerDecomposition).toHaveBeenCalledTimes(1));
});

it('retries cancellation instead of starting a new paid attempt', async () => {
  cancelLayerDecomposition.mockRejectedValueOnce(new Error('network lost'));
  render(<PsdLayerEditor imageUrl="/uploads/source.png" onClose={vi.fn()} />);
  fireEvent.click(screen.getByTestId('layer-start'));
  await act(() => deliverTaskId?.('layer-task-4'));
  fireEvent.click(screen.getByTestId('layer-cancel'));
  fireEvent.click(await screen.findByTestId('layer-retry'));
  expect(runLayerDecomposition).toHaveBeenCalledTimes(1);
  expect(cancelLayerDecomposition).toHaveBeenNthCalledWith(2, 'layer-task-4');
});
```

- [x] **Step 3: 运行测试并确认 RED**

Run: `pnpm exec vitest run src/__tests__/components/psd-layer-editor-cancellation.test.tsx`

Expected: 当前实现因提前 abort 且没有 `taskId`，DELETE 次数为 0 或 `onClose` 过早调用。

### Task 2: 暴露操作级幂等键

**Files:**
- Modify: `src/lib/layer-decomposition-client.ts`
- Modify: `src/__tests__/lib/layer-decomposition-client.test.ts`

**Interfaces:**
- Produces: `createLayerIdempotencyKey(): string`。
- Guarantees: 格式为 `layer-...`，长度不超过 128；显式键原样进入 `idempotency-key` 请求头。

- [x] **Step 1: 增加幂等键格式和复用测试**

```ts
expect(createLayerIdempotencyKey()).toMatch(/^layer-[A-Za-z0-9-]+$/);
expect(createLayerIdempotencyKey().length).toBeLessThanOrEqual(128);
```

- [x] **Step 2: 运行客户端测试确认导出缺失导致 RED**

Run: `pnpm exec vitest run src/__tests__/lib/layer-decomposition-client.test.ts`

- [x] **Step 3: 将现有私有函数改为命名导出**

```ts
export function createLayerIdempotencyKey(): string {
  const random = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `layer-${random}`.slice(0, 128);
}
```

- [x] **Step 4: 运行客户端测试确认 GREEN**

Run: `pnpm exec vitest run src/__tests__/lib/layer-decomposition-client.test.ts`

Expected: 全部通过。

### Task 3: 实现取消协调状态机

**Files:**
- Modify: `src/components/psd-editor/PsdLayerEditor.tsx`
- Test: `src/__tests__/components/psd-layer-editor-cancellation.test.tsx`

**Interfaces:**
- Consumes: `createLayerIdempotencyKey()`、`cancelLayerDecomposition(taskId)`。
- Produces: 一次用户操作一个键、一个任务、最多一个并发 DELETE；取消错误使用取消重试动作。

- [x] **Step 1: 增加操作引用**

```ts
const idempotencyKeyRef = useRef<string | null>(null);
const cancelIntentRef = useRef(false);
const closeAfterCancelRef = useRef(false);
const cancelPromiseRef = useRef<Promise<void> | null>(null);
const [errorAction, setErrorAction] = useState<'layering' | 'cancelling'>('layering');
```

- [x] **Step 2: 实现最多一次服务端取消**

```ts
const cancelRegisteredTask = useCallback((taskId: string) => {
  if (cancelPromiseRef.current) return cancelPromiseRef.current;
  const promise = cancelLayerDecomposition(taskId).then(() => {
    taskControllerRef.current?.abort(new Error('用户取消图片分层'));
  });
  cancelPromiseRef.current = promise;
  return promise;
}, []);
```

- [x] **Step 3: 修改 `onTaskId` 顺序**

```ts
onTaskId: async (taskId) => {
  taskIdRef.current = taskId;
  if (cancelIntentRef.current) await cancelRegisteredTask(taskId);
},
```

- [x] **Step 4: 统一取消、关闭和外部卸载入口**

```ts
const requestLayerCancellation = useCallback(async (closeAfter: boolean) => {
  cancelIntentRef.current = true;
  closeAfterCancelRef.current ||= closeAfter;
  setStage('cancelling');
  const taskId = taskIdRef.current;
  if (taskId) await cancelRegisteredTask(taskId);
}, [cancelRegisteredTask]);
```

- [x] **Step 5: 让取消失败重试保持同一任务语义**

普通错误按钮调用 `startLayering()`；取消错误按钮调用 `requestLayerCancellation(closeAfterCancelRef.current)`，不得生成新幂等键。

- [x] **Step 6: 运行组件测试确认 GREEN**

Run: `pnpm exec vitest run src/__tests__/components/psd-layer-editor-cancellation.test.tsx`

### Task 4: 覆盖响应不确定恢复

**Files:**
- Modify: `src/components/psd-editor/PsdLayerEditor.tsx`
- Modify: `src/__tests__/components/psd-layer-editor-cancellation.test.tsx`

**Interfaces:**
- Consumes: 上一次尝试的 `idempotencyKeyRef.current`。
- Produces: `retryPendingCancellation()`，仅重放同键同请求以找回任务标识。

- [x] **Step 1: 新增同键恢复 RED 测试**

```ts
expect(runLayerDecomposition.mock.calls[0][0].idempotencyKey)
  .toBe(runLayerDecomposition.mock.calls[1][0].idempotencyKey);
```

- [x] **Step 2: 实现取消恢复入口**

```ts
const retryPendingCancellation = useCallback(() => {
  const key = idempotencyKeyRef.current;
  if (!key) return requestLayerCancellation(closeAfterCancelRef.current);
  return executeLayeringAttempt(key, { cancellationRecovery: true });
}, [executeLayeringAttempt, requestLayerCancellation]);
```

- [x] **Step 3: 区分明确失败、响应不确定与终态竞争**

无 `taskId` 且服务端明确返回 `400/422` 校验失败时直接完成本地取消；`401/403/404/409`、网络错误、5xx 或可重试错误进入 `cancel-recovery` 错误动作并保留键。首次最终 provider/model 解析结果（含空目标）必须写入冻结快照，挂载与卸载恢复都不得重新改变请求体。

- [x] **Step 4: 运行组件和客户端测试确认 GREEN**

Run: `pnpm exec vitest run src/__tests__/components/psd-layer-editor-cancellation.test.tsx src/__tests__/lib/layer-decomposition-client.test.ts`

### Task 5: 回归、分支裁决和云端门禁

**Files:**
- Modify after evidence: `docs/testing/BUG_REGISTER.md`
- Modify after evidence: `docs/testing/REGRESSION_REPORT.md`
- Modify after evidence: `docs/testing/RELEASE_READINESS_REPORT.md`
- Modify after evidence: `docs/testing/UNVERIFIED_ITEMS.md`

**Interfaces:**
- Produces: 本地验证结果、并行分支合并裁决、云端待验证清单。

- [x] **Step 1: 运行 PSD 分层专项**

Run:

```bash
pnpm exec vitest run src/__tests__/components/psd-layer-editor-cancellation.test.tsx src/__tests__/lib/layer-decomposition-client.test.ts src/__tests__/api/layered-decompose.test.ts src/__tests__/api/layered-decompose-concurrency.test.ts src/__tests__/api/layered-decompose-postgres-concurrency.test.ts src/__tests__/lib/pear-layer-adapter.test.ts src/__tests__/lib/layer-source-image.test.ts
```

Expected: 非 PostgreSQL 项全部通过；无隔离测试库时 PostgreSQL 项只能明确标记跳过。

- [x] **Step 2: 运行工程门禁**

Run:

```bash
pnpm ts-check
pnpm lint
pnpm test
pnpm build
git diff --check
```

- [ ] **Step 3: 更新中文证据文档**

记录复现、根因、测试、提交、未验证项，不把本地结果写成云端通过。

- [x] **Step 4: 处理并行分支**

`V588-PROVIDER-002` 与 `V588-PROVIDER-003` 只有在重新基线到最新 main 并重跑门禁后才可吸收；`V588-COLLAB-004` 在 PostgreSQL、Coze、真实供应商、Asset/Canvas 接线和前置阶段未闭环前不得合并。

- [ ] **Step 5: 云端验收**

Coze 拉取精确提交后，在 Google Chrome 中执行提交后立即取消、提交后立即关闭、重复取消、网络响应丢失恢复、单次扣费和最多一次退款验证，并保存网络、日志和账务证据。

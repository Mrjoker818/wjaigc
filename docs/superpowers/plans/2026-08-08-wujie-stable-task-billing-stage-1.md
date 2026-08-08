# 无界稳定任务与账务核心实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在保留全部现有入口和供应商行为的前提下，使图像、视频、编辑、3D、分层和 Agent 任务共享数据库权威终态、原子幂等、一次性扣费退款、逐张回图、取消超时和可恢复错误契约。

**Architecture:** 继续使用现有 `cloud_tasks`、PostgreSQL、SSE 和轮询链路，不全量重写。先补齐数据库约束和集成测试，再在 `src/lib/task-core/` 建立薄服务层，把现有 `cloud-task-storage.ts`、`credits.ts` 和模型能力逻辑收敛为明确接口；各业务路由按纵向链路逐个迁移，并保留 `legacy` 回退开关。

**Tech Stack:** Next.js 16、React 19、TypeScript 5、PostgreSQL、Vitest、Playwright、SSE、现有多供应商适配层。

## Global Constraints

- 正式实施基线固定为 `main@e5867f08729312dc4164987e09394e46565be769`；执行前必须重新核对 `origin/main` 和云端运行 Commit。
- 38 项受保护功能、7 个产品表面和 3 个工作区入口保留率必须为 100%。
- 不删除旧任务字段、旧项目读取器或旧路由；迁移使用 `WUJIE_TASK_CORE_MODE=legacy|shadow|core-v2`。
- 数据库是终态和账务权威来源；内存、SSE、轮询和前端状态只做投影。
- `completed` 只能从 `processing` 进入；`failed`、`cancelled`、`timeout` 不得复活为 `completed`。
- 幂等唯一性至少绑定 `userId + idempotencyKey + requestDigest`；同键异请求返回 `409 IDEMPOTENCY_CONFLICT`。
- 扣费、退款和终态转换必须在真实 PostgreSQL 事务和并发测试中证明最多一次。
- 多图 `n=1/2/3/4` 每张独立槽位、独立任务、独立回填；不得等待整批完成。
- UI 不直接推断供应商协议；所有入口使用 `providerId + modelId + capabilities`。
- 未获得隔离 PostgreSQL、真实供应商或可确认云端 Commit 时，结果标记 `BLOCKED`，不得标记通过。

---

### Task 1: 固定真实 PostgreSQL 任务与账务基线

**Files:**
- Create: `tests/integration/task-core-postgres.test.ts`
- Create: `tests/helpers/postgres-test-database.ts`
- Modify: `scripts/doctor.mjs`
- Modify: `docs/testing/UNVERIFIED_ITEMS.md`

**Interfaces:**
- Produces: `withIsolatedPostgres(testName, callback)`，为每个测试创建独立 schema 并在结束后删除。
- Produces: Stage 1 数据库门禁 `POSTGRES_TEST_DATABASE_URL`，缺失时测试明确 `skip` 并阻断发布报告。

- [ ] **Step 1: 写隔离数据库失败测试**

```ts
it('creates an isolated schema and removes it after the test', async () => {
  const schema = await withIsolatedPostgres('task-core-schema', async ({ schemaName, query }) => {
    await query('CREATE TABLE marker(id text primary key)');
    return schemaName;
  });
  expect(await schemaExists(schema)).toBe(false);
});
```

- [ ] **Step 2: 运行测试并确认 RED**

Run: `pnpm exec vitest run tests/integration/task-core-postgres.test.ts`  
Expected: FAIL，提示 `withIsolatedPostgres` 尚不存在；若环境变量缺失则必须显示 `BLOCKED: POSTGRES_TEST_DATABASE_URL`。

- [ ] **Step 3: 实现隔离 schema 帮助器并扩展 doctor**

```ts
export async function withIsolatedPostgres<T>(
  testName: string,
  callback: (context: { schemaName: string; query: QueryFn }) => Promise<T>,
): Promise<T>;
```

Doctor 必须验证连接、建表权限、事务、唯一索引和 advisory lock，不得只验证 TCP 可达。

- [ ] **Step 4: 验证并提交**

Run: `pnpm doctor && pnpm exec vitest run tests/integration/task-core-postgres.test.ts`  
Expected: 隔离数据库存在时 PASS；缺失时 doctor 输出发布阻塞项。

Commit: `test: establish isolated postgres task baseline`

### Task 2: 建立统一模型能力目录

**Files:**
- Create: `src/lib/task-core/model-catalog.ts`
- Modify: `src/lib/model-capabilities.ts`
- Modify: `src/app/api/models/route.ts`
- Modify: `src/app/api/workflow/models/route.ts`
- Test: `src/__tests__/lib/task-model-catalog.test.ts`
- Test: `src/__tests__/api/models-defaults.test.ts`

**Interfaces:**
- Produces:

```ts
interface TaskModelDescriptor {
  providerId: string;
  modelId: string;
  kind: 'image' | 'video' | 'chat' | 'edit' | 'upscale' | 'layer' | '3d';
  protocol: string;
  executionMode: 'sync' | 'async';
  allowedRatios: string[];
  allowedSizes: string[];
  qualityOptions: string[];
  maxOutputs: number;
  maxDurationSeconds?: number;
  supportsReferenceImages: boolean;
  supportsMask: boolean;
  outputKinds: string[];
}
```

- Produces: `resolveTaskModel(providerId, modelId, userId): Promise<TaskModelDescriptor>`.

- [ ] **Step 1: 写失败测试**

覆盖精确 provider/model 配对、普通用户授权、图像比例/尺寸/质量、视频时长、参考图、蒙版、同步/异步和输出格式；禁止只按 `modelId` 模糊匹配。

- [ ] **Step 2: 运行 RED**

Run: `pnpm exec vitest run src/__tests__/lib/task-model-catalog.test.ts src/__tests__/api/models-defaults.test.ts`  
Expected: FAIL，现有多个入口返回的能力结构不一致。

- [ ] **Step 3: 实现目录并让两个模型 API 共用**

保留现有 `classifyModelFamily()` 作为默认推断，只允许管理员配置覆盖推断值，不允许 UI 另建供应商特例。

- [ ] **Step 4: 验证保护入口与提交**

Run: `pnpm check:protected-baseline -- --base e5867f0 --candidate HEAD`  
Expected: 38 个功能 ID 均保留。

Commit: `feat: unify task model capabilities`

### Task 3: 数据库权威任务状态机

**Files:**
- Create: `src/lib/task-core/task-state.ts`
- Create: `src/lib/task-core/task-service.ts`
- Modify: `src/lib/cloud-task-storage.ts`
- Modify: `src/lib/cloud-task-persistence.ts`
- Test: `src/__tests__/lib/task-state.test.ts`
- Test: `tests/integration/task-state-postgres.test.ts`

**Interfaces:**

```ts
type DurableTaskStatus =
  | 'created' | 'queued' | 'submitting' | 'processing' | 'uploading'
  | 'completed' | 'failed' | 'cancelled' | 'timeout';

async function transitionTask(input: {
  taskId: string;
  from: DurableTaskStatus[];
  to: DurableTaskStatus;
  revision?: number;
  result?: Record<string, unknown>;
  error?: UnifiedTaskError;
}): Promise<{ transitioned: boolean; task: DurableTask }>;
```

- [ ] **Step 1: 写非法终态与并发完成失败测试**

测试 `failed/cancelled/timeout -> completed` 必须拒绝；两个并发完成请求只能一个 `transitioned=true`。

- [ ] **Step 2: 运行 RED**

Run: `pnpm exec vitest run src/__tests__/lib/task-state.test.ts tests/integration/task-state-postgres.test.ts`  
Expected: 现有通用 `updateCloudTask` 可覆盖终态，测试失败。

- [ ] **Step 3: 实现条件 SQL 转换**

使用 `UPDATE ... WHERE id=$1 AND status=ANY($2) AND revision=$3 RETURNING *`；终态写入后只允许补充审计字段，不允许改变终态。

- [ ] **Step 4: 让 SSE/轮询只读取投影**

`task-registry.ts` 不再决定终态；数据库转换成功后才调用 `updateTaskProgress()`。

- [ ] **Step 5: 验证并提交**

Commit: `feat: make postgres authoritative for task terminals`

### Task 4: 原子幂等与一次性账务

**Files:**
- Create: `src/lib/task-core/idempotency.ts`
- Create: `src/lib/task-core/billing-service.ts`
- Modify: `src/lib/cloud-task-storage.ts`
- Modify: `src/lib/credits.ts`
- Modify: `src/lib/db-storage.ts`
- Test: `tests/integration/task-billing-concurrency.test.ts`
- Test: `src/__tests__/lib/task-billing.test.ts`

**Interfaces:**

```ts
async function createBillableTask(input: {
  userId: string;
  idempotencyKey: string;
  requestDigest: string;
  creditCost: number;
  task: CreateDurableTaskInput;
}): Promise<{ task: DurableTask; reused: boolean; charged: boolean }>;

async function settleFailedTask(input: {
  taskId: string;
  status: 'failed' | 'cancelled' | 'timeout';
  error: UnifiedTaskError;
}): Promise<{ transitioned: boolean; refunded: boolean }>;
```

- [ ] **Step 1: 写 20 并发请求测试**

同键同摘要返回同一 `taskId` 且只产生一条扣费流水；同键不同摘要返回 `409`；失败、取消、超时竞争只退款一次。

- [ ] **Step 2: 运行 RED**

Run: `pnpm exec vitest run tests/integration/task-billing-concurrency.test.ts`  
Expected: 现有 `user_id + idempotency_key` 不含摘要，冲突语义和账务事务测试失败。

- [ ] **Step 3: 增加可回滚数据库字段**

新增 `request_digest`、`charged_transaction_id`、`refunded_transaction_id` 和账务唯一索引；只新增字段，不删除旧字段。

- [ ] **Step 4: 实现单事务创建、扣费和结算**

使用行锁或 advisory lock 锁定用户余额；任务、余额和流水在同一事务提交；任何一步失败全部回滚。

- [ ] **Step 5: 验证并提交**

Commit: `feat: enforce atomic task billing idempotency`

### Task 5: 多图逐张回图和刷新恢复

**Files:**
- Create: `src/lib/task-core/generation-batch.ts`
- Modify: `src/app/api/generate/route.ts`
- Modify: `src/app/api/poll-task/route.ts`
- Modify: `src/app/api/task-events/route.ts`
- Modify: `src/lib/canvas-task-placeholders.ts`
- Test: `src/__tests__/api/generate-output-count.test.ts`
- Test: `src/__tests__/api/poll-task-progressive-generation-contract.test.ts`
- Test: `tests/e2e/generation-progressive-slots.spec.ts`

**Interfaces:**

```ts
interface GenerationBatch {
  batchId: string;
  requestedCount: 1 | 2 | 3 | 4;
  slots: Array<{ slotId: string; slotIndex: number; taskId: string; status: DurableTaskStatus }>;
}
```

- [ ] **Step 1: 写 `n=1/2/3/4` 和乱序完成失败测试**

供应商槽位按 3、1、4、2 完成时，前端必须逐张填入对应槽位；刷新后已完成槽位不退回“生成中”。

- [ ] **Step 2: 运行 RED**

Run: `pnpm exec vitest run src/__tests__/api/generate-output-count.test.ts src/__tests__/api/poll-task-progressive-generation-contract.test.ts`

- [ ] **Step 3: 用统一任务服务替换生成路由的局部终态/退款**

保留当前 API 响应兼容字段；新增 `batchId/slotId/slotIndex`，旧客户端仍可读取 `taskId`。

- [ ] **Step 4: 实现 SSE 单槽事件和轮询兜底**

事件格式固定为 `{ batchId, slotId, slotIndex, taskId, status, result?, error? }`。

- [ ] **Step 5: 三工作区组件契约回归**

验证图像生成面板、参考图组、融图组、节点生成和画布聊天均使用同一批次事实。

- [ ] **Step 6: 提交**

Commit: `feat: stream generation results by durable slot`

### Task 6: 取消、超时、迟到结果与错误归因

**Files:**
- Create: `src/lib/task-core/task-abort.ts`
- Create: `src/lib/task-core/task-error.ts`
- Modify: `src/app/api/cancel-task/route.ts`
- Modify: `src/app/api/tasks/recover/route.ts`
- Modify: `src/app/api/poll-task/route.ts`
- Modify: `src/lib/task-registry.ts`
- Test: `src/__tests__/api/cancel-task.test.ts`
- Test: `tests/integration/task-terminal-race.test.ts`

**Interfaces:**

```ts
interface UnifiedTaskError {
  code: string;
  message: string;
  source: 'client' | 'wujie' | 'provider' | 'database' | 'storage' | 'network';
  retryable: boolean;
  requestId: string;
  providerStatus?: number;
}
```

- [ ] **Step 1: 写取消/完成、超时/完成和恢复租约竞态测试**

底层 fetch 必须收到 abort；迟到结果写审计但不能覆盖终态；恢复接口不得产生高频循环。

- [ ] **Step 2: 运行 RED**

Run: `pnpm exec vitest run src/__tests__/api/cancel-task.test.ts tests/integration/task-terminal-race.test.ts`

- [ ] **Step 3: 实现统一 AbortController 生命周期**

任务提交、供应商轮询、下载和上传共用组合信号；终态后必须注销 controller 和租约。

- [ ] **Step 4: 实现错误来源和用户提示**

保留供应商原始状态码到服务端审计，前端只显示整理后的中文错误、`requestId` 和重试动作。

- [ ] **Step 5: 提交**

Commit: `feat: unify task cancellation timeout and errors`

### Task 7: 迁移纵向任务入口和管理员控制面

**Files:**
- Modify: `src/app/api/video/generate/route.ts`
- Modify: `src/app/api/image-edit/route.ts`
- Modify: `src/app/api/edit/route.ts`
- Modify: `src/app/api/image-to-3d/route.ts`
- Modify: `src/app/api/layered-decompose/route.ts`
- Modify: `src/app/api/agent-edit/route.ts`
- Modify: `src/app/api/admin/cloud-tasks/route.ts`
- Modify: `src/app/api/admin/credits/pricing/route.ts`
- Modify: `src/components/admin-system.tsx`
- Test: `src/__tests__/api/admin-cloud-tasks.test.ts`
- Test: `tests/regression/task-entry-migration.test.ts`

**Interfaces:**
- Consumes: Tasks 2-6 的模型目录、任务服务、账务服务、Abort 和错误契约。
- Produces: 管理员任务监控显示请求/实际 provider/model、终态、耗时、扣费、退款、错误来源和 requestId。

- [ ] **Step 1: 为每个入口保存 legacy 行为快照**

覆盖正常、拒绝、空结果、超时、取消、连续第二次提交和刷新恢复。

- [ ] **Step 2: 按图像生成 -> 视频 -> 编辑 -> 3D -> 分层 -> Agent 顺序迁移**

每迁移一个入口只启用 `shadow`，比较旧链路与新任务事实；一致后才切 `core-v2`。

- [ ] **Step 3: 管理员控制面接入统一事实**

统计不得由页面自行推算；任务数、积分、退款和模型定价来自相同数据库口径。

- [ ] **Step 4: 每个入口独立回归并提交**

Commit: `refactor: route billable tasks through stable core`

### Task 8: 全量发布门禁与云端真实验收

**Files:**
- Create: `tests/e2e/stage-1-task-billing.spec.ts`
- Create: `docs/testing/STAGE_1_COMPLETION_REPORT.md`
- Modify: `.github/workflows/stage-0-quality.yml`
- Modify: `docs/testing/BUG_REGISTER.md`
- Modify: `docs/testing/REGRESSION_REPORT.md`
- Modify: `docs/testing/RELEASE_READINESS_REPORT.md`
- Modify: `docs/testing/UNVERIFIED_ITEMS.md`

**Interfaces:**
- Produces: 可追踪到 Git SHA、部署地址、浏览器、requestId、taskId、扣费流水和退款流水的 Stage 1 证据。

- [ ] **Step 1: 本地完整门禁**

Run:

```powershell
pnpm install --frozen-lockfile
pnpm doctor
pnpm lint
pnpm ts-check
pnpm test
pnpm build
pnpm check:protected-baseline -- --base e5867f0 --candidate HEAD
```

Expected: Stage 1 新增测试全通过且不增加基线失败；任何新增失败阻断。4 个历史 lint error 和 5 个历史测试失败继续作为平台发布阻塞项登记，不允许为通过 S1 而删除或跳过测试。

- [ ] **Step 2: PostgreSQL 并发门禁**

Run: `pnpm exec vitest run tests/integration/task-*-postgres.test.ts tests/integration/task-*-concurrency.test.ts`  
Expected: 20 并发同键只创建一个任务、只扣一次；失败竞争只退款一次。

- [ ] **Step 3: 三浏览器真实 E2E**

验证登录、`n=1/2/3/4`、逐张回填、取消、超时、刷新恢复、连续第二次操作和退出；失败保存 screenshot/video/trace/console/network。

- [ ] **Step 4: 云端真实供应商与账务**

使用可用供应商，跳过已知不可用 FHL/虚宝但明确登记；每个任务记录 requested/actual route、供应商后台状态、前端终态和积分流水。

- [ ] **Step 5: 发布与回退演练**

确认云端运行 Commit；验证 `core-v2 -> legacy` 开关可在不迁移数据的情况下回退；旧处理中任务由 `handlerVersion` 继续解释。

- [ ] **Step 6: 更新 Obsidian 和发布结论**

只有 PostgreSQL、三浏览器、真实供应商和真实账务证据全部满足时才能将 S1 标记完成；否则标记“有条件完成/阻塞”。

Commit: `test: close stable task and billing stage`

## Self-Review

- 规格覆盖：模型能力、任务终态、多图逐张返回、取消超时、幂等、扣费退款、错误归因、刷新恢复、管理员任务/定价/审计和三工作区共享事实均有对应任务。
- 防回归：每个迁移入口先保存 legacy 证据，再 shadow 比较，最后切换；38 项受保护功能门禁贯穿全阶段。
- 数据安全：数据库只新增字段和索引，保留旧读取器和 `legacy` 开关；没有破坏性删除。
- 真实验证：本地编译、HTTP 200 或 Mock 均不能替代 PostgreSQL、真实浏览器、真实供应商和账务证据。
- 完整性检查：每个任务均包含明确文件、接口、失败测试、验证命令和提交边界。

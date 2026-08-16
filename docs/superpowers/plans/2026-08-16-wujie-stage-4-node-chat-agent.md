# 无界AI Stage 4 节点模式与智能对话实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在保留无限画布、节点模式和独立智能对话全部现有能力的前提下，建立共享 Agent 运行时、节点渲染 shadow 迁移层和三工作区完整素材版本链。

**Architecture:** 复用 Stage 1 的 `cloud_tasks`、幂等、终态和账务服务，新增仅承载有序 Agent 事件的持久化层；三个工作区通过上下文适配器接入，不共享 React 状态。节点模式继续以现有 `Workflow` 领域模型为权威，先分离视图投影和命令，再以 `@xyflow/react` shadow 计算对照，门禁通过后才允许 `react-flow-v2` 成为隔离环境权威，并强制回退 legacy。

**Tech Stack:** Next.js 16、React 19、TypeScript 5、PostgreSQL、现有 Task Core/Asset Graph、Vitest、Playwright、`@xyflow/react@12.11.2`。

## Global Constraints

- 实施基线固定为 `main@7fdc0108952fb3a68415ca3a2a26b5d33641dc6b`；工作分支为 `codex/wj-stable-s4`。
- `stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` 永久只读，不合并、不重置、不强推、不直接提交。
- Stage 3 Task 10 保持“有条件完成”：本地 exact-SHA 三模式 `180/180` 有效；GitHub Actions Billing 和 Coze exact-SHA 外部门禁未关闭。
- 用户已授权不因 GitHub Actions `steps=[]` 停止本地工作，但 Stage 4 不得正式发布，不得进入 Stage 5，直到 Stage 3 外部门禁补验或获得书面批准的等价证据。
- 无限画布、节点模式、独立智能对话继续保留独立入口、布局和历史；共享的是任务、素材、模型授权、Agent 事件和成本事实。
- 38 项受保护功能、七个产品表面、全部 `NodeType`、`PortType`、Skills、Agent 工具、路由、工作区入口和返回路径保留率必须为 100%。
- 不修改 Stage 5 业务工具的生成质量、供应商参数或 UI；Stage 4 仅建立 Agent、聊天、节点和工作区互通边界。
- Agent 模式固定为 `WUJIE_AGENT_RUNTIME_MODE=legacy|shadow|agent-v2`；节点渲染固定为 `WUJIE_WORKFLOW_RENDERER_MODE=legacy|shadow|react-flow-v2`；缺失或非法值必须回落 `legacy`。
- 模式权威来自服务端已鉴权信封；查询参数、localStorage 和普通用户请求不能提升模式。
- shadow 禁止创建额外付费任务、调用额外供应商、修改积分、写素材版本、修改项目或改变用户可见结果；只允许追加脱敏事件和差异指标。
- Agent 任务继续使用数据库条件终态；取消、失败、超时后不能进入 completed，迟到结果不能产生有效版本，每个任务只扣费一次、至多退款一次。
- 所有跨工作区结果必须使用 AssetVersion 和 WorkspacePlacement；裸 URL 只能作为旧数据兼容输入，不能成为新写入权威。
- 任何生产代码修改必须先有稳定 RED，随后最小 GREEN、聚焦回归、全仓回归、保护门禁和独立审查。
- 节点性能门禁：100 节点持续拖动不低于 55 FPS，输入 P95 不高于 50 ms；独立聊天 2 秒内可交互；Agent 1 秒内显示进度或明确阻塞原因。
- 测试账号、密码、Cookie、Token、API Key、数据库连接串、用户图片和完整敏感提示词不得进入 Git 或报告。

## File Structure

- `src/lib/agent-runtime/types.ts`: 运行请求、上下文、事件、工具和状态类型。
- `src/lib/agent-runtime/mode.ts`: `legacy|shadow|agent-v2` 服务端模式解析。
- `src/lib/agent-runtime/event-reducer.ts`: 有序事件归并和终态保护纯函数。
- `src/lib/agent-runtime/event-storage.ts`: PostgreSQL Agent 事件仓储和所有权过滤。
- `src/lib/agent-runtime/tool-registry.ts`: 共享 Agent 工具描述和授权过滤。
- `src/lib/agent-runtime/context-adapters.ts`: Canvas、Simple Chat、Workflow 上下文适配器。
- `src/lib/agent-runtime/service.ts`: 创建运行、追加事件、调用兼容执行器、取消和恢复。
- `src/lib/agent-runtime/legacy-observer.ts`: shadow 模式观察现有 `/api/chat`、`/api/simple-chat/chat` 和 `/api/agent-edit`。
- `src/app/api/agent-runs/route.ts`: 创建运行和列出当前用户运行。
- `src/app/api/agent-runs/[runId]/route.ts`: 查询与取消单次运行。
- `src/app/api/agent-runs/[runId]/events/route.ts`: 按 sequence 增量读取事件。
- `src/components/agent-runtime/use-agent-run-events.ts`: SSE/增量轮询投影 hook。
- `src/components/agent-runtime/AgentProgressTimeline.tsx`: 三工作区共享的进度、错误和取消展示。
- `src/lib/workflow-renderer/mode.ts`: 节点渲染三态解析。
- `src/lib/workflow-renderer/view-model.ts`: `Workflow` 到渲染节点/边的纯投影。
- `src/lib/workflow-renderer/commands.ts`: 拖动、连线、选择、删除、复制和历史命令。
- `src/lib/workflow-renderer/shadow.ts`: legacy 与 XYFlow 投影差异比较。
- `src/components/workflow/WorkflowShadowProbe.tsx`: shadow 只读投影和脱敏差异上报。
- `src/components/workflow/WorkflowReactFlowSurface.tsx`: `react-flow-v2` 渲染表面。
- `scripts/stage-4-inventory.mjs`: 节点、端口、Skills、Agent 工具、路由和入口清单生成器。
- `scripts/stage-4-e2e-fixtures.mjs`: 独立用户、聊天、工作流和 100 节点夹具。
- `tests/helpers/stage-4-e2e.ts`: 登录、模式信封、任务、事件和资产版本断言。
- `tests/helpers/workflow-performance.ts`: 节点 FPS、输入 P95 和交互连续性采样。
- `tests/e2e/stage-4-node-chat-agent.spec.ts`: 五浏览器 Stage 4 核心链路。
- `docs/testing/STAGE_4_BASELINE_REPORT.md`: 实施前真实基线。
- `docs/testing/STAGE_4_REGRESSION_REPORT.md`: 每个检查点和最终验收证据。

---

### Task 0: 冻结功能清单、双模式开关与真实基线

**Files:**
- Create: `src/lib/agent-runtime/mode.ts`
- Create: `src/lib/workflow-renderer/mode.ts`
- Create: `scripts/stage-4-inventory.mjs`
- Create: `scripts/stage-4-e2e-fixtures.mjs`
- Create: `tests/helpers/stage-4-e2e.ts`
- Create: `tests/helpers/workflow-performance.ts`
- Create: `tests/e2e/stage-4-node-chat-agent.spec.ts`
- Create: `src/__tests__/lib/stage-4-modes.test.ts`
- Create: `src/__tests__/scripts/stage-4-inventory.test.ts`
- Create: `src/__tests__/scripts/stage-4-e2e-fixtures.test.ts`
- Create: `docs/testing/STAGE_4_BASELINE_REPORT.md`
- Modify: `scripts/doctor.mjs`
- Modify: `scripts/generate-function-inventory.mjs`
- Modify: `package.json`
- Modify: `.env.example`

**Interfaces:**
- Produces: `type AgentRuntimeMode = 'legacy' | 'shadow' | 'agent-v2'`。
- Produces: `resolveAgentRuntimeMode(raw?: string): AgentRuntimeMode`。
- Produces: `type WorkflowRendererMode = 'legacy' | 'shadow' | 'react-flow-v2'`。
- Produces: `resolveWorkflowRendererMode(raw?: string): WorkflowRendererMode`。
- Produces: `collectStage4Inventory(root): Promise<Stage4Inventory>`。
- Produces: `buildStage4FixturePlan(runId): Stage4FixturePlan`。
- Produces: `measureWorkflowInteraction(page, action): Promise<WorkflowPerformanceSample>`。

- [ ] **Step 1: 写模式解析 RED**

```ts
expect(resolveAgentRuntimeMode(undefined)).toBe('legacy');
expect(resolveAgentRuntimeMode('shadow')).toBe('shadow');
expect(resolveAgentRuntimeMode('agent-v2')).toBe('agent-v2');
expect(resolveAgentRuntimeMode('invalid')).toBe('legacy');

expect(resolveWorkflowRendererMode(undefined)).toBe('legacy');
expect(resolveWorkflowRendererMode('shadow')).toBe('shadow');
expect(resolveWorkflowRendererMode('react-flow-v2')).toBe('react-flow-v2');
expect(resolveWorkflowRendererMode('invalid')).toBe('legacy');
```

- [ ] **Step 2: 运行模式 RED**

Run: `pnpm exec vitest run src/__tests__/lib/stage-4-modes.test.ts`

Expected: FAIL，两个 mode 模块尚不存在。

- [ ] **Step 3: 实现最小模式模块**

```ts
export type AgentRuntimeMode = 'legacy' | 'shadow' | 'agent-v2';

export function resolveAgentRuntimeMode(raw?: string): AgentRuntimeMode {
  return raw === 'shadow' || raw === 'agent-v2' ? raw : 'legacy';
}
```

节点模式使用同一形式，只接受 `shadow` 和 `react-flow-v2`。`doctor` 输出两个模式的解析结果与非法值警告，不输出其他环境变量值。

- [ ] **Step 4: 写功能清单 RED**

```ts
const inventory = await collectStage4Inventory(root);
expect(inventory.workspaces.map(item => item.id)).toEqual([
  'canvas',
  'workflow',
  'simple-chat',
]);
expect(inventory.nodeTypes).toEqual(Object.keys(NODE_TYPE_LABELS).sort());
expect(inventory.portTypes).toEqual(Object.keys(PORT_COMPATIBILITY).sort());
expect(inventory.routes).toContain('/api/chat');
expect(inventory.routes).toContain('/api/simple-chat/chat');
expect(inventory.routes).toContain('/api/agent-edit');
expect(inventory.agentTools.length).toBeGreaterThan(0);
expect(inventory.skills.length).toBeGreaterThan(0);
```

清单必须输出入口、组件、API、任务类型、素材输入输出、是否有自动化测试和风险等级；不能只统计字符串数量。

- [ ] **Step 5: 运行清单 RED，再实现解析器**

Run: `pnpm exec vitest run src/__tests__/scripts/stage-4-inventory.test.ts`

Expected: FAIL，Stage 4 清单生成器尚不存在。

最小实现复用 `scripts/generate-function-inventory.mjs` 的 AST/源码读取规则，并对 `NODE_TYPE_LABELS`、`PORT_COMPATIBILITY`、`PRESET_SKILLS`、`agent-engine` 工具注册和三个入口路由做结构化解析；生成 JSON 和 Markdown 时按稳定 ID 排序。

- [ ] **Step 6: 写隔离夹具和性能采样 RED**

```ts
const plan = buildStage4FixturePlan('s4-run');
expect(plan.browserProfiles).toHaveLength(5);
expect(new Set(plan.users.map(user => user.id)).size).toBe(5);
expect(plan.workflows.every(item => item.nodeCount === 100)).toBe(true);
expect(() => assertStage4FixtureDatabase(process.env.PGDATABASE_URL)).not.toThrow();
```

浏览器测试断言：

```ts
expect(sample.averageFps).toBeGreaterThanOrEqual(55);
expect(sample.inputDelayP95Ms).toBeLessThanOrEqual(50);
expect(sample.lostNodeCount).toBe(0);
expect(sample.unclickableDurationMs).toBe(0);
```

- [ ] **Step 7: 建立 legacy 真实基线**

Run: `pnpm exec vitest run src/__tests__/scripts/stage-4-e2e-fixtures.test.ts`

Run: `pnpm exec playwright test tests/e2e/stage-4-node-chat-agent.spec.ts --project=chromium`

Expected: 夹具单测通过；浏览器结果按实际通过或失败写入 `test-results/stage-4-baseline/`。任何失败均保留截图、视频、Trace、Console 和 Network，不在本步骤修改业务代码。

- [ ] **Step 8: 写基线报告并执行保护门禁**

`docs/testing/STAGE_4_BASELINE_REPORT.md` 必须记录 Commit、环境、节点/端口/Skills/工具数量、三个工作区入口、当前失败、性能样本和证据路径。

Run: `pnpm doctor && pnpm check:protected-baseline && git diff --check`

Expected: Doctor 无失败；受保护功能 38/38；没有空白错误。

- [ ] **Step 9: 独立评审并提交**

评审只检查清单完整性、夹具隔离和采样真实性，不修业务缺陷。

Commit: `test: establish stage four node chat agent baseline`

---

### Task 1: 建立共享 Agent 领域契约与有序事件存储

**Files:**
- Create: `migrations/20260816_wj_stable_s4_agent_events.sql`
- Create: `src/lib/agent-runtime/types.ts`
- Create: `src/lib/agent-runtime/event-reducer.ts`
- Create: `src/lib/agent-runtime/event-storage.ts`
- Create: `src/lib/agent-runtime/tool-registry.ts`
- Create: `src/lib/agent-runtime/context-adapters.ts`
- Create: `src/lib/agent-runtime/service.ts`
- Create: `src/app/api/agent-runs/route.ts`
- Create: `src/app/api/agent-runs/[runId]/route.ts`
- Create: `src/app/api/agent-runs/[runId]/events/route.ts`
- Create: `src/__tests__/lib/agent-runtime-state.test.ts`
- Create: `src/__tests__/lib/agent-runtime-tools.test.ts`
- Create: `src/__tests__/api/agent-runs.test.ts`
- Create: `tests/integration/stage-4-agent-events-postgres.test.ts`
- Modify: `scripts/run-migrations.mjs`
- Modify: `scripts/doctor.mjs`

**Interfaces:**
- Consumes: `DurableTask`, `createBillableTask`, `transitionTask`, `settleFailedTask`, Asset Graph 和管理员模型目录。
- Produces: `AgentRunRequest`、`AgentEvent`、`AgentRunProjection`。
- Produces: `appendAgentEvent(input): Promise<AgentEvent>`。
- Produces: `listAgentEventsForActor(input): Promise<AgentEvent[]>`。
- Produces: `reduceAgentEvents(events): AgentRunProjection`。
- Produces: `authorizeAgentTools(input): AgentToolAuthorizationResult`，其中包含 `tools` 和 `denials`。

- [ ] **Step 1: 写事件状态 RED**

```ts
const projection = reduceAgentEvents([
  event(1, 'run.created'),
  event(2, 'plan.updated'),
  event(3, 'tool.started'),
  event(4, 'run.cancelled'),
  event(5, 'run.completed'),
]);

expect(projection.status).toBe('cancelled');
expect(projection.lastSequence).toBe(4);
expect(projection.ignoredEventIds).toContain('event-5');
```

另写 RED：重复 sequence 去重、sequence 缺口可恢复、失败/超时终态锁定、事件 payload 不接受 API Key/Token/password 字段。

- [ ] **Step 2: 运行 RED**

Run: `pnpm exec vitest run src/__tests__/lib/agent-runtime-state.test.ts`

Expected: FAIL，运行时类型与 reducer 尚不存在。

- [ ] **Step 3: 实现纯领域类型和 reducer**

```ts
export type AgentWorkspace = 'canvas' | 'workflow' | 'chat';
export type AgentMode = 'conversation' | 'vision' | 'agent';

export type AgentRunStatus =
  | 'created' | 'queued' | 'planning' | 'awaiting-confirmation'
  | 'executing' | 'uploading'
  | 'completed' | 'failed' | 'cancelled' | 'timeout';

export type AgentEventType =
  | 'run.created' | 'plan.updated'
  | 'tool.started' | 'tool.progress' | 'tool.completed'
  | 'asset.created'
  | 'run.completed' | 'run.failed' | 'run.cancelled' | 'run.timeout';

export interface AgentContextSnapshot {
  selectedEntityIds: string[];
  visibleVersionIds: string[];
  workflowNodeId?: string;
  conversationId?: string;
  locale: 'zh-CN' | 'en-US';
}

export interface AgentRunRequest {
  projectId: string;
  workspace: AgentWorkspace;
  workspaceId: string;
  mode: AgentMode;
  providerId: string;
  modelId: string;
  prompt: string;
  sourceVersionIds: string[];
  allowedToolIds: string[];
  idempotencyKey: string;
  context: AgentContextSnapshot;
}

export interface AgentEvent {
  eventId: string;
  runId: string;
  sequence: number;
  type: AgentEventType;
  timestamp: string;
  payload: Record<string, unknown>;
}

export interface AgentRunProjection {
  runId: string;
  status: AgentRunStatus;
  lastSequence: number;
  plan: Array<{ id: string; label: string; status: string }>;
  assetVersionIds: string[];
  error?: { code: string; message: string; retryable: boolean };
  ignoredEventIds: string[];
}
```

Reducer 按 sequence 排序，只接受第一个终态；后续终态和工具结果进入 `ignoredEventIds`，不能更新 result、assetVersionIds 或 billing 字段。

- [ ] **Step 4: 写 PostgreSQL 并发 RED**

迁移创建：

```sql
CREATE TABLE IF NOT EXISTS wujie_agent_events (
  id BIGSERIAL PRIMARY KEY,
  event_id TEXT NOT NULL UNIQUE,
  task_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  project_id TEXT NOT NULL DEFAULT '',
  workspace TEXT NOT NULL,
  sequence INTEGER NOT NULL CHECK (sequence > 0),
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at BIGINT NOT NULL,
  UNIQUE (task_id, sequence)
);
CREATE INDEX IF NOT EXISTS idx_agent_events_owner_task_sequence
  ON wujie_agent_events(owner_id, task_id, sequence);
```

20 并发追加必须得到连续唯一 sequence；跨用户读取返回空或 404；同 `eventId` 重试只返回原事件；任务不存在或 owner 不匹配时拒绝追加。

- [ ] **Step 5: 运行 PostgreSQL RED，再实现仓储**

Run: `pnpm exec vitest run tests/integration/stage-4-agent-events-postgres.test.ts`

Expected: FAIL，迁移和仓储尚不存在。

实现必须在事务中锁定对应 `cloud_tasks` 行、核对 `user_id/project_id`、取得 `max(sequence)+1` 并插入；唯一冲突只允许读取同一 `eventId`，不能吞掉不同事件冲突。

- [ ] **Step 6: 写工具授权 RED**

```ts
const authorization = authorizeAgentTools({
  requestedToolIds: ['generate_image', 'edit_image'],
  workspace: 'chat',
  userProductTypes: ['simple-chat'],
  modelCapabilities: ['chat'],
  registry,
});
expect(authorization.tools.map(tool => tool.toolId)).toEqual([]);
expect(authorization.denials).toEqual(expect.arrayContaining([
  expect.objectContaining({ code: 'MODEL_CAPABILITY_REQUIRED' }),
]));
```

模型和用户均授权时才返回工具；Agent 不读取客户端 API Key，也不能自动改选其他付费 provider。

```ts
export interface AgentToolAuthorizationResult {
  tools: AuthorizedAgentTool[];
  denials: Array<{
    toolId: string;
    code: 'TOOL_NOT_FOUND' | 'WORKSPACE_FORBIDDEN'
      | 'PRODUCT_PERMISSION_REQUIRED' | 'MODEL_CAPABILITY_REQUIRED';
  }>;
}
```

- [ ] **Step 7: 实现工具注册表、服务和 API**

`POST /api/agent-runs` 从会话获取真实 userId，验证 project、sourceVersionIds、provider/model 和 allowedToolIds，再通过 `createBillableTask` 创建 `cloud_tasks` 记录并追加 `run.created`。

`GET /api/agent-runs/[runId]/events?after=4` 只返回当前用户的 sequence `>4` 事件；`DELETE /api/agent-runs/[runId]` 复用既有取消/结算服务，不能独立实现退款。

- [ ] **Step 8: 运行 Task 1 回归**

Run: `pnpm exec vitest run src/__tests__/lib/agent-runtime-state.test.ts src/__tests__/lib/agent-runtime-tools.test.ts src/__tests__/api/agent-runs.test.ts tests/integration/stage-4-agent-events-postgres.test.ts`

Expected: 全部通过，PostgreSQL 并发无跳过。

Run: `pnpm ts-check && pnpm lint && pnpm build`

Expected: TypeScript 通过；ESLint 0 errors；生产构建通过。

- [ ] **Step 9: 独立评审并提交**

评审重点：跨用户读取、同键不同请求冲突、终态锁定、敏感字段、一次扣费/退款、迁移回滚安全。

Commit: `feat: add durable shared agent runtime`

---

### Task 2: 接入画布聊天、独立聊天和图片编辑 Agent

**Files:**
- Create: `src/lib/agent-runtime/legacy-observer.ts`
- Create: `src/lib/agent-runtime/surface-requests.ts`
- Create: `src/components/agent-runtime/use-agent-run-events.ts`
- Create: `src/components/agent-runtime/AgentProgressTimeline.tsx`
- Create: `src/__tests__/lib/agent-runtime-surface-requests.test.ts`
- Create: `src/__tests__/components/agent-progress-timeline.test.tsx`
- Create: `src/__tests__/components/agent-runtime-surface-wiring.test.ts`
- Create: `src/__tests__/api/agent-runtime-shadow.test.ts`
- Modify: `src/app/api/chat/route.ts`
- Modify: `src/app/api/simple-chat/chat/route.ts`
- Modify: `src/app/api/agent-edit/route.ts`
- Modify: `src/components/chat-panel.tsx`
- Modify: `src/components/simple-chat/chat-area.tsx`
- Modify: `src/components/agent-editor.tsx`
- Modify: `src/app/api/user-data/sync/route.ts`
- Modify: `src/lib/user-manager.ts`

**Interfaces:**
- Consumes: Task 1 的运行时、事件 API 和三个 context adapter。
- Produces: `buildCanvasAgentRequest`、`buildSimpleChatAgentRequest`、`buildAgentEditRequest`。
- Produces: `observeLegacyAgentRun(input): Promise<void>`，仅 shadow 使用。
- Produces: `useAgentRunEvents(runId)` 和 `<AgentProgressTimeline />`。

- [ ] **Step 1: 写三个入口请求等价 RED**

```ts
expect(buildCanvasAgentRequest(canvasInput)).toMatchObject({
  workspace: 'canvas',
  mode: 'agent',
  providerId: 'provider-chat',
  modelId: 'model-chat',
  sourceVersionIds: ['version-1'],
});

expect(buildSimpleChatAgentRequest(chatInput).allowedToolIds).toEqual([
  'analyze_image',
  'generate_image',
]);

expect(buildAgentEditRequest(editInput).context.selectedEntityIds).toEqual([
  'canvas-image-1',
]);
```

另写 RED：`conversation` 不启用工具；`vision` 缺图片直接失败；Agent 使用管理员目录，不返回“配置第三方 API”入口。

- [ ] **Step 2: 运行 RED，再实现请求构建器**

Run: `pnpm exec vitest run src/__tests__/lib/agent-runtime-surface-requests.test.ts`

Expected: FAIL，请求构建器尚不存在。

实现只规范化参数和上下文，不发网络请求、不扣费、不写素材。

- [ ] **Step 3: 写 shadow 零副作用 RED**

```ts
await observeLegacyAgentRun(input);
expect(deps.appendEvent).toHaveBeenCalled();
expect(deps.callProvider).not.toHaveBeenCalled();
expect(deps.chargeCredits).not.toHaveBeenCalled();
expect(deps.createAssetVersion).not.toHaveBeenCalled();
```

同一 legacy 任务只允许一组观察事件；观察失败不能改变原请求结果，但必须写脱敏诊断。

- [ ] **Step 4: 将三个后端入口接入 shadow**

`legacy` 完全不调用新运行时；`shadow` 在已有任务创建后追加对应事件并对照 provider/model/tool/context；`agent-v2` 通过共享运行时调度现有工具执行器，但保留原路由响应结构供旧前端兼容。

任何入口的 provider/model 不一致必须返回 `MODEL_ROUTE_MISMATCH`，不能静默回退到其他付费供应商。

- [ ] **Step 5: 写共享进度组件 RED**

```tsx
render(<AgentProgressTimeline projection={projection} onCancel={cancel} />);
expect(screen.getByText('正在规划')).toBeVisible();
expect(screen.getByRole('button', { name: '取消任务' })).toBeEnabled();
```

终态隐藏取消按钮；错误显示统一 `code/message/retryable`；无事件超过 1 秒时显示“正在排队”而不是空白或永久 loading。

- [ ] **Step 6: 接入三个前端表面**

`chat-panel.tsx`、`chat-area.tsx` 和 `agent-editor.tsx` 只负责构建上下文、显示事件和提交取消。把事件订阅放进 `use-agent-run-events.ts`，避免三个组件分别实现 SSE/轮询。

独立聊天“返回工作台”继续直接进入项目仪表盘；画布聊天不跳转 `/simple-chat`；Agent 按钮不弹出用户 API Key 配置。

- [ ] **Step 7: 运行 Task 2 回归**

Run: `pnpm exec vitest run src/__tests__/lib/agent-runtime-surface-requests.test.ts src/__tests__/api/agent-runtime-shadow.test.ts src/__tests__/components/agent-progress-timeline.test.tsx src/__tests__/components/agent-runtime-surface-wiring.test.ts src/__tests__/components/chat-panel-generation-recovery-contract.test.ts src/__tests__/components/simple-chat-workspace-return-contract.test.ts src/__tests__/api/agent-edit-task-admission-contract.test.ts`

Expected: 全部通过；现有入口和返回流程不变。

Run: `pnpm ts-check && pnpm lint && pnpm build && pnpm check:protected-baseline`

Expected: TypeScript、构建和 38/38 保护通过；ESLint 0 errors。

- [ ] **Step 8: 五浏览器 shadow 回归、评审并提交**

Run: `pnpm exec playwright test tests/e2e/stage-4-node-chat-agent.spec.ts --grep "chat|agent"`

Expected: 五个浏览器项目分别证明普通对话、图片理解失败停止、Agent 首进度、取消和刷新恢复；shadow 与 legacy 用户可见结果一致。

Commit: `feat: share agent runtime across chat surfaces`

---

### Task 3: 分离节点领域与渲染边界，建立 React Flow shadow

**Files:**
- Modify: `src/lib/workflow-renderer/mode.ts`
- Create: `src/lib/workflow-renderer/view-model.ts`
- Create: `src/lib/workflow-renderer/commands.ts`
- Create: `src/lib/workflow-renderer/shadow.ts`
- Create: `src/components/workflow/WorkflowLegacySurface.tsx`
- Create: `src/components/workflow/WorkflowShadowProbe.tsx`
- Create: `src/components/workflow/WorkflowReactFlowSurface.tsx`
- Create: `src/components/workflow/WorkflowNodeCard.tsx`
- Create: `src/__tests__/lib/workflow-render-view-model.test.ts`
- Create: `src/__tests__/lib/workflow-render-commands.test.ts`
- Create: `src/__tests__/lib/workflow-render-shadow.test.ts`
- Create: `src/__tests__/components/workflow-react-flow-surface.test.tsx`
- Modify: `src/components/node-editor.tsx`
- Modify: `src/lib/workflow-engine.ts`
- Modify: `src/app/api/user-data/sync/route.ts`
- Modify: `src/lib/user-manager.ts`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Consumes: 现有 `Workflow`、`WorkflowNode`、`WorkflowConnection`、`NodePort` 和历史保存回调。
- Produces: `projectWorkflowRenderModel(workflow, viewport): WorkflowRenderModel`。
- Produces: `projectLegacyRenderModel(workflow, viewport): WorkflowRenderModel`。
- Produces: `projectReactFlowRenderModel(workflow, viewport): WorkflowRenderModel`。
- Produces: `applyWorkflowCommand(workflow, command): WorkflowCommandResult`。
- Produces: `compareWorkflowRenderers(legacy, shadow): WorkflowShadowDiff`。
- Produces: `<WorkflowReactFlowSurface model onCommand />`。

- [ ] **Step 1: 写完整投影 RED**

```ts
const model = projectWorkflowRenderModel(workflow, viewport);
expect(model.nodes.map(node => node.id)).toEqual(workflow.nodes.map(node => node.id));
expect(model.edges.map(edge => edge.id)).toEqual(workflow.connections.map(edge => edge.id));
expect(model.nodes.find(node => node.id === 'node-1')?.ports).toEqual(
  workflow.nodes[0].ports,
);
```

遍历全部 `NODE_TYPE_LABELS`，证明每个 NodeType 都能投影；遍历 `PORT_COMPATIBILITY`，证明端口语义不变。

- [ ] **Step 2: 运行投影 RED，再实现纯 view-model**

Run: `pnpm exec vitest run src/__tests__/lib/workflow-render-view-model.test.ts`

Expected: FAIL，workflow-renderer 模块尚不存在。

投影不得包含 fetch、localStorage、积分、Task Core 或 Asset Graph 写入。

```ts
export interface WorkflowRenderNode {
  id: string;
  type: NodeType;
  position: { x: number; y: number };
  size: { width: number; height: number };
  ports: NodePort[];
  selected: boolean;
}

export interface WorkflowRenderEdge {
  id: string;
  source: { nodeId: string; portId: string };
  target: { nodeId: string; portId: string };
  type: PortType;
}

export interface WorkflowRenderModel {
  nodes: WorkflowRenderNode[];
  edges: WorkflowRenderEdge[];
  viewport: { x: number; y: number; zoom: number };
}
```

- [ ] **Step 3: 写命令 RED**

```ts
const moved = applyWorkflowCommand(workflow, {
  type: 'nodes.move',
  nodeIds: ['node-1', 'node-2'],
  delta: { x: 24, y: -12 },
  transactionId: 'drag-1',
});
expect(moved.historyEntries).toHaveLength(1);
expect(moved.workflow.nodes[0].x).toBe(workflow.nodes[0].x + 24);
```

另写 RED：非法端口连线拒绝、删除可撤销、复制保留内部连线、服务器水合不进入用户历史、同一拖动只产生一个历史事务。

```ts
export type WorkflowInteractionCommand =
  | { type: 'nodes.move'; nodeIds: string[]; delta: { x: number; y: number }; transactionId: string }
  | { type: 'connection.create'; connection: WorkflowConnection; transactionId: string }
  | { type: 'selection.set'; nodeIds: string[]; transactionId: string }
  | { type: 'nodes.delete'; nodeIds: string[]; transactionId: string }
  | { type: 'nodes.copy'; nodeIds: string[]; offset: { x: number; y: number }; transactionId: string };

export interface WorkflowCommandResult {
  workflow: Workflow;
  historyEntries: Array<{ transactionId: string; before: Workflow; after: Workflow }>;
}
```

- [ ] **Step 4: 实现命令层并抽出 legacy surface**

`node-editor.tsx` 保留面板、执行和项目协调；将节点/边渲染 JSX 移至 `WorkflowLegacySurface.tsx`，只通过 `onCommand` 回传用户动作。先确保 legacy DOM、可访问名称、快捷键和视觉位置不变。

- [ ] **Step 5: 安装并锁定 React Flow 12**

Run: `pnpm add @xyflow/react@12.11.2`

Expected: `package.json` 和 `pnpm-lock.yaml` 仅新增官方 `@xyflow/react` 及其锁定依赖。该版本在 npm 官方页面标记为 12.11.2，使用 `@xyflow/react` 包名和 MIT 许可。

- [ ] **Step 6: 写 React Flow shadow RED**

```ts
const diff = compareWorkflowRenderers(
  projectLegacyRenderModel(workflow, viewport),
  projectReactFlowRenderModel(workflow, viewport),
);
expect(diff.missingNodeIds).toEqual([]);
expect(diff.extraNodeIds).toEqual([]);
expect(diff.mismatchedPortIds).toEqual([]);
expect(diff.mismatchedEdgeIds).toEqual([]);
```

shadow 组件不得挂载可交互表面，不调用 `onCommand`、save、execute、Task Core 或 Asset Graph。

- [ ] **Step 7: 实现三态宿主**

```tsx
return mode === 'react-flow-v2' ? (
  <WorkflowReactFlowSurface model={model} onCommand={onCommand} />
) : (
  <>
    <WorkflowLegacySurface model={model} onCommand={onCommand} />
    {mode === 'shadow' ? <WorkflowShadowProbe workflow={workflow} /> : null}
  </>
);
```

`WorkflowReactFlowSurface` 使用自定义 node/edge types 保留现有节点卡、端口、状态和标签，不采用默认示例卡替代产品 UI。

- [ ] **Step 8: 运行节点回归与性能门禁**

Run: `pnpm exec vitest run src/__tests__/lib/workflow-render-view-model.test.ts src/__tests__/lib/workflow-render-commands.test.ts src/__tests__/lib/workflow-render-shadow.test.ts src/__tests__/components/workflow-react-flow-surface.test.tsx src/__tests__/components/node-editor-ui-regression.test.ts src/__tests__/components/node-editor-history-baseline-contract.test.ts src/__tests__/components/node-editor-execution-wiring.test.ts`

Run: `pnpm exec playwright test tests/e2e/stage-4-node-chat-agent.spec.ts --grep "workflow"`

Expected: legacy 与 shadow 功能结果一致；100 节点 >=55 FPS、P95 <=50 ms、丢失节点和不可点击时间为 0。

- [ ] **Step 9: 全仓门禁、独立评审并提交**

Run: `pnpm ts-check && pnpm lint && pnpm test && pnpm build && pnpm check:protected-baseline && git diff --check`

评审重点：节点类型丢失、history 双写、shadow 副作用、React Flow state 成为第二权威、执行/账务被渲染器调用。

Commit: `feat: add shadow react flow workflow renderer`

---

### Task 4: 三工作区完全互通、v2 验收与强制回退

**Files:**
- Create: `src/lib/agent-runtime/workspace-results.ts`
- Create: `src/__tests__/lib/agent-workspace-results.test.ts`
- Create: `src/__tests__/api/agent-runtime-accounting.test.ts`
- Create: `tests/integration/stage-4-agent-accounting-postgres.test.ts`
- Modify: `src/lib/asset-core/workspace-transfer.ts`
- Modify: `src/lib/asset-core/task-projector.ts`
- Modify: `src/components/canvas-workspace.tsx`
- Modify: `src/components/node-editor.tsx`
- Modify: `src/components/simple-chat/chat-area.tsx`
- Modify: `tests/e2e/stage-4-node-chat-agent.spec.ts`
- Modify: `.github/workflows/quality.yml`
- Modify: `docs/testing/BUG_REGISTER.md`
- Modify: `docs/testing/REGRESSION_REPORT.md`
- Modify: `docs/testing/RELEASE_READINESS_REPORT.md`
- Modify: `docs/testing/UNVERIFIED_ITEMS.md`
- Modify: `docs/testing/STAGE_4_REGRESSION_REPORT.md`

**Interfaces:**
- Consumes: Agent Runtime、Task Core、Asset Graph、WorkspacePlacement、Workflow renderer modes。
- Produces: `projectAgentResultToWorkspace(input): Promise<WorkspaceAssetReference[]>`。
- Produces: 完整 `chat -> canvas -> workflow -> chat` 版本来源链。
- Produces: `legacy -> shadow -> v2 -> legacy` 自动化和云端验收证据。

- [ ] **Step 1: 写跨工作区版本链 RED**

```ts
const result = await projectAgentResultToWorkspace({
  actorUserId: 'user-1',
  taskId: 'task-1',
  targetProjectId: 'project-1',
  workspace: 'workflow',
  workspaceId: 'workflow:project-1',
  sourceEntityId: 'chat-message-1',
  parentVersionIds: ['chat-version-1', 'canvas-version-2'],
  idempotencyKey: 'chat-canvas-workflow-1',
});
expect(result[0]).toMatchObject({
  assetVersionId: expect.any(String),
  placementId: expect.any(String),
});
```

20 并发相同请求只产生一个 placement；同键不同目标冲突；切换项目后旧结果不能落入新项目；跨用户 versionId 返回 404。

- [ ] **Step 2: 实现统一结果投影**

复用 `projectCompletedTaskToAssets` 和 `prepareWorkflowCanvasInsertions`，把三处裸 URL 新写入收拢到 `projectAgentResultToWorkspace`。旧 URL 数据继续只读兼容，不批量改写历史项目。

- [ ] **Step 3: 写真实账务 RED**

PostgreSQL 测试必须证明：

```ts
expect(await countCharges(taskId)).toBe(1);
expect(await countRefunds(taskId)).toBeLessThanOrEqual(1);
expect((await readTask(taskId)).status).toBe('cancelled');
expect(await countEffectiveVersions(taskId)).toBe(0);
```

覆盖成功、重复提交、取消、重复取消、超时、供应商失败和迟到 completed；内存注册中心清空后结论不变。

- [ ] **Step 4: 运行 PostgreSQL RED，再闭环服务**

Run: `pnpm exec vitest run tests/integration/stage-4-agent-accounting-postgres.test.ts src/__tests__/api/agent-runtime-accounting.test.ts`

Expected: 初次 RED 精确指向重复结算、迟到版本或所有权缺口；最小修复只能位于共享运行时/结果投影，不在三个 UI 分别打补丁。

- [ ] **Step 5: 完成五浏览器端到端链路**

每个浏览器使用独立用户和项目，执行：

```text
独立聊天上传图片
-> 图片理解
-> Agent 生成结果
-> 发送到无限画布
-> 画布移动并保存
-> 发送到节点输入
-> 节点连接与执行
-> 结果返回独立聊天
-> 刷新三个工作区
-> 核对来源链与任务终态
```

Run: `pnpm exec playwright test tests/e2e/stage-4-node-chat-agent.spec.ts`

Expected: Chromium、1920x1080 Chromium、Firefox、WebKit、移动 Chromium 全部通过；失败自动保存截图、视频、Trace、Console 和 Network。

- [ ] **Step 6: 执行本地模式提升和回退**

顺序固定：

```text
agent legacy + workflow legacy
-> agent shadow + workflow shadow
-> agent-v2 + workflow react-flow-v2
-> agent legacy + workflow legacy
```

每一步重新启动生产构建并运行核心 E2E。回到 legacy 后，登录、旧聊天、旧工作流、节点数量、素材版本、任务终态和积分余额必须一致。

- [ ] **Step 7: 执行完整本地门禁**

Run:

```bash
pnpm install --frozen-lockfile
pnpm doctor
pnpm ts-check
pnpm lint
pnpm test
pnpm test:api
pnpm build
pnpm check:protected-baseline
pnpm exec playwright test tests/e2e/stage-4-node-chat-agent.spec.ts
```

Expected: 所有命令退出 0；ESLint 0 errors；PostgreSQL 专项无跳过；功能清单与 Task 0 相比零减少。

- [ ] **Step 8: 更新 CI 但不以 Billing 结果阻断本地证据**

Quality workflow 增加 Stage 4 inventory、PostgreSQL Agent 事件/账务和五浏览器代表门禁。若 GitHub job 再次为 `runner_id=0, steps=[]`，报告为“外部未执行”，不得触发重复提交或伪造通过。

- [ ] **Step 9: main-only 推送和 Coze 精确 SHA 验收**

推送前核对 `origin/main` 未前进，只允许普通 fast-forward。Coze 只能拉取 `main` 精确 SHA，在隔离项目依次执行 shadow、v2、legacy；稳定部署和 `stable` 不改动。

Chrome 云端必须证明：三个工作区可直接进入和返回、Agent 首进度、真实模型路由、成功结果、取消/超时、一次扣费/退款、100 节点性能和完整回退。无法控制 Chrome 或缺少真实供应商时标记 `UNVERIFIED`，不得标记通过。

- [ ] **Step 10: 更新报告、Obsidian、独立评审并提交**

报告写明总功能数、测试数、P0/P1/P2/P3、修复数、未验证数、精确 SHA、回退点和发布结论。Obsidian 更新 Stage 4 Task 0-4 状态与下一唯一目标。

Commit: `test: close stage four workspace interoperability gates`

## Plan Self-Review

- 规格中的共享 Agent 运行时、三种对话模式、三工作区互通、React Flow shadow、零丢失、性能、安全、账务和回退均映射到 Task 0-4。
- Agent 运行事实复用 `cloud_tasks`，没有另建第二套任务终态；新增表只保存有序事件。
- React Flow 不进入 Task 0-2，不直接替换 legacy；`@xyflow/react@12.11.2` 在 Task 3 shadow 证据建立后才安装。
- Task 4 前不允许 v2 权威模式；Stage 3 外部门禁仍保留，不因本地 Stage 4 工作被改写。
- 计划没有占位步骤；所有生产修改均有先行 RED、精确命令、预期结果、回归和提交点。

## References

- 设计规格：`docs/superpowers/specs/2026-08-16-wujie-stage-4-node-chat-agent-design.md`
- 总体设计：`docs/superpowers/specs/2026-08-08-wujie-stable-core-upgrade-design.md`
- Stage 3 计划：`docs/superpowers/plans/2026-08-13-wujie-stable-canvas-kernel-stage-3.md`
- React Flow 官方迁移说明：https://reactflow.dev/learn/troubleshooting/migrate-to-v12
- React Flow 官方 npm 包：https://www.npmjs.com/package/@xyflow/react

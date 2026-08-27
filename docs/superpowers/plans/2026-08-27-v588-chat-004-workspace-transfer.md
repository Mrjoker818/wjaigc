# V588-CHAT-004 智能对话结果发送到工作区 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不复制 V5.8.8 原始 URL 桥接的前提下，让独立智能对话的文本和受管理图片安全、可追踪、可恢复地发送到无限画布和节点模式。

**Architecture:** 客户端只通过 URL 传递来源项目、任务、消息和目标项目标识；登录态服务端重新读取当前用户的权威 Simple Chat 快照并校验目标项目归属。图片继续通过 `AssetVersion -> /api/assets/transfer` 转移，纯函数模块负责稳定工作流 ID、确定性节点 ID、追加布局和重复消费去重，`CanvasWorkspace` 只负责编排、持久化和清理 URL。

**Tech Stack:** Next.js 16 App Router、React 19、TypeScript 5、PostgreSQL、Vitest、Playwright、现有 Asset Core 与 Workflow Engine。

## Global Constraints

- 基线固定为 `origin/main@cb63085e21d8ff0158d8b13606cfdbdc7a8dc1e6` 加已批准规格提交 `07367b66`。
- `J:\无界云端0820` 只读，不复制 donor 的 `wujie_node_bridge` 或原始 URL `localStorage` 桥接。
- GitHub `stable` 禁止修改、合并或推送；所有业务改动最终只进入 `main`。
- 不删除或改名现有无限画布、节点模式、独立智能对话入口与既有功能。
- 每个任务严格执行失败测试、最小实现、局部回归和独立提交。
- 只有全量门禁与 Coze Google Chrome 真实验收通过后，`V588-CHAT-004` 才能标记为已吸收。
- 不提交 `.superpowers/sdd/progress.md`、`.playwright-cli/` 或临时测试产物。

---

## File Structure

- Create `src/lib/asset-core/source-trace.ts`: 集中校验和裁剪 `WorkspaceSourceTrace`，禁止任意 metadata 外泄。
- Modify `src/lib/asset-core/types.ts`: 为规范化资产引用增加可选来源追踪。
- Create `src/lib/simple-chat-workspace-handoff.ts`: URL 意图、稳定 ID、节点构造和工作流追加纯函数。
- Create `src/lib/simple-chat-workspace-handoff-server.ts`: 读取权威 Simple Chat 快照并校验来源、目标和媒体身份。
- Create `src/app/api/simple-chat/workspace-handoff/route.ts`: 登录态解析 API。
- Create `src/lib/simple-chat-workspace-handoff-client.ts`: 按解析、转移、保存、清理顺序执行可恢复交接。
- Modify `src/app/api/assets/transfer/route.ts` and `src/lib/asset-core/service.ts`: 返回经过验证的来源追踪。
- Modify `src/app/api/simple-chat/chat/route.ts`: 为生成图片记录实际模型、供应商和任务来源。
- Modify `src/components/simple-chat/simple-chat-types.ts`: 保留来源追踪并生成受限交接 URL。
- Modify `src/components/simple-chat/chat-area.tsx`: 增加“发送到节点模式”，并完善画布转移来源元数据。
- Modify `src/components/canvas-workspace.tsx`: 直接进入节点模式、消费交接、保存后清理 URL，并把画布来源传入图片节点。
- Modify `src/components/node-editor.tsx`: 在属性面板显示只读来源信息。
- Modify `src/components/infinite-canvas.tsx` and `src/lib/user-types.ts`: 持久化并显示画布图片来源。
- Create focused tests under `src/__tests__/lib`, `src/__tests__/api`, and `src/__tests__/components`.
- Modify V5.8.8 inventory and Chinese testing reports only after verification evidence exists.

---

### Task 1: 来源追踪契约与受限交接意图

**Files:**
- Create: `src/lib/asset-core/source-trace.ts`
- Modify: `src/lib/asset-core/types.ts`
- Create: `src/lib/simple-chat-workspace-handoff.ts`
- Test: `src/__tests__/lib/simple-chat-workspace-handoff.test.ts`

**Interfaces:**
- Produces: `WorkspaceSourceTrace`, `parseWorkspaceSourceTrace`, `buildSimpleChatWorkspaceHandoffUrl`, `parseSimpleChatWorkspaceHandoffIntent`, `parseSimpleChatWorkspaceHandoffBody`, `stableChatImportWorkflowId`, `stableChatImportNodeId`, `appendSimpleChatHandoffToWorkflow`。
- Consumes: existing `Workflow`, `WorkflowNode`, `WorkspaceAssetReference`, and `createWorkflowNode`。

- [ ] **Step 1: Write the failing contract tests**

```ts
import { describe, expect, it } from 'vitest';
import { createEmptyWorkflow, createWorkflowNode } from '@/lib/workflow-engine';
import {
  appendSimpleChatHandoffToWorkflow,
  buildSimpleChatWorkspaceHandoffUrl,
  parseSimpleChatWorkspaceHandoffIntent,
  stableChatImportWorkflowId,
  stableChatImportNodeId,
} from '@/lib/simple-chat-workspace-handoff';

const intent = {
  targetProjectId: 'canvas-project-1',
  chatProjectId: 'chat-project-1',
  chatTaskId: 'task-1',
  chatMessageId: 'message-1',
};

describe('simple chat workspace handoff contracts', () => {
  it('round-trips bounded identifiers without embedding text or media URLs', () => {
    const url = buildSimpleChatWorkspaceHandoffUrl(intent);
    expect(url).toContain('mode=node');
    expect(url).not.toContain('prompt=');
    expect(url).not.toContain('imageUrl=');
    expect(parseSimpleChatWorkspaceHandoffIntent(url.split('?')[1])).toEqual(intent);
    expect(parseSimpleChatWorkspaceHandoffIntent(`projectId=x&mode=node&chatProjectId=${'x'.repeat(201)}`)).toBeNull();
  });

  it('creates stable workflow and node identities', () => {
    expect(stableChatImportWorkflowId('canvas-project-1')).toBe(stableChatImportWorkflowId('canvas-project-1'));
    expect(stableChatImportWorkflowId('canvas-project-1')).not.toBe(stableChatImportWorkflowId('canvas-project-2'));
    expect(stableChatImportNodeId(intent, 'text', 0)).toBe(stableChatImportNodeId(intent, 'text', 0));
    expect(stableChatImportNodeId(intent, 'image', 0)).not.toBe(stableChatImportNodeId(intent, 'image', 1));
  });

  it('creates a named workflow when absent and only appends to an existing workflow', () => {
    const existing = createEmptyWorkflow('已有工作流');
    existing.nodes.push({
      ...createWorkflowNode('input-text', 20, 40, '已有节点'),
      id: 'existing-node',
      config: { text: '不得覆盖' },
    });
    const handoff = {
      text: '保留品牌色并生成海报',
      images: [],
      warnings: [],
      sourceTrace: {
        source: 'simple-chat' as const,
        chatProjectId: 'chat-project-1',
        chatTaskId: 'task-1',
        messageId: 'message-1',
        createdAt: '2026-08-27T00:00:00.000Z',
      },
    };
    const created = appendSimpleChatHandoffToWorkflow(null, 'canvas-project-1', handoff, 1000);
    const appended = appendSimpleChatHandoffToWorkflow(existing, 'canvas-project-1', handoff, 1000);
    expect(created.workflow.name).toBe('智能对话导入');
    expect(created.workflow.id).toBe(stableChatImportWorkflowId('canvas-project-1'));
    expect(appended.workflow.id).toBe(existing.id);
    expect(appended.workflow.name).toBe('已有工作流');
    expect(appended.workflow.connections).toEqual(existing.connections);
  });
});
```

- [ ] **Step 2: Run the new test and record RED**

Run: `pnpm exec vitest run src/__tests__/lib/simple-chat-workspace-handoff.test.ts`

Expected: FAIL because the new modules and exports do not exist.

- [ ] **Step 3: Add the source trace validator**

```ts
export interface WorkspaceSourceTrace {
  source: 'simple-chat';
  chatProjectId: string;
  chatTaskId: string;
  messageId: string;
  modelId?: string;
  providerId?: string;
  generationTaskIds?: string[];
  agentRunId?: string;
  createdAt: string;
}

const TRACE_ID = /^[A-Za-z0-9._:-]{1,200}$/;

export function parseWorkspaceSourceTrace(value: unknown): WorkspaceSourceTrace | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const trace = value as Record<string, unknown>;
  if (
    trace.source !== 'simple-chat'
    || typeof trace.chatProjectId !== 'string' || !TRACE_ID.test(trace.chatProjectId)
    || typeof trace.chatTaskId !== 'string' || !TRACE_ID.test(trace.chatTaskId)
    || typeof trace.messageId !== 'string' || !TRACE_ID.test(trace.messageId)
    || typeof trace.createdAt !== 'string' || Number.isNaN(Date.parse(trace.createdAt))
  ) return undefined;
  const generationTaskIds = Array.isArray(trace.generationTaskIds)
    ? trace.generationTaskIds.filter((id): id is string => typeof id === 'string' && TRACE_ID.test(id)).slice(0, 16)
    : undefined;
  return {
    source: 'simple-chat',
    chatProjectId: trace.chatProjectId,
    chatTaskId: trace.chatTaskId,
    messageId: trace.messageId,
    ...(typeof trace.modelId === 'string' && TRACE_ID.test(trace.modelId) ? { modelId: trace.modelId } : {}),
    ...(typeof trace.providerId === 'string' && TRACE_ID.test(trace.providerId) ? { providerId: trace.providerId } : {}),
    ...(generationTaskIds?.length ? { generationTaskIds } : {}),
    ...(typeof trace.agentRunId === 'string' && TRACE_ID.test(trace.agentRunId) ? { agentRunId: trace.agentRunId } : {}),
    createdAt: new Date(trace.createdAt).toISOString(),
  };
}
```

Add `sourceTrace?: WorkspaceSourceTrace` to `WorkspaceAssetReference` and import the type from `source-trace.ts`.

- [ ] **Step 4: Add bounded URL, stable IDs, and append-only node construction**

```ts
const HANDOFF_ID = /^[A-Za-z0-9._:-]{1,200}$/;

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

export function stableChatImportWorkflowId(projectId: string): string {
  return `wf-chat-import-${stableHash(projectId)}`;
}

export function stableChatImportNodeId(
  intent: SimpleChatWorkspaceHandoffIntent,
  kind: 'text' | 'image',
  index: number,
): string {
  return `node-chat-${stableHash(JSON.stringify([intent.chatProjectId, intent.chatTaskId, intent.chatMessageId, kind, index]))}`;
}
```

Create nodes with `createWorkflowNode`, overwrite only the generated random `id`, merge `sourceTrace` into `config`, and place new nodes to the right of the existing node bounding box. Filter candidate nodes whose deterministic IDs already exist before appending.

- [ ] **Step 5: Run focused tests and commit**

Run: `pnpm exec vitest run src/__tests__/lib/simple-chat-workspace-handoff.test.ts`

Expected: PASS.

Commit:

```bash
git add src/lib/asset-core/source-trace.ts src/lib/asset-core/types.ts src/lib/simple-chat-workspace-handoff.ts src/__tests__/lib/simple-chat-workspace-handoff.test.ts
git commit -m "feat: define simple chat workspace handoff"
```

---

### Task 2: 权威消息解析与权限 API

**Files:**
- Create: `src/lib/simple-chat-workspace-handoff-server.ts`
- Create: `src/app/api/simple-chat/workspace-handoff/route.ts`
- Test: `src/__tests__/lib/simple-chat-workspace-handoff-server.test.ts`
- Test: `src/__tests__/api/simple-chat-workspace-handoff.test.ts`

**Interfaces:**
- Consumes: `readSimpleChatSnapshot(userId)`, `createPostgresAssetStorage().read`, `parseWorkspaceSourceTrace`。
- Produces: `resolveSimpleChatWorkspaceHandoff(input, dependencies?)` and authenticated `POST /api/simple-chat/workspace-handoff`。

- [ ] **Step 1: Write failing ownership and payload tests**

```ts
it('returns only the actor-owned message and managed index-aligned images', async () => {
  const result = await resolveSimpleChatWorkspaceHandoff({
    actorUserId: 'user-1',
    targetProjectId: 'canvas-1',
    chatProjectId: 'chat-1',
    chatTaskId: 'task-1',
    chatMessageId: 'message-1',
  }, {
    projectExists: async () => true,
    readSnapshot: async () => ({ schemaVersion: 1, revision: 1, projects: [projectFixture] }),
  });
  expect(result.text).toBe('最终方案');
  expect(result.images).toHaveLength(1);
  expect(result.images[0].assetRef.assetVersionId).toBe('version-1');
  expect(result.warnings).toContain('UNMANAGED_IMAGE_SKIPPED');
});

it('rejects a target project not owned by the actor', async () => {
  await expect(resolveSimpleChatWorkspaceHandoff(input, {
    projectExists: async () => false,
    readSnapshot: async () => snapshotFixture,
  })).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
});
```

The API test must assert 401 without a session, 400 for malformed identifiers, 403 for target ownership, 404 for missing source, and a structured 200 payload for valid input.

- [ ] **Step 2: Run both tests and record RED**

Run: `pnpm exec vitest run src/__tests__/lib/simple-chat-workspace-handoff-server.test.ts src/__tests__/api/simple-chat-workspace-handoff.test.ts`

Expected: FAIL because the resolver and route do not exist.

- [ ] **Step 3: Implement a dependency-injected server resolver**

```ts
export async function resolveSimpleChatWorkspaceHandoff(
  input: ResolveSimpleChatWorkspaceHandoffInput,
  dependencies: ResolverDependencies = defaultDependencies,
): Promise<SimpleChatWorkspaceHandoff> {
  if (!await dependencies.projectExists(input.actorUserId, input.targetProjectId)) {
    throw new SimpleChatWorkspaceHandoffError('FORBIDDEN', 403);
  }
  const snapshot = await dependencies.readSnapshot(input.actorUserId);
  const project = snapshot.projects.find(item => item.id === input.chatProjectId);
  const task = project?.tasks.find(item => item.id === input.chatTaskId);
  const message = task?.messages.find(item => item.id === input.chatMessageId);
  if (!project || !task || !message) {
    throw new SimpleChatWorkspaceHandoffError('HANDOFF_SOURCE_NOT_FOUND', 404);
  }
  const sourceTrace = buildWorkspaceSourceTrace(project, task, message);
  const images = alignManagedMessageImages(message, sourceTrace);
  const text = message.content.trim() || null;
  if (!text && images.length === 0) {
    throw new SimpleChatWorkspaceHandoffError('NO_MANAGED_MEDIA', 422);
  }
  return {
    text,
    images,
    sourceTrace,
    warnings: images.length < (message.images?.length || 0) ? ['UNMANAGED_IMAGE_SKIPPED'] : [],
  };
}
```

`defaultDependencies.projectExists` must use the existing storage boundary:

```ts
projectExists: (userId, projectId) => createPostgresAssetStorage().read(
  transaction => transaction.findProject(userId, projectId),
),
```

- [ ] **Step 4: Implement the authenticated route**

```ts
export async function POST(request: NextRequest): Promise<NextResponse> {
  const user = await getSessionUser(request);
  if (!user) return NextResponse.json({ success: false, code: 'UNAUTHORIZED' }, { status: 401 });
  const body = await request.json().catch(() => null);
  const intent = parseSimpleChatWorkspaceHandoffBody(body);
  if (!intent) return NextResponse.json({ success: false, code: 'INVALID_HANDOFF' }, { status: 400 });
  try {
    return NextResponse.json({
      success: true,
      handoff: await resolveSimpleChatWorkspaceHandoff({ actorUserId: user.id, ...intent }),
    });
  } catch (error) {
    if (error instanceof SimpleChatWorkspaceHandoffError) {
      return NextResponse.json({ success: false, code: error.code }, { status: error.status });
    }
    return NextResponse.json({ success: false, code: 'HANDOFF_RESOLVE_FAILED' }, { status: 500 });
  }
}
```

- [ ] **Step 5: Run tests and commit**

Run: `pnpm exec vitest run src/__tests__/lib/simple-chat-workspace-handoff-server.test.ts src/__tests__/api/simple-chat-workspace-handoff.test.ts`

Expected: PASS.

Commit:

```bash
git add src/lib/simple-chat-workspace-handoff-server.ts src/app/api/simple-chat/workspace-handoff/route.ts src/__tests__/lib/simple-chat-workspace-handoff-server.test.ts src/__tests__/api/simple-chat-workspace-handoff.test.ts
git commit -m "feat: resolve authorized chat workspace handoffs"
```

---

### Task 3: 资产来源追踪与生成任务追踪

**Files:**
- Modify: `src/lib/asset-core/service.ts`
- Modify: `src/app/api/assets/transfer/route.ts`
- Modify: `src/app/api/simple-chat/chat/route.ts`
- Modify: `src/components/simple-chat/simple-chat-types.ts`
- Test: `src/__tests__/lib/asset-source-trace.test.ts`
- Test: `src/__tests__/api/simple-chat-generated-source-trace.test.ts`
- Test: `src/__tests__/components/simple-chat-asset-transfer.test.ts`

**Interfaces:**
- Consumes: `parseWorkspaceSourceTrace` and current placement metadata.
- Produces: canonical `WorkspaceAssetReference.sourceTrace` across registration, transfer, resolve, persistence, and bridge parsing.

- [ ] **Step 1: Write failing trace propagation tests**

```ts
it('returns only a validated sourceTrace from placement metadata', async () => {
  const reference = await service.resolveAssetReference({
    actorUserId: 'user-1', projectId: 'project-1', assetVersionId: 'version-1', placementId: 'placement-1',
  });
  expect(reference.sourceTrace).toEqual(sourceTraceFixture);
  expect(reference).not.toHaveProperty('metadata');
});

it('preserves sourceTrace through the canvas bridge parser', () => {
  expect(parseSimpleChatCanvasBridgePayload({ images: [{
    url: '/managed.png', assetVersionId: 'version-1', placementId: 'placement-1', sourceTrace: sourceTraceFixture,
  }] })[0].sourceTrace).toEqual(sourceTraceFixture);
});
```

Add a source-level test that `sendGeneratedImage` emits actual `imageModel`, `imageProviderId`, `authoritativeTaskId`, `body.projectId`, `body.taskId`, and `body.responseMessageId` in `sourceTrace`.

- [ ] **Step 2: Run trace tests and record RED**

Run: `pnpm exec vitest run src/__tests__/lib/asset-source-trace.test.ts src/__tests__/api/simple-chat-generated-source-trace.test.ts src/__tests__/components/simple-chat-asset-transfer.test.ts`

Expected: FAIL because canonical references currently discard placement metadata and the bridge parser drops source trace.

- [ ] **Step 3: Return only sanitized trace from Asset Core**

```ts
const sourceTrace = parseWorkspaceSourceTrace(placement?.metadata?.sourceTrace);
return {
  assetId: version.assetId,
  assetVersionId: version.id,
  ...(placement ? { placementId: placement.id, entityId: placement.entityId } : {}),
  url: version.file.url,
  ...(name ? { name } : {}),
  ...(sourceTrace ? { sourceTrace } : {}),
};
```

The transfer route must parse `body.metadata.sourceTrace` and include only the validated trace in its response. It must never return the whole metadata object.

- [ ] **Step 4: Record actual generated image execution source**

```ts
const sourceTrace: WorkspaceSourceTrace = {
  source: 'simple-chat',
  chatProjectId: body.projectId,
  chatTaskId: body.taskId,
  messageId: body.responseMessageId,
  modelId: imageModel,
  providerId: imageProviderId,
  ...(authoritativeTaskId ? { generationTaskIds: [authoritativeTaskId] } : {}),
  createdAt: new Date().toISOString(),
};
```

Attach it to newly registered placement metadata and to the SSE `imageRef`. For task-projected references that were created before this code sees the result, merge the same validated trace into the returned reference without changing asset identity.

- [ ] **Step 5: Preserve trace in Simple Chat parsing and commit**

Update `toWorkspaceAssetReference` to call `parseWorkspaceSourceTrace(value.sourceTrace)` and include only a valid trace.

Run: `pnpm exec vitest run src/__tests__/lib/asset-source-trace.test.ts src/__tests__/api/simple-chat-generated-source-trace.test.ts src/__tests__/components/simple-chat-asset-transfer.test.ts`

Expected: PASS.

Commit:

```bash
git add src/lib/asset-core/service.ts src/app/api/assets/transfer/route.ts src/app/api/simple-chat/chat/route.ts src/components/simple-chat/simple-chat-types.ts src/__tests__/lib/asset-source-trace.test.ts src/__tests__/api/simple-chat-generated-source-trace.test.ts src/__tests__/components/simple-chat-asset-transfer.test.ts
git commit -m "feat: preserve simple chat asset provenance"
```

---

### Task 4: 可恢复的工作流导入执行器

**Files:**
- Create: `src/lib/simple-chat-workspace-handoff-client.ts`
- Test: `src/__tests__/lib/simple-chat-workspace-handoff-client.test.ts`

**Interfaces:**
- Consumes: parsed intent, resolved handoff, `appendSimpleChatHandoffToWorkflow`, `/api/assets/transfer`, and workflow persistence callback.
- Produces: `executeSimpleChatWorkspaceHandoff` with explicit success, partial-success, and failure results.

- [ ] **Step 1: Write failing ordering, idempotency, and recovery tests**

```ts
it('persists before cleaning the URL', async () => {
  const events: string[] = [];
  await executeSimpleChatWorkspaceHandoff({
    intent, currentWorkflow: null,
    resolve: async () => handoffFixture,
    transfer: async request => ({ ...managedReference, entityId: request.entityId }),
    persist: async () => { events.push('persist'); },
    cleanUrl: () => { events.push('clean'); },
    now: () => 1000,
  });
  expect(events).toEqual(['persist', 'clean']);
});

it('keeps the URL when persistence fails', async () => {
  const cleanUrl = vi.fn();
  await expect(executeSimpleChatWorkspaceHandoff({
    ...dependencies,
    persist: async () => { throw new Error('save failed'); },
    cleanUrl,
  })).rejects.toThrow('save failed');
  expect(cleanUrl).not.toHaveBeenCalled();
});

it('reuses deterministic nodes and transfers on repeated consumption', async () => {
  const first = await executeSimpleChatWorkspaceHandoff(dependencies);
  const second = await executeSimpleChatWorkspaceHandoff({ ...dependencies, currentWorkflow: first.workflow });
  expect(second.addedNodeIds).toEqual([]);
  expect(second.workflow.nodes).toHaveLength(first.workflow.nodes.length);
});
```

- [ ] **Step 2: Run the test and record RED**

Run: `pnpm exec vitest run src/__tests__/lib/simple-chat-workspace-handoff-client.test.ts`

Expected: FAIL because the client executor does not exist.

- [ ] **Step 3: Implement the ordered executor**

```ts
export async function executeSimpleChatWorkspaceHandoff(
  input: ExecuteSimpleChatWorkspaceHandoffInput,
): Promise<ExecuteSimpleChatWorkspaceHandoffResult> {
  const handoff = await input.resolve(input.intent);
  const planned = appendSimpleChatHandoffToWorkflow(
    input.currentWorkflow,
    input.intent.targetProjectId,
    handoff,
    input.now(),
  );
  let workflow = planned.workflow;
  for (const pending of planned.pendingImages) {
    const reference = await input.transfer(buildSimpleChatWorkflowTransfer(
      input.intent,
      workflow.id,
      pending,
    ));
    workflow = applyTransferredImageReference(workflow, pending.nodeId, reference);
  }
  await input.persist(workflow);
  input.cleanUrl();
  return {
    workflow,
    addedNodeIds: planned.addedNodeIds,
    warnings: handoff.warnings,
  };
}
```

`buildSimpleChatWorkflowTransfer` must set `targetWorkspace: workflow.id`, `entityType: 'workflow-input'`, `entityId: pending.nodeId`, deterministic idempotency key, and `metadata: { sourceTrace, imageIndex, name }`.

- [ ] **Step 4: Run the test and commit**

Run: `pnpm exec vitest run src/__tests__/lib/simple-chat-workspace-handoff-client.test.ts`

Expected: PASS.

Commit:

```bash
git add src/lib/simple-chat-workspace-handoff-client.ts src/__tests__/lib/simple-chat-workspace-handoff-client.test.ts
git commit -m "feat: execute recoverable chat workflow imports"
```

---

### Task 5: Simple Chat 入口与无限画布来源保留

**Files:**
- Modify: `src/components/simple-chat/chat-area.tsx`
- Modify: `src/components/simple-chat/simple-chat-types.ts`
- Modify: `src/components/canvas-workspace.tsx`
- Modify: `src/lib/user-types.ts`
- Test: `src/__tests__/components/simple-chat-workspace-entry.test.ts`
- Test: `src/__tests__/components/simple-chat-asset-transfer.test.ts`

**Interfaces:**
- Consumes: selected target project, current chat project/task/message, bounded URL builder, validated source trace.
- Produces: “发送到节点模式” action and source-aware existing canvas bridge.

- [ ] **Step 1: Write failing UI wiring tests**

```ts
it('builds node-mode navigation from identifiers only', () => {
  expect(chatAreaSource).toContain('buildSimpleChatWorkspaceHandoffUrl');
  expect(chatAreaSource).toContain('发送到节点模式');
  expect(chatAreaSource).not.toContain('wujie_node_bridge');
  expect(chatAreaSource).not.toMatch(/localStorage\.setItem\([^)]*node_bridge/);
});

it('adds sourceTrace to canvas transfers and canvas images', () => {
  expect(chatAreaSource).toMatch(/metadata:\s*\{[\s\S]*sourceTrace/);
  expect(canvasWorkspaceSource).toContain('sourceTrace: reference.sourceTrace');
});
```

- [ ] **Step 2: Run tests and record RED**

Run: `pnpm exec vitest run src/__tests__/components/simple-chat-workspace-entry.test.ts src/__tests__/components/simple-chat-asset-transfer.test.ts`

Expected: FAIL because the node action and canvas provenance are missing.

- [ ] **Step 3: Add the node-mode action**

```ts
const sendMessageToNodeMode = useCallback((message: SimpleChatMessage) => {
  if (!selectedCanvasProjectId || !project || !task) {
    setControlNotice('请先选择目标画布项目');
    return;
  }
  const url = buildSimpleChatWorkspaceHandoffUrl({
    targetProjectId: selectedCanvasProjectId,
    chatProjectId: project.id,
    chatTaskId: task.id,
    chatMessageId: message.id,
  });
  window.location.assign(url);
}, [project, selectedCanvasProjectId, task]);
```

Use the same existing tab; do not call `window.open`. Render the button next to “添加到画布”, enable it for non-empty text or at least one managed image, and show explicit disabled guidance for empty messages.

- [ ] **Step 4: Preserve provenance in the existing canvas path**

Build message-level source trace from current project/task/message, pass it in transfer metadata, preserve the sanitized trace returned by `/api/assets/transfer`, and assign it to the inserted `CanvasImage`. Add `sourceTrace?: WorkspaceSourceTrace` to both persisted and component canvas image types.

- [ ] **Step 5: Run tests and commit**

Run: `pnpm exec vitest run src/__tests__/components/simple-chat-workspace-entry.test.ts src/__tests__/components/simple-chat-asset-transfer.test.ts`

Expected: PASS.

Commit:

```bash
git add src/components/simple-chat/chat-area.tsx src/components/simple-chat/simple-chat-types.ts src/components/canvas-workspace.tsx src/lib/user-types.ts src/__tests__/components/simple-chat-workspace-entry.test.ts src/__tests__/components/simple-chat-asset-transfer.test.ts
git commit -m "feat: send simple chat results to workspaces"
```

---

### Task 6: CanvasWorkspace 消费、持久化与来源 UI

**Files:**
- Modify: `src/components/canvas-workspace.tsx`
- Modify: `src/components/node-editor.tsx`
- Modify: `src/components/infinite-canvas.tsx`
- Modify: `src/lib/project-workspace-url.ts`
- Test: `src/__tests__/components/simple-chat-workspace-consumer.test.ts`
- Test: `src/__tests__/components/workspace-source-trace-ui.test.ts`
- Test: `src/__tests__/lib/project-workspace-url.test.ts`

**Interfaces:**
- Consumes: URL intent parser and client executor.
- Produces: direct node-mode initialization, save-before-cleanup recovery, warning display, and read-only source UI.

- [ ] **Step 1: Write failing mode, persistence, and UI tests**

```ts
it('enters node mode directly for a project handoff URL', () => {
  expect(getInitialWorkspaceModeFromSearch('?projectId=canvas-1&mode=node')).toBe('node');
});

it('cleans only handoff parameters after a successful save', () => {
  expect(clearSimpleChatWorkspaceHandoffParams(
    '/?projectId=canvas-1&mode=node&chatProjectId=chat-1&chatTaskId=task-1&chatMessageId=message-1',
  )).toBe('/?projectId=canvas-1&mode=node');
});

it('renders provenance without exposing secrets', () => {
  expect(nodeEditorSource).toContain('来源：智能对话');
  expect(infiniteCanvasSource).toContain('智能对话');
  expect(nodeEditorSource).not.toContain('apiKey');
});
```

- [ ] **Step 2: Run tests and record RED**

Run: `pnpm exec vitest run src/__tests__/components/simple-chat-workspace-consumer.test.ts src/__tests__/components/workspace-source-trace-ui.test.ts src/__tests__/lib/project-workspace-url.test.ts`

Expected: FAIL because node-mode URL initialization, consumer wiring, cleanup helper, and source UI are missing.

- [ ] **Step 3: Add direct node-mode initialization and consumer orchestration**

Extract a pure search parser from `getInitialWorkspaceMode`, then use an effect guarded by a ref identity:

```ts
useEffect(() => {
  if (!currentProject || handoffRunRef.current === handoffIdentity) return;
  const intent = parseSimpleChatWorkspaceHandoffIntent(window.location.search);
  if (!intent || intent.targetProjectId !== currentProject.id) return;
  handoffRunRef.current = handoffIdentity;
  void executeSimpleChatWorkspaceHandoff({
    intent,
    currentWorkflow: nodeWorkflow,
    resolve: resolveSimpleChatWorkspaceHandoffFromApi,
    transfer: transferSimpleChatImageToWorkflow,
    persist: async workflow => {
      setNodeWorkflow(workflow);
      await persistNodeWorkflow(workflow);
    },
    cleanUrl: () => window.history.replaceState(null, '', clearSimpleChatWorkspaceHandoffParams(window.location.href)),
    now: Date.now,
  }).catch(error => {
    handoffRunRef.current = null;
    toast.error(toSimpleChatHandoffMessage(error));
  });
}, [currentProject, nodeWorkflow, persistNodeWorkflow]);
```

The ref may suppress only the currently running identity. On failure it must reset so explicit retry or refresh is possible. URL cleanup must happen only inside the executor after `persistNodeWorkflow` resolves.

- [ ] **Step 4: Add compact provenance UI**

In `PropertyPanel`, render a read-only section only when `parseWorkspaceSourceTrace(node.config.sourceTrace)` succeeds. Show source label, chat project, model/provider when present, and formatted source time.

In `InfiniteCanvas`, add a compact “智能对话” source badge beside the existing model/provider badge for selected images. Put details in `title`; do not add a floating panel that can cover image controls.

- [ ] **Step 5: Run focused tests and commit**

Run: `pnpm exec vitest run src/__tests__/components/simple-chat-workspace-consumer.test.ts src/__tests__/components/workspace-source-trace-ui.test.ts src/__tests__/lib/project-workspace-url.test.ts`

Expected: PASS.

Commit:

```bash
git add src/components/canvas-workspace.tsx src/components/node-editor.tsx src/components/infinite-canvas.tsx src/lib/project-workspace-url.ts src/__tests__/components/simple-chat-workspace-consumer.test.ts src/__tests__/components/workspace-source-trace-ui.test.ts src/__tests__/lib/project-workspace-url.test.ts
git commit -m "feat: consume chat handoffs in node mode"
```

---

### Task 7: 聚焦回归、全量门禁与本地浏览器证据

**Files:**
- Modify tests only if a real regression is reproduced.
- Create evidence directory entries under `docs/testing/evidence/` only from actual commands or browser runs.

**Interfaces:**
- Consumes: Tasks 1-6 complete implementation.
- Produces: locally verified candidate suitable for `main` integration.

- [ ] **Step 1: Run the complete CHAT-004 focused suite**

Run:

```bash
pnpm exec vitest run \
  src/__tests__/lib/simple-chat-workspace-handoff.test.ts \
  src/__tests__/lib/simple-chat-workspace-handoff-server.test.ts \
  src/__tests__/lib/simple-chat-workspace-handoff-client.test.ts \
  src/__tests__/lib/asset-source-trace.test.ts \
  src/__tests__/api/simple-chat-workspace-handoff.test.ts \
  src/__tests__/api/simple-chat-generated-source-trace.test.ts \
  src/__tests__/components/simple-chat-workspace-entry.test.ts \
  src/__tests__/components/simple-chat-workspace-consumer.test.ts \
  src/__tests__/components/workspace-source-trace-ui.test.ts \
  src/__tests__/components/simple-chat-asset-transfer.test.ts \
  src/__tests__/lib/workflow-chat-return.test.ts \
  src/__tests__/lib/project-workspace-url.test.ts
```

Expected: all focused tests PASS with no skipped CHAT-004 cases.

- [ ] **Step 2: Run static and full regression gates**

Run sequentially and stop on the first failure:

```bash
pnpm ts-check
pnpm lint:build
pnpm test
pnpm build
git diff --check
```

Expected: each command exits 0. Any pre-existing failure must be recorded with exact output and must not be hidden or skipped.

- [ ] **Step 3: Run local Chromium acceptance**

Start the app on an unused local port and execute the same-tab flow:

1. Log in as a normal test user.
2. Create or select a Simple Chat project and assistant message containing text and a managed generated image.
3. Send to a target project with no workflow; verify direct node mode, “智能对话导入”, one text node, one image node, source details, save, refresh recovery, and no duplicate.
4. Send another message to a project with an existing workflow; verify existing nodes, connections, name, and viewport remain unchanged.
5. Exercise unmanaged historical image, malformed intent, other-user target, and repeated consumption.
6. Re-run existing “添加到画布” and verify source badge plus no regression.

Save screenshot, trace, console, and network evidence under `test-results/` without committing temporary browser profiles.

- [ ] **Step 4: Commit only actual local evidence or regression fixes**

If no source change is needed, do not create an empty commit. If a reproduced defect requires a fix, add its RED test and commit the smallest correction with a `fix:` message.

---

### Task 8: Inventory、main 集成与 Coze 云端验收

**Files:**
- Modify: `docs/plans/v588/V588_ABSORPTION_INVENTORY.md`
- Modify: `docs/testing/REGRESSION_REPORT.md`
- Modify: `docs/testing/RELEASE_READINESS_REPORT.md`
- Modify: `docs/testing/UNVERIFIED_ITEMS.md`
- Create: `docs/testing/evidence/v588-chat-004-*.json`
- Create: `docs/testing/evidence/v588-chat-004-*.png`

**Interfaces:**
- Consumes: verified local candidate and Coze deployment of the exact GitHub `main` SHA.
- Produces: auditable absorption status and next unique V5.8.8 inventory item.

- [ ] **Step 1: Integrate the verified branch into local `main` without touching `stable`**

Verify the branch range and protected branch first:

```bash
git fetch origin
git log --oneline origin/main..codex/v588-chat-004-workspace-transfer
git rev-parse origin/stable
```

Merge or fast-forward only into `main`, re-run `git diff origin/stable...main --name-only` as an audit, and push `main` only after the local gates remain green.

- [ ] **Step 2: Have Coze pull the exact pushed `main` SHA and restart the sandbox**

Use the existing Google Chrome project-page tab. Do not open a new tab and do not use 360 Browser. If the sandbox-disconnected dialog appears, refresh the Coze project page, wait for the sandbox, then force-refresh the existing preview page.

- [ ] **Step 3: Execute the cloud matrix with PearAPI or APIMart**

Cloud evidence must prove:

1. text-only to empty workflow;
2. managed image to empty workflow;
3. mixed text/image to existing workflow;
4. cross-project transfer owned by the same user;
5. ordinary-user success and other-user denial;
6. malformed and URL-only media rejection without remote fetch;
7. duplicate click and refresh recovery without duplicate nodes or assets;
8. source trace after refresh;
9. existing canvas transfer regression;
10. no unhandled console errors and no leaking raw media in the navigation URL.

Use only stable providers PearAPI or APIMart for paid media verification. FHL、虚宝和 4SAPI are excluded because their provider-side service is known unavailable.

- [ ] **Step 4: Update Chinese reports from actual evidence**

Mark `V588-CHAT-004` as “已吸收” only if every cloud gate above passes. Otherwise record “本地候选完成 / 云端待验” and keep each missing item in `UNVERIFIED_ITEMS.md`.

- [ ] **Step 5: Commit and push the closure documentation**

```bash
git add docs/plans/v588/V588_ABSORPTION_INVENTORY.md docs/testing/REGRESSION_REPORT.md docs/testing/RELEASE_READINESS_REPORT.md docs/testing/UNVERIFIED_ITEMS.md docs/testing/evidence/
git commit -m "docs: close V588 chat workspace transfer acceptance"
git push origin main
```

Run a final `git status --short` and verify no `.superpowers/sdd/progress.md`, `.playwright-cli/`, browser profile, secret, or temporary artifact is staged.

# V588-CHAT-003 智能对话项目同步实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**目标：** 为独立智能对话页建立用户隔离、可离线恢复、具备 PostgreSQL 原子 CAS 和可见冲突处理的项目同步机制。

**架构：** 服务器快照与 `syncRevision` 构成已确认基线，浏览器 IndexedDB 保存当前用户的同步信封和待确认操作。客户端协调器串行提交不可变批次，遇到 `409` 后读取最新快照并重放操作；服务端使用事务级 advisory lock 和条件版本校验，杜绝盲写覆盖。

**技术栈：** Next.js 16 App Router、React 19、TypeScript 5、PostgreSQL、原生 IndexedDB、Vitest、Playwright。

## 全局约束

- 设计基线固定为 `main@3de8e951ae05a0f1ab6128d926af3ebf08336ab2`；规格提交为 `c3fa09ae`。
- `origin/stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` 永久只读。
- `J:\无界云端0820` 仅作 V5.8.8 只读参考，不复制供体存储所有权。
- 不修改无限画布 `projects` 同步、聊天生成、供应商、模型或计费链路。
- 不增加第三方 IndexedDB、CRDT 或状态管理依赖。
- 服务器是已确认基线；旧全局缓存不能自动上传或复活服务器已删除记录。
- 请求体上限 20 MiB；其他实体、文本和嵌套上限严格采用已批准规格第 15 节。
- 所有代码变更先得到稳定 RED，再做最小实现；每个任务完成后独立提交。
- 受保护文件只允许精确路径授权，禁止目录级放行。
- 新增设计、测试和发布文档统一使用中文。

---

## 文件职责

- `src/lib/simple-chat-project-sync.ts`：共享类型、边界常量、差异计算、操作压缩、重放和冲突副本纯函数。
- `src/lib/simple-chat-sync-storage.ts`：IndexedDB 信封读写、用户隔离和旧 `localStorage` 备份迁移。
- `src/lib/simple-chat-sync-server.ts`：`chat_simple_projects` 版本化存储解析、PostgreSQL 事务和 CAS。
- `src/lib/simple-chat-sync-client.ts`：单用户串行协调器、不可变批次、冲突重试、退避和生命周期刷新。
- `src/components/simple-chat/simple-chat-sync-status.tsx`：非阻塞同步状态和重试按钮。
- `src/__tests__/fixtures/simple-chat-sync.ts`：所有同步测试共用的确定性项目、信封、存储和 HTTP 夹具。
- `src/app/api/user-data/sync/route.ts`：鉴权、固定键分派、输入边界和统一错误响应。
- `src/app/simple-chat/page.tsx`：协调器接线，不再自行执行全量盲写。
- `src/components/dashboard/dashboard-view.tsx`：异步读取当前用户服务器/IndexedDB 投影，不再读取全局旧键。
- `src/lib/simple-chat-logout.ts`：调用协调器有界刷新，再执行既有注销。

---

### Task 1：同步领域模型、差异与冲突重放

**文件：**

- 新建：`src/lib/simple-chat-project-sync.ts`
- 新建：`src/__tests__/lib/simple-chat-project-sync.test.ts`
- 新建：`src/__tests__/fixtures/simple-chat-sync.ts`

**接口：**

- 产出：`SimpleChatSyncEnvelopeV1`、`SimpleChatSyncOperation`、`diffSimpleChatProjects()`、`compactSimpleChatOperations()`、`replaySimpleChatOperations()`、`acknowledgeSimpleChatOperations()`、`validateSimpleChatProjects()`。
- 依赖：`SimpleChatProject`、`SimpleChatTask`、`SimpleChatMessage` 及其嵌套类型。

测试夹具必须在本任务内提供下列稳定接口，后续任务直接导入，不重复定义临时对象：

```ts
export function task(id: string, name = '对话'): SimpleChatTask;
export function taskWithMessages(id: string, count: number): SimpleChatTask;
export function project(id: string, tasks: SimpleChatTask[] = []): SimpleChatProject;
export function op(operationId: string, sequence: number): SimpleChatSyncOperation;
export function envelope(userId: string): SimpleChatSyncEnvelopeV1;
export function deferred<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
};
export function jsonResponse(status: number, body: unknown): Response;
export function sequenceFetch(...responses: Array<Response | Promise<Response>>): typeof fetch;
export function countPostRequests(fetchImpl: typeof fetch): number;
```

- [ ] **Step 1：写入领域 RED 测试**

```ts
import { describe, expect, it } from 'vitest';
import {
  acknowledgeSimpleChatOperations,
  compactSimpleChatOperations,
  diffSimpleChatProjects,
  replaySimpleChatOperations,
  validateSimpleChatProjects,
} from '@/lib/simple-chat-project-sync';

describe('simple chat project synchronization', () => {
  it('does not resurrect a remote-deleted project without a pending operation', () => {
    const base = [project('p1', [task('t1')])];
    const operations = diffSimpleChatProjects(base, base, 1);
    expect(replaySimpleChatOperations([], operations).projects).toEqual([]);
  });

  it('creates a conflict copy when remote deleted an explicitly edited local task', () => {
    const before = [project('p1', [task('t1', '旧标题')])];
    const current = [project('p1', [task('t1', '本地标题')])];
    const operations = diffSimpleChatProjects(before, current, 1);
    const result = replaySimpleChatOperations([project('p1', [])], operations);
    expect(result.conflicts).toHaveLength(1);
    expect(result.projects[0].tasks[0].id).not.toBe('t1');
    expect(result.projects[0].tasks[0].name).toContain('冲突副本');
  });

  it('preserves the remote entity and creates a local conflict copy when both changed it', () => {
    const before = [project('p1', [task('t1', '基线')])];
    const current = [project('p1', [task('t1', '本地修改')])];
    const remote = [project('p1', [task('t1', '远端修改')])];
    const result = replaySimpleChatOperations(
      remote,
      diffSimpleChatProjects(before, current, 1),
      { createId: () => 'conflict-task', now: () => 100 },
    );
    expect(result.projects[0].tasks.map(item => item.name)).toEqual([
      '远端修改',
      '本地修改（冲突副本）',
    ]);
  });

  it('keeps operations created after the acknowledged batch', () => {
    const operations = [op('op-1', 1), op('op-2', 2)];
    expect(acknowledgeSimpleChatOperations(operations, ['op-1']))
      .toEqual([operations[1]]);
  });

  it('rejects payloads above the approved message limit', () => {
    const oversized = project('p1', [taskWithMessages('t1', 10_001)]);
    expect(validateSimpleChatProjects([oversized])).toMatchObject({
      success: false,
      code: 'CHAT_SYNC_LIMIT_EXCEEDED',
      field: 'messages',
    });
  });
});
```

- [ ] **Step 2：运行测试并确认 RED**

```powershell
pnpm exec vitest run src/__tests__/lib/simple-chat-project-sync.test.ts
```

预期：模块不存在，测试套件失败；不得通过测试内临时 mock 掩盖缺失实现。

- [ ] **Step 3：实现共享类型与纯函数**

```ts
export type SimpleChatEntityType =
  | 'project' | 'task' | 'message' | 'artifact' | 'agent' | 'knowledge-item';

export interface SimpleChatSyncOperation {
  operationId: string;
  sequence: number;
  kind: 'upsert' | 'delete';
  entityType: SimpleChatEntityType;
  projectId: string;
  taskId?: string;
  messageId?: string;
  entityId: string;
  baseValue?: unknown;
  value?: unknown;
}

export interface SimpleChatSyncEnvelopeV1 {
  schemaVersion: 1;
  userId: string;
  baseRevision: number;
  baseProjects: SimpleChatProject[];
  currentProjects: SimpleChatProject[];
  pendingOperations: SimpleChatSyncOperation[];
  updatedAt: number;
}

export interface SimpleChatReplayResult {
  projects: SimpleChatProject[];
  conflicts: Array<{ operationId: string; entityType: SimpleChatEntityType; copyId: string }>;
}

export function diffSimpleChatProjects(
  base: SimpleChatProject[],
  current: SimpleChatProject[],
  sequenceStart: number,
): SimpleChatSyncOperation[];

export function compactSimpleChatOperations(
  operations: SimpleChatSyncOperation[],
): SimpleChatSyncOperation[];

export function replaySimpleChatOperations(
  remote: SimpleChatProject[],
  operations: SimpleChatSyncOperation[],
  options?: { createId?: () => string; now?: () => number },
): SimpleChatReplayResult;

export function acknowledgeSimpleChatOperations(
  pending: SimpleChatSyncOperation[],
  acknowledgedIds: string[],
): SimpleChatSyncOperation[];
```

实现时按 `project -> task -> message -> artifact` 和 `project -> agent/knowledge-item` 的稳定 ID 展平。连续 upsert 保留最早 `baseValue` 和最后 `value`；冲突副本 ID 使用 `crypto.randomUUID()` 注入式工厂，测试传入确定性 ID。

- [ ] **Step 4：运行聚焦测试并确认 GREEN**

```powershell
pnpm exec vitest run src/__tests__/lib/simple-chat-project-sync.test.ts
pnpm ts-check
```

预期：领域测试全部通过，TypeScript 退出码 0。

- [ ] **Step 5：提交领域层**

```powershell
git add src/lib/simple-chat-project-sync.ts src/__tests__/lib/simple-chat-project-sync.test.ts src/__tests__/fixtures/simple-chat-sync.ts
git commit -m "feat: add conflict-safe simple chat sync domain"
```

---

### Task 2：IndexedDB 用户隔离信封与旧缓存备份

**文件：**

- 新建：`src/lib/simple-chat-sync-storage.ts`
- 新建：`src/__tests__/lib/simple-chat-sync-storage.test.ts`
- 修改：`src/components/simple-chat/simple-chat-types.ts`
- 修改：`src/__tests__/fixtures/simple-chat-sync.ts`

**接口：**

- 消费：`SimpleChatSyncEnvelopeV1`。
- 产出：`SimpleChatEnvelopeStore`、`createIndexedDbSimpleChatEnvelopeStore()`、`backupLegacySimpleChatProjects()`。

本任务向共享测试夹具增加：

```ts
export function memoryLocalStorage(initial?: Record<string, string>): Storage & { keys(): string[] };
export function createMemorySimpleChatEnvelopeStore(): SimpleChatEnvelopeStore;
export function createFailingEnvelopeStore(error: Error): SimpleChatEnvelopeStore;
```

- [ ] **Step 1：写入存储 RED 测试**

```ts
describe('simple chat sync storage', () => {
  it('keys envelopes strictly by the authenticated user id', async () => {
    const store = createMemorySimpleChatEnvelopeStore();
    await store.put(envelope('user-a'));
    expect(await store.get('user-a')).toMatchObject({ userId: 'user-a' });
    expect(await store.get('user-b')).toBeNull();
  });

  it('backs up the global legacy value without assigning it to a user', () => {
    const storage = memoryLocalStorage({ wujie_chat_projects: '[{"id":"legacy"}]' });
    backupLegacySimpleChatProjects(storage);
    expect(storage.getItem('wujie_chat_projects')).toBeNull();
    expect(storage.getItem('wujie_chat_projects:legacy-backup')).toContain('legacy');
    expect(storage.keys()).not.toContainEqual(expect.stringContaining('user-a'));
  });

  it('surfaces quota failures instead of reporting a successful write', async () => {
    const store = createFailingEnvelopeStore(new DOMException('quota', 'QuotaExceededError'));
    await expect(store.put(envelope('user-a'))).rejects.toMatchObject({
      code: 'CHAT_SYNC_LOCAL_STORAGE_FAILED',
    });
  });
});
```

- [ ] **Step 2：运行测试并确认 RED**

```powershell
pnpm exec vitest run src/__tests__/lib/simple-chat-sync-storage.test.ts
```

预期：新模块不存在。

- [ ] **Step 3：实现原生 IndexedDB 适配器**

```ts
export interface SimpleChatEnvelopeStore {
  get(userId: string): Promise<SimpleChatSyncEnvelopeV1 | null>;
  put(envelope: SimpleChatSyncEnvelopeV1): Promise<void>;
  delete(userId: string): Promise<void>;
}

export function createIndexedDbSimpleChatEnvelopeStore(
  factory: IDBFactory = indexedDB,
): SimpleChatEnvelopeStore;

export function backupLegacySimpleChatProjects(storage: Storage): {
  backedUp: boolean;
  invalid: boolean;
};
```

数据库固定为 `wujie-simple-chat-sync`，版本 `1`，对象仓 `envelopes`，主键 `userId`。`onblocked`、`onerror`、事务 `onabort` 和配额错误都转换为稳定错误码；不得回退到全局旧键。

将 `simple-chat-types.ts` 中旧 `loadProjects/saveProjects` 标记为仅迁移兼容，并移除 `/simple-chat` 与仪表盘对它们的新增调用；本任务不删除导出，避免尚未迁移消费者编译失败。

- [ ] **Step 4：运行聚焦测试与类型检查**

```powershell
pnpm exec vitest run src/__tests__/lib/simple-chat-sync-storage.test.ts
pnpm ts-check
```

预期：新存储测试通过，TypeScript 退出码 0。仪表盘迁移由 Task 7 的独立 RED 管理，本任务不提前改写该合同。

- [ ] **Step 5：提交浏览器存储层**

```powershell
git add src/lib/simple-chat-sync-storage.ts src/components/simple-chat/simple-chat-types.ts src/__tests__/lib/simple-chat-sync-storage.test.ts src/__tests__/fixtures/simple-chat-sync.ts
git commit -m "feat: isolate simple chat sync envelopes by user"
```

---

### Task 3：PostgreSQL 版本化快照与原子 CAS

**文件：**

- 新建：`src/lib/simple-chat-sync-server.ts`
- 新建：`src/__tests__/lib/simple-chat-sync-server.test.ts`
- 新建：`src/__tests__/integration/simple-chat-sync-postgres.test.ts`

**接口：**

- 消费：经过验证的 `SimpleChatProject[]` 和 `expectedRevision`。
- 产出：`parseStoredSimpleChatSnapshot()`、`readSimpleChatSnapshot()`、`compareAndSetSimpleChatSnapshot()`、`SimpleChatSyncConflictError`。

- [ ] **Step 1：写入存储与真实并发 RED 测试**

```ts
const hasPostgresTestDatabase = Boolean(process.env.POSTGRES_TEST_DATABASE_URL?.trim());

it.runIf(hasPostgresTestDatabase)('allows only one writer for the same revision', async () => {
  const userId = uniqueUserId();
  const [first, second] = await Promise.allSettled([
    compareAndSetSimpleChatSnapshot({ userId, expectedRevision: 0, projects: [project('a')] }),
    compareAndSetSimpleChatSnapshot({ userId, expectedRevision: 0, projects: [project('b')] }),
  ]);
  expect([first.status, second.status].sort()).toEqual(['fulfilled', 'rejected']);
  const snapshot = await readSimpleChatSnapshot(userId);
  expect(snapshot.revision).toBe(1);
  expect(snapshot.projects).toHaveLength(1);
});

it('reads a legacy array as revision zero', () => {
  expect(parseStoredSimpleChatSnapshot([project('legacy')])).toEqual({
    schemaVersion: 1,
    revision: 0,
    projects: [project('legacy')],
  });
});
```

- [ ] **Step 2：运行并确认 RED**

```powershell
pnpm exec vitest run src/__tests__/lib/simple-chat-sync-server.test.ts src/__tests__/integration/simple-chat-sync-postgres.test.ts
```

预期：模块不存在；若 `POSTGRES_TEST_DATABASE_URL` 缺失，真实并发文件必须明确跳过并在报告中保留，不能改为 Mock 通过。

- [ ] **Step 3：实现事务 CAS**

```ts
import 'server-only';

export interface SimpleChatStoredSnapshot {
  schemaVersion: 1;
  revision: number;
  projects: SimpleChatProject[];
}

export class SimpleChatSyncConflictError extends Error {
  readonly code = 'CHAT_SYNC_CONFLICT';
  constructor(readonly currentRevision: number) {
    super('智能对话数据已在其他位置更新');
  }
}

export async function readSimpleChatSnapshot(
  userId: string,
): Promise<SimpleChatStoredSnapshot>;

export function parseStoredSimpleChatSnapshot(value: unknown): SimpleChatStoredSnapshot;

export async function compareAndSetSimpleChatSnapshot(input: {
  userId: string;
  expectedRevision: number;
  projects: SimpleChatProject[];
  now?: number;
}): Promise<SimpleChatStoredSnapshot>;
```

实现必须使用同一 `PoolClient`：`BEGIN`，`pg_advisory_xact_lock(hashtextextended($1, 0))`，`SELECT ... FOR UPDATE`，版本比较，`INSERT/UPDATE`，`COMMIT`。锁键固定为 `simple-chat-sync:${userId}:chat_simple_projects`。异常路径先 `ROLLBACK`，最后 `release()`；版本只由服务器执行 `expectedRevision + 1`。

- [ ] **Step 4：运行单元、真实 PostgreSQL 和类型检查**

```powershell
pnpm exec vitest run src/__tests__/lib/simple-chat-sync-server.test.ts src/__tests__/integration/simple-chat-sync-postgres.test.ts
pnpm ts-check
```

预期：有隔离数据库时并发测试真实通过；无隔离数据库时只允许该文件按既有门禁明确跳过。

- [ ] **Step 5：提交服务端存储层**

```powershell
git add src/lib/simple-chat-sync-server.ts src/__tests__/lib/simple-chat-sync-server.test.ts src/__tests__/integration/simple-chat-sync-postgres.test.ts
git commit -m "feat: add atomic simple chat snapshot cas"
```

---

### Task 4：`/api/user-data/sync` 版本契约与输入边界

**文件：**

- 修改：`src/app/api/user-data/sync/route.ts`
- 新建：`src/__tests__/api/simple-chat-user-data-sync.test.ts`
- 修改：`src/__tests__/api/user-data-sync-asset-graph.test.ts`

**接口：**

- 消费：Task 1 验证器、Task 3 存储函数。
- 产出：GET 的 `syncRevision`、POST 的 `expectedRevision`、稳定 `409 CHAT_SYNC_CONFLICT`。

- [ ] **Step 1：写入 API RED 测试**

```ts
it('returns the snapshot revision for chat projects', async () => {
  readSimpleChatSnapshot.mockResolvedValue({ schemaVersion: 1, revision: 7, projects: [] });
  const response = await GET(authenticatedRequest('/api/user-data/sync?key=chat_simple_projects'));
  expect(await response.json()).toMatchObject({ success: true, value: [], syncRevision: 7 });
});

it('returns a structured conflict without writing', async () => {
  compareAndSetSimpleChatSnapshot.mockRejectedValue(new SimpleChatSyncConflictError(8));
  const response = await POST(authenticatedJsonRequest({
    key: 'chat_simple_projects', value: [], expectedRevision: 7,
  }));
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({
    success: false,
    code: 'CHAT_SYNC_CONFLICT',
    currentRevision: 8,
    retryable: true,
  });
});

it('rejects a missing expectedRevision before storage', async () => {
  const response = await POST(authenticatedJsonRequest({ key: 'chat_simple_projects', value: [] }));
  expect(response.status).toBe(400);
  expect(compareAndSetSimpleChatSnapshot).not.toHaveBeenCalled();
});

it('echoes a bounded request id on conflicts', async () => {
  compareAndSetSimpleChatSnapshot.mockRejectedValue(new SimpleChatSyncConflictError(3));
  const response = await POST(authenticatedJsonRequest(
    { key: 'chat_simple_projects', value: [], expectedRevision: 2 },
    { 'x-request-id': 'req_sync_test' },
  ));
  expect(response.headers.get('x-request-id')).toBe('req_sync_test');
  expect(await response.json()).toMatchObject({ requestId: 'req_sync_test' });
});
```

- [ ] **Step 2：运行测试并确认 RED**

```powershell
pnpm exec vitest run src/__tests__/api/simple-chat-user-data-sync.test.ts src/__tests__/api/user-data-sync-asset-graph.test.ts
```

预期：聊天 key 没有版本契约，目标测试失败；既有画布 `projects` 测试继续通过。

- [ ] **Step 3：接入聊天固定键分支**

```ts
if (key === 'chat_simple_projects') {
  const snapshot = await readSimpleChatSnapshot(sessionUser.id);
  return NextResponse.json({
    success: true,
    key,
    value: snapshot.projects,
    syncRevision: snapshot.revision,
  });
}
```

POST 在任何数据库调用前校验 `expectedRevision`、20 MiB JSON 大小和 Task 1 的结构边界。聊天分支必须使用本路由内的 `readBoundedChatSyncBody(request)` 逐块读取 `request.body`，累计字节超过 `20 * 1024 * 1024` 时立即取消 reader 并返回 `413 CHAT_SYNC_PAYLOAD_TOO_LARGE`，不能先 `request.json()` 后才检查。冲突响应带 `requestId` 与 `x-request-id` 响应头。每次 read/write/conflict 通过现有操作审计接口记录 revision、operationCount、duration、status 和 errorCode，不记录项目正文。其他允许 key 和画布 `projectRevision` 逻辑保持原样。

- [ ] **Step 4：运行 API 与安全回归**

```powershell
pnpm exec vitest run src/__tests__/api/simple-chat-user-data-sync.test.ts src/__tests__/api/user-data-sync-asset-graph.test.ts tests/api/security-test.test.ts
pnpm ts-check
```

预期：聊天与画布两套 revision 字段不串用，测试全部通过。

- [ ] **Step 5：提交 API 契约**

```powershell
git add src/app/api/user-data/sync/route.ts src/__tests__/api/simple-chat-user-data-sync.test.ts src/__tests__/api/user-data-sync-asset-graph.test.ts
git commit -m "feat: version simple chat user data sync"
```

---

### Task 5：单用户客户端协调器、冲突重试与离线恢复

**文件：**

- 新建：`src/lib/simple-chat-sync-client.ts`
- 新建：`src/__tests__/lib/simple-chat-sync-client.test.ts`

**接口：**

- 消费：领域纯函数、`SimpleChatEnvelopeStore`、GET/POST API 契约。
- 产出：`SimpleChatSyncCoordinator`、`SimpleChatSyncStatus`、订阅接口。

- [ ] **Step 1：写入竞态与恢复 RED 测试**

```ts
it('does not clear operations created while a batch is in flight', async () => {
  const pending = deferred<Response>();
  const fetchImpl = sequenceFetch(
    jsonResponse(200, { success: true, value: [], syncRevision: 0 }),
    pending.promise,
  );
  const coordinator = createSimpleChatSyncCoordinator({
    store: createMemorySimpleChatEnvelopeStore(),
    fetchImpl,
  });
  await coordinator.initialize('user-a');
  coordinator.update([project('p1')]);
  const flush = coordinator.flush('debounce');
  coordinator.update([project('p1'), project('p2')]);
  pending.resolve(jsonResponse(200, { success: true, syncRevision: 1 }));
  await flush;
  expect(coordinator.snapshot().pendingOperations).not.toHaveLength(0);
});

it('rebases once on 409 and stops after two conflicts', async () => {
  const fetchImpl = sequenceFetch(
    jsonResponse(200, { success: true, value: [], syncRevision: 0 }),
    jsonResponse(409, { code: 'CHAT_SYNC_CONFLICT', currentRevision: 1 }),
    jsonResponse(200, { success: true, value: [], syncRevision: 1 }),
    jsonResponse(409, { code: 'CHAT_SYNC_CONFLICT', currentRevision: 2 }),
    jsonResponse(200, { success: true, value: [], syncRevision: 2 }),
    jsonResponse(409, { code: 'CHAT_SYNC_CONFLICT', currentRevision: 3 }),
  );
  const coordinator = createSimpleChatSyncCoordinator({
    store: createMemorySimpleChatEnvelopeStore(), fetchImpl,
  });
  await coordinator.initialize('user-a');
  coordinator.update([project('local')]);
  await coordinator.flush('manual');
  expect(coordinator.snapshot().status).toBe('conflict');
  expect(countPostRequests(fetchImpl)).toBe(3);
});

it('keeps pending data on 503 and resumes after online', async () => {
  const coordinator = createSimpleChatSyncCoordinator({
    store: createMemorySimpleChatEnvelopeStore(),
    fetchImpl: sequenceFetch(
      jsonResponse(200, { success: true, value: [], syncRevision: 0 }),
      jsonResponse(503, { success: false, code: 'SERVICE_UNAVAILABLE' }),
      jsonResponse(200, { success: true, syncRevision: 1 }),
    ),
  });
  await coordinator.initialize('user-a');
  coordinator.update([project('offline')]);
  await coordinator.flush('manual');
  expect(coordinator.snapshot().status).toBe('failed');
  await coordinator.handleOnline();
  expect(coordinator.snapshot().status).toBe('synced');
});

it('stops automatic sync on 401 without deleting the envelope', async () => {
  const store = createMemorySimpleChatEnvelopeStore();
  const coordinator = createSimpleChatSyncCoordinator({
    store,
    fetchImpl: sequenceFetch(
      jsonResponse(200, { success: true, value: [], syncRevision: 0 }),
      jsonResponse(401, { success: false, code: 'AUTH_REQUIRED' }),
    ),
  });
  await coordinator.initialize('user-a');
  coordinator.update([project('pending')]);
  await coordinator.flush('manual');
  expect(coordinator.snapshot()).toMatchObject({
    status: 'failed',
    error: { code: 'AUTH_REQUIRED', retryable: false },
  });
  expect(await store.get('user-a')).not.toBeNull();
});

it('backs off at most three times for 429', async () => {
  const sleep = vi.fn().mockResolvedValue(undefined);
  const fetchImpl = sequenceFetch(
    jsonResponse(200, { success: true, value: [], syncRevision: 0 }),
    jsonResponse(429, { success: false, code: 'RATE_LIMITED' }),
    jsonResponse(429, { success: false, code: 'RATE_LIMITED' }),
    jsonResponse(429, { success: false, code: 'RATE_LIMITED' }),
    jsonResponse(200, { success: true, syncRevision: 1 }),
  );
  const coordinator = createSimpleChatSyncCoordinator({
    store: createMemorySimpleChatEnvelopeStore(), fetchImpl, sleep, jitter: () => 0,
  });
  await coordinator.initialize('user-a');
  coordinator.update([project('rate-limited')]);
  await coordinator.flush('manual');
  expect(sleep).toHaveBeenCalledTimes(3);
  expect(coordinator.snapshot().status).toBe('synced');
});
```

- [ ] **Step 2：运行测试并确认 RED**

```powershell
pnpm exec vitest run src/__tests__/lib/simple-chat-sync-client.test.ts
```

预期：协调器模块不存在。

- [ ] **Step 3：实现串行协调器**

```ts
export type SimpleChatSyncStatus =
  | 'loading' | 'syncing' | 'synced' | 'offline' | 'failed' | 'conflict';

export interface SimpleChatSyncSnapshot {
  status: SimpleChatSyncStatus;
  projects: SimpleChatProject[];
  pendingOperations: SimpleChatSyncOperation[];
  error: { code: string; message: string; retryable: boolean } | null;
}

export interface SimpleChatSyncCoordinator {
  initialize(userId: string): Promise<SimpleChatSyncSnapshot>;
  update(projects: SimpleChatProject[]): void;
  flush(reason: 'debounce' | 'manual' | 'pagehide' | 'logout' | 'user-switch'): Promise<void>;
  handleOnline(): Promise<void>;
  snapshot(): SimpleChatSyncSnapshot;
  subscribe(listener: (snapshot: SimpleChatSyncSnapshot) => void): () => void;
  dispose(): Promise<void>;
}

export function createSimpleChatSyncCoordinator(options: {
  store: SimpleChatEnvelopeStore;
  fetchImpl?: typeof fetch;
  createId?: () => string;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
  jitter?: () => number;
}): SimpleChatSyncCoordinator;
```

同一协调器只允许一个活动请求。普通失败最多 3 次指数退避并加确定性可注入抖动；`409` 最多重放 2 次。`pagehide` 使用 `keepalive`，但只有收到成功 revision 才确认操作。

- [ ] **Step 4：运行客户端竞态测试**

```powershell
pnpm exec vitest run src/__tests__/lib/simple-chat-sync-client.test.ts src/__tests__/lib/simple-chat-project-sync.test.ts src/__tests__/lib/simple-chat-sync-storage.test.ts
pnpm ts-check
```

预期：无重复 POST、无请求期间操作丢失、状态收敛符合规格。

- [ ] **Step 5：提交协调器**

```powershell
git add src/lib/simple-chat-sync-client.ts src/__tests__/lib/simple-chat-sync-client.test.ts
git commit -m "feat: coordinate recoverable simple chat sync"
```

---

### Task 6：独立智能对话页接线与同步状态 UI

**文件：**

- 修改：`src/app/simple-chat/page.tsx`
- 新建：`src/components/simple-chat/simple-chat-sync-status.tsx`
- 新建：`src/__tests__/components/simple-chat-sync-status.test.tsx`
- 新建：`src/__tests__/components/simple-chat-sync-integration.test.tsx`

**接口：**

- 消费：`SimpleChatSyncCoordinator`。
- 产出：页面唯一持久化路径和可见状态/重试交互。

- [ ] **Step 1：写入页面接线 RED 测试**

```tsx
it('shows a retryable sync failure without clearing the conversation', async () => {
  const onRetry = vi.fn();
  render(
    <SimpleChatSyncStatusView
      status="failed"
      error={{ code: 'NETWORK_ERROR', message: '同步失败', retryable: true }}
      onRetry={onRetry}
    />,
  );
  expect(screen.getByText('同步失败，点击重试')).toBeVisible();
  await user.click(screen.getByRole('button', { name: '重试同步' }));
  expect(onRetry).toHaveBeenCalledOnce();
});

it('does not call the legacy blind sync path', () => {
  expect(pageSource).not.toContain('scheduleChatProjectsSync');
  expect(pageSource).not.toContain('saveProjects(projects)');
  expect(pageSource).toContain('createSimpleChatSyncCoordinator');
  expect(pageSource).toContain("flush('manual')");
});
```

- [ ] **Step 2：运行测试并确认 RED**

```powershell
pnpm exec vitest run src/__tests__/components/simple-chat-sync-status.test.tsx src/__tests__/components/simple-chat-sync-integration.test.tsx
```

预期：状态组件和协调器接线不存在。

- [ ] **Step 3：替换页面盲写路径**

页面在 `fetchSessionPayload()` 成功并取得 `user.id` 后初始化协调器；`projects` 更新只调用 `coordinator.update(next)`。`handlePersistTask` 更新同一内存树并 `flush('manual')`，不得单独 POST。

```tsx
<SimpleChatSyncStatusView
  status={syncSnapshot.status}
  error={syncSnapshot.error}
  onRetry={() => void coordinatorRef.current?.flush('manual')}
/>
```

状态组件根元素固定带 `data-testid="simple-chat-sync-status"`，放在现有顶部或侧栏状态区，使用文本和熟悉状态图标，不弹原生 dialog，不遮挡模型菜单和对话内容。

- [ ] **Step 4：运行 Simple Chat 聚焦回归**

```powershell
pnpm exec vitest run src/__tests__/components/simple-chat-sync-status.test.tsx src/__tests__/components/simple-chat-sync-integration.test.tsx src/__tests__/components/simple-chat-project-selection.test.ts src/__tests__/components/simple-chat-sse-integration.test.ts src/__tests__/lib/simple-chat-retry.test.ts
pnpm ts-check
```

预期：同步 UI 通过，V588-CHAT-001/002 关键测试无回归。

- [ ] **Step 5：提交页面接线**

```powershell
git add src/app/simple-chat/page.tsx src/components/simple-chat/simple-chat-sync-status.tsx src/__tests__/components/simple-chat-sync-status.test.tsx src/__tests__/components/simple-chat-sync-integration.test.tsx
git commit -m "feat: surface simple chat synchronization state"
```

---

### Task 7：仪表盘同源读取、页面生命周期与退出登录

**文件：**

- 修改：`src/components/dashboard/dashboard-view.tsx`
- 修改：`src/lib/simple-chat-logout.ts`
- 修改：`src/__tests__/components/simple-chat-dashboard-sync-contract.test.ts`
- 修改：`src/__tests__/lib/simple-chat-logout.test.ts`
- 新建：`src/__tests__/components/simple-chat-lifecycle.test.tsx`

**接口：**

- 消费：协调器的 `flush()` 和用户隔离存储。
- 产出：仪表盘与独立聊天一致的数据投影，有界 `pagehide/user-switch/logout`。

- [ ] **Step 1：写入生命周期 RED 测试**

```ts
it('flushes the old user before initializing a new user', async () => {
  expect(pageSource).toContain("flush('user-switch')");
  expect(pageSource).toContain('coordinator.dispose()');
  expect(pageSource).toContain('coordinator.initialize(user.id)');
});

it('logs out after a bounded coordinator flush', async () => {
  const result = await logoutSimpleChatSession({
    flush: () => Promise.resolve(),
    fetchImpl,
    syncTimeoutMs: 5_000,
  });
  expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual(['/api/auth/logout']);
  expect(result).toEqual({ loggedOut: true, sync: 'completed' });
});

it('loads the dashboard projection asynchronously for the current user', () => {
  expect(dashboardSource).toContain('loadSimpleChatDashboardProjects({');
  expect(dashboardSource).toContain('userId: user.id');
  expect(dashboardSource).not.toContain('loadSimpleChatProjects()');
});
```

- [ ] **Step 2：运行并确认 RED**

```powershell
pnpm exec vitest run src/__tests__/components/simple-chat-dashboard-sync-contract.test.ts src/__tests__/lib/simple-chat-logout.test.ts src/__tests__/components/simple-chat-lifecycle.test.tsx
```

预期：仪表盘仍读取全局键，退出辅助函数仍自行 POST 全量快照。

- [ ] **Step 3：接入同源读取和有界刷新**

`dashboard-view.tsx` 在当前用户和 chat 标签激活时调用以下共享读取器：先 GET 服务器快照，网络失败再读取该用户 IndexedDB 信封；两者都为空时显示 0，不读取 legacy backup。

```ts
export async function loadSimpleChatDashboardProjects(input: {
  userId: string;
  store: SimpleChatEnvelopeStore;
  fetchImpl?: typeof fetch;
}): Promise<SimpleChatProject[]>;
```

该函数放入 `src/lib/simple-chat-sync-client.ts`，只负责只读投影，不启动协调器或写入服务器。

```ts
export interface SimpleChatLogoutOptions {
  flush: () => Promise<void>;
  fetchImpl?: typeof fetch;
  syncTimeoutMs?: number;
}
```

`pagehide`、online/offline、用户切换和注销都调用同一协调器。退出刷新超时后保留信封，成功注销并显示“将在下次登录继续同步”的非阻塞状态；注销接口失败仍按现有会话复核规则处理。

- [ ] **Step 4：运行仪表盘、退出和认证回归**

```powershell
pnpm exec vitest run src/__tests__/components/simple-chat-dashboard-sync-contract.test.ts src/__tests__/lib/simple-chat-logout.test.ts src/__tests__/components/simple-chat-lifecycle.test.tsx src/__tests__/api/simple-chat-auth.test.ts
pnpm ts-check
```

预期：对话数量同源、账号切换隔离、退出不跳过会话校验。

- [ ] **Step 5：提交生命周期接线**

```powershell
git add src/components/dashboard/dashboard-view.tsx src/lib/simple-chat-logout.ts src/__tests__/components/simple-chat-dashboard-sync-contract.test.ts src/__tests__/lib/simple-chat-logout.test.ts src/__tests__/components/simple-chat-lifecycle.test.tsx
git commit -m "fix: close simple chat sync lifecycle gaps"
```

---

### Task 8：浏览器回归、并发门禁与保护基线

**文件：**

- 修改：`tests/e2e/stage5-simple-chat-gate.spec.ts`
- 修改：`src/__tests__/e2e/stage5-simple-chat-gate-contract.test.ts`
- 修改：`docs/testing/baselines/protected-source-authorizations.json`
- 修改：`docs/testing/baselines/protected-baseline-allowed-paths.json`
- 修改：`tests/unit/protected-baseline-gate.spec.ts`

**接口：**

- 消费：完整同步实现。
- 产出：Chromium/Firefox/WebKit 可重复的刷新、离线、双标签和账号隔离门禁。

- [ ] **Step 1：扩展 E2E RED 合同**

```ts
async function expectSimpleChatSyncStatus(page: Page, label: string): Promise<void> {
  await expect(page.getByTestId('simple-chat-sync-status')).toContainText(label);
}

test('remote deletion is not resurrected by a stale second tab', async ({ page }, testInfo) => {
  await login(page, testInfo);
  const runTag = `delete-${Date.now()}`;
  const fixture = createProject(runTag, 'project', `删除验证-${runTag}`, [
    { name: '原始对话', messages: numberedMessages(runTag, 2) },
  ]);
  await seedChatProjects(page, testInfo, [fixture], { blockBrowserWrites: false });
  await openFixtureProject(page, fixture.id);
  const second = await page.context().newPage();
  await openFixtureProject(second, fixture.id);

  const row = page.getByText(fixture.name, { exact: true }).locator('..').locator('..');
  await row.hover();
  await row.getByTitle('删除').click();
  await expectSimpleChatSyncStatus(page, '已同步');

  await second.reload({ waitUntil: 'domcontentloaded' });
  await expect(second.getByText(fixture.name, { exact: true })).toHaveCount(0);
  await expectSimpleChatSyncStatus(second, '已同步');
  await second.close();
});

test('offline edits resume without losing completed messages', async ({ page, context }, testInfo) => {
  await login(page, testInfo);
  const runTag = `offline-${Date.now()}`;
  const fixture = createProject(runTag, 'project', `离线验证-${runTag}`, [
    { name: '保留消息', messages: numberedMessages(runTag, 4) },
  ]);
  await seedChatProjects(page, testInfo, [fixture], { blockBrowserWrites: false });
  await openFixtureProject(page, fixture.id);
  await context.setOffline(true);

  const row = page.getByText(fixture.name, { exact: true }).locator('..').locator('..');
  await row.hover();
  await row.getByTitle('重命名').click();
  const renameInput = row.locator('input');
  await renameInput.fill(`${fixture.name}-已修改`);
  await renameInput.press('Enter');
  await expectSimpleChatSyncStatus(page, '离线，等待同步');

  await context.setOffline(false);
  await expectSimpleChatSyncStatus(page, '已同步');
  await page.reload();
  await expect(page.getByText(`${fixture.name}-已修改`, { exact: true })).toBeVisible();
  await expect(page.getByText(`消息 4：阶段5门禁载荷 ${runTag}`, { exact: true })).toBeVisible();
});
```

- [ ] **Step 2：运行合同测试并确认新场景可发现**

```powershell
pnpm exec vitest run src/__tests__/e2e/stage5-simple-chat-gate-contract.test.ts
pnpm exec playwright test tests/e2e/stage5-simple-chat-gate.spec.ts --list
```

预期：合同先因缺少场景名 RED；补入场景后 `--list` 在 Chromium、Firefox、WebKit 和移动 Chromium 项目中发现测试。

同时升级既有 E2E 夹具的版本契约：

```ts
type ChatProjectsSnapshot = { value: unknown; syncRevision: number };

type SeedChatProjectsOptions = { blockBrowserWrites?: boolean };

const before = await readChatProjectsSnapshot(page);
const persisted = await page.request.post('/api/user-data/sync', {
  data: {
    key: CHAT_PROJECTS_SYNC_KEY,
    value: merged,
    expectedRevision: before.syncRevision,
  },
});
```

`seedChatProjects()` 的第四个参数默认为 `{ blockBrowserWrites: true }`，只有本任务新增的真实同步测试显式传 `false`。恢复原快照前必须重新 GET 当前 revision，再用该 revision 做 CAS；测试拦截的成功响应也必须返回递增的 `syncRevision`，不得保留无版本假成功。

- [ ] **Step 3：只登记实际改动的保护路径**

每个受保护源码路径写入精确来源提交，不授权目录。更新门禁测试，使其断言新增路径、来源 SHA 和无目录通配符。

- [ ] **Step 4：运行本地完整门禁**

```powershell
pnpm doctor
pnpm ts-check
pnpm lint:build
pnpm test
pnpm test:api
pnpm test:regression
pnpm exec vitest run tests/unit/protected-baseline-gate.spec.ts
pnpm build
git diff --check
```

预期：已执行测试失败数为 0，构建完成全部路由；缺少隔离 PostgreSQL 的测试仍明确列为跳过，不计通过。

- [ ] **Step 5：提交回归门禁**

```powershell
git add tests/e2e/stage5-simple-chat-gate.spec.ts src/__tests__/e2e/stage5-simple-chat-gate-contract.test.ts docs/testing/baselines/protected-source-authorizations.json docs/testing/baselines/protected-baseline-allowed-paths.json tests/unit/protected-baseline-gate.spec.ts
git commit -m "test: gate conflict-safe simple chat sync"
```

---

### Task 9：报告、推送和 Coze Google Chrome 验收

**文件：**

- 修改：`docs/plans/v588/V588_ABSORPTION_INVENTORY.md`
- 修改：`docs/testing/BUG_REGISTER.md`
- 修改：`docs/testing/REGRESSION_REPORT.md`
- 修改：`docs/testing/RELEASE_READINESS_REPORT.md`
- 修改：`docs/testing/UNVERIFIED_ITEMS.md`
- 新建：`docs/testing/evidence/v588-chat-003-project-sync-cloud-2026-08-26.json`
- 新建：`docs/testing/evidence/v588-chat-003-project-sync-cloud-2026-08-26.png`

**接口：**

- 消费：本地完整门禁和精确候选 SHA。
- 产出：V588-CHAT-003 云端关闭证据及下一唯一吸收项。

- [ ] **Step 1：更新候选报告但保持“云端待验”**

报告必须记录：基线、候选 SHA、测试总数、跳过数、PostgreSQL 并发结果、`stable` SHA、未验证项。云端验证前不得把 `V588-CHAT-003` 标成已吸收。

- [ ] **Step 2：提交并普通快进推送 `main`**

```powershell
git add docs/plans/v588/V588_ABSORPTION_INVENTORY.md docs/testing/BUG_REGISTER.md docs/testing/REGRESSION_REPORT.md docs/testing/RELEASE_READINESS_REPORT.md docs/testing/UNVERIFIED_ITEMS.md
git commit -m "docs: record simple chat sync candidate"
git push origin main
```

预期：普通快进成功；`git rev-parse refs/remotes/origin/stable` 仍为 `52f7c601ed150769e15d06fb435c6e360e28c9e7`。

- [ ] **Step 3：Coze 拉取精确 SHA 并完成运行健康**

只使用现有 Google Chrome 标签页。Coze 项目页拉取 `main` 精确候选、生产构建并重启；若沙箱断开，刷新项目页恢复后强制刷新现有预览页。禁止创建新 Chrome 标签页，禁止进入 360 浏览器。

- [ ] **Step 4：执行真实云端矩阵**

在真实管理员和普通用户会话中验证：

1. 服务器项目装载与 `syncRevision`；
2. 创建、重命名、删除项目和任务；
3. 普通对话和 Deep Research Artifact 刷新恢复；
4. 双标签不同项目自动合并；
5. 双标签同实体冲突副本；
6. 删除不复活；
7. 离线编辑和恢复联网；
8. 仪表盘项目/任务数量一致；
9. 切换账号缓存隔离；
10. 退出前同步与下次登录继续同步；
11. Console error/warning、原生 dialog、网络 4xx/5xx；
12. PostgreSQL 最终 revision 和快照内容。

保存 screenshot、trace、console 和 network 证据。任何失败先登记并写 RED，不在浏览器里临时修改生产数据制造通过。

- [ ] **Step 5：关闭报告并提交证据**

只有矩阵全部通过才把清单更新为“已吸收 / 云端通过”。若真实 PostgreSQL 或跨账号场景被环境阻塞，结论必须为“有条件通过”或“未验证”。

```powershell
git add docs/plans/v588/V588_ABSORPTION_INVENTORY.md docs/testing/BUG_REGISTER.md docs/testing/REGRESSION_REPORT.md docs/testing/RELEASE_READINESS_REPORT.md docs/testing/UNVERIFIED_ITEMS.md docs/testing/evidence/v588-chat-003-project-sync-cloud-2026-08-26.json docs/testing/evidence/v588-chat-003-project-sync-cloud-2026-08-26.png
git commit -m "docs: close simple chat sync cloud gate"
git push origin main
```

下一唯一吸收项固定为 `V588-CHAT-004`；不得返回重复执行 `V588-CHAT-002`。

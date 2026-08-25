# V588-CHAT-002 确定性原位重试 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为独立智能对话页的普通对话、联网对话、Deep Research 和 CanvasEditor 增加可持久化失败状态与确定性原位重试，且不重复消息、附件登记或下游生成任务。

**Architecture:** 新建纯领域模块 `src/lib/simple-chat-retry.ts`，统一状态转换、重试上下文校验、刷新中断恢复和请求重建；`chat-area.tsx` 只把首次请求与重试请求接入同一个执行路径。CanvasEditor 保持局部状态，后端只做有界幂等键校验与上游 Header 透传，不扩建数据库任务队列。

**Tech Stack:** Next.js 16、React 19、TypeScript 5、Vitest、React Test Renderer、SSE、现有用户数据 JSONB 持久化。

## Global Constraints

- V5.8.8 目录 `J:\无界云端0820` 只读，不复制其删除后重发实现。
- `stable` 分支不得修改；所有代码、测试和文档仅进入 `main`。
- 每个任务严格执行“失败测试 -> 最小实现 -> 聚焦回归 -> 审查”。
- 失败重试不得新增用户消息或助手消息，必须保留原消息 ID。
- 重试必须复用原模型、供应商、模式、附件引用、`responseMessageId` 和幂等键。
- 重试不得再次登记附件，不在重试上下文中复制 data URL 或文件二进制。
- 刷新后遗留 `streaming` 必须收敛为可重试 `failed`，不得永久加载。
- 不宣称不支持幂等 Header 的第三方文本模型具有严格 exactly-once。
- 不修改其他工作区、画布、管理员系统、供应商目录或计费逻辑。

---

## File Map

- Create `src/lib/simple-chat-retry.ts`: 状态、错误、版本化上下文、校验、恢复和重试请求重建。
- Modify `src/components/simple-chat/simple-chat-types.ts`: 为消息接入领域类型。
- Modify `src/components/simple-chat/chat-area.tsx`: 首次请求快照、原位状态更新、普通/联网/Deep Research 重试和 UI。
- Modify `src/components/simple-chat/canvas-editor.tsx`: CanvasEditor 行内失败与冻结快照重试。
- Modify `src/app/api/simple-chat/chat/route.ts`: 校验并向对话上游透传幂等键。
- Modify `src/app/api/simple-chat/deep-research/route.ts`: 校验并向规划、报告上游透传派生幂等键。
- Create `src/__tests__/lib/simple-chat-retry.test.ts`: 纯领域契约。
- Modify `src/__tests__/components/simple-chat-request-context-integration.test.tsx`: 普通、联网、附件、Deep Research 和竞态集成测试。
- Create `src/__tests__/components/canvas-editor-retry.test.tsx`: CanvasEditor 原位失败与重试测试。
- Create `src/__tests__/api/simple-chat-retry-idempotency.test.ts`: API 幂等键边界与透传测试。
- Modify `docs/plans/v588/V588_ABSORPTION_INVENTORY.md`: 更新 V588-CHAT-002 状态与证据。
- Modify `docs/testing/BUG_REGISTER.md`, `REGRESSION_REPORT.md`, `RELEASE_READINESS_REPORT.md`, `UNVERIFIED_ITEMS.md`: 记录本地与云端结论。

---

### Task 1: 消息状态、冻结上下文与刷新恢复领域契约

**Files:**
- Create: `src/lib/simple-chat-retry.ts`
- Modify: `src/components/simple-chat/simple-chat-types.ts`
- Test: `src/__tests__/lib/simple-chat-retry.test.ts`

**Interfaces:**
- Produces: `SimpleChatMessageStatus`, `SimpleChatFailure`, `SimpleChatRetryContextV1`, `recoverInterruptedSimpleChatMessages()`, `readSimpleChatRetryContext()`, `createSimpleChatRetryContext()`。
- Consumes: 既有 `SimpleChatMessage`、`ReasoningEffort`、`ResponseSpeed` 和媒体引用 ID。

- [ ] **Step 1: 写入状态恢复和上下文边界的失败测试**

```ts
import { describe, expect, it } from 'vitest';
import {
  createSimpleChatRetryContext,
  readSimpleChatRetryContext,
  recoverInterruptedSimpleChatMessages,
} from '@/lib/simple-chat-retry';

describe('simple-chat deterministic retry contract', () => {
  it('converts persisted streaming messages into retryable failures', () => {
    const [message] = recoverInterruptedSimpleChatMessages([{
      id: 'assistant-a', role: 'assistant', content: 'partial', createdAt: 1,
      status: 'streaming',
      retryContext: createSimpleChatRetryContext({
        kind: 'chat', projectId: 'project-a', taskId: 'task-a',
        userMessageId: 'user-a', assistantMessageId: 'assistant-a',
        idempotencyKey: 'simple-chat-retry:task-a:assistant-a',
        modelId: 'deepseek-v4-flash', providerId: 'provider-a',
        webSearch: false, sourceVersionIds: [], selectedEntityIds: [],
        historyMessageIds: ['user-a'], systemMessages: [], knowledgeItems: [], memories: [],
      }),
    }]);
    expect(message.status).toBe('failed');
    expect(message.error).toEqual({ message: '上次请求中断，可重试。', retryable: true });
  });

  it('rejects oversized or cross-message retry contexts', () => {
    expect(readSimpleChatRetryContext({ version: 1, kind: 'chat', projectId: 'x'.repeat(300) })).toBeNull();
    expect(readSimpleChatRetryContext({
      version: 1, kind: 'chat', projectId: 'project-a', taskId: 'task-a',
      userMessageId: 'user-a', assistantMessageId: 'assistant-b',
      idempotencyKey: 'key-a', modelId: 'model-a', providerId: 'provider-a',
      webSearch: false, sourceVersionIds: [], selectedEntityIds: [],
      historyMessageIds: [], systemMessages: [], knowledgeItems: [], memories: [],
    }, { assistantMessageId: 'assistant-a' })).toBeNull();
  });
});
```

- [ ] **Step 2: 运行测试并确认 RED**

Run: `pnpm exec vitest run src/__tests__/lib/simple-chat-retry.test.ts`
Expected: FAIL，提示 `@/lib/simple-chat-retry` 不存在或导出缺失。

- [ ] **Step 3: 定义最小领域类型与有界解析**

```ts
export type SimpleChatMessageStatus = 'streaming' | 'completed' | 'failed';

export interface SimpleChatFailure {
  code?: string;
  message: string;
  retryable: boolean;
}

export interface SimpleChatRetryContextV1 {
  version: 1;
  kind: 'chat' | 'deep-research';
  projectId: string;
  taskId: string;
  userMessageId: string;
  assistantMessageId: string;
  idempotencyKey: string;
  modelId: string;
  providerId: string;
  imageModelId?: string;
  imageProviderId?: string;
  webSearch: boolean;
  reasoningEffort?: string;
  responseSpeed?: string;
  canvasProjectId?: string;
  sourceVersionIds: string[];
  selectedEntityIds: string[];
  historyMessageIds: string[];
  systemMessages: Array<{ role: 'system'; content: string }>;
  knowledgeItems: Array<{ id: string; type: string; title: string; content: string }>;
  memories: Array<{ category: string; content: string }>;
  deepAnalysis?: boolean;
  depth?: 'quick' | 'standard' | 'deep';
}
```

实现每个 ID 最大 256 字符、模型/供应商最大 256 字符、系统文本和记忆单项最大 10,000 字符、ID 数组最多 64 项、知识和记忆最多 64 项、完整序列化结果最大 128 KiB。`recoverInterruptedSimpleChatMessages()` 只转换带有效重试上下文的 `streaming` 助手消息；无有效上下文的遗留消息转为不可重试 `failed`。

- [ ] **Step 4: 让组件消息类型引用领域类型**

```ts
import type {
  SimpleChatFailure,
  SimpleChatMessageStatus,
  SimpleChatRetryContextV1,
} from '@/lib/simple-chat-retry';

export interface SimpleChatMessage {
  // 原字段保持不变
  status?: SimpleChatMessageStatus;
  error?: SimpleChatFailure;
  retryContext?: SimpleChatRetryContextV1;
}
```

- [ ] **Step 5: 运行聚焦测试和类型检查**

Run: `pnpm exec vitest run src/__tests__/lib/simple-chat-retry.test.ts`
Expected: PASS。
Run: `pnpm ts-check`
Expected: exit 0。

- [ ] **Step 6: 提交领域契约**

```bash
git add src/lib/simple-chat-retry.ts src/components/simple-chat/simple-chat-types.ts src/__tests__/lib/simple-chat-retry.test.ts
git commit -m "feat: add deterministic simple chat retry contract"
```

---

### Task 2: 普通与联网对话原位失败和确定性重试

**Files:**
- Modify: `src/components/simple-chat/chat-area.tsx`
- Modify: `src/__tests__/components/simple-chat-request-context-integration.test.tsx`

**Interfaces:**
- Consumes: Task 1 的 `createSimpleChatRetryContext()`、`readSimpleChatRetryContext()`、`recoverInterruptedSimpleChatMessages()`。
- Produces: `executeChatRequest(context)` 和 `retryFailedMessage(messageId)`；消息 UI 使用 `status/error/retryContext`。

- [ ] **Step 1: 写普通、联网和附件重试的失败测试**

在现有 Harness 中加入以下断言：

```ts
it('retries a failed assistant in place with its frozen request context', async () => {
  submitText('原问题');
  await flushPromises();
  firstChatResponse.emit({ type: 'error', error: 'supplier failed' });
  firstChatResponse.close();
  await flushPromises();

  const before = latestTask.messages.map(message => message.id);
  clickButtonByText('重试');
  await flushPromises();

  const payloads = requestPayloads('/api/simple-chat/chat');
  expect(latestTask.messages.map(message => message.id)).toEqual(before);
  expect(payloads).toHaveLength(2);
  expect(payloads[1]).toMatchObject({
    model: payloads[0].model,
    providerId: payloads[0].providerId,
    webSearch: payloads[0].webSearch,
    responseMessageId: payloads[0].responseMessageId,
    idempotencyKey: payloads[0].idempotencyKey,
  });
});

it('does not register attachments again during retry', async () => {
  expect(requestPayloads('/api/simple-chat/chat').filter(body => body.assetAction === 'register')).toHaveLength(1);
  clickButtonByText('重试');
  await flushPromises();
  expect(requestPayloads('/api/simple-chat/chat').filter(body => body.assetAction === 'register')).toHaveLength(1);
});
```

另加用例：首次发送后切换当前模型和关闭联网，再重试；第二次 payload 仍使用首次 `providerId/model/webSearch=true`。

- [ ] **Step 2: 运行集成测试并确认 RED**

Run: `pnpm exec vitest run src/__tests__/components/simple-chat-request-context-integration.test.tsx`
Expected: 新用例 FAIL，原因是消息没有 `failed` 状态或“重试”按钮，现有 `regenerateLast` 删除消息并使用当前状态。

- [ ] **Step 3: 首次发送时创建冻结上下文**

创建用户/助手 ID 后立即生成：

```ts
const retryContext = createSimpleChatRetryContext({
  kind: 'chat',
  projectId: requestProjectId,
  taskId: requestTaskId,
  userMessageId,
  assistantMessageId,
  idempotencyKey: `simple-chat-retry:${requestTaskId}:${assistantMessageId}`,
  modelId: requestModelSelection.modelId,
  providerId: requestModelSelection.providerId,
  imageModelId: selectedImageModel,
  imageProviderId: selectedImageProviderId,
  webSearch,
  reasoningEffort,
  responseSpeed,
  canvasProjectId: selectedCanvasProjectId || undefined,
  sourceVersionIds: requestSourceVersionIds,
  selectedEntityIds: requestSelectedEntityIds,
  historyMessageIds: messages.map(message => message.id),
  systemMessages,
  knowledgeItems: apiKnowledgeItems,
  memories: memories.map(memory => ({ category: memory.category, content: memory.content })),
  deepAnalysis: isDeepAnalysis,
});
```

助手消息初始写入 `status: 'streaming'` 和 `retryContext`。首次请求体增加 `idempotencyKey`，Header 增加 `Idempotency-Key`。

- [ ] **Step 4: 抽取共用执行器并原位更新状态**

```ts
const executeChatRequest = useCallback(async (
  context: SimpleChatRetryContextV1,
  userMessage: SimpleChatMessage,
): Promise<void> => {
  setMessages(previous => previous.map(message => message.id === context.assistantMessageId
    ? { ...message, content: '', status: 'streaming', error: undefined, retryContext: context }
    : message));
  // 从 historyMessageIds + userMessage 重建消息，不登记附件。
  // SSE text/image 只写 context.assistantMessageId。
  // done -> completed；HTTP/协议/type:error -> failed，并保存原错误。
}, [/* 只包含稳定依赖和 ref */]);
```

`type:error` 后必须停止接受后续 text/done；部分输出可以保留在错误详情之外，但下一次重试开始时清空旧部分输出。所有状态更新使用 `context.assistantMessageId`，不依赖“最后一条消息”。

- [ ] **Step 5: 增加失败消息常显重试 UI**

```tsx
{msg.role === 'assistant' && msg.status === 'failed' && (
  <div className="mt-3 flex items-center justify-between gap-3 border-t border-destructive/20 pt-2">
    <span className="text-xs text-destructive">{msg.error?.message || '请求失败'}</span>
    {msg.error?.retryable && msg.retryContext && (
      <button type="button" onClick={() => void retryFailedMessage(msg.id)} title="重试失败请求">
        <RefreshCw className="h-3.5 w-3.5" />
        重试
      </button>
    )}
  </div>
)}
```

现有“重新生成”保留为主动创建新回复，但改为接收明确消息 ID，不能再用 `slice(0, -2)` 假设目标位于末尾。

- [ ] **Step 6: 加载任务时恢复中断消息**

```ts
setMessages(recoverInterruptedSimpleChatMessages((task.messages || []).filter(Boolean)));
```

恢复结果经既有 `onUpdateTask` 写回本地和服务器，避免每次刷新重复转换。

- [ ] **Step 7: 运行普通/联网/附件/竞态回归**

Run: `pnpm exec vitest run src/__tests__/components/simple-chat-request-context-integration.test.tsx src/__tests__/components/simple-chat-sse-integration.test.ts`
Expected: 全部 PASS，且 V588-CHAT-001 的模型快照、历史图片隔离和迟到响应隔离用例不回归。

- [ ] **Step 8: 提交聊天原位重试**

```bash
git add src/components/simple-chat/chat-area.tsx src/__tests__/components/simple-chat-request-context-integration.test.tsx
git commit -m "feat: retry failed simple chat messages in place"
```

---

### Task 3: Deep Research 原位失败与阶段恢复

**Files:**
- Modify: `src/components/simple-chat/chat-area.tsx`
- Modify: `src/__tests__/components/simple-chat-request-context-integration.test.tsx`

**Interfaces:**
- Consumes: Task 1 的 `SimpleChatRetryContextV1`，Task 2 的消息状态更新约定。
- Produces: `executeDeepResearchRequest(context, query)`；失败消息的“重试”分派到正确执行器。

- [ ] **Step 1: 写 Deep Research 原位重试失败测试**

```ts
it('retries Deep Research on the same messages and frozen provider pair', async () => {
  submitText('研究问题');
  clickButtonByText('Deep Research');
  firstResearchResponse.emit({ type: 'phase', label: '规划中' });
  firstResearchResponse.emit({ type: 'error', error: 'research failed' });
  firstResearchResponse.close();
  await flushPromises();

  const before = latestTask.messages.map(message => message.id);
  selectTaskModel('other-provider', 'other-model');
  clickButtonByText('重试');
  await flushPromises();

  const payloads = requestPayloads('/api/simple-chat/deep-research');
  expect(latestTask.messages.map(message => message.id)).toEqual(before);
  expect(payloads[1]).toMatchObject({
    query: payloads[0].query,
    model: payloads[0].model,
    providerId: payloads[0].providerId,
    depth: payloads[0].depth,
    idempotencyKey: payloads[0].idempotencyKey,
  });
});
```

- [ ] **Step 2: 运行测试并确认 RED**

Run: `pnpm exec vitest run src/__tests__/components/simple-chat-request-context-integration.test.tsx -t "retries Deep Research"`
Expected: FAIL，现有 Deep Research 无状态、上下文和重试分派。

- [ ] **Step 3: 实现 Deep Research 冻结上下文与执行器**

首次请求创建 `kind: 'deep-research'`、`depth: 'standard'` 和稳定幂等键。执行器始终：

```ts
await fetch('/api/simple-chat/deep-research', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Idempotency-Key': context.idempotencyKey,
  },
  body: JSON.stringify({
    query,
    model: context.modelId,
    providerId: context.providerId,
    depth: context.depth || 'standard',
    idempotencyKey: context.idempotencyKey,
  }),
});
```

阶段事件、文本、引用和错误只更新 `context.assistantMessageId`；错误后忽略迟到文本。重试不再创建第二个 Artifact；只在 `completed` 后创建一次，并使用助手消息 ID 作为去重键。

- [ ] **Step 4: 运行 Deep Research 与竞态回归**

Run: `pnpm exec vitest run src/__tests__/components/simple-chat-request-context-integration.test.tsx -t "Deep Research"`
Expected: Deep Research 成功、精确错误、同消息重试、任务切换隔离全部 PASS。

- [ ] **Step 5: 提交 Deep Research 重试**

```bash
git add src/components/simple-chat/chat-area.tsx src/__tests__/components/simple-chat-request-context-integration.test.tsx
git commit -m "feat: retry deep research in place"
```

---

### Task 4: CanvasEditor 行内失败与冻结快照重试

**Files:**
- Modify: `src/components/simple-chat/canvas-editor.tsx`
- Modify: `src/components/simple-chat/chat-area.tsx`
- Create: `src/__tests__/components/canvas-editor-retry.test.tsx`
- Modify: `src/__tests__/components/simple-chat-request-context-integration.test.tsx`

**Interfaces:**
- CanvasEditor produces: `CanvasAiEditSnapshot` 局部状态，`retryAiEdit()`。
- ChatArea consumes: 明确的 `CanvasAiEditRequest`，其中包含冻结 `modelId/providerId/idempotencyKey`。

- [ ] **Step 1: 写 CanvasEditor 失败、重试和版本唯一性测试**

```tsx
it('keeps the selection and instruction and retries the frozen edit once', async () => {
  const edit = vi.fn()
    .mockRejectedValueOnce(new Error('APIMart edit failed'))
    .mockResolvedValueOnce('前缀CANVAS_OK后缀');
  render(<CanvasEditor content="前缀原文后缀" onClose={vi.fn()} onAiEdit={edit} />);
  selectTextareaRange(2, 4);
  typeInstruction('替换选区');
  clickButtonByText('AI 修改');
  await screen.findByText('APIMart edit failed');
  clickButtonByText('重试修改');
  await screen.findByDisplayValue('前缀CANVAS_OK后缀');
  expect(edit.mock.calls[1]).toEqual(edit.mock.calls[0]);
  expect(screen.getByText('版本 (2)')).toBeTruthy();
});
```

- [ ] **Step 2: 运行测试并确认 RED**

Run: `pnpm exec vitest run src/__tests__/components/canvas-editor-retry.test.tsx`
Expected: FAIL，现有组件只显示 Toast 且会清空/读取当前状态。

- [ ] **Step 3: 在 CanvasEditor 保存不可变失败快照**

```ts
interface CanvasAiEditSnapshot {
  instruction: string;
  currentContent: string;
  selectedText: string;
  selectionStart: number;
  selectionEnd: number;
}

const [failedEdit, setFailedEdit] = useState<{
  snapshot: CanvasAiEditSnapshot;
  message: string;
} | null>(null);
```

首次点击从 textarea 读取精确 selectionStart/selectionEnd 并冻结；失败保留输入和选区。`retryAiEdit()` 只使用 `failedEdit.snapshot`。成功后新增一个版本并清空错误，失败不新增版本。

- [ ] **Step 4: ChatArea 冻结 Canvas 模型和幂等键**

把回调改为接受一次请求快照：

```ts
interface CanvasAiEditRequest extends CanvasAiEditSnapshot {
  idempotencyKey: string;
  modelId: string;
  providerId: string;
}
```

CanvasEditor 首次调用时由 ChatArea 返回绑定选定任务模型的执行闭包；重试调用同一闭包和快照。请求 Header/body 携带同一个幂等键。已有任务/项目迟到响应隔离继续使用 `projectIdRef/taskIdRef`。

- [ ] **Step 5: 增加行内错误和重试控件**

```tsx
{failedEdit && (
  <div role="alert" className="mb-2 flex items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2">
    <span className="text-xs text-destructive">{failedEdit.message}</span>
    <button type="button" onClick={() => void retryAiEdit()} disabled={isAiEditing}>
      <RefreshCw size={14} />
      重试修改
    </button>
  </div>
)}
```

- [ ] **Step 6: 运行 CanvasEditor 与请求作用域回归**

Run: `pnpm exec vitest run src/__tests__/components/canvas-editor-retry.test.tsx src/__tests__/components/simple-chat-request-context-integration.test.tsx -t "CanvasEditor"`
Expected: 原模型发送、精确供应商错误、任务切换隔离、项目切换隔离、行内重试全部 PASS。

- [ ] **Step 7: 提交 CanvasEditor 重试**

```bash
git add src/components/simple-chat/canvas-editor.tsx src/components/simple-chat/chat-area.tsx src/__tests__/components/canvas-editor-retry.test.tsx src/__tests__/components/simple-chat-request-context-integration.test.tsx
git commit -m "feat: retry canvas edits with frozen context"
```

---

### Task 5: API 幂等键校验与上游透传

**Files:**
- Modify: `src/app/api/simple-chat/chat/route.ts`
- Modify: `src/app/api/simple-chat/deep-research/route.ts`
- Create: `src/__tests__/api/simple-chat-retry-idempotency.test.ts`

**Interfaces:**
- Consumes: 前端 body/Header 的同一 `idempotencyKey`。
- Produces: 有界规范化 `requestIdempotencyKey`；普通聊天直接透传，Deep Research 派生 `:plan` 与 `:report`。

- [ ] **Step 1: 写 API 幂等边界的失败测试**

```ts
it('forwards a bounded retry key to the chat provider', async () => {
  await POST(chatRequest({ idempotencyKey: 'simple-chat-retry:task-a:assistant-a' }));
  expect(providerFetch).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
    headers: expect.objectContaining({ 'Idempotency-Key': 'simple-chat-retry:task-a:assistant-a' }),
  }));
});

it('derives stable Deep Research phase keys', async () => {
  await POST(deepResearchRequest({ idempotencyKey: 'research-a' }));
  expect(providerFetch.mock.calls[0][1].headers['Idempotency-Key']).toBe('research-a:plan');
  expect(providerFetch.mock.calls.at(-1)[1].headers['Idempotency-Key']).toBe('research-a:report');
});

it('rejects an oversized idempotency key', async () => {
  const response = await POST(chatRequest({ idempotencyKey: 'x'.repeat(257) }));
  expect(response.status).toBe(400);
});
```

- [ ] **Step 2: 运行测试并确认 RED**

Run: `pnpm exec vitest run src/__tests__/api/simple-chat-retry-idempotency.test.ts`
Expected: FAIL，普通聊天和 Deep Research 尚未向文本上游透传，Deep Research 未校验键长。

- [ ] **Step 3: 实现有界幂等键解析与透传**

只接受 1–256 字符的 `[A-Za-z0-9:._-]`。body 与 Header 同时存在但不一致时返回 409；一致时使用该值：

```ts
function readIdempotencyKey(request: NextRequest, bodyValue: unknown): string | undefined {
  const bodyKey = typeof bodyValue === 'string' ? bodyValue.trim() : '';
  const headerKey = (request.headers.get('idempotency-key') || '').trim();
  if (bodyKey && headerKey && bodyKey !== headerKey) throw new IdempotencyConflictError();
  const key = bodyKey || headerKey;
  if (!key) return undefined;
  if (key.length > 256 || !/^[A-Za-z0-9:._-]+$/.test(key)) throw new InvalidIdempotencyKeyError();
  return key;
}
```

普通聊天供应商 Header 增加 `Idempotency-Key`；Deep Research 规划和报告分别使用 `${key}:plan`、`${key}:report`。不得把 Key 写入日志或错误正文。

- [ ] **Step 4: 运行 API 安全与认证回归**

Run: `pnpm exec vitest run src/__tests__/api/simple-chat-retry-idempotency.test.ts src/__tests__/api/simple-chat-auth.test.ts src/__tests__/api/chat-agent-v2-generation-routing.test.ts`
Expected: 全部 PASS，既有图像生成幂等键保持不变。

- [ ] **Step 5: 提交 API 幂等透传**

```bash
git add src/app/api/simple-chat/chat/route.ts src/app/api/simple-chat/deep-research/route.ts src/__tests__/api/simple-chat-retry-idempotency.test.ts
git commit -m "fix: preserve simple chat retry idempotency"
```

---

### Task 6: 全量回归、清单更新、推送与云端验收

**Files:**
- Modify: `docs/plans/v588/V588_ABSORPTION_INVENTORY.md`
- Modify: `docs/testing/BUG_REGISTER.md`
- Modify: `docs/testing/REGRESSION_REPORT.md`
- Modify: `docs/testing/RELEASE_READINESS_REPORT.md`
- Modify: `docs/testing/UNVERIFIED_ITEMS.md`
- Create: `docs/testing/evidence/v588-chat-002-<commit>-cloud-2026-08-25.json`
- Create: `docs/testing/evidence/2026-08-25-v588-chat-002-cloud.png`

**Interfaces:**
- Consumes: Tasks 1–5 的实现与测试。
- Produces: 可追溯本地证据、GitHub `main` 提交和 Coze Chrome 云端证据。

- [ ] **Step 1: 运行聚焦套件**

```bash
pnpm exec vitest run \
  src/__tests__/lib/simple-chat-retry.test.ts \
  src/__tests__/components/canvas-editor-retry.test.tsx \
  src/__tests__/components/simple-chat-request-context-integration.test.tsx \
  src/__tests__/components/simple-chat-sse-integration.test.ts \
  src/__tests__/api/simple-chat-retry-idempotency.test.ts \
  src/__tests__/api/simple-chat-auth.test.ts \
  src/__tests__/api/chat-agent-v2-generation-routing.test.ts
```

Expected: 全部 PASS；不得跳过失败用例。

- [ ] **Step 2: 运行全仓门禁**

Run in order:

```bash
pnpm ts-check
pnpm lint
pnpm test
pnpm build
git diff --check
```

Expected: 每条命令 exit 0。任何失败先定位并只修复本项引入的问题；不得通过禁用规则、删除测试或增加固定等待绕过。

- [ ] **Step 3: 更新中文清单和测试报告**

`V588_ABSORPTION_INVENTORY.md` 将 V588-CHAT-002 更新为“本地已实现，待云端验收”，并记录测试命令和提交。Bug/回归/发布报告明确区分：

```text
应用内消息原位与下游任务幂等：已验证
第三方文本供应商严格 exactly-once：供应商能力相关，不作保证
真实失败注入与刷新恢复：云端待验证
```

- [ ] **Step 4: 提交报告并推送 main**

```bash
git add docs/plans/v588/V588_ABSORPTION_INVENTORY.md docs/testing
git commit -m "docs: record deterministic chat retry regression"
git push origin main
git rev-parse HEAD
git rev-parse origin/main
git rev-parse stable
```

Expected: `HEAD == origin/main`；`stable` 仍为任务开始前的提交，不产生任何 stable 变更。

- [ ] **Step 5: Coze 拉取后仅使用既有 Google Chrome 标签页验证**

验证三条路径：

1. 普通/联网聊天：制造可控供应商失败，确认一组消息、原位错误、模型/供应商/联网状态不变；点击重试后同一消息完成。
2. Deep Research：失败后原位重试，阶段恢复，不产生第二组消息或重复 Artifact。
3. CanvasEditor：保留原选区与指令，行内显示错误，重试后仅新增一个成功版本。

同时记录：Git Commit、部署 URL、测试时间、账号、请求 URL、HTTP/SSE、`responseMessageId`、幂等键摘要、消息 ID、Console error/warning 数量、截图。不得创建新 Chrome 标签页；沙箱断开时先在既有项目页恢复，再强制刷新既有预览页。

- [ ] **Step 6: 归档机器证据并作发布结论**

证据 JSON 至少包含：

```json
{
  "commit": "<deployed-main-commit>",
  "deploymentUrl": "<coze-preview-url>",
  "testedAt": "2026-08-25T00:00:00+08:00",
  "browser": "Google Chrome",
  "ordinaryChatRetry": { "sameMessageIds": true, "sameProviderModel": true, "sameIdempotencyKey": true },
  "deepResearchRetry": { "sameMessageIds": true, "singleArtifact": true },
  "canvasEditorRetry": { "selectionPreserved": true, "instructionPreserved": true, "singleSuccessfulVersion": true },
  "consoleErrors": 0,
  "consoleWarnings": 0,
  "verdict": "pass"
}
```

只有三条真实链路和本地全量门禁全部通过，才把 V588-CHAT-002 标为“已吸收并云端验证”；否则保持“有条件通过/未验证”，登记精确阻塞项。

---

## Self-Review

- Spec coverage: 状态模型、冻结上下文、普通/联网、Deep Research、CanvasEditor、持久化恢复、应用内幂等、竞态、UI、全量门禁和云端证据均有对应任务。
- Scope control: 不引入数据库队列，不修改计费，不调整其他功能，不触碰 stable。
- Placeholder scan: 所有实施步骤均包含明确文件、代码、命令和预期结果，没有占位描述。
- Type consistency: 全计划统一使用 `SimpleChatRetryContextV1`、`assistantMessageId`、`idempotencyKey`、`streaming/completed/failed`。
- Evidence boundary: 明确区分应用内幂等和第三方供应商 exactly-once，避免过度声明。

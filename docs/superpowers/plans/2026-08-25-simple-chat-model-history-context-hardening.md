# 智能对话模型选择与历史图片上下文加固 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复独立智能对话页模型选择不生效、模型下拉列表被对话内容遮挡和失效历史图片污染纯文本请求的问题，并完成普通对话、CanvasEditor、Deep Research 的本地与云端回归。

**Architecture:** 当前 `SimpleChatTask` 成为聊天模型与供应商组合的唯一数据源，菜单选择通过纯函数一次写入二者，移除 `chat-area.tsx` 内重复的聊天模型状态。选择性恢复 V5.8.8 顶部栏的层叠上下文，使聊天与图像模型菜单稳定覆盖消息区。新增浏览器兼容的请求上下文模块，负责严格校验图片引用、保留最近三轮有效图片并生成不可变请求快照；历史数据本身不被改写。

**Tech Stack:** Next.js 16、React 19、TypeScript 5、Vitest 3、Testing Library、Playwright 1.60、Google Chrome 云端真实验收。

## Global Constraints

- 所有代码、测试和文档只进入 `main`；`origin/stable` 必须保持 `52f7c601ed150769e15d06fb435c6e360e28c9e7`。
- V5.8.8 固定为只读 donor，不在 `J:\无界云端0820` 写入任何文件。
- 保留最近三轮图片上下文能力，不增加模型选择 UI、图片上下文开关或供应商自动切换；下拉菜单只恢复必要层级，不做布局重构。
- 不修改管理员供应商配置，不把 APIMart `get_channel_failed` 改写为程序成功或 SSE 协议错误。
- 不使用 Mock 冒充真实供应商成功；Mock 仅用于确定性前端协议回归，最终结论以现有 Chrome 云端真实测试为准。
- 每项严格执行“失败测试 → 最小接入 → 全量回归 → 云端验证”。

---

## File Map

- Create: `src/lib/simple-chat-request-context.ts` — 模型组合、图片引用校验和最近历史图片请求副本的纯函数。
- Create: `src/__tests__/lib/simple-chat-request-context.test.ts` — 纯函数边界和媒体格式测试。
- Modify: `src/components/simple-chat/chat-area.tsx` — 使用任务单一模型数据源、恢复模型菜单父级层叠上下文、捕获请求快照、过滤历史与当前图片。
- Modify: `src/__tests__/components/simple-chat-model-selector-contract.test.ts` — 从字符串存在性升级为单一数据源、原子写入和层叠边界契约。
- Create: `src/__tests__/components/simple-chat-request-context-integration.test.ts` — 验证普通对话、CanvasEditor、Deep Research 的接线契约。
- Create: `tests/e2e/stage5-simple-chat-gate.spec.ts` — 选择性吸收 V5.8.8 的浏览器门禁并增加模型选择和失效图片用例。
- Modify: `docs/testing/BUG_REGISTER.md` — 登记云端复现、根因、修复和证据。
- Modify: `docs/testing/REGRESSION_REPORT.md` — 记录局部、全量和云端回归结果。
- Modify: `docs/testing/RELEASE_READINESS_REPORT.md` — 更新 Stage 4 发布判断。
- Modify: `docs/testing/UNVERIFIED_ITEMS.md` — 仅移除取得真实证据的项目。
- Modify: `docs/plans/v588/V588_ABSORPTION_INVENTORY.md` — 将菜单层级标为“选择性吸收”，将模型状态与历史图片标为“donor 同样缺陷，当前线独立修复”。

---

### Task 1: 建立请求上下文纯函数的失败测试

**Files:**
- Create: `src/__tests__/lib/simple-chat-request-context.test.ts`
- Create after RED: `src/lib/simple-chat-request-context.ts`

**Interfaces:**
- Produces: `SimpleChatModelSelection`、`readSimpleChatModelSelection()`、`applySimpleChatModelSelection()`、`filterSimpleChatImageInputs()`、`buildSimpleChatHistoryRequestContext()`。
- Consumes: `getSafeImageTypeFromDataUrl()` 和 `getSafeMediaTypeFromResponse()` from `src/lib/media-validation.ts`。

- [ ] **Step 1: 写模型组合失败测试**

```ts
import { describe, expect, it } from 'vitest';
import {
  applySimpleChatModelSelection,
  readSimpleChatModelSelection,
} from '@/lib/simple-chat-request-context';

describe('simple-chat model selection', () => {
  it('atomically applies model and provider without mutating the task', () => {
    const task = { id: 'task-1', model: 'gemini-old', providerId: 'provider-old' };
    const next = applySimpleChatModelSelection(task, {
      modelId: 'gpt-5.5',
      providerId: 'provider-apimart',
    });
    expect(next).toEqual({ id: 'task-1', model: 'gpt-5.5', providerId: 'provider-apimart' });
    expect(task).toEqual({ id: 'task-1', model: 'gemini-old', providerId: 'provider-old' });
    expect(readSimpleChatModelSelection(next)).toEqual({
      modelId: 'gpt-5.5',
      providerId: 'provider-apimart',
    });
  });
});
```

- [ ] **Step 2: 写图片筛选与最近三轮失败测试**

```ts
const PNG_1PX = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zr1sAAAAASUVORK5CYII=';

it('keeps supported images and rejects malformed or unsafe references', () => {
  const result = filterSimpleChatImageInputs([
    'https://cdn.example.com/a.png',
    '/api/serve-upload/uploads/a.png',
    '/uploads/b.webp',
    PNG_1PX,
    'data:image/png;base64,not-valid',
    'data:text/plain;base64,SGVsbG8=',
    'blob:https://example.com/old',
    '',
  ]);
  expect(result.accepted).toEqual([
    'https://cdn.example.com/a.png',
    '/api/serve-upload/uploads/a.png',
    '/uploads/b.webp',
    PNG_1PX,
  ]);
  expect(result.rejectedCount).toBe(4);
});

it('only attaches valid images from the latest three image-bearing user rounds', () => {
  const context = buildSimpleChatHistoryRequestContext([
    { id: 'u1', role: 'user', content: 'one', images: ['https://cdn.example.com/1.png'] },
    { id: 'a1', role: 'assistant', content: 'reply' },
    { id: 'u2', role: 'user', content: 'two', images: ['https://cdn.example.com/2.png'] },
    { id: 'u3', role: 'user', content: 'three', images: ['data:image/png;base64,broken'] },
    { id: 'u4', role: 'user', content: 'four', images: ['/uploads/4.png'] },
  ]);
  expect(context.messages.find(message => message.id === 'u1')?.images).toBeUndefined();
  expect(context.messages.find(message => message.id === 'u2')?.images).toEqual(['https://cdn.example.com/2.png']);
  expect(context.messages.find(message => message.id === 'u3')?.images).toBeUndefined();
  expect(context.messages.find(message => message.id === 'u4')?.images).toEqual(['/uploads/4.png']);
  expect(context.rejectedCount).toBe(1);
});
```

- [ ] **Step 3: 运行测试并确认 RED**

Run: `pnpm exec vitest run src/__tests__/lib/simple-chat-request-context.test.ts`

Expected: FAIL，错误为无法解析 `@/lib/simple-chat-request-context`，而不是测试语法错误。

- [ ] **Step 4: 提交 RED 测试**

```bash
git add src/__tests__/lib/simple-chat-request-context.test.ts
git commit -m "test: reproduce simple chat request context bugs"
```

---

### Task 2: 实现浏览器兼容的请求上下文模块

**Files:**
- Create: `src/lib/simple-chat-request-context.ts`
- Test: `src/__tests__/lib/simple-chat-request-context.test.ts`

**Interfaces:**
- Produces:
  - `type SimpleChatModelSelection = { modelId: string; providerId: string }`
  - `readSimpleChatModelSelection(task): SimpleChatModelSelection`
  - `applySimpleChatModelSelection(task, selection): task copy`
  - `filterSimpleChatImageInputs(values): { accepted: string[]; rejectedCount: number }`
  - `buildSimpleChatHistoryRequestContext(messages, maximumImageRounds?): { messages; images; rejectedCount; messageIds }`

- [ ] **Step 1: 写最小模型组合实现**

```ts
export interface SimpleChatModelSelection {
  modelId: string;
  providerId: string;
}

export function readSimpleChatModelSelection(
  task: { model?: string; providerId?: string } | null | undefined,
): SimpleChatModelSelection {
  return {
    modelId: task?.model?.trim() || '',
    providerId: task?.providerId?.trim() || '',
  };
}

export function applySimpleChatModelSelection<T extends { model: string; providerId: string }>(
  task: T,
  selection: SimpleChatModelSelection,
): T {
  return {
    ...task,
    model: selection.modelId.trim(),
    providerId: selection.providerId.trim(),
  };
}
```

- [ ] **Step 2: 写严格图片引用实现**

```ts
import { getSafeImageTypeFromDataUrl, getSafeMediaTypeFromResponse } from '@/lib/media-validation';

const MAX_IMAGE_URL_LENGTH = 4096;

function decodeStrictDataImage(value: string): { mimeType: string; bytes: Uint8Array } | null {
  const safeType = getSafeImageTypeFromDataUrl(value);
  const match = value.match(/^data:image\/[\w+.-]+;base64,([A-Za-z0-9+/]+={0,2})$/i);
  if (!safeType || !match || match[1].length % 4 !== 0 || typeof globalThis.atob !== 'function') return null;
  try {
    const decoded = globalThis.atob(match[1]);
    const bytes = Uint8Array.from(decoded, character => character.charCodeAt(0));
    if (!bytes.length || globalThis.btoa(decoded) !== match[1]) return null;
    return getSafeMediaTypeFromResponse(safeType.mimeType, bytes, false)
      ? { mimeType: safeType.mimeType, bytes }
      : null;
  } catch {
    return null;
  }
}
```

For URL inputs, accept only credential-free `http:`/`https:` URLs or traversal-free `/api/serve-upload/` and `/uploads/` paths. Reject `blob:`, protocol-relative URLs, credentials, traversal and strings longer than 4096 characters.

- [ ] **Step 3: 写最近三轮请求副本实现**

```ts
export function buildSimpleChatHistoryRequestContext(
  messages: readonly SimpleChatHistoryMessage[],
  maximumImageRounds = 3,
): SimpleChatHistoryRequestContext {
  const history = messages.filter(message => message.role !== 'search');
  const recentIds = new Set(
    history
      .filter(message => message.role === 'user' && (message.images?.length || 0) > 0)
      .slice(-maximumImageRounds)
      .map(message => message.id),
  );
  let rejectedCount = 0;
  const images: string[] = [];
  const messageIds: string[] = [];
  const requestMessages = history.map(message => {
    if (message.role !== 'user' || !recentIds.has(message.id)) {
      return { id: message.id, role: message.role, content: message.content };
    }
    const filtered = filterSimpleChatImageInputs(message.images || []);
    rejectedCount += filtered.rejectedCount;
    if (!filtered.accepted.length) return { id: message.id, role: message.role, content: message.content };
    images.push(...filtered.accepted);
    messageIds.push(message.id);
    return { id: message.id, role: message.role, content: message.content, images: filtered.accepted };
  });
  return { messages: requestMessages, images, rejectedCount, messageIds };
}
```

- [ ] **Step 4: 运行局部测试并确认 GREEN**

Run: `pnpm exec vitest run src/__tests__/lib/simple-chat-request-context.test.ts`

Expected: PASS，所有模型组合、URL、data URL、最近三轮和不变性断言通过。

- [ ] **Step 5: 提交纯函数实现**

```bash
git add src/lib/simple-chat-request-context.ts src/__tests__/lib/simple-chat-request-context.test.ts
git commit -m "fix: validate simple chat request context"
```

---

### Task 3: 让当前任务成为聊天模型唯一数据源并恢复菜单层级

**Files:**
- Modify: `src/components/simple-chat/chat-area.tsx`
- Modify: `src/__tests__/components/simple-chat-model-selector-contract.test.ts`

**Interfaces:**
- Consumes: `readSimpleChatModelSelection()` and `applySimpleChatModelSelection()` from Task 2.
- Produces: `handleChatModelSelect(selection)`，菜单、持久化和请求共同读取当前任务组合。

- [ ] **Step 1: 将现有契约测试改为单一数据源失败测试**

```ts
it('uses the current task as the only chat model selection source', () => {
  expect(source).toContain('const chatModelSelection = readSimpleChatModelSelection(task);');
  expect(source).toContain('onUpdateTask(applySimpleChatModelSelection(task, selection));');
  expect(source).not.toContain('const [selectedModel, setSelectedModel]');
  expect(source).not.toContain('const [selectedProviderId, setSelectedProviderId]');
});

it('keeps both model menus above the scrolling conversation', () => {
  expect(source).toContain('<header className="relative z-50');
  expect(source.match(/role="listbox"/g)).toHaveLength(2);
});
```

- [ ] **Step 2: 运行契约测试并确认 RED**

Run: `pnpm exec vitest run src/__tests__/components/simple-chat-model-selector-contract.test.ts`

Expected: FAIL，因为 `chat-area.tsx` 仍保存两个重复的本地状态，且顶部栏缺少 V5.8.8 已验证的父级层叠上下文。

- [ ] **Step 3: 最小接入任务单一数据源**

```ts
const chatModelSelection = readSimpleChatModelSelection(task);
const selectedModel = chatModelSelection.modelId;
const selectedProviderId = chatModelSelection.providerId;

const handleChatModelSelect = useCallback((selection: SimpleChatModelSelection) => {
  if (!task) return;
  onUpdateTask(applySimpleChatModelSelection(task, selection));
  setOpenModelMenu(null);
}, [onUpdateTask, task]);
```

Remove `setSelectedModel()` and `setSelectedProviderId()` from task synchronization. Split model loading from default selection: loading only sets `chatModels`; a second effect applies the first model to a task only when both task fields are empty.

Update the chat menu item to call:

```tsx
onClick={() => handleChatModelSelect({ modelId: m.modelId, providerId: m.providerId })}
```

Do not alter the image-model selector in this task.

Restore the exact parent stacking fix proven by V5.8.8 and historical commit `01e45fbf`:

```tsx
<header className="relative z-50 flex flex-wrap items-center ...">
```

Keep both existing listboxes inside this header. Do not solve the regression only by increasing the child menu `z-index`, and do not introduce a Portal or redesign the top bar.

- [ ] **Step 4: 运行模型选择测试并确认 GREEN**

Run: `pnpm exec vitest run src/__tests__/components/simple-chat-model-selector-contract.test.ts src/__tests__/lib/simple-chat-request-context.test.ts`

Expected: PASS，聊天模型无重复本地状态；两个模型菜单拥有高于消息滚动区的父级层叠上下文；图像模型现有行为保持。

- [ ] **Step 5: 提交模型选择修复**

```bash
git add src/components/simple-chat/chat-area.tsx src/__tests__/components/simple-chat-model-selector-contract.test.ts
git commit -m "fix: harden simple chat model menus"
```

---

### Task 4: 接入当前图片校验和历史图片请求副本

**Files:**
- Modify: `src/components/simple-chat/chat-area.tsx`
- Create: `src/__tests__/components/simple-chat-request-context-integration.test.ts`

**Interfaces:**
- Consumes: `filterSimpleChatImageInputs()` and `buildSimpleChatHistoryRequestContext()` from Task 2.
- Produces: 当前上传无效时阻止请求；历史无效时忽略并继续；历史记录不被改写。

- [ ] **Step 1: 写接线失败测试**

```ts
it('validates current uploads before registration and filters history only in the request copy', () => {
  expect(source).toContain('filterSimpleChatImageInputs(uploadedImages.map(attachment => attachment.url || \'\'))');
  expect(source).toContain('buildSimpleChatHistoryRequestContext(messages)');
  expect(source).toContain('historyContext.messages.map(message => ({');
  expect(source).not.toContain('recentUserImageIds');
});
```

- [ ] **Step 2: 运行接线测试并确认 RED**

Run: `pnpm exec vitest run src/__tests__/components/simple-chat-request-context-integration.test.ts`

Expected: FAIL，因为旧代码仍直接发送最近三轮原始 `images`。

- [ ] **Step 3: 在提交前校验当前上传图片**

At the beginning of `handleSend`, before `setIsStreaming(true)` and before asset registration:

```ts
const currentImages = filterSimpleChatImageInputs(
  uploadedImages.map(attachment => attachment.url || ''),
);
if (currentImages.rejectedCount > 0) {
  setSearchStatus('当前上传图片无效，请重新选择图片后发送。');
  return;
}
```

- [ ] **Step 4: 用请求副本替换旧历史图片逻辑**

```ts
const historyContext = buildSimpleChatHistoryRequestContext(messages);
setHistoryImages(historyContext.images);
if (historyContext.rejectedCount > 0) {
  setSearchStatus(`已忽略 ${historyContext.rejectedCount} 张失效历史图片，本次请求继续发送。`);
}

allMessages = [
  ...systemMessages,
  ...historyContext.messages.map(message => ({
    role: message.role,
    content: message.content,
    ...(message.images?.length ? { images: message.images } : {}),
  })),
  { role: 'user', content: userMsg.content, ...(userMsg.images?.length ? { images: userMsg.images } : {}) },
];
```

Do not call `setMessages()` with the filtered history. The persisted user history must retain its original image data.

- [ ] **Step 5: 运行局部测试并确认 GREEN**

Run: `pnpm exec vitest run src/__tests__/lib/simple-chat-request-context.test.ts src/__tests__/components/simple-chat-request-context-integration.test.ts src/__tests__/components/simple-chat-model-selector-contract.test.ts`

Expected: PASS。

- [ ] **Step 6: 提交历史图片修复**

```bash
git add src/components/simple-chat/chat-area.tsx src/__tests__/components/simple-chat-request-context-integration.test.ts
git commit -m "fix: ignore invalid simple chat history images"
```

---

### Task 5: 固化普通对话、CanvasEditor 和 Deep Research 请求快照

**Files:**
- Modify: `src/components/simple-chat/chat-area.tsx`
- Modify: `src/__tests__/components/simple-chat-request-context-integration.test.ts`

**Interfaces:**
- Consumes: `readSimpleChatModelSelection(task)`.
- Produces: 三条请求在开始时捕获同一个不可变 `{ modelId, providerId }` 快照。

- [ ] **Step 1: 写三路径失败测试**

```ts
it('captures a model selection snapshot for all three simple-chat request paths', () => {
  expect(source.match(/const requestModelSelection = readSimpleChatModelSelection\(task\);/g)).toHaveLength(3);
  expect(source).toContain('model: requestModelSelection.modelId');
  expect(source).toContain('providerId: requestModelSelection.providerId');
});
```

- [ ] **Step 2: 运行测试并确认 RED**

Run: `pnpm exec vitest run src/__tests__/components/simple-chat-request-context-integration.test.ts`

Expected: FAIL，因为三条路径仍直接读取两个闭包变量。

- [ ] **Step 3: 在三条路径捕获请求快照**

At the start of `canvasAiEdit`, `handleSend`, and the Deep Research submit callback:

```ts
const requestModelSelection = readSimpleChatModelSelection(task);
if (!requestModelSelection.modelId || !requestModelSelection.providerId) {
  throw new Error('请先选择可用的对话模型。');
}
```

Use the snapshot for request bodies, assistant message metadata, retry context and applied task metadata. Do not read `selectedModel` or `selectedProviderId` after the first `await` in those paths.

- [ ] **Step 4: 运行相关回归并确认 GREEN**

Run: `pnpm exec vitest run src/__tests__/lib/simple-chat-request-context.test.ts src/__tests__/components/simple-chat-request-context-integration.test.ts src/__tests__/components/simple-chat-model-selector-contract.test.ts src/__tests__/components/simple-chat-sse-integration.test.ts src/__tests__/lib/simple-chat-sse.test.ts`

Expected: PASS。

- [ ] **Step 5: 提交请求快照修复**

```bash
git add src/components/simple-chat/chat-area.tsx src/__tests__/components/simple-chat-request-context-integration.test.ts
git commit -m "fix: snapshot simple chat request models"
```

---

### Task 6: 建立真实浏览器回归门禁

**Files:**
- Create: `tests/e2e/stage5-simple-chat-gate.spec.ts`

**Interfaces:**
- Consumes: V5.8.8 只读 donor 的 100 消息、会话切换和 SSE error 场景。
- Produces: 当前线的模型点击、请求体一致性和失效图片排除浏览器门禁。

- [ ] **Step 1: 复制 donor 门禁的有效部分并保持账号硬门禁**

Copy the login isolation, 100-message rendering, conversation switching and SSE error cases from:

`J:\无界云端0820\tests\e2e\stage5-simple-chat-gate.spec.ts`

Keep `requireRealEnvironment()` unchanged in meaning: missing real E2E credentials must fail, not silently skip.

- [ ] **Step 2: 增加模型点击和请求体断言**

```ts
await page.route('**/api/models?type=chat', route => route.fulfill({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify({
    models: [
      { id: 'gemini-test', name: 'Gemini Test', providerId: 'provider-a' },
      { id: 'gpt-test', name: 'GPT Test', providerId: 'provider-b' },
    ],
    providers: [
      { id: 'provider-a', name: 'Provider A' },
      { id: 'provider-b', name: 'Provider B' },
    ],
  }),
}));

let submittedBody: Record<string, unknown> | null = null;
await page.route('**/api/simple-chat/chat', async route => {
  submittedBody = route.request().postDataJSON();
  await route.fulfill({
    status: 200,
    headers: { 'Content-Type': 'text/event-stream; charset=utf-8' },
    body: 'data: {"type":"text","content":"OK"}\n\ndata: [DONE]\n\n',
  });
});

await page.getByRole('button', { name: 'Gemini Test' }).click();
await page.getByRole('option', { name: /GPT Test/ }).click();
await expect(page.getByRole('button', { name: 'GPT Test' })).toBeVisible();
```

After sending, assert `submittedBody.model === 'gpt-test'` and `submittedBody.providerId === 'provider-b'`.

- [ ] **Step 3: 增加长对话菜单遮挡回归**

Seed enough messages to fill and scroll the conversation. Open the chat model menu and then the image model menu. For each menu:

1. Assert the listbox is visible and its bounding box intersects the viewport.
2. Use `document.elementFromPoint()` at the center of a visible option and assert the hit target belongs to that option, not to a message bubble.
3. Scroll the listbox and select a non-first option.
4. Capture a screenshot with the open menu as regression evidence.

Repeat the visibility and hit-target check with the configured mobile viewport. Horizontal overflow or top clipping is a failure.

- [ ] **Step 4: 增加失效历史图片排除断言**

Seed a task whose previous user message has `images: ['data:image/png;base64,broken']`, send a text-only message, and assert no request message contains that image. Assert the non-blocking text `已忽略 1 张失效历史图片` is visible.

- [ ] **Step 5: 运行 Playwright 门禁**

Run when a local production server and isolated credentials are available:

```bash
E2E_BASE_URL=http://127.0.0.1:5000 \
E2E_TEST_USERNAME=<isolated-user> \
E2E_TEST_PASSWORD=<isolated-password> \
pnpm exec playwright test tests/e2e/stage5-simple-chat-gate.spec.ts --project=chromium
```

Expected: all tests PASS; failures retain screenshot, video and trace. If credentials are absent, record this command as blocked and do not report it as passed.

- [ ] **Step 6: 提交浏览器门禁**

```bash
git add tests/e2e/stage5-simple-chat-gate.spec.ts
git commit -m "test: add simple chat browser regression gate"
```

---

### Task 7: 执行全量本地质量门禁

**Files:**
- No production edits unless a concrete regression failure proves they are required.

**Interfaces:**
- Consumes: Tasks 1-6.
- Produces: 可推送的本地验证证据。

- [ ] **Step 1: 运行相关测试**

Run:

```bash
pnpm exec vitest run \
  src/__tests__/lib/simple-chat-request-context.test.ts \
  src/__tests__/components/simple-chat-request-context-integration.test.ts \
  src/__tests__/components/simple-chat-model-selector-contract.test.ts \
  src/__tests__/components/simple-chat-sse-integration.test.ts \
  src/__tests__/lib/simple-chat-sse.test.ts
```

Expected: all PASS。

- [ ] **Step 2: 运行全量门禁**

Run in order:

```bash
pnpm test
pnpm ts-check
pnpm lint:build
pnpm build
pnpm check:protected-baseline
```

Expected: Vitest 全部通过；缺少 `POSTGRES_TEST_DATABASE_URL` 的 PostgreSQL 专项只能标记为未验证；TypeScript、ESLint、Next build 和受保护基线全部退出码 0。

- [ ] **Step 3: 核对分支边界**

```bash
git diff --check
git status --short
git rev-parse HEAD
git rev-parse origin/stable
```

Expected: 仅保留既有未跟踪目录；`origin/stable` 仍为 `52f7c601ed150769e15d06fb435c6e360e28c9e7`。

---

### Task 8: 更新测试记录、吸收清单并推送 main

**Files:**
- Modify: `docs/testing/BUG_REGISTER.md`
- Modify: `docs/testing/REGRESSION_REPORT.md`
- Modify: `docs/testing/RELEASE_READINESS_REPORT.md`
- Modify: `docs/testing/UNVERIFIED_ITEMS.md`
- Modify: `docs/plans/v588/V588_ABSORPTION_INVENTORY.md`.

**Interfaces:**
- Consumes: fresh Task 7 command output.
- Produces: 中文审计记录 and pushed `origin/main`.

- [ ] **Step 1: 记录事实而非扩大结论**

Record exact commit, test time, commands, pass/fail counts, PostgreSQL/E2E blockers and cloud URL. Mark the menu stacking change as `选择性吸收 V5.8.8`，and mark model-state/history-image changes as `donor 同样存在缺陷；当前线独立修复` rather than claiming the whole batch was absorbed.

- [ ] **Step 2: 运行文档契约和差异检查**

Run:

```bash
pnpm exec vitest run src/__tests__/docs
git diff --check
```

Expected: PASS and no whitespace errors.

- [ ] **Step 3: 提交审计记录**

```bash
git add docs/testing docs/superpowers
git commit -m "docs: record simple chat context regression"
```

- [ ] **Step 4: 推送并验证远端**

```bash
git push origin main
git rev-parse HEAD
git rev-parse origin/main
git rev-parse origin/stable
```

Expected: `HEAD == origin/main`; stable SHA unchanged.

---

### Task 9: Coze 精确同步和 Chrome 云端验收

**Files:**
- Create evidence under: `docs/testing/evidence/` only when the repository's existing evidence naming convention requires checked-in artifacts.
- Modify reports from Task 8 only after real evidence exists.

**Interfaces:**
- Consumes: exact pushed `origin/main` SHA.
- Produces: Stage 4 cloud pass or precise unresolved blocker.

- [ ] **Step 1: 在现有 Google Chrome Coze 项目标签页精确拉取**

Require Coze to report full `HEAD`/`origin/main`, unchanged `origin/stable`, clean status, build exit 0, 5000 PID, `/`, `/simple-chat`, `/api/auth/me`, and all referenced static asset statuses. Do not open a new Chrome tab.

- [ ] **Step 2: 独立验证线上构建签名**

Fetch `/simple-chat` and its referenced first-party JavaScript assets. Assert at least one asset contains `SIMPLE_CHAT_SSE_MALFORMED` and the new request-context implementation signature; all referenced first-party assets must return 200.

- [ ] **Step 3: 真实验证模型选择**

In the existing logged-in Chrome preview tab:

1. Create a clean conversation.
2. Select a different APIMart model.
3. Reopen the menu and assert the selected option changed.
4. In a long conversation, verify both model menus render above message bubbles, remain scrollable and accept clicks.
5. Send a unique marker.
6. Verify the actual request and resulting message use the selected provider/model pair.

If APIMart returns `get_channel_failed`, model selection consistency may pass, but supplier success remains `未验证`.

- [ ] **Step 4: 真实验证失效历史图片隔离**

Use the historical conversation that previously produced `decode base64 image data failed`, send a text-only marker, and verify the invalid image is ignored, the request is sent without it, the page does not enter permanent loading, and the supplier no longer returns a base64 decoding error.

- [ ] **Step 5: 真实验证 CanvasEditor 与 Deep Research**

Verify CanvasEditor changes only the selected text and preserves the rest; verify Deep Research shows phase updates and a terminal result or a truthful supplier error. Capture Console errors/warnings and ensure no duplicate requests or native error dialogs.

- [ ] **Step 6: 更新最终云端结论**

Only mark V588-CHAT-001 closed when model selection, both model menus' non-occlusion, invalid history isolation, ordinary chat, CanvasEditor and Deep Research have real evidence. Otherwise keep the exact item in `UNVERIFIED_ITEMS.md` and do not announce Stage 4 complete.

---

## Plan Self-Review Result

- Spec coverage: model/provider atomicity, model-menu stacking, current-image blocking, history-image filtering, immutable history, three request snapshots, error separation, local gates, cloud evidence and branch boundaries all map to Tasks 1-9.
- Placeholder scan: no `TBD`、`TODO`、`FIXME` or unspecified file paths remain.
- Type consistency: all tasks use `SimpleChatModelSelection`, `modelId`, `providerId`, `accepted`, `rejectedCount`, `messages`, `images`, and `messageIds` consistently.
- Scope: no administrator configuration, provider auto-fallback, layout redesign beyond restoring the proven header stacking context, V5.8.8 write, database migration or `stable` modification is included.

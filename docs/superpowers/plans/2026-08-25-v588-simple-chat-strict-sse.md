# V5.8.8 Simple Chat 严格 SSE 吸收实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `simple-chat` 的普通对话、画布 AI 修图和 Deep Research 接入同一套严格 SSE 解析器，消除分块解析缺陷与画布修图错误接线，并完成本地与 Coze 云端闭环验证。

**Architecture:** 在 `src/lib/simple-chat-sse.ts` 建立不理解业务事件的纯协议层，统一增量 UTF-8 解码、SSE 事件恢复、严格 JSON 解析、`[DONE]` 收尾和取消。`chat-area.tsx` 的三个入口只保留原有业务分派；CanvasEditor 直接连接已有三参数 `canvasAiEdit`，删除重复的非流式内联请求。

**Tech Stack:** TypeScript 5、React 19、Next.js 16、Web Streams API、Vitest 3、ESLint、Google Chrome、Coze 云端沙箱。

## Global Constraints

- 固定 `J:\无界云端0820` 的 V5.8.8 为只读 donor，不向该目录写入文件。
- 仅修改并推送 `main`；`stable` 必须保持 `52f7c601ed150769e15d06fb435c6e360e28c9e7` 不变。
- 严格采用方案 A：非空、非 `[DONE]` 的畸形 JSON 事件立即失败，禁止静默跳过。
- 不改变模型、供应商、任务、积分、项目同步和资产所有权。
- 保留当前 `AssetVersion -> /api/assets/transfer` 画布传输链路。
- 不复制 donor 的原始 URL `localStorage` 桥接。
- 不使用固定长时间 sleep；等待明确的流事件、网络完成或界面状态。
- 云端付费验证仅使用 PearAPI 或 APIMART；FHL、虚宝和 4SAPI 不参与测试。
- 不创建新的浏览器标签页，只使用已打开的 Google Chrome Coze 项目页和预览页。
- 每个实现任务严格执行 RED → GREEN；不得跳过失败测试。

---

### Task 1: 共享严格 SSE 协议层

**Files:**
- Create: `src/lib/simple-chat-sse.ts`
- Create: `src/__tests__/lib/simple-chat-sse.test.ts`

**Interfaces:**
- Produces: `SimpleChatSseEvent`
- Produces: `SimpleChatSseProtocolError`，`code === 'SIMPLE_CHAT_SSE_MALFORMED'`
- Produces: `SimpleChatSseDecoder.push(chunk: Uint8Array): SimpleChatSseEvent[]`
- Produces: `SimpleChatSseDecoder.finish(): SimpleChatSseEvent[]`
- Produces: `consumeSimpleChatJsonStream(stream, options): Promise<'completed' | 'cancelled'>`
- `options.onEvent` receives a parsed JSON value; `options.isActive` optionally stops stale requests.

- [ ] **Step 1: Write the failing decoder tests**

Create `src/__tests__/lib/simple-chat-sse.test.ts` with real `TextEncoder` chunks and a real `ReadableStream`. Cover these independent cases:

```ts
import { describe, expect, it, vi } from 'vitest';
import {
  SimpleChatSseDecoder,
  SimpleChatSseProtocolError,
  consumeSimpleChatJsonStream,
} from '@/lib/simple-chat-sse';

const encoder = new TextEncoder();

function byteChunks(...values: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const value of values) controller.enqueue(encoder.encode(value));
      controller.close();
    },
  });
}

describe('SimpleChatSseDecoder', () => {
  it('reassembles JSON split across arbitrary byte chunks', () => {
    const decoder = new SimpleChatSseDecoder();
    expect(decoder.push(encoder.encode('data: {"type":"te'))).toEqual([]);
    expect(decoder.push(encoder.encode('xt","content":"ok"}\n\n')))
      .toEqual([{ data: '{"type":"text","content":"ok"}' }]);
  });

  it('supports CRLF, comments, event, id and multiline data', () => {
    const decoder = new SimpleChatSseDecoder();
    const events = decoder.push(encoder.encode(
      ':heartbeat\r\nevent: message\r\nid: 7\r\ndata: {"type":"text",\r\ndata: "content":"ok"}\r\n\r\n',
    ));
    expect(events).toEqual([{
      event: 'message',
      id: '7',
      data: '{"type":"text",\n"content":"ok"}',
    }]);
  });

  it('preserves a Chinese UTF-8 character split between byte chunks', () => {
    const bytes = encoder.encode('data: {"type":"text","content":"中文"}\n\n');
    const split = bytes.findIndex((value, index) => index > 0 && value >= 0x80);
    const decoder = new SimpleChatSseDecoder();
    expect(decoder.push(bytes.slice(0, split + 1))).toEqual([]);
    expect(decoder.push(bytes.slice(split + 1))).toEqual([
      { data: '{"type":"text","content":"中文"}' },
    ]);
  });

  it('returns every complete event from one chunk', () => {
    const decoder = new SimpleChatSseDecoder();
    expect(decoder.push(encoder.encode('data: {"n":1}\n\ndata: {"n":2}\n\n')))
      .toEqual([{ data: '{"n":1}' }, { data: '{"n":2}' }]);
  });

  it('flushes an event without a trailing newline', () => {
    const decoder = new SimpleChatSseDecoder();
    decoder.push(encoder.encode('data: {"tail":true}'));
    expect(decoder.finish()).toEqual([{ data: '{"tail":true}' }]);
  });
});

describe('consumeSimpleChatJsonStream', () => {
  it('stops cleanly at DONE and ignores late events', async () => {
    const onEvent = vi.fn();
    await expect(consumeSimpleChatJsonStream(
      byteChunks('data: {"n":1}\n\ndata: [DONE]\n\ndata: {"n":2}\n\n'),
      { onEvent },
    )).resolves.toBe('completed');
    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onEvent).toHaveBeenCalledWith({ n: 1 });
  });

  it('fails fast on malformed non-empty JSON', async () => {
    await expect(consumeSimpleChatJsonStream(
      byteChunks('data: {"broken":\n\n'),
      { onEvent: vi.fn() },
    )).rejects.toMatchObject<Partial<SimpleChatSseProtocolError>>({
      name: 'SimpleChatSseProtocolError',
      code: 'SIMPLE_CHAT_SSE_MALFORMED',
    });
  });

  it('does not swallow callback failures', async () => {
    const failure = new Error('business handler failed');
    await expect(consumeSimpleChatJsonStream(
      byteChunks('data: {"n":1}\n\n'),
      { onEvent: () => { throw failure; } },
    )).rejects.toBe(failure);
  });

  it('cancels a stale request before dispatching later events', async () => {
    let active = true;
    const onEvent = vi.fn(() => { active = false; });
    await expect(consumeSimpleChatJsonStream(
      byteChunks('data: {"n":1}\n\n', 'data: {"n":2}\n\n'),
      { onEvent, isActive: () => active },
    )).resolves.toBe('cancelled');
    expect(onEvent).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run the focused tests and capture RED**

Run:

```powershell
pnpm exec vitest run src/__tests__/lib/simple-chat-sse.test.ts
```

Expected: FAIL because `@/lib/simple-chat-sse` does not exist. Save the failing test count and error text in the implementation notes before creating production code.

- [ ] **Step 3: Implement the minimal protocol layer**

Create `src/lib/simple-chat-sse.ts` with these exact public contracts:

```ts
export interface SimpleChatSseEvent {
  data: string;
  event?: string;
  id?: string;
}

export interface ConsumeSimpleChatJsonStreamOptions {
  onEvent: (value: unknown) => void | Promise<void>;
  isActive?: () => boolean;
}

export class SimpleChatSseProtocolError extends Error {
  readonly code = 'SIMPLE_CHAT_SSE_MALFORMED' as const;
  readonly preview: string;

  constructor(rawData: string) {
    super('流式响应格式异常，请重试。');
    this.name = 'SimpleChatSseProtocolError';
    this.preview = rawData.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 200);
  }
}

export class SimpleChatSseDecoder {
  push(chunk: Uint8Array): SimpleChatSseEvent[];
  finish(): SimpleChatSseEvent[];
}

export async function consumeSimpleChatJsonStream(
  stream: ReadableStream<Uint8Array>,
  options: ConsumeSimpleChatJsonStreamOptions,
): Promise<'completed' | 'cancelled'>;
```

Implementation rules:

- Keep one streaming `TextDecoder`, one undecoded text buffer and current `data/event/id` fields.
- Treat LF, CR and CRLF as valid line endings; when a chunk ends in CR, wait for the next chunk before deciding whether it is CRLF.
- Remove at most one leading ASCII space after `:`.
- Join multiple `data` fields with `\n`.
- Dispatch only events with at least one `data` field.
- `finish()` flushes `TextDecoder.decode()`, processes the final unterminated line, dispatches the tail event and then becomes idempotent.
- `consumeSimpleChatJsonStream` checks `isActive` after each read and before each callback, cancels stale readers, stops at `[DONE]`, uses `JSON.parse`, throws `SimpleChatSseProtocolError` on parse failure, and releases the reader lock in `finally`.

- [ ] **Step 4: Run the focused tests and capture GREEN**

Run the same Vitest command. Expected: all new parser tests pass with no warning or unhandled rejection.

- [ ] **Step 5: Commit Task 1**

```powershell
git add -- src/lib/simple-chat-sse.ts src/__tests__/lib/simple-chat-sse.test.ts
git diff --cached --check
git commit -m "feat: add strict simple chat sse parser"
```

---

### Task 2: Three-entry integration and CanvasEditor wiring

**Files:**
- Modify: `src/components/simple-chat/chat-area.tsx:635-674`
- Modify: `src/components/simple-chat/chat-area.tsx:882-1001`
- Modify: `src/components/simple-chat/chat-area.tsx:1050-1090`
- Modify: `src/components/simple-chat/chat-area.tsx:2198-2219`
- Create: `src/__tests__/components/simple-chat-sse-integration.test.ts`

**Interfaces:**
- Consumes: `consumeSimpleChatJsonStream` from Task 1.
- Preserves: all existing ordinary-chat event branches and `requestScopeIsCurrent` stale-request behavior.
- Preserves: Deep Research `phase`, `text`, `citations` behavior.
- Produces: `CanvasEditor.onAiEdit={canvasAiEdit}` with argument order `(instruction, currentContent, selectedText)`.

- [ ] **Step 1: Write the failing integration contract**

Create a source contract test that reads `chat-area.tsx` and asserts:

```ts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(process.cwd(), 'src/components/simple-chat/chat-area.tsx'),
  'utf8',
);

describe('simple-chat strict SSE integration', () => {
  it('uses the shared consumer in all three streaming entries', () => {
    expect(source).toContain("from '@/lib/simple-chat-sse'");
    expect(source.match(/consumeSimpleChatJsonStream\(/g)).toHaveLength(3);
    expect(source).not.toContain("buffer.split('\\n')");
    expect(source).not.toContain('catch { /* skip */ }');
  });

  it('connects CanvasEditor to the three-argument streaming editor', () => {
    expect(source).toContain('onAiEdit={canvasAiEdit}');
    expect(source).not.toContain('stream: false');
    expect(source).toContain(
      'async function canvasAiEdit(instruction: string, currentContent: string, selectedText: string)',
    );
  });
});
```

- [ ] **Step 2: Run the integration test and capture RED**

```powershell
pnpm exec vitest run src/__tests__/components/simple-chat-sse-integration.test.ts
```

Expected: FAIL because the shared import/calls are absent, old split loops remain and CanvasEditor still uses the duplicate callback.

- [ ] **Step 3: Replace only the three protocol loops**

At the top of `chat-area.tsx`, import:

```ts
import {
  SimpleChatSseProtocolError,
  consumeSimpleChatJsonStream,
} from '@/lib/simple-chat-sse';
```

For each response body:

- Throw the existing no-body error before calling the helper.
- Pass the response body to `consumeSimpleChatJsonStream`.
- Move the existing `if/else` business event logic into `onEvent` after narrowing the parsed value to a non-null object.
- In ordinary chat, pass `isActive: requestScopeIsCurrent`; return early when the helper result is `cancelled`.
- Remove only `TextDecoder`, `buffer`, `reader.read`, `split`, JSON parse and empty catches.
- Preserve `fullContent`, phase labels, attachment registration, generation controls and all setState calls.
- When catching `SimpleChatSseProtocolError`, use its Chinese message; preserve current generic messages for network and HTTP errors.

- [ ] **Step 4: Connect the real CanvasEditor callback**

Replace the duplicated inline `onAiEdit={async (...) => ...}` block with:

```tsx
onAiEdit={canvasAiEdit}
```

Do not change `CanvasEditorProps`; it already declares the correct three-argument contract and displays rejected errors through `toast.error`.

- [ ] **Step 5: Run integration and related tests**

```powershell
pnpm exec vitest run `
  src/__tests__/lib/simple-chat-sse.test.ts `
  src/__tests__/components/simple-chat-sse-integration.test.ts `
  src/__tests__/components/simple-chat-layout-contract.test.ts `
  src/__tests__/components/simple-chat-model-selector-contract.test.ts `
  src/__tests__/components/simple-chat-asset-transfer.test.ts `
  src/__tests__/api/simple-chat-auth.test.ts
```

Expected: all selected tests pass; no failure is skipped.

- [ ] **Step 6: Commit Task 2**

```powershell
git add -- src/components/simple-chat/chat-area.tsx src/__tests__/components/simple-chat-sse-integration.test.ts
git diff --cached --check
git commit -m "fix: unify simple chat stream parsing"
```

---

### Task 3: Local quality gates and regression evidence

**Files:**
- Modify after evidence exists: `docs/testing/REGRESSION_REPORT.md`
- Modify after evidence exists: `docs/testing/RELEASE_READINESS_REPORT.md`
- Modify after evidence exists: `docs/testing/UNVERIFIED_ITEMS.md`
- Modify after evidence exists: `docs/plans/v588/V588_ABSORPTION_INVENTORY.md`

**Interfaces:**
- Consumes: Task 1 and Task 2 commits.
- Produces: reproducible local evidence; does not mark cloud verification complete.

- [ ] **Step 1: Run full Vitest**

```powershell
pnpm test
```

Record passed, failed and environment-gated skipped counts exactly.

- [ ] **Step 2: Run static and build gates**

```powershell
pnpm ts-check
pnpm exec eslint src/lib/simple-chat-sse.ts src/components/simple-chat/chat-area.tsx src/__tests__/lib/simple-chat-sse.test.ts src/__tests__/components/simple-chat-sse-integration.test.ts --max-warnings=0
pnpm build
node scripts/check-protected-baseline.mjs --base 7fdc0108952fb3a68415ca3a2a26b5d33641dc6b --allow-path-file docs/testing/baselines/protected-baseline-allowed-paths.json
git diff --check
```

All commands must exit 0. If any fail, fix the concrete cause and rerun both focused and full gates.

- [ ] **Step 3: Update Chinese local evidence**

In the four listed documents record:

- exact commit candidate;
- RED failure count and reason;
- GREEN focused and related counts;
- full test, TypeScript, ESLint, build and protected-baseline results;
- discovered CanvasEditor parameter-order defect and its minimal correction;
- `V588-CHAT-001` status as “本地已吸收，云端待验”，not “完成”.

- [ ] **Step 4: Commit docs and push main**

```powershell
git add -- docs/plans/v588/V588_ABSORPTION_INVENTORY.md docs/testing/REGRESSION_REPORT.md docs/testing/RELEASE_READINESS_REPORT.md docs/testing/UNVERIFIED_ITEMS.md
git diff --cached --check
git commit -m "docs: record simple chat sse local regression"
git push origin main
```

After push, verify `git rev-parse origin/stable` remains the Global Constraints hash.

---

### Task 4: Coze deployment and real Chrome acceptance

**Files:**
- Create after execution: `docs/testing/evidence/v588-chat-001-cloud-2026-08-25.json`
- Create after execution: screenshots under `docs/testing/evidence/`
- Modify after execution: the four Task 3 status documents.

**Interfaces:**
- Consumes: exact pushed `origin/main` commit.
- Produces: cloud evidence proving the three live entries, no native dialog and clean console/network terminal states.

- [ ] **Step 1: Pull exact main in the existing Coze project tab**

Use the existing Google Chrome project tab `https://code.coze.cn/p/7671964106919837702/preview`. If the sandbox-disconnected dialog appears, click its refresh action, wait for the sandbox to be ready, pull the exact `origin/main` commit and restart. Do not create a new tab and do not use 360 Browser.

- [ ] **Step 2: Refresh and identify the exact preview build**

Force-refresh the existing preview tab `https://62afe49a-716e-4d9e-99cd-a0be49c4794c-5000.dev.coze.site/`. Verify authentication remains valid, root returns 200 and the deployed commit/build identifier matches Task 3.

- [ ] **Step 3: Verify ordinary chat**

Using an administrator-configured PearAPI or APIMART chat model:

- submit one short Chinese prompt;
- observe at least two incremental text updates before completion;
- verify the final message is complete and streaming state ends;
- capture request, response content type, terminal event, screenshot and console/network logs.

- [ ] **Step 4: Verify CanvasEditor AI editing**

- open the simple-chat writing canvas;
- enter a distinguishable original sentence;
- select a distinguishable substring;
- request a small rewrite;
- verify the provider receives the original/selection/instruction in the correct roles;
- verify only the selected portion is replaced and the version history gains one entry;
- verify malformed/error response does not overwrite content and produces a visible error.

- [ ] **Step 5: Verify Deep Research**

- submit one bounded research query;
- observe phase, incremental text and citations/artifact terminal state;
- verify loading ends and no partial result is falsely marked successful;
- capture screenshot, stream/network evidence and console logs.

- [ ] **Step 6: Verify browser health and branch invariant**

Across all three flows assert:

- no unhandled Console Error or Promise rejection;
- no native browser error dialog;
- no permanent loading;
- no duplicate request caused by one click;
- `stable` hash is unchanged.

- [ ] **Step 7: Save evidence and close the inventory item**

Write the evidence JSON with test time, URL, Git commit, build ID, browser, provider/model, requests, terminal states, screenshots and console/network counts. Update the four Chinese status documents to “已吸收并完成云端验证” only if every required assertion passes; otherwise preserve the exact blocker as “未验证/不通过”. Commit and push only these evidence and documentation files.

---

## Plan Self-Review Result

- Spec coverage: strict parser、三入口、画布接线、取消、隐私、本地门禁、云端验收和分支保护均有对应任务。
- Placeholder scan: no `TBD`、`TODO`、模糊“稍后处理”或缺失命令。
- Type consistency: Task 1 public contracts与 Task 2 consumption names一致；Task 3/4不引入新 runtime interface。
- Scope check: plan only implements `V588-CHAT-001`; `CHAT-002` 至 `CHAT-004` remain separate future items.

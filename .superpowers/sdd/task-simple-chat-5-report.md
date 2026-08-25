# Task 5 Report: Simple Chat Request Model Snapshots

## Scope

Implemented on `main` from `aa454affaf6dc1f8e2bcd14113631428b788b72b`. The stable comparison point remains `52f7c601ed150769e15d06fb435c6e360e28c9e7`. No donor worktree was modified.

## Changes

- `canvasAiEdit`, `handleSend`, and `handleDeepResearch` each capture one immutable `requestModelSelection` from the active `SimpleChatTask` before request side effects.
- Every path validates both `modelId` and `providerId` before sending. Ordinary chat and Deep Research expose `请先选择可用的对话模型。`; CanvasEditor receives the same throwable error for its existing toast handling.
- Ordinary chat now uses the snapshot for the chat request, assistant-message metadata, and request task/project metadata. The active-agent id is also captured before attachment registration, so the request path does not re-read task state after its first await.
- Deep Research now persists the snapshot pair on its assistant message and sends that same pair in its request body.
- CanvasEditor sends the snapshot pair in its real `/api/simple-chat/chat` request.
- Existing Task 4 task/project scope checks remain in place before history rebuilding, submission, stream updates, errors, and completion state updates.

## Test Coverage

- Added a snapshot-contract assertion for all three request paths.
- Added a missing-selection ordinary-chat behavior test, asserting a visible error and no network submission.
- Added a deferred Brand DNA same-task model-switch test: the in-flight request and persisted assistant metadata keep the start pair, while the following request uses the newly selected pair.
- Added real component interaction coverage for CanvasEditor and Deep Research request bodies; Deep Research also verifies persisted assistant metadata.

## RED to GREEN

RED against `aa454aff`: 3 failures in `simple-chat-request-context-integration.test.tsx` (the required three snapshots were absent, incomplete selection submitted, and Deep Research did not persist model/provider metadata).

GREEN verification:

```text
pnpm exec vitest run src/__tests__/lib/simple-chat-request-context.test.ts src/__tests__/components/simple-chat-request-context-integration.test.tsx src/__tests__/components/simple-chat-model-selector-contract.test.ts src/__tests__/components/simple-chat-sse-integration.test.ts src/__tests__/lib/simple-chat-sse.test.ts
5 files passed, 28 tests passed

pnpm ts-check
passed

pnpm exec eslint src/components/simple-chat/chat-area.tsx src/__tests__/components/simple-chat-request-context-integration.test.tsx
0 errors; 40 pre-existing warnings in chat-area.tsx
```

No open test handles were reported by Vitest.

## Concerns

- Targeted ESLint remains warning-only because `chat-area.tsx` has 40 existing warnings, none introduced by this task.
- The repository had pre-existing modified/untracked `.superpowers` and `.playwright-cli` files; they were left untouched.

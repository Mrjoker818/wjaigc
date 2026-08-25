# Task 4 报告：简单聊天图片请求校验接线

## 范围

- 分支：`main`
- 开始提交：`2f9dd4d62aba3915c5354d53da3f2bc1bcbcd9bf`
- 稳定基线：`52f7c601ed150769e15d06fb435c6e360e28c9e7`（只读，未修改）
- 修改文件：
  - `src/components/simple-chat/chat-area.tsx`
  - `src/__tests__/components/simple-chat-request-context-integration.test.tsx`
  - `.superpowers/sdd/task-simple-chat-4-report.md`

## RED

先新增真实 RTL 集成测试，并通过文件输入控件注入损坏的 `data:image/png;base64,not-valid` 上传图片；历史测试则以同一损坏图片作为持久化用户消息。

首次运行因 Vitest 进程的 `localStorage` 非浏览器实现而在组件挂载阶段报 `localStorage.setItem is not a function`，未进入被测提交路径。测试夹具补齐内存 `localStorage` 后重跑，获得预期的产品级 RED：

1. 当前损坏上传没有显示“当前上传图片无效，请重新选择图片后发送。”，旧 `handleSend` 会继续进入提交流程。
2. `/api/simple-chat/chat` 请求中历史消息仍含 `images: ['data:image/png;base64,not-valid']`，断言期望 `undefined`、实际收到该无效图片。

## 实现

`ChatArea.handleSend` 在 `setIsStreaming(true)`、附件登记和聊天请求之前调用 `filterSimpleChatImageInputs(uploadedImages.map(attachment => attachment.url || ''))`。只要当前上传存在拒绝项，即显示明确提示并提前返回；已验证的当前附件仍按原始顺序交给既有 `registerChatAttachment` 与 `alignSimpleChatMediaSlots`。

历史请求改用 `buildSimpleChatHistoryRequestContext(messages)`：

- `historyImages` 只使用 helper 返回的已接受历史图片。
- 请求副本只映射 helper 返回的消息，保留最近三个含图用户轮次的语义。
- 历史失效图片仅从请求副本移除，不调用 `setMessages` 改写持久化消息。
- 历史拒绝项显示独立、非阻塞的 Agent 栏提示；下一次无拒绝历史的请求会清除此提示。
- 未引入本地聊天模型状态，继续使用 Task 3 的任务派生 `selectedModel` 与 `selectedProviderId`。

## 覆盖

新增 RTL 集成测试验证：

1. 已选择目标画布时，当前无效上传阻止附件登记和聊天请求。
2. 历史无效图片不进入 `/api/simple-chat/chat`，当前文本仍发送，且父级持久化任务中的历史 `images` 保持原样。

Task 2 helper 既有测试覆盖严格 base64、媒体签名以及超过 4096 字符的有效 data 图片；本任务仅接线，不改变该校验规则。

## 验证

```text
pnpm exec vitest run src/__tests__/lib/simple-chat-request-context.test.ts src/__tests__/components/simple-chat-request-context-integration.test.tsx src/__tests__/components/simple-chat-model-selector-contract.test.ts src/__tests__/components/simple-chat-workflow-return-race.test.tsx
4 files passed, 12 tests passed

pnpm ts-check
exit 0

pnpm exec eslint src/components/simple-chat/chat-area.tsx src/__tests__/components/simple-chat-request-context-integration.test.tsx
exit 0; 40 existing warnings in chat-area.tsx, 0 errors
```

## 关注项

目标组件本身已有 40 条 ESLint 警告（未使用变量、Hook 依赖和 `img` 规则）；本任务未修改这些现有问题。未改动供应商回退、管理员设置、稳定分支或其他未跟踪路径。

## 状态检查（2026-08-25）

提交 `eff448656e4dd0ca709088018cb158740b887f1a` 已存在于 `main`。检查未发现命令行包含 `_upstream-wjaigc-restore` 或 `vitest` 的 Node/Vitest 进程，因此没有遗留测试进程或需要终止的开放句柄。最近一次 focused Vitest 命令已正常退出，结果为 4 个测试文件、12 个测试全部通过；未发现测试挂起问题。

## Fix Review（2026-08-25）

### TDD RED

以 `eff44865` 为基线先扩展 RTL 测试：

- 当前无效上传被拒绝后，Deep Research 控件仍可用；移除无效附件后，重新上传签名有效 PNG 必须完成资产登记与主聊天请求，并保留登记返回的图片 URL、`sourceVersionIds` 和 `selectedEntityIds`。
- 历史消息同时包含无效和有效图片时，只发送有效图片；失效提示只出现一次，随后切换到另一 `task.id` 必须清除提示和“将携带最近对话中的 1 张图片作为上下文”指示器。

执行 `pnpm exec vitest run src/__tests__/components/simple-chat-request-context-integration.test.tsx` 得到预期 RED：2 个测试中 1 个失败。失败断言为切换任务后页面文本仍包含“已忽略 1 张失效历史图片，本次请求继续发送。”；因此确认 `historyImageNotice` 未随 `task.id` 变化复位。有效上传重试、资产登记和媒体槽对齐断言在基线行为下已通过。

### 实现与 GREEN

提交 `82a0d44291ee05911461583579125f078964f194` 在既有 `task?.id` 同步 effect 中仅增加：

```ts
setHistoryImages([]);
setHistoryImageNotice(null);
```

重新执行 focused suite，正常退出并通过：4 个测试文件、12 个测试。

```text
pnpm exec vitest run src/__tests__/lib/simple-chat-request-context.test.ts src/__tests__/components/simple-chat-request-context-integration.test.tsx src/__tests__/components/simple-chat-model-selector-contract.test.ts src/__tests__/components/simple-chat-workflow-return-race.test.tsx
4 files passed, 12 tests passed

pnpm ts-check
exit 0

pnpm exec eslint src/components/simple-chat/chat-area.tsx src/__tests__/components/simple-chat-request-context-integration.test.tsx
exit 0; 40 existing warnings in chat-area.tsx, 0 errors
```

### 自检

- 任务切换只复位显示/上下文派生状态；不改写持久化消息或附件登记行为。
- RTL 覆盖通过真实文件输入、附件删除按钮、目标画布选择、资产登记响应、聊天请求与父级任务切换验证行为。
- 复查未重新引入本地聊天模型状态，未触碰 provider fallback、stable、V5.8.8 donor 或无关文件。
- 所有 Vitest 命令均在限定等待内正常退出；未发现 Node/Vitest 开放句柄。

## Fix Review 2（2026-08-25）

### TDD RED

新增确定性 RTL 回归：启用 Brand DNA 后启动 Task A 发送，在动态 `@/lib/brand-dna` mock 保持 deferred 时切换至 Task B，再解析该 import。测试使用真实 `handleSend` 的“附件登记完成后、历史上下文构建前”异步边界，不使用 sleep。

对 `f5c5551` 运行：

```text
pnpm exec vitest run src/__tests__/components/simple-chat-request-context-integration.test.tsx
3 tests: 2 passed, 1 failed
```

精确失败为：断言 `fetch` 不应调用 `/api/simple-chat/chat`，但收到 Task A 的主请求，其 payload 包含 `taskId: "task-1"`、`content: "Task A historical question"` 和已接受的有效历史图片。该失败证明 Task A 在 Brand DNA import 恢复后越过了 Task B 切换，继续构建历史并提交请求。

### 修复与 GREEN

代码提交：`fd56ddc34e01c15caad7f900a6a001e600351fdd`。

在 Brand DNA `await import()` 块后、以及主聊天 `fetch` 构建前分别加入 `if (!requestScopeIsCurrent()) return;`。这两个 guard 保持 Task 3 的任务派生模型选择与既有依赖数组，不引入延迟、任务对象依赖或 provider 行为变化。

```text
pnpm exec vitest run src/__tests__/lib/simple-chat-request-context.test.ts src/__tests__/components/simple-chat-request-context-integration.test.tsx src/__tests__/components/simple-chat-model-selector-contract.test.ts src/__tests__/components/simple-chat-workflow-return-race.test.tsx
4 files passed, 13 tests passed

pnpm ts-check
exit 0

pnpm exec eslint src/components/simple-chat/chat-area.tsx src/__tests__/components/simple-chat-request-context-integration.test.tsx
exit 0; 40 existing warnings in chat-area.tsx, 0 errors
```

### 自检

- 测试确认 stale continuation 不发送 Task A 主请求，且 Task B 不出现 Task A 的历史失效提示或上下文指示器。
- dynamic mock 在测试结束时通过 `vi.doUnmock()` 清理；focused Vitest 正常退出，未发现开放句柄。
- 改动仅覆盖 ChatArea 的请求范围防护、同文件 RTL 测试和本报告；未触碰 stable、donor、provider fallback 或其他路径。

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

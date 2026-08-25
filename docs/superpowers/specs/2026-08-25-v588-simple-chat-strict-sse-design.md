# V5.8.8 Simple Chat 严格 SSE 吸收设计

## 1. 背景与目标

当前 `simple-chat` 的普通对话、画布 AI 修图和 Deep Research 在
`src/components/simple-chat/chat-area.tsx` 内各自维护一套基于
`TextDecoder + buffer.split('\n')` 的流式解析逻辑。三套实现都可能遗漏
CRLF、多行 `data`、任意网络分块、UTF-8 跨块字符和无结尾换行的尾事件，
并会静默吞掉无法解析的 JSON。

本设计对应吸收清单 `V588-CHAT-001`。目标是在不改变三条业务链路职责、
供应商选择、任务所有权、扣费逻辑和资产归属的前提下，引入一套共享、严格、
可独立测试的 SSE 解析层。

## 2. 已确认决策

采用严格失败方案 A：

- 空行、注释行和合法但无 `data` 的事件可以忽略。
- `data: [DONE]` 表示正常结束，不作为消息内容。
- 任意非空、非 `[DONE]` 的 `data` 事件若不是合法 JSON，立即抛出统一协议错误。
- 协议错误必须进入当前入口已有的失败处理，不允许静默跳过后继续拼接内容。
- 已经收到的部分文本可以保留，但本项不新增“失败消息原位重试”；该能力属于
  `V588-CHAT-002`。

选择严格失败的原因是：静默跳过损坏事件可能让用户看到被截断但标记为成功的
回答，也可能漏掉结构化错误、图片结果或研究引用。明确失败比伪成功更容易诊断，
也为后续确定性重试建立可靠前提。

## 3. 方案比较

### 方案 A：严格失败（采用）

所有畸形业务数据立即终止当前流，显示可理解的失败信息。优点是不会伪造成功，
错误可观测且测试边界明确；缺点是上游偶发插入一条损坏事件时，本次回答会失败。

### 方案 B：全部跳过

继续沿用 V5.8.8 宽松行为，忽略无法解析的事件。兼容性较强，但可能丢失正文、
图片、引用或错误事件，并把不完整结果误标为成功，因此不采用。

### 方案 C：按事件类型混合处理

已知正文和错误事件严格，未知事件宽松。由于事件类型本身位于 JSON 内，JSON 已
损坏时无法可靠判断它属于哪一类，规则会产生歧义，因此本阶段不采用。

## 4. 架构边界

### 4.1 共享协议层

新增 `src/lib/simple-chat-sse.ts`，只负责 SSE 协议和 JSON 数据解析：

- `SimpleChatSseDecoder`：增量接收 `Uint8Array`，维护 UTF-8 解码和事件缓冲。
- `push(chunk)`：返回当前分块内已经完整结束的 SSE 事件。
- `finish()`：冲刷 `TextDecoder` 和未以空行结束的尾事件，只允许调用一次。
- `parseSimpleChatJsonEventStrict(event)`：区分普通 JSON、`[DONE]` 和协议错误。
- `consumeSimpleChatJsonStream(stream, onEvent)`：统一读取流、处理 `[DONE]`、释放
  reader，并把解析后的 JSON 交给调用方。
- `SimpleChatSseProtocolError`：稳定错误类型，错误码固定为
  `SIMPLE_CHAT_SSE_MALFORMED`，日志只记录截断后的非敏感原始片段。

解析器支持：

- LF 与 CRLF；
- 注释、`event`、`id` 和多行 `data`；
- 任意字节分块与跨块 UTF-8 字符；
- 分块中包含多个事件；
- 没有末尾换行的最后一个事件；
- `[DONE]` 后停止消费，不处理迟到事件。

### 4.2 三个业务入口

当前文件中存在三套相关实现，但画布实现有一层额外的接线缺陷：
`canvasAiEdit(instruction, currentContent, selectedText)` 包含流式读取却没有被界面调用；
`CanvasEditor` 实际连接的是另一段 `stream: false` 的内联请求，而且两参数回调会把
组件传入的“修改指令、完整原文、选中文本”错误解释为“原文、修改指令”。

因此本项在 `src/components/simple-chat/chat-area.tsx` 中执行以下最小接入：

1. 将 `CanvasEditor.onAiEdit` 直接连接到现有三参数 `canvasAiEdit`，删除重复且参数
   顺序错误的非流式内联请求；
2. 将 `canvasAiEdit` 的手写 reader 循环替换为共享解析器；
3. 将普通对话的手写 reader 循环替换为共享解析器；
4. 将 Deep Research 的手写 reader 循环替换为共享解析器。

每个入口保留自己的事件分派和状态更新：`generation_controls`、
`search_status`、`tool_status`、正文、图片、阶段和引用仍由现有代码处理。共享层不
理解这些业务字段，也不修改模型、供应商、附件、提示词或任务参数。

## 5. 数据流

1. 当前入口按原逻辑发起 `fetch` 并验证 HTTP 状态。
2. 将 `response.body` 交给 `consumeSimpleChatJsonStream`。
3. 共享层按字节增量解码并恢复完整 SSE 事件。
4. 合法 JSON 事件逐条交给该入口现有回调。
5. 收到 `[DONE]` 或流正常结束后完成当前入口的既有收尾逻辑。
6. 遇到畸形 JSON 时抛出 `SimpleChatSseProtocolError`，由该入口外层 `catch`
   转换为用户可见的“流式响应格式异常，请重试”，同时保留控制台诊断码。

## 6. 错误、取消与隐私

- HTTP 非成功状态仍由现有代码处理，不归解析器改写。
- 合法的结构化 `error` 事件仍由现有业务分派处理。
- 畸形事件统一失败，不能 `catch {}` 后继续。
- 用户取消或组件卸载仍依赖现有 `AbortController`；共享 reader 必须在
  `finally` 中释放锁，不增加固定等待时间。
- 日志不得记录完整提示词、Access Token、API Key、用户图片或完整上游响应；
  原始事件片段最多保留 200 个字符并去除控制字符。

## 7. 明确不在本项实施的内容

- 不新增消息 `streaming/completed/failed` 状态和重试上下文；属于
  `V588-CHAT-002`。
- 不改变项目同步、冲突合并、离页冲刷；属于 `V588-CHAT-003`。
- 不复制 V5.8.8 的原始 URL `localStorage` 画布桥接。
- 不改变当前 `AssetVersion -> /api/assets/transfer` 的安全画布传输链路。
- 不新增发送到节点模式；属于 `V588-CHAT-004`。
- 不重写服务端路由、会话模型、供应商适配、积分或任务状态机。

## 8. 测试与验收

### 8.1 失败测试先行

新增纯单元测试覆盖：

- JSON 被拆成任意多个字节块；
- CRLF、注释、`event`、`id` 和多行 `data`；
- 中文 UTF-8 字符跨块；
- 同一块包含多个事件；
- 无末尾换行的尾事件；
- `[DONE]` 正常终止且忽略迟到事件；
- 非空畸形 JSON 抛出 `SIMPLE_CHAT_SSE_MALFORMED`；
- reader 正常释放，回调异常不被吞掉。

新增接入契约测试，证明三个入口都使用共享消费函数，且旧的
`buffer.split('\n')` 手写解析不再存在。契约还必须证明 `CanvasEditor.onAiEdit`
接收三参数并调用 `canvasAiEdit`，不再保留 `stream: false` 的重复内联请求。

### 8.2 本地门禁

按顺序执行：

1. 新增聚焦测试；
2. `simple-chat` 关联测试；
3. 全量 Vitest；
4. TypeScript 检查；
5. 变更文件 ESLint；
6. 生产构建；
7. 受保护功能与分支检查。

任何失败都必须保留并修复，不得通过跳过测试或增加长等待时间制造通过。

### 8.3 云端验收

只推送 `main`，`stable` 不得变化。Coze 拉取精确提交后，仅使用已经打开的
Google Chrome 项目页和预览页，不创建新标签页。真实验证：

1. 普通对话持续流式输出并正常结束；
2. 画布 AI 修图流式过程和结果可见；
3. Deep Research 阶段、正文和引用持续更新并正常结束；
4. 三入口均无未处理 Console Error、Promise rejection 或原生错误弹窗；
5. 通过受控测试响应验证畸形事件会进入明确失败，而不是显示残缺成功结果。

付费模型仅使用 PearAPI 或 APIMART，不使用 FHL、虚宝或 4SAPI。每次云端验收记录
Git Commit、部署地址、时间、截图、Console 和网络证据。

## 9. 完成标准

只有同时满足以下条件，`V588-CHAT-001` 才能标记为已吸收：

- 三套手写客户端 SSE 解析均由共享严格解析层替代；
- 所有新增失败测试经历 RED 后转为 GREEN；
- 本地全量质量门禁通过；
- `main` 精确提交完成 Coze 云端三入口验证；
- 中文吸收清单、回归报告、发布准备报告和未验证项同步更新；
- `stable` 提交未发生变化。

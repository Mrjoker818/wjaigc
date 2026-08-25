# V588-CHAT-002 智能对话失败状态与确定性原位重试设计

日期：2026-08-25
目标分支：`main`
只读参考：`J:\无界云端0820`（V5.8.8）
关联清单：`docs/plans/v588/V588_ABSORPTION_INVENTORY.md`

## 1. 目标

为独立智能对话页补齐统一、可持久化的消息状态和确定性重试能力，覆盖：

- 普通对话
- 联网对话
- Deep Research
- CanvasEditor AI 修改

失败后必须保留原始输入和可理解的错误信息；重试不得重复插入用户消息，不得读取已经变化的当前模型或模式，不得重复登记附件。对话内触发图像生成时，重试必须复用原助手消息 ID，使现有下游幂等键保持不变。

## 2. 方案选择

### 方案 A：直接吸收 V5.8.8 的删除后重发

优点是改动较少。缺点是会删除原用户消息和失败助手消息，再从当前界面状态重新发送；模型、供应商、模式和附件可能漂移，也可能产生重复任务。否决。

### 方案 B：当前主线确定性原位重试

为助手消息持久化状态和版本化重试上下文。失败后原位显示错误与重试按钮；重试复用原用户消息、原助手消息 ID、冻结的模型/供应商/模式和已登记媒体引用。CanvasEditor 在编辑器内保留失败上下文。采用。

### 方案 C：把所有聊天请求改造成数据库任务队列

能够提供更强的跨实例恢复，但会扩大到任务队列、账务和供应商协议改造，不符合本次“最小吸收”约束。留作后续架构升级，不纳入本项。

## 3. 消息状态模型

`SimpleChatMessage` 增加：

```ts
type SimpleChatMessageStatus = 'streaming' | 'completed' | 'failed';

interface SimpleChatMessage {
  // 既有字段保持不变
  status?: SimpleChatMessageStatus;
  error?: {
    code?: string;
    message: string;
    retryable: boolean;
  };
  retryContext?: SimpleChatRetryContext;
}
```

状态转换只允许：

```text
新建 -> streaming
streaming -> completed
streaming -> failed
failed -> streaming（用户显式重试）
```

旧消息未带 `status` 时按 `completed` 展示。页面加载时，持久化的 `streaming` 不能永久显示加载动画，应转换为 `failed`，提示“上次请求中断，可重试”。

## 4. 冻结重试上下文

采用有版本号的可序列化上下文：

```ts
interface SimpleChatRetryContextV1 {
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
  request: ChatRequestSnapshot | DeepResearchRequestSnapshot;
}
```

约束：

- 上下文只保存请求所需的有界文本、标识符和设置。
- 图片与附件复用原用户消息中的 `images`、`imageRefs`、`attachments`；不在重试上下文中复制 data URL 或二进制内容。
- 首次发送生成一次 `idempotencyKey`，重试不得改变。
- 重试根据 `userMessageId` 读取原用户消息，根据 `assistantMessageId` 原位更新助手消息。
- 找不到原消息、项目或任务不匹配时拒绝重试，并给出明确提示。

## 5. 请求执行与幂等边界

普通对话和联网对话共用一个纯请求执行器；首次发送负责创建消息，重试只调用执行器：

1. 将同一助手消息更新为 `streaming`，清除旧错误和旧的部分文本。
2. 复用冻结的 `modelId + providerId`、模式、控制项和媒体引用。
3. 请求体与 `Idempotency-Key` Header 都携带同一幂等键。
4. 流式文本只写入同一助手消息。
5. `done` 后标记 `completed`；HTTP、协议或流式错误标记 `failed`。
6. 若用户切换项目/任务，迟到事件不得污染当前任务，但原任务数据仍按其归属更新。

对话工具触发图像生成时继续复用同一个 `responseMessageId`，因此既有：

```text
simple-chat:{taskId}:{responseMessageId}:generate
```

保持不变，可避免应用侧重复创建同一图像任务。上游文本模型是否支持幂等 Header 由供应商决定，因此本项只承诺应用内确定性重试和已支持下游任务的幂等，不宣称所有第三方 LLM 都能提供严格 exactly-once。

Deep Research 使用同一消息状态和上下文，但保留独立执行器；计划、搜索、写作阶段重试时仍写回原助手消息，不新增第二组用户/助手消息。

## 6. CanvasEditor 失败交互

CanvasEditor 不创建独立聊天消息，因此不把失败状态塞入聊天气泡：

- 提交时冻结当前全文、选区范围、选中文本、修改指令、模型和供应商。
- 失败后在 AI 修改栏上方显示行内错误和“重试修改”。
- 保留原指令、原选区和原内容；用户仍可修改指令后发起一次新请求。
- 点击“重试修改”严格复用失败快照；不读取已变化的当前对话模型。
- 成功后才新增 Canvas 版本并清除失败状态。
- 任务/项目切换后的迟到响应不得覆盖编辑器内容。

## 7. 持久化与恢复

当前独立聊天项目会完整 JSON 序列化到：

- `localStorage`：`wujie_chat_projects`
- 服务器用户数据：`chat_simple_projects` 对应 JSONB

现有链路不会裁剪消息扩展字段，因此 `status`、`error` 和 `retryContext` 可随项目保存。新增加载规范化函数负责：

- 验证状态枚举和重试上下文字段；非法上下文移除，不盲目信任持久化 JSON。
- 旧消息缺少状态时兼容为完成态。
- 残留 `streaming` 转换为可重试失败态。
- 限制文本、ID、数组数量和序列化体积，避免重试上下文无限膨胀。

## 8. UI 规则

- `streaming`：仅当前消息显示加载状态，禁止重复点击重试。
- `failed`：消息气泡保留错误摘要，气泡底部常显“重试”按钮，不依赖 hover。
- `completed`：保留现有复制、重新生成、长短改写、分支等操作。
- “重新生成”与“失败重试”区分：重新生成是用户主动创建新回复；失败重试是在原消息原位恢复。
- 重试期间不改变输入框内容，不切换用户当前选定模型，不重复出现用户消息。
- 所有按钮使用现有 Lucide 图标与工具提示，保持当前视觉体系。

## 9. 测试策略

先建立 RED 测试，再做最小实现：

1. 类型/纯函数：状态迁移、上下文规范化、重载中断收敛。
2. 普通对话：流式错误后原位失败；重试不新增用户消息，消息 ID、模型、供应商、模式和幂等键不变。
3. 联网对话：重试保持 `webSearch=true`，不被当前开关覆盖。
4. 附件：重试复用原 `imageRefs`，不再次调用附件登记接口。
5. 图像工具调用：重试保持同一 `responseMessageId`，下游图像幂等键不变。
6. Deep Research：失败后原位重试，阶段文本不会创建第二条助手消息。
7. CanvasEditor：错误行内显示；重试保留选区、指令、模型和供应商；成功后只新增一个版本。
8. 竞态：切换任务或项目后迟到事件不能写入当前界面。
9. 持久化：刷新后失败消息与重试上下文保留；遗留 streaming 可重试。
10. 回归：V588-CHAT-001 的模型下拉层级、历史图片隔离、APIMart 普通聊天、CanvasEditor 和 Deep Research 测试继续通过。

## 10. 验收标准

- 三种聊天入口失败后都有明确、持久化、可重试状态。
- 重试前后消息数量不增加，用户消息和助手消息 ID 不变。
- 重试请求的模型、供应商、模式、附件引用和幂等键与首次请求一致。
- CanvasEditor 失败后无需重新选区或重新输入指令。
- 刷新页面后不会永久停留“生成中”。
- 不修改 `stable`，不直接复制 V5.8.8 业务代码。
- 聚焦测试、全量测试、类型检查、Lint、构建均通过后才推送 `main`。
- Coze 拉取后仅用既有 Google Chrome 标签页完成真实失败与恢复验收，并归档截图、网络和 Console 证据。

## 11. 非目标

- 本项不重构整个聊天页面或数据存储架构。
- 本项不引入新的数据库任务队列。
- 本项不保证不支持幂等 Header 的第三方文本模型严格 exactly-once。
- 本项不调整供应商价格、模型目录或其他业务工具。

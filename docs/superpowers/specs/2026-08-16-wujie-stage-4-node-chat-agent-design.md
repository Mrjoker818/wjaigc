# 无界AI Stage 4 节点模式与智能对话升级设计

> 计划编号：`WJ-STABLE-001-S4`
> 状态：设计已获用户方向确认，等待书面规格复核
> 设计基线：`main@7fdc0108952fb3a68415ca3a2a26b5d33641dc6b`
> 设计日期：2026-08-16
> 工作分支：`codex/wj-stable-s4`

## 1. 目标

在不删除现有功能、不合并三个工作区 UI、不修改 `stable` 分支的前提下，建立共享 Agent 运行时，治理节点模式与两套智能对话的重复执行链路，并完成无限画布、节点模式、独立智能对话之间的受控互通。

Stage 4 的完成结果必须同时满足：

1. 无限画布、节点模式、独立智能对话继续作为三个独立产品入口存在。
2. 三个工作区共享素材身份、版本、任务、模型授权、Agent 事件和成本事实。
3. 普通对话、图片理解和 Agent 是明确不同的执行模式，不能因点击 Agent 而要求用户另行配置第三方 API。
4. 节点模式保留全部节点类型、连线、AI 建图、执行、日志、导入、历史、保存和素材流转能力。
5. React Flow 只通过 `legacy -> shadow -> react-flow-v2 -> legacy` 渐进验证，不直接替换现有 SVG 节点编辑器。
6. 所有 Agent 和节点执行继续使用 Stage 1 的持久化任务、幂等、取消、超时、迟到结果隔离、积分扣除与退款契约。
7. 所有结果继续使用 Stage 2 的 Asset、AssetVersion 和 WorkspacePlacement 契约，不覆盖原始素材。
8. 节点和工作区交互继续使用 Stage 3 已验证的画布、命令、历史和保存边界，不把业务逻辑重新塞回大型组件。

## 2. 当前基线与条件推进规则

当前正式源码为 `main@7fdc0108952fb3a68415ca3a2a26b5d33641dc6b`，`stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` 保持只读。

Stage 3 Task 10 已取得本地精确提交三模式 `180/180`、PostgreSQL 全量、TypeScript、ESLint 零错误和生产构建证据，但 GitHub Actions 因账户 Billing 未分配 Runner，Coze 最新精确提交浏览器回归也受 Chrome 扩展接管阻塞。根据用户确认，Stage 4 可以进行本地设计、基线和实现，但：

- Stage 3 仍标记为“有条件完成 / 外部门禁未关闭”，不能改写为正式完成。
- Stage 4 代码只能进入 `main` 候选，不得进入或改写 `stable`。
- Stage 4 不得正式发布，直到 Stage 3 的 Coze 精确 SHA、三模式回退和外部不可变门禁得到补验或明确替代证据。
- Actions `steps=[]` 只记为基础设施未执行，不能记为代码通过或失败，也不通过重复提交消耗额度。

## 3. 现状盘点

### 3.1 节点模式

现有节点模式以 `src/components/node-editor.tsx` 和 `src/lib/workflow-engine.ts` 为中心，已支持 27 类以上节点、端口类型、连线、AI 建图、DAG 执行、工作流保存、素材引用、执行日志、预设、ComfyUI 导入、撤销重做和画布结果回写。

主要架构风险：

- `node-editor.tsx` 约 4,895 行、257 KB，渲染、输入、拖动、连线、历史、执行轮询、上传和素材转移集中在一个组件。
- 当前未安装 React Flow / XYFlow，不能把“计划采用 React Flow”描述成已实现能力。
- 节点业务模型、渲染状态和远程执行状态耦合，局部交互修改容易影响执行或保存。
- 现有节点测试以源码契约和模块测试为主，缺少统一的 100 节点真实交互性能门禁。

### 3.2 无限画布内 AI 对话

`src/components/chat-panel.tsx` 约 6,955 行、389 KB，包含普通对话、图片引用、Skills、提示词优化、图像生成、Agent 模式和大量专业模板。后端主要经过 `/api/chat`，其中自带工具选择与多轮 Agent 循环。

主要架构风险：

- 普通对话、工具调用、图像任务和 Agent 事件在同一组件内管理。
- 与独立智能对话存在重复的会话、附件、模型选择、工具调用和结果落盘逻辑。
- Agent 进度、取消、恢复和成本展示没有统一事件协议。

### 3.3 独立智能对话

`/simple-chat` 是独立页面，保留项目、任务、附件、记忆、分享、模型比较、深度研究、Skills 和 Agent。核心 UI 位于 `src/components/simple-chat/chat-area.tsx`，后端主要经过 `/api/simple-chat/chat`。

主要架构风险：

- Agent 配置目前主要是会话级 system prompt 与工具列表，和画布 `/api/chat`、图片 `agent-edit` 不是同一运行时。
- 本地项目数据、服务端会话事实和项目仪表盘统计仍有多种投影来源。
- 独立聊天到画布已有素材桥接，但节点模式和 Agent 上下文还没有完整的同一来源关系。

### 3.4 现有 Agent 实现

当前至少存在三条相关链路：

- `/api/chat`：聊天工具调用和多轮循环。
- `/api/simple-chat/chat`：独立智能对话。
- `/api/agent-edit` + `src/lib/agent-engine.ts`：图片编辑 Agent。

Stage 4 不删除这些入口，而是在其外建立共享运行时边界，按入口逐个迁移。迁移期间 legacy 入口必须可回退，不能一次性重写三条链路。

## 4. 总体方案

采用“共享运行时优先、上下文适配器接入、节点渲染后置”的方案。

```text
无限画布内聊天 ─┐
独立智能对话 ───┼─> Workspace Context Adapter
节点 Agent ─────┘          │
                            v
                    Shared Agent Runtime
          plan -> authorize -> execute -> observe -> settle
                  │             │             │
                  v             v             v
             Model Catalog   Task Core     Asset Graph
                  │             │             │
                  └──── Agent Event Stream ───┘
                                │
              canvas / workflow / simple-chat projections
```

节点渲染独立采用第二条渐进链路：

```text
Workflow Domain Model
        │
        ├─ legacy SVG renderer（当前权威）
        ├─ shadow React Flow adapter（只计算和比对）
        └─ react-flow-v2 renderer（门禁通过后才可权威）
```

共享运行时和节点渲染迁移相互独立。Agent 运行时不能依赖 React Flow，React Flow 也不能直接调用供应商或账务接口。

## 5. 共享 Agent 运行时

### 5.1 请求契约

```typescript
type AgentWorkspace = 'canvas' | 'workflow' | 'chat';
type AgentMode = 'conversation' | 'vision' | 'agent';

interface AgentRunRequest {
  userId: string;
  projectId: string;
  workspace: AgentWorkspace;
  workspaceId: string;
  mode: AgentMode;
  providerId: string;
  modelId: string;
  prompt: string;
  sourceVersionIds: string[];
  allowedToolIds: string[];
  idempotencyKey: string;
  context: AgentContextSnapshot;
}

interface AgentContextSnapshot {
  selectedEntityIds: string[];
  visibleVersionIds: string[];
  workflowNodeId?: string;
  conversationId?: string;
  locale: 'zh-CN' | 'en-US';
}
```

`userId` 不接受客户端自报值，服务端必须从已验证会话获得真实用户；请求中的项目、素材版本、模型和工具均需再次做所有权与授权校验。

### 5.2 状态与事件契约

```typescript
type AgentRunStatus =
  | 'created'
  | 'queued'
  | 'planning'
  | 'awaiting-confirmation'
  | 'executing'
  | 'uploading'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'timeout';

type AgentEventType =
  | 'run.created'
  | 'plan.updated'
  | 'tool.started'
  | 'tool.progress'
  | 'tool.completed'
  | 'asset.created'
  | 'run.completed'
  | 'run.failed'
  | 'run.cancelled'
  | 'run.timeout';

interface AgentEvent {
  eventId: string;
  runId: string;
  sequence: number;
  type: AgentEventType;
  timestamp: string;
  payload: Record<string, unknown>;
}
```

事件必须有单调递增 `sequence`。SSE、轮询和页面刷新只负责投影数据库事实；旧事件不能覆盖新终态，取消、失败和超时后不能接受迟到完成。

### 5.3 工具注册与授权

共享工具注册表至少记录：

- 稳定 `toolId` 和版本。
- 支持的工作区、输入种类和输出种类。
- 所需模型能力、用户产品权限和管理员授权。
- 是否会扣费、是否可取消、超时和补偿策略。
- 输入 schema、输出 schema 和可记录的脱敏审计字段。

Agent 不得自己拼接 API Key 或选择未授权供应商。模型选择统一使用管理员模型目录的 `providerId + modelId + capabilities`，用户明确选择的可用模型失败时不得静默切换到别的付费供应商。

### 5.4 三个上下文适配器

- `CanvasAgentContextAdapter`：提供当前项目、选中节点、可见素材版本、图片组/参考图组/融图组语义和受控画布命令。
- `SimpleChatAgentContextAdapter`：提供会话、附件、记忆、消息引用和“发送到画布/节点”的目标信息。
- `WorkflowAgentContextAdapter`：提供当前节点、上游输出、端口类型、工作流执行状态和结果回写位置。

适配器只能读取上下文和提交受控命令，不能直接修改其他工作区的 React 状态或 localStorage。

## 6. 普通对话、图片理解与 Agent 分离

三个模式使用同一模型目录，但具有不同契约：

- `conversation`：纯文本或已有多模态消息，不自动调用工具。
- `vision`：必须有已授权且可读取的图片版本，失败时明确停止，不继续编造图片结论。
- `agent`：允许在用户授权的工具集合内规划和执行，并立即显示计划或首个进度事件。

界面继续保留两套产品形态：

- 画布聊天保持右侧工作面板，强调当前画布上下文、素材引用和结果回写。
- 独立智能对话保持完整页面，强调低门槛对话、项目、记忆、分享、深度研究和 Agent 管理。

共享的是运行时、事件和数据，不把两套界面合并，也不让 `/simple-chat` 通过登录页或无限画布中转导航。

## 7. 节点模式渐进升级

### 7.1 领域与渲染分离

`Workflow`、`WorkflowNode`、`WorkflowConnection`、端口兼容、DAG 执行和保存格式继续由领域层权威管理。渲染器只消费稳定的视图模型并发出命令：

```typescript
interface WorkflowViewportAdapter {
  project(workflow: Workflow, viewport: WorkflowViewport): WorkflowRenderModel;
  hitTest(point: Point): WorkflowHitResult;
  beginInteraction(command: WorkflowInteractionCommand): void;
  updateInteraction(command: WorkflowInteractionCommand): void;
  commitInteraction(command: WorkflowInteractionCommand): WorkflowCommand[];
  cancelInteraction(reason: string): void;
}
```

节点拖动、连线、选择、删除、复制、撤销和重做必须通过命令进入历史与保存链路。渲染器不能直接调用 `/api/workflow/execute`、模型接口、积分接口或资产写接口。

### 7.2 React Flow 三态

使用服务端权威配置：

```text
WUJIE_WORKFLOW_RENDERER_MODE=legacy|shadow|react-flow-v2
```

- `legacy`：当前 SVG 编辑器权威，行为完全不变。
- `shadow`：React Flow 适配器只在内存中投影节点、边、视口和命中结果，记录脱敏差异，不渲染交互 UI、不保存、不执行、不扣费。
- `react-flow-v2`：只有保护、性能、旧工作流和五浏览器门禁通过后才可在隔离环境成为权威。

非法值、缺失配置、初始化失败或运行时熔断均回落 `legacy`。浏览器 localStorage、查询参数和普通用户请求不能提升模式。

### 7.3 节点功能零丢失

迁移前后必须保持：

- 所有现有 NodeType、端口类型和端口兼容关系。
- 文生图、图生图、图片编辑、视频、音频、3D、分层、专业工具、Agent、控制和输出节点。
- AI 自然语言建图、预设工作流、自动布局、素材库、提示词库、@图片引用。
- 执行日志、节点状态、串行等待、取消、错误展示和结果回写。
- 节点复制粘贴、框选、多选、连线高亮、撤销重做、小地图、JSON 编辑和 ComfyUI 导入。
- 工作流保存、刷新恢复、旧项目读取和节点结果发送到画布。

任一节点类型、入口、字段、端口或命令减少均阻止模式提升。

## 8. 三工作区完全互通

Stage 2 的素材版本与 placement 是唯一跨工作区媒介。禁止通过裸 URL 数组或 localStorage 复制冒充互通。

必须形成以下真实闭环：

```text
独立聊天附件/结果
-> AssetVersion
-> 发送到无限画布形成 canvas placement
-> 画布编辑产生派生版本
-> 发送到节点形成 workflow input placement
-> 节点执行产生 workflow output version
-> 返回聊天形成 chat result placement
-> 来源链、任务、供应商、模型和成本可追溯
```

跨工作区操作必须满足：

- 同一 `projectId` 和真实 owner。
- 同一幂等键重复提交只创建一个 placement 或任务。
- 切换项目或会话后，旧异步结果不能落入新上下文。
- 删除 placement 不删除 Asset；回收、恢复和媒体健康沿用 Stage 2 规则。
- 失败、取消、超时或未授权结果不得生成有效版本或工作区放置。

## 9. 错误、安全与可观测性

所有入口统一返回包含 `code`、`message`、`requestId`、`taskId/runId` 和 `retryable` 的错误。供应商错误、程序参数错误、授权错误、网络错误和账务错误必须可区分。

强制安全边界：

- 服务端校验登录、用户、项目、素材版本、工作流、模型和工具授权。
- 远程图片与附件沿用安全下载器，拒绝私网、重绑定、重定向、超大内容、错误 MIME 和像素炸弹。
- API Key、Token、密码、完整敏感提示词和用户图片内容不得写入 Agent 事件或日志。
- 工具输入执行 schema 校验；文本、附件、工具轮数、节点数和总体请求体均设上限。
- 相同用户和幂等键绑定规范化请求摘要；同键不同请求返回冲突。
- 扣费、终态、退款和结果版本采用数据库条件式转换，不由内存状态决定。

日志至少包含 `gitCommit`、`environment`、`requestId`、`runId/taskId`、`userId` 脱敏标识、`projectId`、`workspace`、`providerId`、`modelId`、`toolId`、`duration`、`status` 和 `errorCode`。

## 10. 性能与体验门禁

固定门禁：

- 节点模式 100 节点持续拖动不低于 55 FPS。
- 节点模式输入事件 P95 不高于 50 ms。
- 节点拖动、连线、选择期间不因远程任务或保存触发整页不可交互。
- 独立智能对话首次进入 2 秒内可交互。
- Agent 提交后 1 秒内显示已排队、规划中或明确阻塞原因。
- Agent 运行期间可取消；刷新后可恢复；终态后不永久显示处理中。
- 三工作区切换不经过错误登录页或其他工作区中转。
- 100 节点、长对话和多附件场景不产生未处理 Console Error、Promise rejection 或无限请求循环。

不得通过降低节点数、隐藏功能、延长固定等待或关闭错误断言制造通过。

## 11. 测试策略

### 11.1 Task 0 基线

先生成并冻结：

- 节点类型、端口、字段、工具、Skills、路由和工作区入口清单。
- 节点模式、画布聊天、独立聊天的截图、DOM、Console、Network 和 Trace。
- 旧工作流、100 节点、长对话、多附件、Agent 成功/失败/取消/刷新恢复夹具。
- 当前模型选择、用户授权、任务、素材版本和积分账务事实。

### 11.2 自动化层级

- 单元测试：Agent 事件归并、状态机、工具授权、上下文适配、端口兼容和命令历史。
- 组件测试：三个入口的模式选择、进度、取消、恢复、错误和结果操作。
- PostgreSQL 集成：幂等、并发终态、一次扣费/退款、迟到结果和跨用户隔离。
- API 测试：正常、缺参、错误参数、未登录、越权、重复、并发、超时、第三方失败和恢复。
- Playwright：Chromium、1920x1080 Chromium、Firefox、WebKit、移动 Chromium。
- 云端：Coze 精确 SHA、Chrome、真实供应商、真实积分、模式提升和强制回退。

### 11.3 必测用户链路

1. 独立聊天普通对话、图片理解、Agent、刷新恢复和直接返回仪表盘。
2. 画布聊天引用当前图片、Agent 执行、结果进入画布、保存与刷新。
3. 节点创建、拖动、连线、执行、取消、保存、刷新和结果进入画布。
4. 聊天结果 -> 画布编辑 -> 节点处理 -> 返回聊天的完整版本链。
5. 未授权模型、供应商失败、取消、超时、迟到结果、重复点击和两个标签页并发。
6. `legacy -> shadow -> agent-v2/react-flow-v2 -> legacy` 后数据、登录、任务、素材和积分一致。

## 12. 实施分解

Stage 4 拆成五个可独立审查的子项目，每个子项目单独 RED、最小实现、回归和提交：

1. **Task 0：功能清单与真实基线。** 只盘点和测试，不修改业务行为。
2. **Task 1：共享 Agent 领域契约与事件存储。** 不接 UI，不替换现有入口。
3. **Task 2：画布聊天与独立聊天适配。** 先 shadow 对照，再逐入口切换；图片编辑 Agent 暂保持兼容适配。
4. **Task 3：节点领域/渲染边界与 React Flow shadow。** 先分离命令和视图模型，再引入经过验证的渲染适配器。
5. **Task 4：三工作区互通、五浏览器、Coze 和回退门禁。** 关闭 Stage 4 后才允许进入 Stage 5。

每个 Task 完成后同步仓库报告和 Obsidian 看板。已完成且证据仍适用于当前提交的步骤不得重复执行。

## 13. 明确不在本阶段处理

- 不提升去背景、擦除、蒙版、放大、分层、视频、3D、品牌、精修等业务工具的生成质量；它们属于 Stage 5。
- 不重做无限画布内核，不改变 Stage 3 已通过的平移、选择、历史、保存和媒体稳定语义。
- 不全面改版节点或聊天 UI；只做支持状态、错误、进度、取消和互通所必需的交互调整。
- 不删除旧路由、旧字段、旧工作流 reader、旧聊天数据或 legacy renderer。
- 不修改 `stable`，不在云端未验前推广新模式。

## 14. 完成与回退标准

只有同时满足以下条件，Stage 4 才能标记完成：

- 受保护节点、工具、Skills、路由和入口数量没有减少。
- Task 0-4 全部完成，P0/P1 为 0。
- PostgreSQL、全量测试、类型、ESLint 零错误和构建通过。
- 五浏览器核心链路通过，节点 100 节点与 Agent 首进度达到固定性能门禁。
- 三工作区完整素材版本链和任务来源链可追溯。
- 真实供应商任务只扣费一次，取消/失败/超时至多退款一次，迟到结果被隔离。
- Coze 运行提交与 GitHub 精确 SHA 一致。
- Agent 和节点新模式均完成 `legacy -> shadow -> v2 -> legacy` 回退，旧数据和三个工作区可继续使用。
- Stage 3 外部门禁已补验，或由经过书面批准的等价不可变证据正式替代。

任一项缺失时只能标记“本地通过”或“有条件通过”，不得更新 `stable`，不得进入 Stage 5。

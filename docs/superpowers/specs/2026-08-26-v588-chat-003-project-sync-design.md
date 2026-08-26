# V588-CHAT-003 智能对话项目同步与并发冲突设计

日期：2026-08-26

目标分支：`main`

设计基线：`3de8e951ae05a0f1ab6128d926af3ebf08336ab2`

只读稳定分支：`origin/stable@52f7c601ed150769e15d06fb435c6e360e28c9e7`

只读参考：`J:\无界云端0820`（V5.8.8）

关联清单：`docs/plans/v588/V588_ABSORPTION_INVENTORY.md`

## 1. 目标

为独立智能对话页补齐用户隔离、可恢复并且不会静默覆盖的项目同步机制，覆盖：

- 项目、任务、消息、Artifact、Agent 和知识项的跨设备持久化；
- 页面刷新、关闭、切换账号、退出登录及离线恢复；
- 多标签页和多设备并发修改；
- 明确的同步状态、失败重试和冲突副本；
- 现有普通对话、联网对话、Deep Research 和 CanvasEditor 数据的无损兼容。

服务器中的已确认快照是同步基线。本地只重放当前用户尚未确认的明确操作，不能用旧缓存直接覆盖服务器，也不能让服务器已经删除的内容被普通本地缓存复活。

## 2. 当前问题与 V5.8.8 评估

### 2.1 当前主线

当前 `src/app/simple-chat/page.tsx` 存在以下风险：

- 所有用户共用 `wujie_chat_projects`，存在同一浏览器切换账号后的缓存串写风险；
- 服务器只要返回非空数组就整体替换本地数据，本地未同步修改可能丢失；
- `/api/user-data/sync` 对 `chat_simple_projects` 使用盲写 upsert，没有版本条件；
- 800 ms 防抖写入和 `handlePersistTask` 全量写入可能互相覆盖；
- 普通同步异常被静默吞掉，用户无法判断数据是否已经上云；
- 页面离开时没有统一的有界刷新，退出登录辅助函数也不携带版本；
- 删除没有独立语义，旧快照可能重新带回已删除项目或任务。

### 2.2 V5.8.8 供体

V5.8.8 增加了 `updatedAt` 合并和 `pagehide` 的 `keepalive` 写入，能够减少部分刷新丢失，但不能直接吸收：

- 时间戳是客户端生成的，不能作为可靠并发版本；
- 时间相同时本地获胜，仍可能覆盖服务器修改；
- 不记录删除语义，会复活其他设备已经删除的数据；
- 没有用户隔离缓存、冲突响应和可见失败状态；
- 同步失败仍被静默吞掉。

本项选择性吸收 V5.8.8 的页面离开刷新思路，不吸收其“按 `updatedAt` 整体合并”策略。

## 3. 方案选择

### 方案 A：CAS 版本 + 用户隔离的待同步操作日志

服务器快照作为基线，本地记录当前用户尚未确认的明确操作。写入必须携带服务器版本；冲突时重新读取快照、重放操作并有限重试。采用。

优点：不静默覆盖、删除语义明确、无需第二套存储系统，并且可以离线恢复。缺点：需要增加差异计算、操作重放和冲突测试。

### 方案 B：直接吸收 V5.8.8 的时间戳合并

实现较快，但无法可靠处理删除、时钟漂移、跨用户缓存及并发覆盖。否决。

### 方案 C：CRDT 或永久服务端事件日志

协作能力最强，但会扩大到协议、存储、清理和全平台迁移，不符合本次最小吸收范围。留作后续协作架构升级。

## 4. 范围与非目标

### 4.1 纳入范围

- 独立智能对话页 `/simple-chat`；
- `chat_simple_projects` 的读取和写入；
- 智能对话项目在用户仪表盘中的同源读取；
- 当前简单聊天退出流程；
- 本地缓存迁移、同步状态与重试入口；
- 单元、API、PostgreSQL 并发及浏览器回归测试。

### 4.2 非目标

- 不修改无限画布的 `projects` 同步协议；
- 不重构聊天生成、供应商调用或计费链路；
- 不引入 CRDT、WebSocket 协同编辑或永久操作日志；
- 不改变项目、任务、消息和 Artifact 的业务结构；
- 不触碰 `stable`，不直接修改只读 V5.8.8 目录。

## 5. 架构边界

拆分为四个可独立测试的单元：

1. `simple-chat-project-sync`：纯函数层，负责差异计算、操作压缩、重放和冲突副本。
2. `simple-chat-sync-storage`：IndexedDB 浏览器存储层，负责按用户读写同步信封及旧缓存隔离。
3. `simple-chat-sync-client`：协调层，负责拉取、CAS 提交、重试、退避和页面生命周期刷新。
4. `simple-chat-sync-server`：服务端存储层，负责读取版本化快照和 PostgreSQL 原子 CAS。

页面组件只订阅同步状态并调用协调层，不自行实现合并规则。API 路由只做鉴权、输入校验、错误映射和服务端存储调用。

## 6. 本地同步信封

同步信封使用浏览器原生 IndexedDB，避免大型聊天历史、附件引用和 Artifact 继续挤占同步 `localStorage` 配额。数据库和对象仓定义如下：

```text
database: wujie-simple-chat-sync
object store: envelopes
primary key: userId
```

数据结构：

```ts
interface SimpleChatSyncEnvelopeV1 {
  schemaVersion: 1;
  userId: string;
  baseRevision: number;
  baseProjects: SimpleChatProject[];
  currentProjects: SimpleChatProject[];
  pendingOperations: SimpleChatSyncOperation[];
  updatedAt: number;
}
```

字段语义：

- `baseRevision`：`baseProjects` 对应的服务器版本；
- `baseProjects`：最近一次服务器确认的快照；
- `currentProjects`：当前界面可见数据；
- `pendingOperations`：从已确认基线到当前状态之间尚未上云的明确操作；
- `updatedAt`：仅用于本地诊断和清理，不参与服务端冲突判断。

`userId` 必须与当前会话完全一致。读取到不一致的信封时拒绝加载并记录脱敏警告。

IndexedDB 不可用或事务失败时，页面进入可见 `failed` 状态并继续保留内存中的当前数据；不得降级到未分用户的旧 `localStorage`。本轮不引入第三方存储依赖。

## 7. 操作模型

操作使用稳定对象标识和单调本地序号：

```ts
type SimpleChatEntityType =
  | 'project'
  | 'task'
  | 'message'
  | 'artifact'
  | 'agent'
  | 'knowledge-item';

interface SimpleChatSyncOperation {
  operationId: string;
  sequence: number;
  kind: 'upsert' | 'delete';
  entityType: SimpleChatEntityType;
  projectId: string;
  taskId?: string;
  entityId: string;
  value?: unknown;
}
```

约束：

- `upsert` 必须携带经过边界校验的实体值；
- `delete` 不携带实体值，删除语义不能被普通 upsert 压缩掉；
- 同一实体连续 upsert 可压缩为最后一次；
- `upsert -> delete` 压缩为 delete；
- `delete -> upsert` 视为用户明确恢复，保留最后一次 upsert；
- 已提交批次通过 `operationId` 精确确认，不能用“清空全部”误删请求期间新增的操作；
- Artifact 和消息使用已有稳定 ID 去重，不能按数组位置或文本内容判断身份。

## 8. 初始化与正常同步数据流

### 8.1 登录初始化

1. 完成会话鉴权并取得 `user.id`。
2. 读取 `wujie_chat_sync:v1:<userId>`。
3. `GET /api/user-data/sync?key=chat_simple_projects`，取得 `value` 和 `syncRevision`。
4. 如果不存在本地信封，以服务器快照建立基线。
5. 如果存在信封，将其 `pendingOperations` 按顺序重放到最新服务器快照。
6. 对重放结果执行 `recoverInterruptedSimpleChatProjects`，只修正中断状态，不生成同步操作。
7. 设置页面状态，随后对仍有待同步操作的信封发起 CAS 提交。

服务器返回空数组仍是有效权威快照，不能因为数组为空就回退到旧全局缓存。

### 8.2 本地修改

1. 页面先更新 `currentProjects`，保证交互即时响应。
2. 根据修改前后状态生成明确操作并持久化信封。
3. 800 ms 防抖后创建不可变提交批次。
4. 提交 `{ key, value, expectedRevision }`。
5. 成功后只确认该批次包含的 `operationId`，更新基线和新版本。
6. 请求期间产生的新操作继续保留并触发下一轮同步。

`handlePersistTask` 与普通防抖写入必须共用同一个协调器，不能再各自提交全量快照。

## 9. 服务端版本化存储

继续使用 `wujie_user_data`，不增加第二套表，也不执行破坏性迁移。仅 `chat_simple_projects` 在 `data_value` 内使用版本化信封：

```ts
interface StoredSimpleChatSnapshotV1 {
  schemaVersion: 1;
  revision: number;
  projects: SimpleChatProject[];
}
```

兼容规则：

- 历史 `data_value` 为数组时，读取为 `projects = data_value`、`revision = 0`；
- 首次成功写入后原子升级为版本化信封；
- 其他 `chat_` 和 `projects` 键保持现有格式；
- API 对客户端继续返回 `value` 数组，存储信封不泄漏为业务数据。

### 9.1 GET 契约

成功响应：

```json
{
  "success": true,
  "key": "chat_simple_projects",
  "value": [],
  "syncRevision": 0
}
```

### 9.2 POST 契约

请求：

```json
{
  "key": "chat_simple_projects",
  "value": [],
  "expectedRevision": 0
}
```

成功响应返回新的 `syncRevision`。缺少、非安全整数或负数版本返回 `400 INVALID_SYNC_REVISION`。

### 9.3 PostgreSQL 原子 CAS

CAS 必须由一条条件式 `INSERT ... ON CONFLICT ... DO UPDATE ... WHERE ... RETURNING` 或同等事务语义完成：

- 新记录只允许 `expectedRevision = 0`；
- 历史数组记录视为 revision `0`；
- 版本化记录只在存储 revision 等于 `expectedRevision` 时更新；
- 新 revision 为 `expectedRevision + 1`，由服务器计算；
- 条件未命中时重新读取当前 revision，返回 `409`，不能退化为盲写；
- 两个使用同一 revision 的并发请求只能有一个成功。

冲突响应：

```json
{
  "success": false,
  "code": "CHAT_SYNC_CONFLICT",
  "message": "智能对话数据已在其他位置更新",
  "currentRevision": 8,
  "requestId": "req_xxx",
  "retryable": true
}
```

## 10. 冲突合并规则

客户端收到 `409` 后：

1. 读取最新服务器快照；
2. 以该快照为新基线；
3. 依次重放当前设备未确认操作；
4. 重新提交，最多自动重试 2 次；
5. 仍冲突时进入可见 `conflict` 状态，由用户点击重试。

规则：

- 修改不同项目、任务或实体时自然合并；
- 本地明确 delete 可以删除新基线中的目标；
- 服务器删除且本地没有待同步操作时保持删除；
- 服务器删除但本地存在明确 upsert 时，创建标记为冲突副本的新稳定 ID，不复用已删除 ID；
- 同一字段双方都修改且不能无歧义合并时，服务器版本保留原 ID，本地版本保存为“冲突副本”；
- 消息与 Artifact 先按稳定 ID 合并，再按字段冲突规则处理；
- 冲突副本必须保留来源标记和创建时间，但不得改变对话请求与计费状态。

## 11. 旧缓存迁移与用户隔离

旧键 `wujie_chat_projects` 不能自动归属给当前账号，也不能自动上传。实施规则：

- 首次升级时把旧值原样移动到 `wujie_chat_projects:legacy-backup`；
- 写入迁移标记，后续不重复迁移；
- 当前账号存在服务器或用户隔离信封时，完全忽略旧备份；
- 本项不提供自动导入旧备份，避免跨账号污染；
- 如后续需要恢复，另行设计由用户确认内容和目标账号的显式导入工具；
- 用户仪表盘读取当前用户信封或服务器数据，不再读取全局旧键。

退出登录不删除对应用户信封；切换账号后只打开新账号自己的键。

## 12. 生命周期与离线恢复

- 正常编辑：800 ms 防抖提交；
- `pagehide`：使用 `keepalive` 提交当前不可变批次，不等待超长响应；
- React 清理：取消定时器并触发同一有界刷新逻辑；
- 退出登录：先执行最长 5 秒的有界同步，再调用退出接口；
- 切换用户：冻结旧用户协调器、持久化其信封，再初始化新用户协调器；
- 离线：停止网络重试，保持本地信封，浏览器恢复在线后继续；
- `429/5xx`：指数退避并加随机抖动，最多连续自动重试 3 次；
- 不使用固定长时间 sleep，不允许多个协调器同时同步同一用户。

页面关闭时无法确认服务端响应，因此操作只有在后续读取到相应 revision 或正常请求成功后才从日志中移除。

## 13. 同步状态与用户反馈

```ts
type SimpleChatSyncStatus =
  | 'loading'
  | 'syncing'
  | 'synced'
  | 'offline'
  | 'failed'
  | 'conflict';
```

界面文案：

- `syncing`：正在同步；
- `synced`：已同步；
- `offline`：离线，等待同步；
- `failed`：同步失败，点击重试；
- `conflict`：检测到冲突，已保留副本。

状态放在独立智能对话页现有顶部或侧栏状态区，不新增阻塞式弹窗。`failed` 和 `conflict` 提供明确重试按钮；成功后状态自动收敛为 `synced`。

## 14. 错误处理

- `401`：停止同步并保留用户信封，进入既有重新登录流程；
- `403`：显示权限错误，不自动重试；
- `409`：按冲突流程处理；
- `413`：先压缩同实体连续操作和已确认历史；仍超限时提示用户，不能吞掉数据；
- `429`、`500`、`502`、`503`、`504`：有界退避，保持待同步状态；
- 非 JSON 或错误结构响应：标记 `failed` 并记录 requestId；
- IndexedDB 配额不足或事务失败：停止宣称“已同步”，提示本地保存空间不足；
- 所有异常都不能清空 `currentProjects`、`pendingOperations` 或已完成 Artifact。

统一错误格式遵循：

```json
{
  "success": false,
  "code": "CHAT_SYNC_CONFLICT",
  "message": "智能对话数据已在其他位置更新",
  "requestId": "req_xxx",
  "retryable": true
}
```

## 15. 数据与请求边界

服务端必须校验：

- 项目、任务、消息、Artifact、Agent 和知识项均为有限数组；
- 所有 ID 和文本字段有长度上限；
- 嵌套深度、总实体数量和请求体字节数有上限；
- 不接受函数、原型污染键或非 JSON 值；
- 当前接口只能读写当前会话用户的固定键 `chat_simple_projects`；
- 客户端传入的 `userId` 不参与服务端归属判断；
- 日志不记录完整消息、提示词、附件内容、Token 或 API Key。

本项采用以下明确上限：

- 请求体 JSON 编码后不超过 20 MiB；
- 项目不超过 500 个；
- 单项目任务不超过 1,000 个；
- 单任务消息不超过 10,000 条；
- 单消息 Artifact 和附件分别不超过 64 个；
- 单项目 Agent 和知识项分别不超过 1,000 个；
- ID 不超过 256 个字符，名称不超过 512 个字符；
- 单条普通消息正文不超过 512 KiB；
- 单个 Deep Research 报告或 Artifact 文本不超过 2 MiB；
- JSON 嵌套深度不超过 16 层。

客户端和服务端共用同一组常量。测试覆盖边界值与超限值；若现有真实数据超过上限，先记录兼容样本并调整规格，不允许实施代码静默截断。

## 16. 可观测性

每次同步记录结构化元数据：

- `requestId`
- `anonymousUserId`
- `module: simple-chat-sync`
- `action: read | write | conflict | retry`
- `expectedRevision`
- `currentRevision`
- `nextRevision`
- `operationCount`
- `duration`
- `status`
- `errorCode`

客户端 Console 只在开发环境输出脱敏诊断。生产错误进入现有操作日志或错误监控，不输出项目正文。

## 17. 目标文件

预计最小改动范围：

- `src/app/simple-chat/page.tsx`
- `src/app/api/user-data/sync/route.ts`
- `src/components/simple-chat/simple-chat-types.ts`
- `src/lib/simple-chat-logout.ts`
- 新增 `src/lib/simple-chat-project-sync.ts`
- 新增 `src/lib/simple-chat-sync-storage.ts`
- 新增 `src/lib/simple-chat-sync-client.ts`
- 新增服务端 CAS 辅助模块，具体路径在实施计划中按现有 `db-storage` 边界确定
- 用户仪表盘中当前读取 `loadProjects()` 的位置
- 对应 unit、API、PostgreSQL 并发和 E2E 测试
- V5.8.8 吸收清单及测试报告

不得顺带重构 `simple-chat` 的聊天发送、模型选择或 CanvasEditor 业务。

## 18. TDD 与测试矩阵

所有实现必须先产生稳定 RED，再做最小修改。

### 18.1 单元测试

- 用户隔离存储键；
- 旧全局缓存只备份、不自动上传；
- 操作生成、压缩和批次确认；
- 项目、任务、消息和 Artifact 的 upsert/delete 重放；
- 服务器删除不被普通缓存复活；
- 明确本地恢复生成冲突副本；
- 同步期间新增操作不会被误清除；
- 中断任务恢复不产生伪同步操作。

### 18.2 API 测试

- 正常 GET/POST 和版本递增；
- 未登录、错误键、缺少版本、非法版本；
- 历史数组格式读取与首次升级；
- 同版本并发写入一个成功、一个 `409`；
- 409 响应结构；
- 畸形 JSON、超限数据和原型污染输入；
- 数据库失败及非 JSON 异常映射。

### 18.3 PostgreSQL 专项

使用隔离测试数据库同时提交两个相同 `expectedRevision`，断言：

- 只写入一个快照；
- revision 只增加一次；
- 失败请求得到真实当前 revision；
- 不存在部分写入或盲目覆盖。

缺少隔离 PostgreSQL 时必须标记未验证，不能以 Mock 结果替代。

### 18.4 浏览器 E2E

- 登录后读取服务器项目；
- 创建项目、发送消息、Artifact 完成后刷新恢复；
- 页面关闭/返回后恢复；
- 离线编辑、重新联网并同步；
- 双标签页修改不同项目自动合并；
- 双标签页修改同一实体生成冲突副本；
- 一端删除、另一端旧缓存刷新时不复活；
- 切换账号后缓存完全隔离；
- 退出登录前同步失败时保留待同步数据；
- 同步状态、失败提示和重试按钮可见；
- Console 无未处理异常，网络日志保留版本与冲突响应。

Chromium 完成真实云端闭环；Firefox、WebKit 完成本地核心回归。失败时保存 screenshot、video、trace、console 和 network 证据。

### 18.5 既有能力回归

- V588-CHAT-001：模型下拉层级与可操作性；
- V588-CHAT-002：失败状态、确定性原位重试、Deep Research Artifact；
- 普通对话、联网对话、Deep Research、CanvasEditor；
- 用户仪表盘对话数量与 `/simple-chat` 一致；
- 登录、刷新、退出流程不再出现“正在验证身份”回归。

## 19. 验收标准

本项只有同时满足以下条件才可关闭：

- 不丢失已完成消息和 Artifact；
- 服务器删除的数据不会被旧缓存无意复活；
- 不同账号不能读取或上传彼此缓存；
- 并发写入不会静默覆盖；
- 两个相同 revision 的 PostgreSQL 并发写入只能成功一个；
- 离线修改恢复联网后继续同步；
- 刷新、页面离开、切换账号和退出登录均有明确结果；
- 同步失败有可见状态和可操作重试；
- V588-CHAT-001/002 全量回归通过；
- Chromium 云端证据完整，Firefox/WebKit 本地核心测试通过；
- 受保护文件门禁、类型检查、Lint、单元/API/E2E、构建全部通过；
- `stable` SHA 保持不变，修改只进入 `main`。

## 20. 实施顺序约束

1. 固化当前失败证据和 RED 测试；
2. 实现纯同步与存储函数；
3. 实现服务端 PostgreSQL CAS；
4. 接入客户端协调器和状态 UI；
5. 接入退出、页面离开和用户仪表盘；
6. 运行模块回归与全量门禁；
7. 推送 `main`，由 Coze 拉取精确 SHA；
8. Google Chrome 在现有预览页完成真实云端验证；
9. 更新 V5.8.8 吸收清单、缺陷登记和发布准备报告。

任何阶段出现登录、消息持久化、Artifact、模型下拉或账号隔离回归，立即停止后续吸收并修复，不允许带着新增回归进入云端。

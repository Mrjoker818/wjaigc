# 无界AI 项目 Lib 工具库 & 类型定义 核心逻辑 Bug 分析报告

> 扫描范围：`src/lib/`、`src/lib/image-tools/`、`src/types/`、`scripts/*.py|*.sh`、`src/app/globals.css`
>
> 严重程度定义：
> - **P0**：可导致数据错误、内存泄漏、安全漏洞、生产崩溃，必须立即修复
> - **P1**：可导致功能异常、资源未释放、竞态条件，应尽快修复
> - **P2**：代码健壮性/边界/未使用代码/可维护性问题，排期修复

---

## 一、`src/lib/db-client.ts` — 数据库连接池

### 核心功能
PostgreSQL 连接池单例 + 带重试的 `execSql` 封装 + 连接池关闭。

### 发现的问题

| # | 问题 | 严重度 | 说明 |
|---|------|--------|------|
| 1 | **`execSql` 使用 Pool.query（非 client），重试逻辑安全** | — | 当前实现正确（曾因 pool.end() 导致级联失败，已注释修复）。✅ 良好 |
| 2 | **`getPool()` 模块级单例非线程安全（多实例 Next.js dev）** | P2 | Next.js dev 模式下 HMR 可能导致模块被多次求值，`pool` 变量会被重新创建但旧 pool 未 `end()`，可能出现连接泄漏。已通过 `globalThis` 方案在 `task-registry.ts` 中使用，建议 db-client 也采用同样模式。 |
| 3 | **`closePool()` 未在进程退出钩子中调用** | P1 | 进程退出（SIGINT/SIGTERM）时未优雅关闭连接池，可能导致 PostgreSQL 端残留 idle 连接。建议添加 `process.on('SIGTERM', () => closePool())`。 |
| 4 | **SSL 配置 `rejectUnauthorized: false` 存在安全风险** | P2 | 对 supabase/aidap 域名无条件关闭证书校验，可能被中间人攻击。建议生产环境提供显式 SSL CA 配置。 |
| 5 | **重试逻辑未释放/重置连接** | ✅ 已处理 | 注释明确说明"pg handles bad connections internally"。 |

### 修复建议
- 将 `pool` 单例改为挂在 `globalThis` 上（与 task-registry 一致）。
- 添加进程退出钩子调用 `closePool()`。
- 增加连接池监控（idle 数、waiting 数）日志。

---

## 二、`src/lib/db-storage.ts` — 数据库持久化存储

### 核心功能
用户/API 提供商/品牌资产等表的 CRUD，封装在 execSql 之上。

### 发现的问题

| # | 问题 | 严重度 | 说明 |
|---|------|--------|------|
| 1 | **🔴 P0：`dbBatchUpdateProviderOrder` 事务完全失效** | **P0** | 代码使用 `execSql('BEGIN')` → `execSql('UPDATE')` → `execSql('COMMIT')`。但 `execSql` 内部调用 `pool.query()`，**每次调用都可能从连接池取不同连接**，BEGIN/UPDATE/COMMIT 不在同一连接上，事务完全无效！并发更新可能出现部分成功部分失败的脏数据。**必须使用 `pool.connect()` 获取单个 client，然后在同一 client 上执行 BEGIN/所有 UPDATE/COMMIT，参考文件中 `dbSetDefaultBrandAsset` 已正确使用该模式**（line 710-724）。 |
| 2 | **`JSON.stringify` 未做 try-catch** | P2 | `JSON.stringify(user.api_permissions)` 若传入循环引用对象会抛异常，被外层 catch 吞掉但没有具体错误信息。 |
| 3 | **`dbDeleteStaleProviders` 空列表仍会生成无效 SQL（已防御）** | ✅ | line 177 `if (activeIdList.length === 0) return;` 已处理。 |
| 4 | **排序更新 `updated_at = Date.now()` 使用客户端时间** | P2 | 多实例部署时客户端时钟不一致可能导致排序时间漂移，建议使用 SQL `NOW()`。 |

### 修复建议
- **立即修复 `dbBatchUpdateProviderOrder`**：仿照 `dbSetDefaultBrandAsset` 的写法使用 `pool.connect()` 获取 client 后在同一连接上 BEGIN/COMMIT。

```ts
// 修复示例
export async function dbBatchUpdateProviderOrder(orders: Array<{ id: string; sortOrder: number }>): Promise<boolean> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const { id, sortOrder } of orders) {
      await client.query('UPDATE wujie_api_providers SET sort_order = $1, updated_at = $2 WHERE id = $3',
        [sortOrder, Date.now(), id]);
    }
    await client.query('COMMIT');
    return true;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[db-storage] dbBatchUpdateProviderOrder error:', e);
    return false;
  } finally {
    client.release();
  }
}
```

---

## 三、`src/lib/task-registry.ts` — 任务注册中心

### 核心功能
全局任务 Map + 事件总线 + SSE 推送 + 每用户并发排队 + TTL 清理。

### 发现的问题

| # | 问题 | 严重度 | 说明 |
|---|------|--------|------|
| 1 | **🔴 P0：`releaseQueueSlot` 重复激活排队任务导致并发数超售** | **P0** | `releaseQueueSlot` 调用 `dequeueNextTask` 弹出下一个排队任务，并在返回非空时 `userActiveCount.set(userId, (current)+1)`。但 `dequeueNextTask` 内部（line 265-278）**已经做了 `userActiveCount.set(userId, Math.max(0, current-1))`**（line 267）。这意味着释放一个槽位时：先 `-1`，再 `+1`（net=0）看似平衡，但实际上如果 `dequeueNextTask` 返回 null（没有排队任务），`releaseQueueSlot` 不走 `+1` 分支，只做了 `-1`（正确）。**但是** `dequeueNextTask` 里在弹出任务后只做了 `-1` 而未 `+1`（等调用方做），这里逻辑是协调的；真正 bug 在：**cancelTask 调用 `updateTaskProgress({status:'cancelled'})` 前就调 `releaseQueueSlot`，而 `updateTaskProgress` 内部 emit 'cancelled' 事件，若监听方在 cancelled 回调中再次尝试 dequeue 会引发重复计数**。并发计数极易漂移为负数或超过 MAX。 |
| 2 | **🔴 P0：`cancelledTasks` Set 只增不减（除 evict 时）** | **P0** | 任务完成/失败后 `cancelledTasks` 中对应的任务 id **永远不会被清除**，除非任务被 evict。但 `isTaskCancelled` 会一直返回 true，**如果任务 ID 被复用（例如使用时间戳+随机数的低碰撞场景），新任务可能被错误判定为已取消**。更严重的是：**正常 completed/failed 的任务从未从 cancelledTasks 中删除，造成无界内存增长**。evict 函数（line 302）只在 registry 超过 MAX_TASKS 时才触发删除 cancelledTasks 条目，正常 TTL 清理（line 320-343）虽然也清理，但需要等 30 分钟。长期运行的服务上 cancelledTasks 会持续增长。 |
| 3 | **`enqueueTask` 并发计数初始值错误** | P1 | line 244 若 `active < cfg.maxConcurrent`，会立即 `userActiveCount.set(userId, active + 1)`；但任务还没真正开始执行（只是从 registerTask 返回，路由可能还在做准备工作）。如果任务在真正开始前就报错退出且未调用 releaseQueueSlot，会导致该用户并发计数永久 -1（泄露）。 |
| 4 | **`waitForQueueSlot` Promise 可能永远挂起（内存泄漏）** | **P0** | 如果任务在 `queued` 状态被直接从 registry 删除（evict）、或事件总线漏发 `updated` 事件（`updateTaskProgress` 中当 oldStatus==='queued' 且新状态 !== 'queued' 时才 emit 'updated'，但 `enqueueTask` 设置 status='pending' 时**会**emit；但如果直接 `cancelTask`，cancelTask 先 emit 'cancelled' 再 releaseSlot。waitForQueueSlot 确实监听了 cancelled 分支，**但如果任务被 TTL 清理（zombie 逻辑），既不发 pending/processing 也不发 cancelled，waitForQueueSlot 的 Promise 会等到 5 分钟超时才返回 false，期间其闭包引用的 task 对象无法 GC**。 |
| 5 | **`taskEventBus.setMaxListeners(200)` 只是告警阈值提升，未清理监听器** | P1 | 每个 SSE 连接都会 `taskEventBus.on('task-event', handler)`，SSE 客户端断开时若未正确调用 unsubscribe（例如客户端网络断开时 response.close 未触发），监听器会永久堆积。 |
| 6 | **`evictOldestTerminalTasks` 只在 registerTask 时调用，长时空闲后 registry 可能超限** | P2 | 无任务注册时不会清理。 |
| 7 | **Zombie 任务清理的条件判断逻辑有歧义** | P2 | line 324 `if (ACTIVE_STATUSES.includes(task.status) || isTerminal)` 条件永远为真（所有任务要么 active 要么 terminal），内部注释说"终态任务：如果 taskUserMap 中仍有映射，说明之前未正确释放（历史泄露），也需递减"，但这会对所有终态任务（包含已正确释放的）重复递减 active count，导致 active count 变负数。**isTerminal 时 taskUserMap 中仍存在映射就是历史泄露，但这里不做判断就全部递减，会 double-decrement。** |
| 8 | **排队任务队列位置更新只更新剩余队列，不包含已弹出的 nextTaskId** | P2 | line 273 `queue.forEach((id, idx) => updateTaskProgress(id, { queuePosition: idx + 1 }))` 正确。但 nextTaskId 被弹出后 queuePosition 未显式置 0（enqueueTask 中调用的 updateTaskProgress 会设置 queuePosition:0）。 |

### 修复建议
- **P0-1**：重构 release/dequeue 逻辑，使并发计数只在一处维护，避免双处修改。
- **P0-2**：任务进入 `completed/failed` 终态时，立即调用 `cancelledTasks.delete(taskId)`；任务 ID 改用 UUID v4 避免复用风险。
- **P0-4**：TTL 清理 zombie 任务时应 emit 'cancelled' 事件（或自定义 'evicted'），让 waitForQueueSlot 立即退出。
- **P1-5**：SSE 连接关闭必须调用 unsubscribe()；建议使用 FinalizationRegistry 或 WeakRef 兜底。


---

## 四、`src/lib/task-events-client.ts` — SSE 客户端

### 核心功能
浏览器端 EventSource 封装，支持自动重连、事件订阅、任务取消 API。

### 发现的问题

| # | 问题 | 严重度 | 说明 |
|---|------|--------|------|
| 1 | **`connect()` 在已连接或重连挂起时重复创建 EventSource** | P1 | line 45 `if (this.eventSource) return;` 只在 eventSource 存在时 return，但重连等待期间（scheduleReconnect 的 setTimeout 还未触发）eventSource 是 null，此时用户手动调用 connect() 会再次创建 EventSource，而旧的重连定时器仍在运行，导致两个 EventSource 并存，事件重复派发。 |
| 2 | **`disconnect()` 未通知服务端关闭，可能产生半开连接** | P2 | EventSource.close() 只关闭客户端侧，TCP 连接可能在服务端保持直到超时。影响不大但应注意。 |
| 3 | **重连无最大总时长限制** | P2 | 30 次重连最多等 30s+1min+2min+... 按指数退避累计 ~30 分钟，期间 handlers 仍然引用外部闭包可能造成内存滞留。 |
| 4 | **`onmessage` 中静默吞掉 parse 错误** | P2 | line 58-62 catch 块未打日志，调试困难。 |
| 5 | **`scheduleReconnect` 未保存 timer 到 reconnectTimer 之外** | ✅ | disconnect 已清。 |

### 修复建议
- connect() 开头加 `if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }` 防止重入。
- onerror 中区分"致命错误"（4xx）与可恢复错误，401/403 直接停止重连。

---

## 五、`src/lib/agent-engine.ts` — Agent 编排引擎

### 核心功能
Tool 注册表 + LLM 循环，支持多轮工具调用。

### 发现的问题

| # | 问题 | 严重度 | 说明 |
|---|------|--------|------|
| 1 | **🔴 P0：内置工具 execute 都是占位符，返回的 data 是 ctx.imageUrl 原值** | **P0** | line 371-440 所有内置工具（image_edit/generate_image/remove_background/upscale 等）的 execute 都直接 `return { success: true, data: ctx.imageUrl, description: '...指令已记录' }`，**没有真正执行任何操作**。这意味着 agent-auto 节点在前端预览时看起来"工作"，但实际不产生任何新图片。如果生产环境依赖这些内置工具，将完全无效。需要在 route 层补充真正的工具调用。 |
| 2 | **消息历史累积无截断，长循环可能导致 token 爆炸** | P1 | while 循环每轮向 messages 追加 assistant + user 消息，maxRounds=5 时消息长度可控，但工具返回的 description 很长时可能超出 context window。没有任何 token 计数与截断逻辑。 |
| 3 | **`context.imageUrl` 在工具成功后被 `result.data` (string) 覆盖，但 result.data 可能不是 URL** | P1 | line 242 `if (result.success && result.data && typeof result.data === 'string')` 检查了 string 类型，但若工具返回 base64 data URL 会被当作 imageUrl 传递给下一轮，部分工具不能处理 base64。 |
| 4 | **`consecutiveFailures` 计数逻辑** | P2 | line 214 工具不存在时 `continue`（不执行工具），但 consecutiveFailures++；line 252 工具抛异常也++。3 次后终止，这是合理的，但"工具不存在"的场景不应计入连续失败（是 LLM 幻觉，应该反馈给 LLM 让其调整）。 |
| 5 | **buildSystemPrompt 中 `context.maxRounds \|\| DEFAULT_MAX_ROUNDS` 正确，但传入 context.currentRound 从 0 开始，首轮提示"第 1 轮"时实际是 currentRound=1** | P2 | 日志与实际轮次偏移 1。 |
| 6 | **没有取消检查（isTaskCancelled）** | P1 | Agent 循环没有接入 task-registry 的取消信号，用户取消任务后循环仍可能继续运行几轮直到自然结束。 |
| 7 | **toolRegistry 是模块级 Map，多租户/多请求无隔离** | P2 | 若在请求中动态注册工具（如自定义工作流工具），会污染全局注册表并造成竞态。建议改为 context 级注册表或支持请求级卸载。 |

### 修复建议
- **P0-1**：内置工具要么删除（注释说明由 route 层处理），要么 throw Error 告知调用方必须提供真实执行函数。目前的"指令已记录"具有误导性。
- **P1-6**：在循环中加入 `if (ctx.signal?.aborted) break;`（或 isTaskCancelled 检查）。
- 对 messages 做长度截断：超过 N 轮后将早期工具结果替换为摘要。

---

## 六、`src/lib/workflow-engine.ts` — 工作流引擎

### 核心功能
DAG 节点/连线/端口数据模型 + 拓扑排序 + 属性面板配置 + 请求体构建 + AI 建图 + ComfyUI 导入。

### 发现的问题

| # | 问题 | 严重度 | 说明 |
|---|------|--------|------|
| 1 | **🔴 P0：`topologicalSort` 在检测到环时"降级追加"节点，可能导致执行顺序错误** | **P0** | line 1081-1086 检测到环时（sorted.length < nodes.length），将剩余节点按 nodes 原序 push，然后继续执行。但环内节点的输入依赖永远不会满足，getNodeInputs 拿不到上游 result，节点执行必然失败。应直接抛出错误或在 UI 标红环，而不是静默降级。 |
| 2 | **🔴 P0：`getNodeInputs` 未处理多输入同端口冲突，多个上游连到同一端口会被最后一个覆盖** | **P0** | line 1135 `for (const conn of incomingConns)` 直接 `inputs.imageUrl = upstreamOutput.imageUrl`，如果有多个上游连到同一 in-image 端口，后者覆盖前者。对于 image 端口这通常是配置错误，但对于 prompt 端口做了拼接（line 1152 `inputs.prompt = inputs.prompt ? \`${inputs.prompt}, ${promptVal}\` : promptVal;`）。行为不一致，应统一：image 类也应检测并报错/拼接/取数组。 |
| 3 | **`buildNodeExecutionRequest` 中 case 'condition-if'/'condition-switch'/'loop-for' 等逻辑节点缺失独立处理，全部 fallthrough** | P1 | line 1590 `case 'condition-if': case 'condition-switch': case 'loop-for':` 之后紧接着是 `case 'video-speed-change': return { endpoint: '/api/video/tools' ... }`，这意味着**条件节点/循环节点会被错误地构建为 video-speed-change 请求**！这是明显的 switch case 穿透 bug。应该在这些逻辑节点 case 后加 `return null;` 或 break。 |
| 4 | **`autoLayoutWorkflow` 分层 BFS 结果在有跨层连接时可能不正确** | P2 | line 1706-1720 使用"对每个节点取所有上游 level 最大值+1"，这是正确的最长路径分层算法，基本 OK。 |
| 5 | **`parseAIBuildResponse` 的正则 `/\{[\s\S]*\}/` 贪婪匹配，若 LLM 返回多个 JSON 块或 JSON 前后有 `{` `}` 会错误截取** | P1 | 应使用更健壮的括号匹配或要求 ```json 代码块。 |
| 6 | **`createWorkflowFromAIResult` 中 node.id 被直接赋值为 AI 返回的 id，但 AI 可能返回重复 id** | P1 | line 1836 `node.id = n.id;` 若 AI 返回重复 id 会导致连线错乱。应做唯一性校验。 |
| 7 | **`inferVideoModelFromKeywords` 中 `isKling && (...)` 运算符优先级错误** | **P0** | video-api.ts line 351: `const supportsChar = isKling && (lower.includes('v3') && !lower.includes('fast')) \|\| isSeedance \|\| ...`。由于 `&&` 优先级高于 `\|\|`，实际解析为 `(isKling && lower.includes('v3') && !lower.includes('fast')) \|\| isSeedance \|\| ...`，这其实是**正确的**。但 isKling 赋值在前：`isKling = lower.includes('kling') \|\| lower.includes('dashscope') \|\| lower.includes('wanx') \|\| lower.includes('通义')`，会将通义千问（文本模型）误判为可灵家族。**wanx 是通义万相（视频），dashscope 是阿里云平台（包含很多非 Kling 模型），这会导致很多非 Kling 模型被错误打上 Kling 的能力标签**（如首尾帧/运动笔刷等）。 |
| 8 | **演示工作流连接的 portId 与 createDefaultPorts 生成的不一致** | P2 | createDemoWorkflow 中端口 id 是 `n1-out-1` 这种格式，而 createDefaultPorts 生成的是 `out-image` 等语义化 id，连线失效。 |
| 9 | **`NODE_TYPE_LABELS` 缺少 `ai-retouch` 的中文映射？不，已包含** | ✅ | |
| 10 | **PORT_COMPATIBILITY 中 video → image 允许，但下游 image 节点拿到 video URL 会失败** | P2 | line 480 `video: ['video', 'any', 'image']` 声明 video 可以连到 image 端口，但 image 节点无法处理视频，应该去掉 `'image'`。 |

### 修复建议
- **P0-1**：拓扑排序检测到环时抛出异常，让 UI 高亮环路上的节点。
- **P0-2**：多输入同端口时，image 类应取数组形式（inputs.imageUrls = [..., url]），不应静默覆盖。
- **P0-3**：在 switch 中为 `condition-if/condition-switch/loop-for/loop-while/loop-each/parallel/subgraph/group` 添加 `return null;`（目前文件末尾已有这些 case 的 return null，但因为 fallthrough 顺序问题，video-speed-change 的 case 会先匹配到）。**实际看代码，line 1587-1593 `case 'condition-if':/case 'condition-switch':/case 'loop-for':` 后面没有 break/return，直接落到 line 1594 开始的 `case 'video-speed-change'`，必须修复！**

```ts
// 修复：逻辑节点直接返回 null
case 'condition-if':
case 'condition-switch':
case 'loop-for':
case 'loop-while':
case 'loop-each':
case 'parallel':
case 'subgraph':
case 'group':
case 'input-param':
case 'output-image':
case 'output-video':
  return null;    // ← 必须加，否则穿透到 video-speed-change
case 'video-speed-change':
  return { ... };
```

- **P0-7 (video-api)**：平台关键词（dashscope/ark）与模型家族分离判断，先用 modelId 做精确匹配，再用 URL 兜底。

---

## 七、`src/lib/api-compatibility.ts` — API 兼容层

### 核心功能
6 种 Profile 抽象（apimart/openai/pearapi/openai-async/auto/gemini-image），统一参数转换、图片提取、fallback 逻辑。

### 发现的问题

| # | 问题 | 严重度 | 说明 |
|---|------|--------|------|
| 1 | **`resolveProfileForModel` 中 nano-banana 强制返回 openai，但 nano-banana 实际走 gemini-image 协议通过 PearAPI** | P1 | line 718-722：`if (isNanoBananaModel(modelId)) return COMPAT_PROFILES['openai'];`。这是为了修复"PearAPI 适配的 Gemini 模型不走 /chat/completions"，但需确认：如果用户在 PearAPI 官方 baseUrl (pearapi.ai) 上配 nano-banana，URL_PROFILE_RULES 中 pearapi.ai 应该命中 PROFILE_PEARAPI。这里强制 openai 可能会让 pearapi.ai 上的 nano-banana 用错 profile。应该让 URL 匹配优先，模型检测次之。 |
| 2 | **`extractImageUrl` 5-path 解析对 b64_json 正则校验过于简单** | P2 | line 835 `/^[A-Za-z0-9+/=]+$/` 无法排除包含该字符但非 base64 的错误消息；应加上长度检查。 |
| 3 | **`persistResultImage` 对 http 图片下载无大小限制** | P1 | line 668 `fetch(imageUrl)` 下载远程图片到本地，如果攻击者构造超大图片 URL（几 GB），会耗尽服务器内存/磁盘。应加大小上限（如 20MB）。 |
| 4 | **`tryChatCompletionsImageFallback` 中 chatRequestBody 构造后传入 buildGeminiChatImageRequest，**但 buildGeminiChatImageRequest 期望的字段是 prompt/model/size/image/image_urls，而构造的对象含 prompt/model/size/image/image_urls，是正确的** | ✅ | |
| 5 | **`isChannelUnavailableError` 正则可能误报** | P2 | `/no available compatible account/i` 会匹配到 New API 等中转的正常"模型不存在"错误，触发不必要的 fallback。 |
| 6 | **`convertAspectRatioToSize` 对非标准比例动态计算时对齐 64，但 GPT-Image-2 要求 16 对齐、Flux 要求 8 对齐** | P2 | line 1183 写死 `/64)*64`，与模型能力表不一致。应根据 modelId 查询 caps.sizeAlignment。 |
| 7 | **`buildGeminiChatImageRequest` 将 ratioInstruction 只拼到第一个 text 类型 content，但 userContent 中 text 可能不是第一个（图片在前时）** | P1 | line 606-613：遍历 userContent 找第一个 type==='text' 拼入，这是对的，但如果第一个元素是 image_url，则 ratioInstruction 不会拼入（因为 break 前没找到 text）。实际代码中 text 始终 push 在最前，所以是安全的，但代码脆弱。 |
| 8 | **`resolveGeminiImageSize` 硬编码比例→像素映射，未覆盖 5:4/4:5/21:9** | P2 | Gemini 2.5 Flash Image Preview 等新模型支持更多比例，缺少会退化为"ratio exists but quality not found→1K"，可能不是最优。 |
| 9 | **`gcd` 函数未处理 0 输入** | P2 | `gcd(0, x)` 返回 x（正确），但 `gcd(0,0)` 会死循环。当前调用处 w/h 都来自正常分辨率，但建议加防御。 |
| 10 | **`persistResultImage` 自调用 localhost save-image，若端口未启动会死锁** | P1 | line 647 `http://localhost:${internalPort}/api/save-image` 在 Next.js 冷启动阶段可能自调用失败（因为请求处理器中调自己会形成死锁，若 server 未开始接受新连接）。应直接复用 server-data-root 的 saveImageFile 而不是走 HTTP。 |

### 修复建议
- **P1-3**：fetch 远程图片前检查 Content-Length，下载时限制字节数。
- **P1-10**：避免 HTTP 自调用，直接调用保存函数（如 `saveImageFile` from server-data-root）。
- **P1-1**：resolveProfileForModel 中对 nano-banana 的强制 openai 应只在"非 PearAPI 域名"下生效。


---

## 八、`src/lib/api-helpers.ts` — API 辅助

### 核心功能
构建内部/外部 API URL，自动 /v1 重试，超时控制。

### 发现的问题

| # | 问题 | 严重度 | 说明 |
|---|------|--------|------|
| 1 | **🔴 P0：`AbortSignal.any` / `AbortSignal.timeout` 在旧 Node 版本中不可用** | **P0（潜在）** | `AbortSignal.any()` 和 `AbortSignal.timeout()` 是 Node 18+ / 现代浏览器 API。若 Docker 镜像使用 Node 16，会直接抛 `AbortSignal.any is not a function`。需在 package.json 中确认 engines 要求 node>=18，或加 polyfill/降级。检查了 package.json 但未显示（未见engines字段），需要确认。 |
| 2 | **`fetchWithV1Retry` 对 401/403 也认为是"需要重试 /v1"** | P1 | line 142 `if (retryResponse.ok \|\| isJsonLikeResponse(retryResponse))` 对 401/403 JSON 也接受为"成功"，会返回 v1 路径的 401 而不是原始路径的错误，误导用户。 |
| 3 | **`fetchWithV1Retry` 中 v1 重试使用了 `AbortSignal.any([fetchOptions.signal, timeoutSignal])`，但首次请求使用的是 `effectiveOptions.signal`（若有原 signal 则没有新 timeout 叠加）** | P2 | 首次请求若外部传了 signal 但没有 timeout，将不会有默认超时保护。line 112 `if (!effectiveOptions.signal) { effectiveOptions.signal = AbortSignal.timeout(defaultTimeoutMs); }` 只在没有 signal 时添加 timeout。 |
| 4 | **`isUnifiedApiUrl` 正则 `/\/(api|proxy|gateway|rest)(\/v?\d+)?\/?$/` 会错误匹配 `/api` 作为路径末尾** | P2 | 例如 baseUrl 为 `https://example.com/v1/api`，被错误识别为 unified API，跳过 /v1 重试。 |

### 修复建议
- 在 package.json 中加入 `"engines": { "node": ">=18" }` 并在启动时校验。
- fetchWithV1Retry 的 retry 成功条件应改为 `response.ok`，对 4xx JSON 响应继续返回原响应。

---

## 九、`src/lib/api-error-translator.ts` & `api-error-translate.ts` — 错误翻译

### 核心功能
将 API 英文错误翻译为中文提示，分类错误类型。

### 发现的问题

| # | 问题 | 严重度 | 说明 |
|---|------|--------|------|
| 1 | **两个翻译模块并存（api-error-translate.ts 和 api-error-translator.ts），功能重叠** | P1 | api-error-translate.ts 是简单字符串替换（line 8 `export function translateApiError(rawMsg: string): string`），api-error-translator.ts 是完整分类+重试策略。两者都导出 `translateApiError`，容易引起导入混淆。应统一为一个模块，删除旧的 api-error-translate.ts。 |
| 2 | **api-error-translator.ts 中 `isAuthError` 判断过于宽松** | P2 | line 241-247: `lower.includes('authentication')` 会匹配到 `authentication succeeded`/`authentication required` 等正常消息；`lower.includes('api key') && lower.includes('invalid')` 正确，但 `lower.includes('unauthorized')` 无 context 限制。 |
| 3 | **`isContentBlocked` 中 `lower.includes('safety') && lower.includes('blocked')` 运算符优先级** | P2 | `&&` 优先于 `||`，正确，但 line 267 行缺少括号分隔可能导致阅读误解。 |
| 4 | **smart-retry.ts 中重复定义了 `ClassifiedError` 类型，与 api-error-translator.ts 中的 ClassifiedError 结构不一致** | P1 | smart-retry.ts line 37 定义自己的 ClassifiedError，api-error-translator.ts line 33 也定义 ClassifiedError，字段名相同但分类枚举不同（ErrorCategory vs ApiErrorCategory）。若同时导入会产生类型冲突。 |
| 5 | **两个分类器逻辑重复** | P2 | smart-retry.classifyApiError 和 api-error-translator.classifyApiError 是"双实现"，未来新增错误类别需改两处，容易遗漏。 |

### 修复建议
- 删除 `api-error-translate.ts`，所有调用方改用 `api-error-translator.ts`。
- 统一 ClassifiedError 类型到一个文件。

---

## 十、`src/lib/smart-retry.ts` — 智能重试

### 核心功能
错误分类 + 带退避的 fetch 重试。

### 发现的问题

| # | 问题 | 严重度 | 说明 |
|---|------|--------|------|
| 1 | **`fetchWithSmartRetry` 中 `suggestedRetries` 与调用方 `maxRetries` 取小逻辑正确，但 `maxAttempts = maxRetries + 1` 默认 4 次意味着"默认最多 3 次重试"，而 cf_timeout 建议重试 2 次** | P2 | 实际重试次数是 min(maxRetries??suggestedRetries, ...)，若调用方未传 maxRetries，cf_timeout 会重试 2 次（正确）。 |
| 2 | **`fetchWithSmartRetryHttp` 中 response.text() 调用后未检查 response.bodyUsed，后续 response.body 不可重读** | P2 | 调用方拿到的 Response 对象 body 已被消费，若再调 resp.json() 会失败。应在返回前重新构造 Response 或只返回解析后的对象。 |
| 3 | **`isUpstreamRetryable` SSE 解析时部分匹配正则过宽** | P2 | `ev?.item?.type === 'image_generation_call'` 但不检查 ev.item 是否有 result，可能误判。 |
| 4 | **`TRANSPORT_ERROR_MARKERS` 和 `NETWORK_ERROR_MARKERS` 大量重复标记（两个数组都含 timeout/econnreset/...）** | P2 | 分类重复导致 isNetworkError 和 isTransportError 可能同时命中，但逻辑上 network_error 先匹配（line 162），transport 分支永远走不到。 |

### 修复建议
- fetchWithSmartRetryHttp 返回 `{ response, bodyText }` 或让调用方决定如何解析。
- 合并 NETWORK_ERROR_MARKERS 和 TRANSPORT_ERROR_MARKERS。

---

## 十一、`src/lib/size-auto-repair.ts` — 尺寸自动修复

### 核心功能
运行时检测并修复无效尺寸（对齐、比例、像素总数约束）。

### 发现的问题

| # | 问题 | 严重度 | 说明 |
|---|------|--------|------|
| 1 | **🔴 P0：从 API Route 导入违反 Next.js 分层约束** | **P0** | line 14 `import { calculateActualPixelsFromRatio } from '@/app/api/generate/route';`。**严禁从 app/api 下导入代码到 lib/ 中**：1) API Route 文件导出了 `POST` 等 Next.js 路由处理器，导入它会触发 Next.js 的路由模块初始化，可能导致构建时/serverless 打包时错误；2) 这造成了循环依赖风险；3) 可能将 Route 段的 side-effect（如 `export const maxDuration = 600`）误执行。`calculateActualPixelsFromRatio` 是纯函数，应抽到 lib/ 下（如已有的 canvas-generation-group.ts 中的 calculateActualPixels）。 |
| 2 | **`recalculatePixelSize` 中 try-catch 吞掉所有错误** | P2 | 无法定位为什么函数返回 null。建议至少 console.warn。 |
| 3 | **`multiConstraintRepairSize` 中 aspect ratio 约束只在 aspect>maxAspectRatio 时正确，但 aspect<1/maxAspectRatio 分支里 `targetW = targetH / maxAspectRatio` 未更新 targetH** | P1 | line 130-133: 当比例超出 1/max 时只改了 targetW 没有同时按比例缩放 targetH，会导致图片拉伸。应按比例同时缩放 w 和 h：`const scale = (1/maxAspectRatio)/aspect; targetW *= scale;`（保持 targetH 不变，改 targetW；但更合理的是保持面积不变）。 |

### 修复建议
- **P0-1**：立即将 `calculateActualPixelsFromRatio` 从 `app/api/generate/route.ts` 移动到 `src/lib/canvas-generation-group.ts` 或新建 `src/lib/size-utils.ts`，然后 route 和 size-auto-repair 都从 lib 导入。
- **P1-3**：修复 aspect 超下界时的缩放逻辑：

```ts
} else if (aspect < 1 / maxAspectRatio) {
  // 过高：保持宽不变按比例扩高
  const newH = targetW * maxAspectRatio;
  targetH = newH;
}
```

---

## 十二、`src/lib/responses-api-sse.ts` — Responses SSE

### 核心功能
OpenAI Responses API SSE 解析 + 流式保活 + 多格式图片提取。

### 发现的问题

| # | 问题 | 严重度 | 说明 |
|---|------|--------|------|
| 1 | **`parseResponsesApiSSEEvent` 只处理以 `data: ` 开头的行，忽略 SSE 的 `event: ` 行** | P2 | 标准 SSE 允许 `event: xxx` 定义事件类型，`data: {...}` 只包含数据。当前实现忽略 event 行，若某些中转站使用 event 类型区分事件（如 `event: response.failed`），会全部走 'unknown' 分支。 |
| 2 | **`streamResponsesApiSSE` 中 reader.read() 抛出异常后未释放 reader** | P1 | catch 块直接返回但未调用 `reader.cancel()`，在某些 fetch 实现中可能导致连接泄漏。建议 finally 块 `reader.cancel().catch(()=>{})`。 |
| 3 | **`extractImageUrlFromMarkdown` 中正则 `(https?:\/\/[^\s)]+)` 贪婪匹配到右括号前，若 markdown 中图片 alt 包含 `)` 会截断** | P2 | 应使用非贪婪或平衡括号匹配，但实际场景影响小。 |
| 4 | **`inferTextModel` 硬编码返回 gpt-4o 为默认，但用户可能没配置该模型** | P2 | 应允许通过配置传入。 |

### 修复建议
- 在 finally 块中释放 reader。
- 解析 SSE 时跟踪 `event:` 行的事件类型。

---

## 十三、`src/lib/model-capabilities.ts` — 模型能力

### 核心功能
模型家族分类 + 能力声明表 + 请求过滤 + 尺寸修正 + 别名规范化。

### 发现的问题

| # | 问题 | 严重度 | 说明 |
|---|------|--------|------|
| 1 | **`classifyModelFamily` 中 Gemini 正则 `/gemini.*flash/.test(id) && id.includes('image')` 有冗余** | P2 | line 63 先行的 `/gemini.*image/.test(id)` 已覆盖。且 `/gemini-\d.*flash/` 写法中 `\d` 不匹配 `gemini-2.5-flash`（因为 `2.5` 含小数点），实际被后面的 includes 补救。 |
| 2 | **`isNanoBananaModel` 只在 api-compatibility 中定义，model-capabilities 无对应分类** | P2 | nano-banana 被分到 'gemini-image' 家族（line 65），但这些模型实际是 PearAPI 适配的，并非 Google 官方 Gemini，能力（如 supportsNegativePrompt 等）可能不同。 |
| 3 | **`normalizeModelForApi` 的 QUALITY_SUFFIX_RE 会错误剥离模型名本身含有的 `-hd` 后缀** | P1 | line 621: `/-(2k|4k|8k|hd|uhd)$/i` 会将 `stable-diffusion-3-hd` 这种真实模型名错误截断。例如若存在模型 `xxx-hd`（如 Ideogram HD），会被错误归一化。建议要求管理员使用明确分隔符（如 `__2k`）或在匹配前检查 base 部分是已知模型。 |
| 4 | **`repairSizeForModel` 中边长约束缩放时没有保持 w/h 比例** | P1 | line 567-578 对 width>maxSide 和 height>maxSide 分别独立 scale，会导致图片变形。应该只按比例取最小 scale。 |

### 修复建议
- **P1-3**：QUALITY_SUFFIX_RE 改为匹配管理员别名专用模式（如 `@2k`、`~4k`），或只对管理员显式标记的自定义模型名生效。
- **P1-4**：修复为 `const scale = Math.min(maxSide/width, maxSide/height); width*=scale; height*=scale;`。

---

## 十四、`src/lib/model-name-map.ts` — 模型名称映射

### 核心功能
模型技术 ID → 市场名/简称/厂商的映射。

### 发现的问题

| # | 问题 | 严重度 | 说明 |
|---|------|--------|------|
| 1 | **`seedream` 模式重复定义（line 132 和 line 180 重复）** | P1 | line 132 `{ pattern: 'seedream-4', entry: {... provider: 'ByteDance' } }`，line 180 又有 `{ pattern: 'seedream-4', entry: {... provider: 'ByteDance' } }`。由于按顺序匹配，第一个先命中，第二个永远不会生效。**同样 pattern 'seedream' 出现两次（line 133 和 line 183）**。 |
| 2 | **`veo3.1` 被分类为 type: 'image'，但 Veo 是视频模型** | **P0** | line 187 `{ pattern: 'veo3.1', entry: { name: 'Veo 3.1', type: 'image', provider: 'Google' } }` 类型错误，应为 `'video'`。会导致 UI 在"图像模型"列表展示视频模型。 |
| 3 | **`imagen` pattern 过于宽泛，可能匹配到包含"imagen"字样的其他模型** | P2 | `imagen` 会匹配到 `imagination-xxx` 等。 |
| 4 | **`gpt-image` 宽泛匹配，会命中 `gpt-image-1`/`gpt-image-2` 等具体条目之后但由于先匹配更具体的所以 OK** | ✅ | 因为更具体的 gpt-image-2 在前。 |
| 5 | **`sora` 同样出现在 image 和 video 两个位置** | P1 | line 160 `{ pattern: 'sora', ... type: 'image' }` 和 line 370 的 video 区域没有 sora，但 line 160 先匹配，所以 `sora` 永远被分类为 image。实际上 OpenAI Sora 是视频模型。 |
| 6 | **`gen-4`/`gen-3-alpha` 等 Runway 模型同时在 image 和 video 中出现** | P1 | 这些是视频模型，但在 image 列表中没有（检查代码，image 部分没有 gen-4，OK）。但 pattern `gen-4` 会错误命中任何含 "gen-4" 的模型 ID（如某图像模型 gen-4x）。 |

### 修复建议
- **P0 (veo3.1)**：type 改为 `'video'`。
- **P1 (sora)**：line 160 image 段中删除 sora，保留 video 段中的 sora（line 386）。
- 删除重复的 seedream 条目。

---

## 十五、`src/lib/video-api.ts` — 视频生成 API（6 种协议）

### 核心功能
dashscope/volcengine-ark/minimax/vidu/openai-video/fal-video/rest-generic 协议适配器 + 轮询解析。

### 发现的问题

| # | 问题 | 严重度 | 说明 |
|---|------|--------|------|
| 1 | **`resolveVideoCompatProfile` 中 baseUrl 分支逻辑冗余且有 bug** | P1 | line 395-408: `if (!urlLower.includes('volcengine') && !urlLower.includes('ark') && !urlLower.includes('dashscope') && !urlLower.includes('aliyun')) { return 'rest-generic'; }` —— 这段代码在前面判断完所有"官方域名"后，如果都没命中就返回 rest-generic，**但它写在了 `if (urlLower.includes('openai')) return 'openai-video';` 之后，且最后一句永真——只要不是官方域名就返回 rest-generic，这是对的**。但是：`if (urlLower.includes('dashscope') \|\| urlLower.includes('aliyun')) return 'dashscope';` 会把任何第三方代理（例如 api.apimart.aliyuncs.com 上挂的非 Kling 模型）都错误路由到 dashscope 协议。 |
| 2 | **`buildDashscopeSubmit` 使用 `/api/v1/tasks` 但缺少 `/services/aigc/video-generation/` 前缀？** | 待确认 | 万相/可灵的实际 DashScope OpenAPI 端点是 `/api/v1/services/aigc/video-generation/video-synthesis`，不是 `/contents/generations/tasks`（那是火山方舟）。当前 buildVolcengineSubmit 用 `/contents/generations/tasks`（正确），但 buildDashscopeSubmit 需要确认是否对。 |
| 3 | **`parseVideoSubmitResponse` 对 `__sync_complete__` 的处理** | P2 | 当 rest-generic 返回同步结果时，taskId 设为 `__sync_complete__`，轮询时需要跳过 poll，这依赖调用方判断，容易漏判。 |
| 4 | **`inferVideoModelFromKeywords` 中 `supportsChar` 运算符优先级虽然正确，但括号误导** | P2 | line 351: `isKling && (lower.includes('v3') && !lower.includes('fast')) \|\| isSeedance \|\| ...` —— 已在 workflow-engine 部分讨论过，正确但缺注释。 |
| 5 | **`buildFalVideoSubmit` 中 Authorization 头使用 `Key ${apiKey}` 是 fal.ai 的正确格式** | ✅ | |
| 6 | **轮询请求未设置超时** | P1 | buildVideoPollRequest 返回对象无 signal/timeout，调用方 fetch 可能挂起。 |
| 7 | **`parseDashscopePoll` 中 `video_result?.[0]` 对视频列表只取第一个，丢失多视频结果** | P2 | 某些 API 一次生成多个视频，只取第一个会丢失结果。 |
| 8 | **fal.ai 轮询需要 `req_id` 并到 `queue.fal.run/requests/{req_id}/status` 和 `.../response`，但 buildFalVideoPoll 实现未阅读完整代码** | 待确认 | 需检查 fal 适配器是否遵循 queue-subscribe 模式。 |

### 修复建议
- **P1-1**：URL 匹配优先使用"显式 compatProfile 配置"，只有在用户未配置时才用 URL 模式推断，且严格匹配完整域名（如 `(^|\.)dashscope\.aliyuncs\.com$`）。
- **P1-6**：buildVideoPollRequest 返回增加 timeout 字段，或调用方统一使用 fetchWithTimeout。


---

## 十六、`src/lib/image-tools/iopaint-client.ts` — IOPaint 客户端

### 核心功能
Python 子进程调用 LaMa 擦除 / rembg 去背景 / HTTP 服务兜底。

### 发现的问题

| # | 问题 | 严重度 | 说明 |
|---|------|--------|------|
| 1 | **🔴 P0：`callPythonScript` 中 Python 子进程的 stdin 写入可能被背压阻塞，导致死锁** | **P0** | line 623 `proc.stdin.write(inputData); proc.stdin.end();` 是同步写入。当 inputData 较大（图片 base64 通常 500KB-5MB）时，若子进程尚未开始读取 stdin，write() 可能在 Node.js libuv 内部缓冲区满时同步等待（虽然 Node 的 Stream.write 对 pipe 通常不阻塞，但同步写法在极端情况下会造成 event loop 阻塞）。更严重的是：**stdout/stderr 没有持续消费，若 Python 进程向 stderr 写大量输出（如 torch 初始化日志），stderr 的 OS 管道缓冲区（通常 64KB）被写满后 Python 进程会阻塞在 write() 上，而 Node.js 端等待 close 事件 → 死锁直到超时**。当前虽然注册了 `proc.stderr.on('data')`，但 on('data') 默认是流动模式，应该能消费。**但是 on('data') 监听器是在 proc.spawn 之后才注册的，存在竞态：如果子进程在 spawn 后立刻写 stderr（非常快的失败路径），数据可能在监听器注册前触发，导致 error 事件丢失或进程挂起**。 |
| 2 | **`checkPythonEnv` 的 execSync 可能阻塞 event loop** | P1 | line 110 `execSync(\`which ${pythonBin}\`, ...)` 是同步调用，会阻塞整个 Node.js 事件循环长达 10 秒（timeout 10000）。在高并发服务器中这会导致所有请求暂停。应改为 async `execFile`。 |
| 3 | **`checkPythonEnv` 有 5 分钟缓存，但 `_pythonEnvAvailable` 是模块级全局变量，Next.js dev HMR 时不会重置** | P2 | 生产环境没问题，但开发时可能因环境安装后还需等 5 分钟才重新检测。 |
| 4 | **`eraseWithLama` 中 `checkPythonEnv()` 在 removebg 分支和 erase 分支分别检查，但缓存的 `_pythonEnvAvailable` 被共用** | P1 | 若先调用 removebg（只检查 rembg）成功，再调用 erase（需要 torch），缓存仍为 true 但 torch 未安装，导致 erase 失败而非走 HTTP 兜底。`checkPythonEnv(mode)` 的 mode 参数**只在首次检查时生效**，后续缓存直接返回，不会重新验证对应 mode 的依赖。 |
| 5 | **`performInpaint` 先尝试 Python 子进程，失败后尝试 HTTP 服务，但 Python 子进程启动失败（如模型不存在）时错误消息已包含明确指引，但 HTTP 兜底可能因服务不存在而快速失败，用户体验可接受** | P2 | |
| 6 | **Python 子进程被超时 kill 时使用 SIGKILL，可能遗留子进程（pip/torch 子进程）** | P1 | line 586 `proc.kill('SIGKILL')` 只杀 Python 主进程，Python 启动的子进程（如 pip install 触发的下载）变成孤儿。应使用 pid 组杀死（`kill(-pid)`）或 detached 模式。 |
| 7 | **`callPythonScript` 未设置子进程工作目录 cwd** | P2 | Python 脚本中若使用相对路径 import 可能出问题，需显式 `cwd: SCRIPTS_DIR` 或 project root。 |
| 8 | **`generateRemoveBgMask` 硬编码了 `scripts/iopaint_removebg.py` 为相对路径，但 callPythonScript 接受相对路径时依赖 process.cwd()** | P1 | line 413 `callPythonScript('scripts/iopaint_removebg.py', ...)` 其他调用用的是 `path.join(__dirname, '../../scripts/...')` 风格的绝对路径（ERASE_SCRIPT/REMOVEBG_SCRIPT 常量）。这里硬编码相对路径，在 Next.js 编译后 cwd 可能不是项目根，导致找不到脚本。 |
| 9 | **`readImageToBuffer` 中 HTTP 路径 `fetch(imageUrl)` 未设超时** | P1 | line 163 file.ts 的 readImageToBuffer 对远程 URL 未设 AbortSignal.timeout，可能挂起。 |

### 修复建议
- **P0-1**：先注册 stdio 的 data 监听器，再写入 stdin；或使用 Promise 链式确保监听器已就绪。考虑设置 `stdio: ['pipe', 'pipe', 'pipe']` 后立即在 spawn 前/后同步 on('data')。
- **P1-2**：把 execSync 改为 async execFile。
- **P1-4**：按 mode 分别缓存 `_pythonEnvAvailable`，或每次调用时校验对应模块。
- **P1-6**：spawn 时加 `detached: true`，kill 时 `process.kill(-proc.pid, 'SIGKILL')`。
- **P1-8**：改为绝对路径 `path.join(SCRIPTS_DIR, 'iopaint_removebg.py')`。

---

## 十七、`src/lib/image-tools/config.ts` — 图片工具配置

### 核心功能
模型/输出目录、Python 路径、超时等常量。

### 发现的问题

| # | 问题 | 严重度 | 说明 |
|---|------|--------|------|
| 1 | **`UPSCAYL_MODELS_DIR` 环境变量读取错误** | P1 | line 79 `process.env.UPSCAYL_MODELS_DIR \|\| (fs.existsSync('/space/upscayl-models') ? '/space/upscayl-models' : ...)`，但文件顶部 `import fs from 'fs'` 是同步导入，存在时返回 `/space/...`，没有问题。但是 line 66 `export const UPSCALE_OUTPUT_DIR = _upscaleDir.dir;` 而 _upscaleDir 是 resolveOutputDir 返回值——生产环境下 urlPrefix 是 `/api/serve-upload/uploads/upscale`，但 saveOutputBuffer 中 outputDir 匹配逻辑只对 UPSCALE_OUTPUT_DIR 和 INPAINT_OUTPUT_DIR 精确匹配，若通过 custom outputDir 调用 saveOutputBuffer，会走到 `outputDir.startsWith(PUBLIC_DIR)` 分支，生产环境 PUBLIC_DIR 可能不存在或不可写，导致文件保存到 urlPrefix 错误的路径。 |
| 2 | **`PYTHON_BIN` 的 `require('fs').accessSync(VENV_PYTHON)` 在模块加载时同步执行** | P2 | Next.js 打包时如果在 client 组件中导入 config.ts 会失败（因为 fs 模块在浏览器中不可用）。目前所有 image-tools 只在服务端使用，但没有显式 `'use server'` 标记，存在被 client bundle 引入的风险。 |
| 3 | **`LOCAL_AI_ENABLED` 默认为 dev 启用，但生产环境默认关闭** | ✅ | 合理。 |

### 修复建议
- 对所有 image-tools 子模块添加 `'use server'` 标注或确保只在 server-only 路径导入。

---

## 十八、`src/lib/image-tools/file.ts` — 文件工具

### 核心功能
目录创建、文件名生成、图片读取、缩放、保存。

### 发现的问题

| # | 问题 | 严重度 | 说明 |
|---|------|--------|------|
| 1 | **`saveOutputBuffer` 使用同步 writeFileSync** | P1 | line 158 `fs.writeFileSync(filepath, buffer)` 在高并发下会阻塞 event loop，特别是大 buffer（几 MB）。应改为 writeFile 异步，但调用方大量使用同步写法，需统一改。 |
| 2 | **`saveOutputBuffer` 开发环境复制到 public 时，未检查源文件是否与目标文件相同（可能硬链接失败）** | P2 | line 172 `fs.copyFileSync(filepath, publicTarget)` 若 filepath 和 publicTarget 是同一文件（软链接场景）会报错，但 catch 已吞掉。 |
| 3 | **`saveOutputBuffer` 的 urlPrefix 判断逻辑不完备** | P1 | line 160-168 只对 UPSCALE_OUTPUT_DIR 和 INPAINT_OUTPUT_DIR 显式判断，removebg/temp 等目录会走到 startsWith(PUBLIC_DIR) 或 `/api/serve-upload` 分支。生产环境下若 outputDir 是 TEMP_DIR，urlPrefix 可能返回包含磁盘绝对路径的错误 URL（line 167 `'/api/serve-upload' + path.dirname(filepath)` 这里 filepath 是绝对路径，例如 `/space/wujie-data/uploads/temp/xxx.png`，path.dirname 会返回 `/space/wujie-data/uploads/temp`，最终 URL 变成 `/api/serve-upload/space/wujie-data/uploads/temp`，而不是 `/api/serve-upload/uploads/temp/xxx.png`）。**这是一个明确的 bug：urlPrefix 计算错误。** |
| 4 | **`readImageToBuffer` 对 data URL 的处理用了 `split(',')[1]`，但没有处理 data URL 可能包含多个 `,`（如 base64 中含参数）** | P2 | 正常 data URL 格式是 `data:mime;base64,<data>`，split(',',1)[1] 只取第一个逗号前，会丢失后续数据。应使用 `indexOf(',')` 然后 `slice(pos+1)`。 |
| 5 | **`readImageToBuffer` 对远程 URL 没设超时** | P1 | 可能挂起。 |

### 修复建议
- **P1-3**：重写 urlPrefix 计算逻辑：根据是否生产环境 + 子目录名，统一构造 `/api/serve-upload/uploads/{subdir}` 或 `/outputs/{subdir}`。
- 所有 fs 同步方法在热路径上改为异步。

---

## 十九、`src/lib/image-tools/mask.ts` — 蒙版工具

### 核心功能
蒙版验证、归一化、二值化。

### 发现的问题

| # | 问题 | 严重度 | 说明 |
|---|------|--------|------|
| 1 | **`convertToBinaryMask` 中通道数判断使用 `channels as 3 \| 4` 强转，但 sharp 返回的 channels 可能是 other（如 grayscale=1）** | P2 | line 83 `raw: { width, height, channels: channels as 3 \| 4 }`，如果输入是单通道 mask（JPEG 灰度），channels=1 强转为 3 会导致 sharp 解码错误。应确保先 `.ensureAlpha()` 已将 channels 变为 4（line 65 已调用 ensureAlpha，但 resize 后未再次 ensureAlpha，若原图是 3 通道 PNG，ensureAlpha 后变 4，安全）。 |
| 2 | **二值化阈值固定 127 没提供参数调节** | P2 | 某些场景（软画笔、低流量蒙版）会被错误二值化。 |
| 3 | **`createEmptyMask` 创建 3 通道黑色 PNG，但后续 validateAndNormalize 会调用 ensureAlpha** | ✅ | 正确。 |

### 修复建议
- 基本功能 OK，建议添加阈值参数。

---

## 二十、`src/lib/image-tools/upscayl.ts` — 无损放大

### 核心功能
Python ONNX Real-ESRGAN 放大 + sharp Lanczos3 兜底。

### 发现的问题

| # | 问题 | 严重度 | 说明 |
|---|------|--------|------|
| 1 | **`PYTHON_BIN` 在文件顶部被重新定义，覆盖了 config.ts 中的智能路径** | P1 | line 58 `const PYTHON_BIN = process.env.PYTHON_BIN \|\| 'python3';` 忽略了 config.ts 中考虑 venv 的路径选择逻辑，可能使用系统 python3 而非 venv python，导致找不到 onnxruntime 依赖。应从 config.ts 导入 PYTHON_BIN。 |
| 2 | **`isOnnxUpscaleAvailable` 使用 spawn 同步风格（但实际是 Promise 包装），`timeout: 10000` 在 options 中但 spawn 不支持 timeout 选项** | P1 | Node.js `spawn` 的 options **没有 timeout 字段**（只有 exec/execFile 有），这行 timeout 无效。如果 python3 挂起，检查会永远不返回，应手动用 setTimeout + kill。 |
| 3 | **`callOnnxUpscale` 中文件模式下 outputFile 被指定为 OUTPUT_DIR/filename，但 outputFile 路径可能与后续 finalOutputPath 重复（两次 writeFileSync 写同一个文件）** | P2 | line 343 写 outputFile，line 362 `if (finalOutputPath !== result.outputFile)` 后再 writeFileSync 一次，若相同则跳过（正确）。但 finalBuffer 经过 sharp 后已经是处理过的数据，而 outputFile 是 Python 原始输出，处理后应该覆盖原文件，是正确的。 |
| 4 | **`callOnnxUpscale` 同样存在 stdio 竞态与 SIGKILL 杀不净子进程问题** | P1 | 与 iopaint-client 的 callPythonScript 相同问题。 |
| 5 | **tmpDir 用 fs.mkdtempSync 创建，在 finally 中 rmSync 清理，是正确的** | ✅ | |
| 6 | **`isOnnxUpscaleAvailable` 返回 available=true 但模型文件可能是 realesrgan-x4plus.onnx 而非 realesrgan-x4plus-fp16.onnx，实际脚本加载哪个？** | 待确认 | Python 脚本 `upscale_onnx.py` 中是否处理了模型选择。若硬编码 fp16 文件名，非 fp16 模型即使存在也用不了。 |
| 7 | **`calcTimeoutMs` 估算过小可能误杀大图任务** | P2 | secondsPerTile=12s 对于 128 tile 在 CPU 上可能过短，导致大任务连续超时。 |

### 修复建议
- **P1-1**：从 config.ts 导入 PYTHON_BIN，不要重新定义。
- **P1-2**：移除 spawn 的 timeout 选项，改用 AbortController + setTimeout kill。

---

## 二十一、`scripts/iopaint_erase.py` — LaMa 擦除脚本

### 核心功能
Python 端调用 IOPaint 模型执行擦除，通过 stdin/stdout JSON 通信。

### 发现的问题

| # | 问题 | 严重度 | 说明 |
|---|------|--------|------|
| 1 | **`import torch` 在函数 `run_erase` 内部重复（外层 try 和内层 device 检测都 import torch）** | P2 | line 227 函数顶部 `import torch`，line 253 `import torch` 再次检查 cuda。Python 模块缓存使第二次 import 为 no-op，但外层 try 的 torch.set_num_threads(2) 与内层 import 顺序问题：如果外层 ImportError 被 catch（torch_path=None），内层仍会 `import torch` 并成功，这个逻辑是对的，但可以重构为单次 import。 |
| 2 | **模型加载每次调用都重新初始化（`LaMa(device=device)` + `model.init_model(device=device)`）** | **P0** | 每次 HTTP 请求或子进程调用都会重新加载模型权重到内存（~200MB），然后在进程退出时释放。在子进程模式下这是预期的（每次启动 Python 进程），但如果通过 HTTP 服务模式使用 IOPaint，模型常驻内存是正确的。然而在子进程模式下**每次都重新加载模型**意味着每次擦除要 5-15 秒模型加载时间 + 推理时间，CPU 高负载。建议在 Python 端实现模型缓存（多请求复用进程），但这是架构层面的改进。 |
| 3 | **`torch.set_num_threads(2)` 限制 CPU 线程，但未设置 OMP_NUM_THREADS/MKL_NUM_THREADS** | P2 | torch 的 set_num_threads 只控制 intraop threads，底层 MKL/OpenMP 可能仍启动多线程，造成 CPU 过载。 |
| 4 | **`cv2.imdecode` 对 1 通道 mask 的处理：`img.squeeze(axis=2)` 只在 shape[2]==1 时工作，若图像是灰度 PNG 读取后 shape 为 (H,W)（无第3维），squeeze 会误把 H 或 W 为 1 的维度误删** | P1 | line 83 `if img.ndim == 3 and img.shape[2] == 1: img = img.squeeze(axis=2)` 用了 axis=2 安全。 |
| 5 | **输出编码 `encode_np_to_base64` 接收 BGR，但 IOPaint model(image_rgb, mask_gray, config) 返回 BGR** | ✅ | 文档注释正确（line 276: `输出: BGR IMAGE`），与 cv2.imencode 一致。 |
| 6 | **`check_model_available` 中检查文件大小 `> 1_000_000`（1MB）** | P2 | zits 子模型文件较小（edge-line 可能 <1MB？），检查阈值过高会误判模型无效。实际 zits 模型应在 5MB+，OK。 |
| 7 | **脚本入口没有捕获 KeyboardInterrupt/ BrokenPipeError** | P2 | 当 Node 端超时 kill 进程时，Python 会收到 BrokenPipeError，没有捕获会在 stderr 打印 traceback（无害但污染日志）。 |

### 修复建议
- **P0-2（架构）**：考虑使用 Python 常驻进程（如 gRPC/HTTP 服务）复用模型，避免每次冷启动。当前子进程模式适合低频调用，高并发场景不适用。
- 设置 `os.environ['OMP_NUM_THREADS']='2'` 等环境变量。

---

## 二十二、`scripts/iopaint_removebg.py` — 去背景脚本

### 核心功能
rembg 库去除背景 + 蒙版优化（膨胀 + 高斯模糊）。

### 发现的问题

| # | 问题 | 严重度 | 说明 |
|---|------|--------|------|
| 1 | **`new_session(model_name)` 每次调用都创建新 session（加载模型）** | **P0** | 与 erase 脚本相同，每次调用都重新加载模型（~170MB），在频繁调用场景性能极差。子进程模式下无法避免，但应在文档中明确。 |
| 2 | **`remove` 返回 RGBA，然后 `split()[-1]` 提取 alpha，再对 mask 做 MaxFilter(5)+GaussianBlur(1.5)** | ✅ | 正确的蒙版优化流程。 |
| 3 | **`mask_img.resize(original_size, Image.LANCZOS)` 和 `result_resized = result.resize(original_size, Image.LANCZOS)` 两次 resize，但 rembg 可能已经把图像 resize 回原尺寸了** | P2 | 重复 resize 会造成图像二次模糊。可以先检测尺寸是否一致再 resize。 |
| 4 | **MaxFilter(size=5) 对 5x5 窗口取最大值等价于膨胀 2 像素，对于前景主体边缘过度膨胀会包含背景像素** | P2 | 膨胀 + 模糊的组合在某些对比度较低的图片上会产生白边，建议提供可调参数。 |
| 5 | **没有对输入图片尺寸做上限检查** | P1 | 超大图（>4000px）会导致 rembg 内存爆炸（4000x4000x4 float = 64MB+，内部处理可能放大 5-10 倍）。应在 Python 端限制 max_edge，与 iopaint_erase.py 一致（2048）。 |

### 修复建议
- **P1-5**：在 `remove_background` 开头添加 max_edge=2048 的尺寸限制。
- 考虑复用 session（使用全局字典缓存）。

---

## 二十三、`scripts/start-iopaint-lama.sh` — IOPaint 启动脚本

### 核心功能
启动 IOPaint HTTP 服务（兼容旧版）。

### 发现的问题

| # | 问题 | 严重度 | 说明 |
|---|------|--------|------|
| 1 | **使用 `iopaint start` 命令但未检查是否安装** | P2 | 若 iopaint CLI 未安装会直接报错退出，没有友好提示。 |
| 2 | **没有设置 `--model-dir` 的持久化目录到 /space** | P2 | 与 iopaint_erase.py 的 IOPAINT_MODELS_DIR 逻辑一致，但 shell 中 MODEL_DIR 正确传入了 `--model-dir="$MODEL_DIR"`，OK。 |
| 3 | **缺少 `nohup`/后台模式和日志文件** | P2 | 直接前台启动，关闭 terminal 服务停止。生产环境需要 systemd/supervisor 管理。 |

### 修复建议
- 添加错误提示和检查 iopaint 是否可用。

---

## 二十四、`src/lib/image-compress.ts` — 图片压缩

### 核心功能
前端 Canvas 压缩 + 自动降质量重试。

### 发现的问题

| # | 问题 | 严重度 | 说明 |
|---|------|--------|------|
| 1 | **🔴 P0：`loadImage` 函数对 string 类型 source 设置 crossOrigin='anonymous' 后直接 img.src=source，但没有处理 CORS 失败；同时 ObjectURL 分支提前 return，string 分支的 onload/onerror 在 return 之后才赋值给 img.onload/onerror，导致对 string source 永远不会触发 resolve/reject（onload 始终是 null）** | **P0** | line 127-148：当 source 是 string 时，先设置 img.crossOrigin，再 `img.src = source;`（line 136），但此时 img.onload 和 img.onerror **还未被赋值**（赋值在 line 145-146，在 else 分支 return 之后）。由于 src 赋值后图片加载是异步的，onload/onerror 会在后续同步代码执行完之后才绑定，但此时图片可能已经 load 完成了！若图片已在浏览器缓存中，onload 可能在赋值 src 的微任务中立即触发（某些浏览器），此时监听器还没绑定，Promise 永远 pending。**这是确定性 bug**。 |
| 2 | **`compressAndSave` 中 POST body 用的是 `{ imageData: source }`，但 save-image API 期望的字段是 `imageUrl` 或 `imageData`？需核对** | P1 | line 100、113 POST body 都是 `{ imageData: result.dataUrl }`，需确认 API 是否接受。api-compatibility.ts 中 save-image 接收 `{ imageUrl }`，字段名不一致。 |
| 3 | **压缩循环中递减 quality *= 0.8 可能导致质量快速下降（5 次后 0.85→0.68→0.55→0.44→0.35→0.28）** | P2 | 0.28 质量已经很差，5 次重试可能过多。 |
| 4 | **缩小时 `scale=0.75` 可能导致无限循环** | P2 | 虽然 attempts 限制了，但缩小后不再重新检查大小。 |

### 修复建议
- **P0-1**：重写 loadImage 函数，统一先绑定 onload/onerror，再设置 src：

```ts
function loadImage(source: string | File | Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load image'));
    if (typeof source === 'string') {
      img.src = source;
    } else {
      const url = URL.createObjectURL(source);
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Failed to load image')); };
      img.src = url;
    }
  });
}
```

---

## 二十五、`src/lib/remove-bg-postprocess.ts` — 去背景后处理

### 核心功能
本地/AI RemoveBG 结果后处理（边缘修复、白背景合成、蒙版膨胀）。

### 发现的问题

| # | 问题 | 严重度 | 说明 |
|---|------|--------|------|
| 1 | **`sharp` 导入重复（文件顶部 `import sharp from 'sharp'` 与函数内 `const sharp = (await import('sharp')).default` 混用）** | P1 | line 19 顶部静态 import 了 sharp，在 `postProcessAIRemoveBG` 中多处又使用 `await import('sharp')` 动态导入。这在 Next.js 中如果被 client bundle 意外引入会导致构建失败（sharp 是 native 模块），但该文件只在服务端使用。重复 import 无害但冗余。 |
| 2 | **`repairEdgeColors` 双重循环对全图像素 5x5 遍历，时间复杂度 O(W×H×25)** | P2 | 对 2048x2048 图像（4M 像素）就是 100M 次操作，在 Node.js 主线程上执行可能阻塞 event loop 数百毫秒。应考虑用 sharp 的原生卷积/median 滤波器，或移到 worker_threads。 |
| 3 | **`postProcessLocalRemoveBG` 中合成白背景时 meta.width/height 可能为 undefined（`meta.width \|\| 1`）** | P2 | 防御 OK。 |
| 4 | **AI removebg 策略1中 dilatedAlpha 用 3x3 最大滤波膨胀，但 dilation 是原地计算新 buffer，正确** | ✅ | |
| 5 | **策略2 差异分析中 `threshold = Math.max(20, medianDiff + 0.3 * (q75Diff - medianDiff))` 阈值固定，在光线复杂的图片上可能误分割** | P2 | 自适应阈值已是较好策略，但极端情况仍有问题。 |
| 6 | **策略3 边缘颜色检测 `bgTolerance=70` 硬编码，在渐变背景或纹理背景上会失败** | P2 | 策略3 作为兜底，本身是 best effort。 |
| 7 | **`postProcessAIRemoveBG` 中策略 1/2/3 都做 `origResized`（缩放原图到 AI 结果尺寸），重复 resize 多次，浪费 CPU** | P1 | 每次策略都重新 resize 原图，应在策略外缓存 origResized 结果。 |
| 8 | **没有图像尺寸上限** | P1 | 传入 4000+px 图片会导致 raw pixel 操作内存爆炸（4000x4000x4 = 64MB，多 Buffer 并存易 OOM）。 |

### 修复建议
- **P1-7**：策略判断前提早 resize 原图，各策略复用。
- **P1-8**：限制处理图片最大边长（如 2048）。
- 考虑把 repairEdgeColors 改为 sharp 的 morphology/median 操作，性能更好。

---

## 二十六、`src/lib/psd-export.ts` — PSD 导出

### 核心功能
浏览器端 AI 分层 + ag-psd 写入 PSD 文件。

### 发现的问题

| # | 问题 | 严重度 | 说明 |
|---|------|--------|------|
| 1 | **文件顶部 `'use client'`，纯前端 Canvas 操作，无 Node 依赖** | ✅ | 正确。 |
| 2 | **`sampleCornerColors` 采样 4 个角 + 边缘，取中位数作为背景色，但复杂图像（如全主体无背景、非纯色背景）会误采样到主体像素** | P2 | 中位数比平均值鲁棒，但仍有局限。 |
| 3 | **文件很大（2745行），模块职责混杂（分层算法 + UI 类型定义 + PSD 写入）** | P2 | 可拆分为多个子模块，但当前可维护。 |

### 修复建议
- PSD 导出模块整体设计良好，主要是性能和算法准确性的改进（非 bug）。

---

## 二十七、`src/lib/svg-export.ts` — SVG 导出

### 核心功能
浏览器端位图转矢量（颜色量化 + 轮廓追踪 + 路径简化 + 曲线拟合）。

### 发现的问题

| # | 问题 | 严重度 | 说明 |
|---|------|--------|------|
| 1 | **`buildPaletteFast` 中层次聚类是 O(N²) 复杂度，对高 colorPrecision 会很慢** | P2 | 但在浏览器端运行，应该加 Web Worker 避免阻塞 UI。当前没有 Web Worker，大图片（>1024px）会阻塞主线程数百毫秒。 |
| 2 | **注释 `/**` 后面又有一个 `/**`（line 65-66）是 JSDoc 重复** | P2 | 无害但格式错误。 |
| 3 | **轮廓追踪使用 4 邻域 stack-based flood fill，大区域可能栈溢出（JS 数组作为栈不会溢出，但会大量内存分配）** | P2 | |

### 修复建议
- 大图像时使用 OffscreenCanvas + Web Worker。

---

## 二十八、`src/lib/fetch-image-buffer.ts` — 图片 Buffer 获取

### 核心功能
从 data URL、本地路径、S3、外部 URL 获取图片 Buffer。

### 发现的问题

| # | 问题 | 严重度 | 说明 |
|---|------|--------|------|
| 1 | **🔴 P0：路径穿越防护不完整** | **P0** | line 38 `const sanitizedUrl = decoded.replace(/\.\./g, '').replace(/\/\//g, '/');` **通过字符串删除 `..` 来防御路径穿越，这种"黑名单删除"策略可以被绕过**。例如：`....//` 删除 `..` 后变成 `../`（因为删除第一对 `..` 后 `....//` → `../`，再删除 `//` 变成 `../`）。或者用 `..././` 绕过。而且 `decodeURIComponent` 只解码一次，双重编码（`%252e%252e%252f` → `%2e%2e%2f` → `../`）会绕过。正确做法是用 `path.resolve` 后用 `startsWith(allowedBaseDir)` 白名单校验（代码中 line 47/55 已有 startsWith 检查，这才是真正的安全边界！）**但** line 38 的 sanitize 是多此一举，反而可能因为误删字符导致合法路径被破坏（如文件名为 `my..photo.png` 会被变成 `myphoto.png`）。**startsWith 校验才是真正的防护，应移除 sanitize 逻辑，直接用 path.normalize 后 startsWith。** |
| 2 | **`path.basename(sanitizedUrl)` 构造 uploadPath 会丢失子目录信息** | P2 | line 62 用 basename 只取文件名，如果相对路径包含子目录如 `uploads/2024/01/a.png`，会变成 `uploads/a.png`，导致文件找不到。 |
| 3 | **S3 超时 Promise.race 中 setTimeout 返回 null，但 5s 后没有 abort 信号，下载继续在后台运行** | P1 | line 68-74 即使 timeout 触发返回 null，downloadImageFromS3 仍然继续执行，可能积累大量未关闭请求。应使用 AbortSignal。 |
| 4 | **source URL 重新下载 5s 超时过短** | P2 | |
| 5 | **localhost fetch 用 `http://localhost:${port}${url}`，url 可能是 `/api/serve-upload/xxx`，正确** | ✅ | |

### 修复建议
- **P0-1**：**立即移除** `sanitizedUrl = decoded.replace(/\.\./g, '').replace(/\/\//g, '/')` 这一行，改为 `const normalizedUrl = path.normalize(decoded);` 然后依赖后续的 startsWith 白名单校验。黑名单删除永远是不安全的，而且会破坏合法文件名。
- **P1-3**：使用 AbortController 控制超时。

```ts
// 修复示例
const decoded = decodeURIComponent(url);
// 不要做 replace(/\.\./g, '') 这种不安全的"清理"
const relativePath = decoded.replace(/^\/api\/serve-upload\//, '').replace(/^\/+/, '');
// ...后续所有路径都用 path.normalize + startsWith 校验
```

---

## 二十九、`src/types/psdLayer.ts` & `image-tools.ts` & 其他类型

### 核心功能
类型定义。

### 发现的问题

| # | 问题 | 严重度 | 说明 |
|---|------|--------|------|
| 1 | **`PSDExportResult` 在 psdLayer.ts 和 psd-export.ts 中重复定义（PSDExportResult vs psd-export 中的 PSDExportResult），字段不完全一致** | P2 | psdLayer.ts 的 PSDExportResult 有 success/psdBlob/manifestBlob，psd-export.ts 的 PSDExportResult 有 blob/manifest/mode/filename/designScene。两个同名接口含义不同容易混淆。 |
| 2 | **`UpscaleModel` 枚举包含了 `'4x-UltraSharp'` 但 Python 脚本只支持 `realesrgan-x4plus-fp16`** | P2 | 前端类型与后端实际支持模型不匹配。 |
| 3 | **`imagetracerjs.d.ts` 只有 34 行，是 imagetracerjs 库的简单类型声明** | ✅ | 基本合理。 |

### 修复建议
- 统一 PSDExportResult 类型定义到单一文件。

---

## 三十、`src/app/globals.css` — 全局样式

### 核心功能
Tailwind 导入、主题变量、全局布局样式。

### 发现的问题

| # | 问题 | 严重度 | 说明 |
|---|------|--------|------|
| 1 | **`html, body, #__next, main { overflow: hidden; }` 强制全局隐藏溢出** | P2 | 这对全屏画布应用是合理的，但 `.dashboard-scrollable` 类通过 `main.dashboard-scrollable { overflow-y: auto }` 覆盖需要 `<main>` 标签有这个类。其他普通页面（如登录、设置）若没有这个类会被截断内容。需确保所有滚动页面都有该类。 |
| 2 | **`box-sizing: border-box` 只在 html/body/#__next/main 上设置，没在 `*` 全局设置** | P2 | 新组件可能使用 content-box 导致尺寸计算不一致。建议加 `*, *::before, *::after { box-sizing: border-box; }`。 |
| 3 | **Tailwind v4 语法使用 `@custom-variant dark`** | ✅ | 与 tailwindcss v4 一致。 |

### 修复建议
- 添加全局 `* { box-sizing: border-box; }`。


---

## 三十一、`src/lib/db-client.ts` 补充发现

### 补充问题

| # | 问题 | 严重度 | 说明 |
|---|------|--------|------|
| 1 | **`getPool()` 非线程安全（Next.js HMR 场景）** | P2 | 与 task-registry 使用 globalThis 不同，db-client 的 pool 是模块级变量，HMR 会创建多个 pool 实例，旧的不会被 end()，造成连接泄漏。建议使用 globalThis 存储单例。 |

---

## 三十二、最高优先级修复清单（Top 10）

按生产风险排序，建议按以下顺序立即修复：

| 优先级 | 文件 | 问题 | 类型 |
|--------|------|------|------|
| 1 | **src/lib/db-storage.ts** | `dbBatchUpdateProviderOrder` 事务完全失效（多连接 BEGIN/COMMIT） | P0 数据一致性 |
| 2 | **src/lib/fetch-image-buffer.ts** | 路径穿越防护用黑名单 `replace(/\.\./g,'')` 可被绕过（虽有 startsWith 兜底但 sanitize 破坏合法文件名且给予虚假安全感） | P0 安全 |
| 3 | **src/lib/size-auto-repair.ts** | 从 `@/app/api/generate/route` 导入违反 Next.js 分层约束，可能导致构建/打包失败 | P0 架构 |
| 4 | **src/lib/workflow-engine.ts** | switch case 穿透：`condition-if/switch/loop-for` 等逻辑节点 fallthrough 到 `video-speed-change`，导致错误请求 | P0 功能错误 |
| 5 | **src/lib/workflow-engine.ts** | 拓扑排序遇环时静默追加节点，不报错也不处理，可能导致节点执行失败级联 | P0 功能错误 |
| 6 | **src/lib/image-compress.ts** | `loadImage` 函数先设 src 后绑 onload/onerror，string 类型 source 的 Promise 可能永远 pending | P0 功能错误 |
| 7 | **src/lib/task-registry.ts** | `cancelledTasks` 无界增长（终态任务不删除），并发计数在僵尸清理时可能 double-decrement 致负数 | P0 内存泄漏/计数漂移 |
| 8 | **src/lib/task-registry.ts** | `waitForQueueSlot` 若任务被 TTL zombie 清理，Promise 等不到事件直到 5min 超时 | P0 请求挂起 |
| 9 | **src/lib/model-name-map.ts** | `veo3.1` 类型错误标记为 `image`（应为 `video`）；`sora` 被 image 段先匹配到 `type:'image'` 而不是 video | P0 展示错误 |
| 10 | **src/lib/image-tools/iopaint-client.ts** | `callPythonScript` 在 stdio 监听器绑定前可能丢失子进程的早期输出/错误；SIGKILL 无法杀进程组 | P1 稳定性 |

---

## 三十三、全局/架构层面观察

### 1. 连接池/资源管理
- **db-client**：缺少全局单例保护（HMR 场景），缺少进程退出优雅关闭。
- **SSE (task-events-client)**：客户端重连逻辑正确，但服务端未看到订阅者清理代码（若存在服务端 SSE 路由，需检查 response.close 时是否 unsubscribe）。
- **Python 子进程**：所有 spawn 调用都没使用 `detached:true` + `process.kill(-pid)`，超时 kill 可能遗留孙子进程（torch 线程池等）。

### 2. 错误处理一致性
- 同一类错误在 `smart-retry.ts` 和 `api-error-translator.ts` 中有两套独立的分类器，新增错误类型时需要同步两处，维护成本高。建议统一分类逻辑。
- 大量 `catch { /* ignore */ }` 静默吞错，特别是文件系统和网络操作，对排障不利。

### 3. Next.js 分层违反
- `src/lib/size-auto-repair.ts` 从 `app/api/generate/route.ts` 导入（P0 已列出）。
- `src/lib/image-tools/*.ts` 使用了 `fs/child_process/sharp` 等 Node.js 原生模块，但未标注 `'use server'`，若被 client component 导入会打包失败。

### 4. 超时与 AbortController 滥用风险
- 全局大量使用 `AbortSignal.timeout()` 和 `AbortSignal.any()`，这是 Node 18+ API。若 Docker 镜像 Node 版本低于 18，会直接 crash。
- 建议在 `package.json` 中加 `"engines": { "node": ">=18.17" }` 并在启动时校验。

### 5. 内存泄漏模式
- **task-registry.EventEmitter**：setMaxListeners(200) 是告警阈值不是硬限制，若 SSE 客户端未正确 unsubscribe，listener 会无限增长。
- **Python 子进程 stdout/stderr 字符串累积**：大输出时（如 torch 初始化日志）会占用内存。建议限制 stdout/stderr buffer 大小（如只保留最后 4KB）。

### 6. 并发/竞态
- `enqueueTask`、`releaseQueueSlot`、`dequeueNextTask` 操作 userActiveCount/userQueues 都没有锁（JS 单线程是安全的，但异步 await 期间其他调用可能插入）。仔细审查后，所有对这些 Map 的操作都是同步的，JS 单线程下安全。
- 但 `updateTaskProgress` 会 emit 事件，事件处理函数内若调用 enqueue/dequeue 可能产生重入，需注意。

### 7. 类型安全
- 大量使用 `Record<string, unknown>` + as 断言，any 类型较多（video-api.ts 中显式 disable eslint）。
- API 响应数据未做 zod/valibot 运行时校验，一个字段变化可能导致深层 crash。

### 8. 未使用代码
- `src/lib/api-error-translate.ts` 与新的 `api-error-translator.ts` 功能重复，应删除旧文件。
- `agent-engine.ts` 内置工具全是 placeholder，若不实际使用应移除或标注。
- `start-iopaint-lama.sh` 是为旧版 HTTP 模式保留的，当前推荐子进程模式，应在文档中明确。

---

## 三十四、总结

代码库整体**完成度较高**，主要模块（任务注册、SSE、API 兼容层、多模型支持、本地上游 AI 工具链）都有清晰的设计思路，注释充分。但也存在以下三类系统性问题：

1. **事务/原子性缺陷**：如 `dbBatchUpdateProviderOrder` 跨连接 BEGIN/COMMIT，是典型的"看起来有事务但实际无效"bug。
2. **资源泄漏隐患**：Python 子进程未清理进程组、EventEmitter 监听器未可靠解绑、cancelledTasks Map 无界增长。
3. **Next.js 架构边界违反**：从 lib 导入 app/api 下的 route 文件，是生产构建的定时炸弹。

建议优先修复 Top 10 P0 问题，然后对 Python 子进程管理和错误分类做一次重构收敛。整体代码质量在同类 AI 图像项目中偏上，设计文档与注释很完善，修复上述硬伤后可稳定支撑生产。

# V588-STABILITY-002 PSD 分析安全与稳定性设计

> 状态：P0，优先于 `V588-ADMIN-004`。V5.8.8 仅作为只读 donor；只吸收 VLM 回退和预算思想，不复制任意路径读取、静默默认成功或逐候选 120 秒等待。

## 目标

把 `/api/analyze-psd` 从“直接把用户字符串交给视觉模型、失败时可能伪成功、客户端超时后再发第二次付费请求”的同步脚本，收敛为有明确输入边界、模型授权、总截止时间、严格输出、数据库幂等和一次性退款的分析链路。

本项不重写 PSD 导出算法，不改变 Basic/Pro/Studio 产物结构，不调整 AI PSD 独立生成器，也不吸收 donor 的用户、认证或文件存储实现。

## 已确认根因

当前路由存在以下可复现代码事实：

1. `request.json()` 在请求体体积检查之前读取全部 base64。
2. `image` 未经过 `loadSafeImageInput()`，远程地址、相对地址和像素预算没有统一门禁。
3. 模型硬编码为 `doubao-seed-1-6-vision-250815`，没有管理员模型目录和用户授权闭环。
4. SDK 调用没有贯穿请求、媒体解码和上游调用的统一取消信号。
5. 非 JSON 输出会被替换成默认图层并返回 `success: true`，造成错误扣费和伪成功。
6. 路由使用先扣后退的非任务级内存状态，无法阻止多实例重复请求或保证只退款一次。
7. `psd-export.ts` 在 12 秒后放弃专用路由，再调用 `/api/chat`，首请求可能仍在后台执行，导致两次上游调用和两次扣费。

donor 增加了管理员 VLM 候选，但仍允许任意本地路径/远程 URL，显式模型失败后会越权回退，单候选最长 120 秒，且 11 项测试只匹配源码字符串。因此 donor 控制器不可直接复制。

## 方案选择

### 方案 A：复用安全媒体、任务内核和严格候选路由，推荐

路由只负责认证、限流式读取请求体和错误映射。新建小型 PSD 分析模块分别处理请求/输出契约、媒体解析、授权候选和任务结算。持久任务使用现有 `cloud_tasks`、`createBillableTask()`、`completeCloudTask()` 与 `settleFailedTask()`。

优点：跨实例幂等、退款原子化、模块边界清楚、能够写真实行为测试。缺点：需要修改专用路由和 PSD 客户端，并新增数个小模块。

### 方案 B：在现有 160 行路由内继续堆叠判断

优点：文件数量少。缺点：输入、模型、账务和输出继续耦合，难以证明取消、并发与退款一致性。

### 方案 C：复制 donor 路由

优点：短期差异小。缺点：引入任意路径读取、SSRF、未授权模型、候选超时叠加和失败不退款，违反当前安全内核。

采用方案 A。

## 请求契约

请求体最大 `28 MiB`，流式累计读取；声明 `Content-Length` 或实际字节超过上限均返回 `413 PSD_ANALYSIS_BODY_TOO_LARGE`。

支持两种互斥媒体来源：

```ts
type PsdAnalysisMediaInput =
  | { image: string; projectId?: never; sourceVersionId?: never }
  | { image?: never; projectId: string; sourceVersionId: string };
```

- `image` 只允许 `data:image/{png,jpeg,webp,avif};base64,...`，不允许裸 base64、任意 `/api/*`、文件路径或远程 URL。
- `projectId + sourceVersionId` 通过 `AssetService.resolveAssetReference()` 验证当前用户项目与版本归属，再把受控媒体交给 `loadSafeImageInput()`。
- 解码后最大 `20 MiB`、最大 `40,000,000` 像素，MIME 必须与文件签名一致。
- `safe-image-input` 对本地候选执行 `realpath` 后再次验证仍位于允许根目录，阻止符号链接逃逸。

可选模型字段必须成对出现：

```ts
providerId?: string; // 1-128 个安全字符
model?: string;      // 1-160 个可打印字符
```

幂等键从 `Idempotency-Key` 请求头读取，格式为 8-128 个 URL 安全字符。缺失或非法返回 `400 PSD_ANALYSIS_IDEMPOTENCY_INVALID`。

## 模型授权与回退

候选仅来自管理员启用且有 `baseUrl`、`apiKey`、已选模型的 `vlm/chat` 提供商，并经过当前用户 `chatModels` 授权检查。

- 显式 `providerId + model`：提供商必须拥有该模型且用户获授权；失败时不切换提供商。
- 自动模式：按稳定目录顺序收集视觉模型，按 `providerId + model` 去重，最多 3 个候选。
- 仅当 `PSD_ANALYSIS_PLATFORM_MODEL` 明确配置时，允许把平台 SDK 作为自动模式首候选；不再硬编码已失效模型。
- 每个上游调用共享同一个 `AbortSignal`；请求总截止时间为 `45 秒`，不是每个候选各 45 秒。
- 文本内容始终位于图片之前，OpenAI 兼容请求固定 `stream: false`、`max_tokens: 4096`、`temperature: 0.3`。
- `401/403` 等凭据和权限错误不跨提供商隐藏；自动候选只对可重试的网络、超时、`429`、`5xx` 和不支持端点继续下一个。

## 输出预算

上游响应累计最大 `256 KiB`。JSON 和严格 SSE 都归一化为同一个文本输出，再进入同一个解析器。

合法结果必须满足：

- 顶层只读取 `backgroundColor`、`backgroundMode`、`layers`。
- JSON 最大深度 8。
- `backgroundColor` 为 3 个 `0-255` 整数。
- `backgroundMode` 为 `white | corner | color | white-preserve | none`。
- 图层数 `1-8`，第一层必须为 `bg`。
- `role` 为 `bg | subject | text | deco | fx`。
- `name` 为 1-80 字符，`description` 为 1-300 字符。

允许单个 fenced JSON 代码块；非 JSON、超预算或结构非法均返回失败并退款，不再生成默认图层伪装成功。

## 任务、幂等与账务

媒体通过安全校验后，以图片 SHA-256、来源版本、显式模型对和契约版本生成规范化请求摘要。任务类型为 `psd-analysis`，积分成本沿用当前 `segment` 操作成本。

1. `createBillableTask()` 在 PostgreSQL 事务中绑定 `userId + idempotencyKey + requestDigest`，同时创建任务并扣费。
2. 同键同摘要：复用同一任务；完成任务重放相同结果，进行中任务按数据库终态条件等待，不再次调用上游。
3. 同键不同摘要：返回 `409 IDEMPOTENCY_CONFLICT`。
4. 只有 `processing -> completed` 能提交结果。
5. 超时、取消、非法输出和全部候选失败通过 `settleFailedTask()` 进入终态并原子退款一次。
6. 客户端断开会 abort 所有底层工作；等待复用任务的客户端断开不会取消另一个请求拥有的任务。
7. 成功响应包含 `taskId`、`requestId`、实际 `providerId`、`model` 和 `fallbackReason`；不返回 API Key、原始 base64 或敏感头。

## 客户端行为

`psd-export.ts` 每次用户导出生成一个稳定幂等键，并只调用 `/api/analyze-psd`：

- 客户端截止时间 `50 秒`，晚于服务端 `45 秒`，确保服务端先完成终态结算。
- 失败时返回 `null`，继续当前本地 PSD 分解算法；不再调用 `/api/chat`。
- 当前画布 URL 仍在浏览器侧转换成 data URL，因此现有图片预览和下载入口保持不变。
- 不增加固定长 sleep；复用任务等待依赖数据库终态变化和请求取消信号。

## 错误格式

```json
{
  "success": false,
  "code": "PSD_ANALYSIS_OUTPUT_INVALID",
  "message": "PSD 分析模型返回了无效结构",
  "requestId": "req_xxx",
  "taskId": "psd_analysis_xxx",
  "retryable": true
}
```

认证、输入、授权、积分、冲突、超时、上游和内部错误分别映射为确定状态码，不暴露堆栈、API Key 或供应商原始敏感响应。

## 验收标准

### 本地 RED/GREEN

1. 鉴权先于请求体解码、积分和上游调用。
2. 超请求体、MIME 伪造、超字节、像素炸弹、路径穿越、符号链接、私网 DNS、重定向和跨用户版本均拒绝。
3. 显式模型精确授权；自动候选去重、最多 3 个、总截止时间 45 秒。
4. JSON/SSE 共用严格输出解析器，所有越界结构失败而非伪成功。
5. 同键并发只调用一次上游、只扣一次；失败、超时和取消只退款一次。
6. 客户端只调用 `/api/analyze-psd`，不再调用 `/api/chat`。
7. 既有 PSD Basic/Pro/Studio、本地分解和下载测试保持通过。

### Coze / Google Chrome

- 使用 PearAPI 或 APIMART 的已授权视觉模型完成一次真实 PSD 分析与 Pro PSD 下载。
- Network 中单次用户操作只出现一个 `/api/analyze-psd` 业务请求和一个实际上游候选。
- 成功响应展示实际 provider/model；刷新或重复提交同一幂等键不重复扣费。
- 制造上游失败与超时后任务进入确定失败终态且只退款一次。
- Console error/warning、原生错误弹窗为 0。
- `origin/stable` 与 V5.8.8 donor 保持不变。

## 非目标

- 不修改 AI PSD 独立生成器、Pear 分层 ZIP、元素拆解或图片工具栏。
- 不调整 PSD 图层合成质量、命名视觉设计或导出 UI。
- 不把 `V588-ADMIN-004`、支付、用户管理或供应商能力矩阵合并进本项。
- 不允许在本地无 PostgreSQL 时用进程内 Map 冒充多实例幂等；缺少持久任务依赖时返回明确不可用。

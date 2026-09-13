# V5.8.8 媒体网关选择性吸收设计

## 1. 状态与目标

本设计对应 `V588-MEDIA-001`。当前 GitHub `main` 是实现基线，`J:\无界云端0820` 仅作为只读供体，`stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` 保持只读。

目标是在不改变现有工作区、模型目录、供应商协议、任务、积分和资产权威来源的前提下，提供可受控开放的图像与视频媒体网关：

- 网关密钥仅以哈希形式持久化，原始密钥只在签发时返回一次。
- 支持分钟限流、每日请求配额和数据库原子幂等。
- 支持图像、视频提交，以及现有任务的状态查询和取消。
- 网关请求贯穿可信来源标签、requestId、providerId、modelId、任务和积分审计。
- 复用现有 `256/512 WebP` 多尺寸缩略图，不建立第二套缩略图处理链路。
- 不建立第二套供应商任务状态机，不复制 donor 的旧协议实现。

## 2. 非目标

- 不把 `src/lib/api-compatibility.ts` 或 `src/lib/video-api.ts` 移入新 workspace 包。
- 不改变 Pear、APImart 或其他供应商现有请求协议。
- 不允许网关请求携带供应商 API Key 或绕过管理员模型授权。
- 不复制 `cloud_tasks`、Asset、AssetVersion 或积分流水状态。
- 不通过网关新增音频、3D、PSD、批注或其他媒体类型。
- 不重新实现现有缩略图回填、S3 恢复和原图回退。
- 不在本阶段修改无限画布、节点模式或独立智能对话入口。

## 3. 架构边界

采用“薄网关门面 + 当前权威内核”。

```text
External client
  -> gateway authentication and admission
  -> trusted internal request
  -> existing /api/generate or /api/video/generate
  -> existing cloud_tasks and billing
  -> existing AssetVersion and thumbnail variants
```

网关拥有：

- 密钥生命周期。
- 请求体边界校验。
- 分钟尝试限流。
- 每日已准入请求配额。
- 外部幂等键与请求摘要。
- 外部请求到现有 taskId/taskIds 的关联。
- 网关级操作审计。

现有内核继续拥有：

- `providerId + modelId` 的授权和能力判断。
- 供应商请求构建、提交和轮询。
- `n>1` 的真实生成槽位。
- 任务终态、取消、超时和迟到结果隔离。
- 积分扣除、失败退款和退款幂等。
- 项目、Asset、AssetVersion、placement 和缩略图。

## 4. 数据模型

### 4.1 `wujie_gateway_keys`

每行代表一把管理员签发并绑定到目标用户的密钥。

| 字段 | 约束 | 含义 |
|---|---|---|
| `id` | 主键 | 内部密钥 ID |
| `user_id` | 非空、索引 | 网关任务实际所属用户 |
| `key_hash` | 唯一、非空 | 原始密钥的 SHA-256 哈希 |
| `key_prefix` | 非空 | 供列表和审计显示的脱敏前缀 |
| `label` | 最长 100 字符 | 管理员可读名称 |
| `requests_per_minute` | 1～600 | 分钟限流 |
| `daily_quota` | 0～100000 | 0 表示不限 |
| `enabled` | 非空 | 吊销后为 false |
| `created_by` | 非空 | 签发管理员 ID |
| `created_at` | 非空 | 签发时间 |
| `last_used_at` | 可空 | 最近一次鉴权成功时间 |
| `revoked_at` | 可空 | 吊销时间 |

原始密钥格式为 `wmg_<随机值>`。随机值至少 32 字节，使用加密安全随机源。原始密钥不进入日志、审计详情、浏览器持久化或数据库。

### 4.2 `wujie_gateway_rate_windows`

以 `key_id + window_start` 为主键保存一分钟窗口计数。每次合法 Bearer 鉴权后的尝试均原子递增；超限请求返回 `429 GATEWAY_RATE_LIMITED`，计数不退款。

### 4.3 `wujie_gateway_requests`

该表是准入和审计记录，不是任务状态副本。

| 字段 | 约束 | 含义 |
|---|---|---|
| `id` | 主键 | `gatewayRequestId` |
| `gateway_key_id` | 非空 | 密钥 ID |
| `user_id` | 非空 | 任务所属用户 |
| `idempotency_key` | 非空、最长 200 | 客户端幂等键 |
| `request_digest` | 非空 | 规范化请求 SHA-256 |
| `media_type` | `image` 或 `video` | 请求类型 |
| `admission_status` | 枚举 | `reserved/admitted/rejected` |
| `task_ids` | JSONB 数组 | 现有内核返回的 taskId/taskIds |
| `created_at` | 非空 | 创建时间 |
| `updated_at` | 非空 | 更新时间 |

唯一约束为 `gateway_key_id + idempotency_key`。同键同摘要返回已存在的准入结果；同键不同摘要返回 `409 GATEWAY_IDEMPOTENCY_CONFLICT`。

每日配额不以可反复加减的裸计数作为真相，而是按当天 `admission_status='admitted'` 的唯一请求记录计算。并发准入在数据库事务和密钥行锁内完成，避免超过配额。

## 5. 配额与计费语义

1. 分钟限流统计通过密钥格式与哈希校验后的所有尝试，包括参数失败和重复请求，防止失败重放绕过限流。
2. 日配额只统计至少创建一个现有持久化任务的网关请求。
3. 参数错误、模型未授权、积分不足或内部入口未创建任务时，请求转为 `rejected`，不占日配额。
4. 已创建任务后发生供应商失败或用户取消，日配额仍计为一次已准入请求；积分退款继续由现有任务系统负责。
5. 图像 `n>1` 只占一个网关日请求额度，但现有内核必须创建对应数量的真实槽位，积分按现行模型规则和输出数量计算。
6. 幂等重放不得再次占用限流之外的日配额、创建任务或扣除积分。
7. 网关层不得自行写入积分余额或自行退款。

## 6. API 设计

### 6.1 管理面

所有管理接口要求当前会话为管理员：

- `GET /api/admin/gateway/keys`：列出脱敏密钥、绑定用户、限流、配额和使用摘要。
- `POST /api/admin/gateway/keys`：签发密钥；原始密钥仅在本次响应返回。
- `PATCH /api/admin/gateway/keys/{keyId}`：调整标签、分钟限额、日配额和启停状态。
- `DELETE /api/admin/gateway/keys/{keyId}`：幂等吊销，不物理删除审计记录。

管理员仪表盘新增独立“媒体网关”功能区，采用单层数据表和抽屉式签发/编辑表单。列表永不显示完整密钥，不提供再次查看原始密钥的能力。

### 6.2 数据面

所有数据接口要求 `Authorization: Bearer wmg_...`。两个提交接口还必须携带 `Idempotency-Key`；任务查询和按 taskId 取消不要求额外幂等键：

- `POST /api/gateway/v1/images`
- `POST /api/gateway/v1/videos`
- `GET /api/gateway/v1/tasks/{taskId}`
- `POST /api/gateway/v1/tasks/{taskId}/cancel`

提交请求必须显式携带 `providerId` 和 `modelId`，禁止网关静默选择或切换供应商。图像请求允许现有生成入口支持的 prompt、数量、比例、尺寸、质量和参考图字段；视频请求允许现有视频入口支持的 prompt、时长、比例、首帧、尾帧和参考图字段。

状态查询与取消先用网关密钥解析真实 `user_id`，再调用现有用户归属查询。其他用户的 taskId 统一返回 `404 GATEWAY_TASK_NOT_FOUND`，避免泄漏资源存在性。

### 6.3 返回合同

成功提交返回：

```json
{
  "success": true,
  "requestId": "req_xxx",
  "gatewayRequestId": "gwreq_xxx",
  "taskId": "task_xxx",
  "taskIds": ["task_xxx"],
  "status": "queued"
}
```

错误返回：

```json
{
  "success": false,
  "code": "GATEWAY_RATE_LIMITED",
  "message": "请求过于频繁，请稍后重试",
  "requestId": "req_xxx",
  "retryable": true
}
```

网关保留稳定错误码，不向外返回内部堆栈、供应商 API Key、完整网关密钥或数据库错误文本。

## 7. 可信内部上下文

网关通过现有内部共享密钥签名身份调用生成、轮询和取消入口，并附加：

- `x-wujie-source-channel: gateway`
- `x-wujie-gateway-request-id`
- `x-wujie-gateway-key-id`

这些 Header 只有在 `requireApiAuthOrReject()` 返回 `source='internal'` 时才可信。Cookie、桌面 Token 或外部请求直接设置同名 Header 必须被忽略。

现有生成和视频入口将可信网关元数据写入任务结果/审计上下文；积分流水继续由现有扣费函数产生，并在 description 或 reference metadata 中追加脱敏网关标签。网关层不得接受客户端提供的 `sourceChannel` 覆盖可信来源。

## 8. 请求边界与安全

- JSON 请求体上限 1 MiB；超过上限返回 `413 GATEWAY_BODY_TOO_LARGE`。
- prompt 去除首尾空白后长度为 1～20000 字符。
- `providerId/modelId/idempotencyKey` 采用明确长度和字符边界。
- 图像数量沿用现有模型能力上限且平台硬上限为 4。
- 参考图数量和 URL/data URL 字节限制复用现有输入校验，不新增远程下载捷径。
- 网关密钥比较基于哈希查询，不进行明文扫描。
- 数据库失败采用 fail closed，不允许绕过限流、配额或幂等。
- 管理操作、鉴权失败、限流、准入、任务查询和取消均记录脱敏操作日志。

## 9. 缩略图复用

当前 `wujie_asset_thumbnail_variants` 已实现 256 和 512 两档 WebP 变体，并具备租约、失败重试、安全输入、S3 与持久数据根回退。

网关任务完成后仍由现有 AssetVersion 流程生成/回填缩略图。任务查询响应可以在当前用户有权访问且变体 ready 时返回 `thumbnailUrls`：

```json
{
  "256": "/api/.../256.webp",
  "512": "/api/.../512.webp"
}
```

变体尚未 ready 时不阻塞任务完成，返回原图/视频封面作为 `previewUrl`。缩略图失败不改变生成任务终态。

## 10. 故障与竞态处理

- 两个并发同键同摘要请求只能有一个执行内部提交，另一个复用相同记录和任务 ID。
- 同键不同摘要在任何终态均返回冲突。
- 内部提交超时但结果不明确时保持 `reserved`，通过后续状态核对恢复，禁止立即重复提交。
- 内部明确拒绝且没有任务 ID 时转为 `rejected`。
- 取消复用现有数据库条件式终态和退款逻辑；网关只返回权威结果。
- 吊销密钥阻止新请求，但已创建任务仍可由管理员审计；吊销后的外部密钥不能查询或取消任务。
- `GATEWAY_ENABLED` 不为 `true` 时，所有外部数据面请求统一返回 503；管理员仍可管理密钥和查看状态。

## 11. 管理界面

管理员仪表盘增加“媒体网关”入口，显示：

- 总密钥数、启用数、今日准入量和最近限流数。
- 密钥标签、绑定用户、脱敏前缀、状态、分钟限额、日配额、今日使用量和最近使用时间。
- 签发、编辑、启停和吊销操作。

签发成功使用一次性模态框显示完整密钥，并明确关闭后无法再次查看。复制按钮使用图标并提供 tooltip。表格和抽屉遵循现有管理员设计系统，不重构整个管理员页面。

## 12. 测试与验收

### 12.1 单元与 API

- 密钥格式、哈希、一次性展示和日志脱敏。
- 管理员鉴权、字段边界、签发、修改和幂等吊销。
- 默认关闭、缺失/错误/吊销密钥、请求体超限和非法 JSON。
- 分钟限流、日配额、日切、参数拒绝不占日配额。
- 同键同摘要并发归并、同键异摘要冲突。
- 显式 `providerId + modelId` 透传且禁止隐式切换。
- `n=2/3/4` 保持现有槽位数量，不折叠结果。
- 状态查询和取消的用户隔离。
- 可信 Header 只对内部认证生效。
- 256/512 缩略图 ready、pending 和原图回退。

### 12.2 PostgreSQL

- 20 路并发准入不超过分钟限额和日配额。
- 20 路相同幂等请求只创建一条网关请求和一组权威任务。
- 明确拒绝、模糊超时、重放、取消和迟到完成不造成重复任务、扣费或退款。
- 配额统计与请求记录对账一致。

### 12.3 全量门禁

- `pnpm ts-check`
- `pnpm lint:build`
- `pnpm test`
- `pnpm check:protected-baseline`
- `pnpm build`

### 12.4 Coze

1. 证明 Coze 运行 exact `main` tree，`stable` 未修改。
2. 网关关闭态返回稳定 503，普通应用功能保持可用。
3. 临时开启后使用测试密钥完成 APImart 或 PearAPI 图像任务及一个稳定视频任务。
4. 验证任务查询、取消、一次扣费/退款、AssetVersion、缩略图和刷新恢复。
5. 验证错误 Key、吊销 Key、限流、日配额和跨用户 taskId。
6. 保存 Network、Console、截图、requestId、gatewayRequestId、taskId 和积分流水证据。

无法取得的真实供应商或云端证据必须标记为未验证，不能由 Mock 或本地测试替代。

## 13. 发布与回滚

- 第一阶段部署时保持 `GATEWAY_ENABLED=false`，因此现有 UI 和内部 API 行为不变。
- 数据库迁移只新增表和索引，不修改现有任务、积分或资产表的既有列语义。
- 关闭 `GATEWAY_ENABLED` 即可立即停止外部数据面；历史任务继续由现有内核完成。
- 回滚应用代码不删除网关表，保留审计记录；不得回滚或重算现有积分流水。
- 只有关闭态、开启态、并发、账务和全平台回归全部通过后，才把 `V588-MEDIA-001` 标记完成。

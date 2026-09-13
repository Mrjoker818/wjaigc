# V5.8.8 媒体网关实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不复制任务、积分、资产或供应商状态机的前提下，为现有图像与视频内核增加默认关闭、可审计、可限流、数据库原子幂等的外部媒体网关。

**Architecture:** 新增 `src/lib/media-gateway/` 作为密钥、准入、内部转发和响应投影的薄边界；外部路由只做 Bearer 鉴权、1 MiB 请求限制、结构校验和稳定错误映射，然后使用真实用户身份调用现有 `/api/generate`、`/api/video/generate`、`/api/poll-task` 与 `/api/cancel-task`。`cloud_tasks`、积分流水、AssetVersion 和 `256/512 WebP` 缩略图继续是唯一权威来源，网关表只保存密钥、配额窗口和外部请求映射。

**Tech Stack:** Next.js 16 App Router、React 19、TypeScript 5、PostgreSQL 18、Vitest 3、Playwright 1.60、Tailwind CSS 4。

## Global Constraints

- 仅修改并提交 `main`；`stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` 永远只读。
- 实现基线为已批准规格提交 `main@9d5b3564492bd3ca31a2e3578d4546c0b4e59117`；`J:\无界云端0820` 仅作只读供体。
- 不复制 donor 的 `api-compatibility.ts`、`video-api.ts` 或 `wujie-media-gateway` 状态机。
- `GATEWAY_ENABLED` 默认不为 `true`；关闭态下外部数据面统一返回 `503 GATEWAY_DISABLED`，现有 UI 与内部 API 行为不变。
- 网关必须显式接收并透传 `providerId + modelId`，不得静默选择、切换或降级供应商。
- 网关不得直接扣费、退款、写 AssetVersion 或生成缩略图；全部复用现有权威内核。
- 原始 `wmg_` 密钥只在签发响应出现一次；数据库、日志、浏览器持久化和列表接口不得保存或输出明文。
- 所有提交必须携带 `Idempotency-Key`；同密钥同摘要复用，同密钥异摘要返回 409。
- 图像 `n>1` 占一个网关日配额，但必须保留现有独立槽位、逐张回填和按输出计费语义。
- 每项遵循 RED → 最小实现 → GREEN → 模块回归 → 审查 → 小提交；禁止顺手重构现有大文件。
- 现有 `.superpowers/sdd/*` 用户修改不得暂存、覆盖或回滚。

---

## 文件结构

| 文件 | 单一职责 |
|---|---|
| `migrations/20260913_v588_media_gateway.sql` | 新增网关密钥、分钟窗口、请求映射表与约束 |
| `src/lib/media-gateway/types.ts` | 共享领域类型和稳定错误码 |
| `src/lib/media-gateway/schema.ts` | 请求边界、规范化和摘要输入 |
| `src/lib/media-gateway/key-service.ts` | 密钥签发、哈希鉴权、更新、吊销和脱敏列表 |
| `src/lib/media-gateway/admission.ts` | 分钟限流、日配额、幂等准入和任务映射事务 |
| `src/lib/media-gateway/internal-client.ts` | 可信内部 Header 与现有权威路由调用 |
| `src/lib/media-gateway/task-projection.ts` | 任务归属、终态、预览和缩略图响应投影 |
| `src/lib/media-gateway/http.ts` | 1 MiB JSON 读取、requestId 和稳定错误响应 |
| `src/lib/media-gateway/audit.ts` | 脱敏网关操作审计 |
| `src/app/api/admin/gateway/keys/route.ts` | 管理员密钥列表与签发 |
| `src/app/api/admin/gateway/keys/[keyId]/route.ts` | 管理员更新、启停与吊销 |
| `src/app/api/gateway/v1/images/route.ts` | 图像准入与提交门面 |
| `src/app/api/gateway/v1/videos/route.ts` | 视频准入与提交门面 |
| `src/app/api/gateway/v1/tasks/[taskId]/route.ts` | 权威任务状态查询 |
| `src/app/api/gateway/v1/tasks/[taskId]/cancel/route.ts` | 权威任务取消 |
| `src/components/dashboard/media-gateway-admin.tsx` | 管理员媒体网关表格与抽屉 |
| `src/components/dashboard/dashboard-view.tsx` | 仅接入管理员导航入口 |

### Task 1: MEDIA-001A 数据库迁移与领域合同

**Files:**
- Create: `migrations/20260913_v588_media_gateway.sql`
- Create: `src/lib/media-gateway/types.ts`
- Test: `src/__tests__/scripts/media-gateway-migration.test.ts`
- Test: `src/__tests__/lib/media-gateway-types.test.ts`

**Interfaces:**
- Produces: `GatewayKeyRecord`、`GatewayRequestRecord`、`GatewayErrorCode`、`GatewayError`。
- Produces tables: `wujie_gateway_keys`、`wujie_gateway_rate_windows`、`wujie_gateway_requests`。

- [ ] **Step 1: 写迁移与类型失败测试**

```ts
it('defines the three gateway tables and concurrency constraints', async () => {
  const sql = await readFile('migrations/20260913_v588_media_gateway.sql', 'utf8');
  expect(sql).toContain('CREATE TABLE IF NOT EXISTS wujie_gateway_keys');
  expect(sql).toContain('UNIQUE (gateway_key_id, idempotency_key)');
  expect(sql).toContain("CHECK (media_type IN ('image', 'video'))");
  expect(sql).toContain("CHECK (admission_status IN ('reserved', 'admitted', 'rejected'))");
  expect(sql).not.toMatch(/api[_-]?key\s+TEXT/i);
});
```

- [ ] **Step 2: 运行测试并确认 RED**

Run: `pnpm exec vitest run src/__tests__/scripts/media-gateway-migration.test.ts src/__tests__/lib/media-gateway-types.test.ts`

Expected: FAIL，原因仅为迁移文件和类型模块尚不存在。

- [ ] **Step 3: 实现追加式迁移**

```sql
CREATE TABLE IF NOT EXISTS wujie_gateway_keys (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  key_prefix TEXT NOT NULL,
  label TEXT NOT NULL CHECK (char_length(label) BETWEEN 1 AND 100),
  requests_per_minute INTEGER NOT NULL CHECK (requests_per_minute BETWEEN 1 AND 600),
  daily_quota INTEGER NOT NULL CHECK (daily_quota BETWEEN 0 AND 100000),
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS wujie_gateway_rate_windows (
  gateway_key_id TEXT NOT NULL REFERENCES wujie_gateway_keys(id),
  window_start TIMESTAMPTZ NOT NULL,
  attempt_count INTEGER NOT NULL CHECK (attempt_count >= 0),
  PRIMARY KEY (gateway_key_id, window_start)
);

CREATE TABLE IF NOT EXISTS wujie_gateway_requests (
  id TEXT PRIMARY KEY,
  gateway_key_id TEXT NOT NULL REFERENCES wujie_gateway_keys(id),
  user_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL CHECK (char_length(idempotency_key) BETWEEN 1 AND 200),
  request_digest TEXT NOT NULL,
  media_type TEXT NOT NULL CHECK (media_type IN ('image', 'video')),
  admission_status TEXT NOT NULL CHECK (admission_status IN ('reserved', 'admitted', 'rejected')),
  task_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  rejection_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (gateway_key_id, idempotency_key)
);
```

同时添加 `user_id`、`created_at`、`admission_status` 索引；不修改既有表。

- [ ] **Step 4: 实现稳定类型合同**

```ts
export type GatewayMediaType = 'image' | 'video';
export type GatewayAdmissionStatus = 'reserved' | 'admitted' | 'rejected';
export type GatewayErrorCode =
  | 'GATEWAY_DISABLED' | 'GATEWAY_AUTH_REQUIRED' | 'GATEWAY_KEY_INVALID'
  | 'GATEWAY_RATE_LIMITED' | 'GATEWAY_DAILY_QUOTA_EXCEEDED'
  | 'GATEWAY_IDEMPOTENCY_REQUIRED' | 'GATEWAY_IDEMPOTENCY_CONFLICT'
  | 'GATEWAY_BODY_TOO_LARGE' | 'GATEWAY_INVALID_REQUEST'
  | 'GATEWAY_TASK_NOT_FOUND' | 'GATEWAY_INTERNAL_UNAVAILABLE';

export class GatewayError extends Error {
  constructor(
    readonly code: GatewayErrorCode,
    readonly status: number,
    message: string,
    readonly retryable = false,
  ) { super(message); this.name = 'GatewayError'; }
}
```

- [ ] **Step 5: GREEN、迁移脚本合同和提交**

Run: `pnpm exec vitest run src/__tests__/scripts/media-gateway-migration.test.ts src/__tests__/scripts/run-migrations.test.ts src/__tests__/lib/media-gateway-types.test.ts`

Expected: PASS，迁移校验和机制不受影响。

```bash
git add migrations/20260913_v588_media_gateway.sql src/lib/media-gateway/types.ts src/__tests__/scripts/media-gateway-migration.test.ts src/__tests__/lib/media-gateway-types.test.ts
git commit -m "feat: add media gateway persistence schema"
```

### Task 2: MEDIA-001A 密钥生命周期与管理 API

**Files:**
- Create: `src/lib/media-gateway/key-service.ts`
- Create: `src/lib/media-gateway/audit.ts`
- Create: `src/app/api/admin/gateway/keys/route.ts`
- Create: `src/app/api/admin/gateway/keys/[keyId]/route.ts`
- Test: `src/__tests__/lib/media-gateway-key-service.test.ts`
- Test: `src/__tests__/lib/media-gateway-audit.test.ts`
- Test: `src/__tests__/api/admin-media-gateway-keys.test.ts`
- Modify: `src/__tests__/api/admin-route-authorization-contract.test.ts`

**Interfaces:**
- Consumes: `GatewayKeyRecord`、`GatewayError`。
- Produces: `issueGatewayKey(input): Promise<{ key: GatewayKeyView; secret: string }>`。
- Produces: `authenticateGatewayBearer(value): Promise<GatewayPrincipal>`。
- Produces: `listGatewayKeys()`、`updateGatewayKey()`、`revokeGatewayKey()`。
- Produces: `auditGatewayEvent()`，仅接受脱敏网关标识和操作结果。

- [ ] **Step 1: 写密钥安全失败测试**

```ts
it('returns the raw secret once and persists only its sha256 hash', async () => {
  const issued = await issueGatewayKey(validInput);
  expect(issued.secret).toMatch(/^wmg_[A-Za-z0-9_-]{43,}$/);
  expect(inserted.keyHash).toBe(createHash('sha256').update(issued.secret).digest('hex'));
  expect(JSON.stringify(inserted)).not.toContain(issued.secret);
  expect(JSON.stringify(await listGatewayKeys())).not.toContain(issued.secret);
});
```

覆盖：非管理员 403、未知用户、范围边界、停用/吊销 Key、吊销幂等、日志脱敏。

- [ ] **Step 2: 运行并确认 RED**

Run: `pnpm exec vitest run src/__tests__/lib/media-gateway-key-service.test.ts src/__tests__/api/admin-media-gateway-keys.test.ts`

Expected: FAIL，缺少服务和路由。

- [ ] **Step 3: 实现密钥服务**

```ts
export async function issueGatewayKey(input: IssueGatewayKeyInput) {
  const secret = `wmg_${randomBytes(32).toString('base64url')}`;
  const keyHash = createHash('sha256').update(secret).digest('hex');
  const id = `gwkey_${randomUUID()}`;
  await execSql(INSERT_KEY_SQL, [id, input.userId, keyHash, secret.slice(0, 12), input.label,
    input.requestsPerMinute, input.dailyQuota, input.createdBy]);
  return { key: await getGatewayKeyView(id), secret };
}

export async function authenticateGatewayBearer(header: string | null) {
  const secret = parseBearer(header);
  if (!/^wmg_[A-Za-z0-9_-]{43,}$/.test(secret)) throw invalidKey();
  const digest = createHash('sha256').update(secret).digest('hex');
  const row = await findEnabledKeyByHash(digest);
  if (!row || row.revokedAt) throw invalidKey();
  return { keyId: row.id, userId: row.userId, requestsPerMinute: row.requestsPerMinute,
    dailyQuota: row.dailyQuota } satisfies GatewayPrincipal;
}
```

查询必须使用 `key_hash = $1`，不得枚举明文；成功鉴权以同一条条件式 SQL 更新 `last_used_at` 并返回 principal，失败、停用或吊销鉴权不得更新时间；所有返回对象只含 `keyPrefix`。

- [ ] **Step 4: 实现管理员路由**

`GET/POST` 和 `PATCH/DELETE` 首行调用 `requireAdminUser(request)`；POST 只在 201 响应返回 `secret`，PATCH 白名单仅允许 `label/requestsPerMinute/dailyQuota/enabled`，已吊销记录拒绝重新启用，DELETE 将 `enabled=false, revoked_at=now()`。POST/PATCH/DELETE 均调用 `auditGatewayEvent()` 写入操作者、action、outcome、keyId/keyPrefix 等脱敏事实，不记录 secret/hash。

- [ ] **Step 5: GREEN、鉴权回归和提交**

Run: `pnpm exec vitest run src/__tests__/lib/media-gateway-key-service.test.ts src/__tests__/lib/media-gateway-audit.test.ts src/__tests__/api/admin-media-gateway-keys.test.ts src/__tests__/api/admin-route-authorization-contract.test.ts`

Expected: PASS，管理接口均要求管理员，原始 Key 不可再次获取。

```bash
git add src/lib/media-gateway/key-service.ts src/lib/media-gateway/audit.ts src/app/api/admin/gateway/keys src/__tests__/lib/media-gateway-key-service.test.ts src/__tests__/lib/media-gateway-audit.test.ts src/__tests__/api/admin-media-gateway-keys.test.ts src/__tests__/api/admin-route-authorization-contract.test.ts
git commit -m "feat: add media gateway key management"
```

### Task 3: MEDIA-001A 请求边界、限流与原子准入

**Files:**
- Create: `src/lib/media-gateway/schema.ts`
- Create: `src/lib/media-gateway/http.ts`
- Create: `src/lib/media-gateway/admission.ts`
- Test: `src/__tests__/lib/media-gateway-schema.test.ts`
- Test: `src/__tests__/lib/media-gateway-admission.test.ts`
- Test: `tests/integration/media-gateway-admission-postgres.test.ts`

**Interfaces:**
- Produces: `readGatewayJson(request, maxBytes = 1_048_576)`。
- Produces: `normalizeGatewayImageRequest()`、`normalizeGatewayVideoRequest()`、`digestGatewayRequest()`。
- Produces: `reserveGatewayRequest(input)`、`markGatewayAdmitted()`、`markGatewayRejected()`。

- [ ] **Step 1: 写边界和幂等 RED 测试**

```ts
it('canonicalizes object keys but preserves ordered reference images', () => {
  expect(digestGatewayRequest({ prompt: ' x ', providerId: 'p', modelId: 'm', referenceImages: ['a', 'b'] }))
    .toBe(digestGatewayRequest({ modelId: 'm', referenceImages: ['a', 'b'], providerId: 'p', prompt: 'x' }));
  expect(digestGatewayRequest({ providerId: 'p', modelId: 'm', prompt: 'x', referenceImages: ['b', 'a'] }))
    .not.toBe(digestGatewayRequest({ providerId: 'p', modelId: 'm', prompt: 'x', referenceImages: ['a', 'b'] }));
});
```

覆盖：1 MiB/非法 JSON、prompt 1～20000、ID 字符边界、幂等键 1～200、图像 `n<=4`、引用图复用现有验证器。

- [ ] **Step 2: 运行并确认 RED**

Run: `pnpm exec vitest run src/__tests__/lib/media-gateway-schema.test.ts src/__tests__/lib/media-gateway-admission.test.ts`

Expected: FAIL，仅因模块缺失。

- [ ] **Step 3: 实现有限读取与规范化摘要**

```ts
export async function readGatewayJson(request: Request, maxBytes = 1_048_576) {
  const declared = Number(request.headers.get('content-length') || 0);
  if (declared > maxBytes) throw new GatewayError('GATEWAY_BODY_TOO_LARGE', 413, '请求体过大');
  const reader = request.body?.getReader();
  let total = 0; const chunks: Uint8Array[] = [];
  while (reader) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) { await reader.cancel(); throw bodyTooLarge(); }
    chunks.push(value);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new GatewayError('GATEWAY_INVALID_REQUEST', 400, '请求体不是有效 JSON'); }
}
```

摘要使用稳定键排序 JSON 和 SHA-256；禁止摘要包含网关密钥或供应商密钥。

- [ ] **Step 4: 实现事务准入**

事务顺序固定为：锁密钥行 → 原子递增分钟窗口 → 查询/插入幂等记录 → 锁定当天配额范围 → 返回 `execute/reuse/conflict/rate-limited/quota-exceeded`。同键同摘要只允许一条 `reserved`；模糊超时保持 `reserved`，不得转 rejected 后重提。

```ts
export type GatewayAdmissionDecision =
  | { kind: 'execute'; request: GatewayRequestRecord }
  | { kind: 'reuse'; request: GatewayRequestRecord };
```

- [ ] **Step 5: 运行 20 路 PostgreSQL 并发验证**

Run: `if (-not $env:PGDATABASE_URL) { throw 'PGDATABASE_URL is required' }; $env:POSTGRES_TEST_DATABASE_URL=$env:PGDATABASE_URL; pnpm exec vitest run tests/integration/media-gateway-admission-postgres.test.ts`

Expected: 20 路同幂等键只有 1 个 `execute`；分钟上限和日配额不超卖；异摘要 409；数据库失败 fail closed。

- [ ] **Step 6: 模块 GREEN 和提交**

Run: `pnpm exec vitest run src/__tests__/lib/media-gateway-schema.test.ts src/__tests__/lib/media-gateway-admission.test.ts`

```bash
git add src/lib/media-gateway/schema.ts src/lib/media-gateway/http.ts src/lib/media-gateway/admission.ts src/__tests__/lib/media-gateway-schema.test.ts src/__tests__/lib/media-gateway-admission.test.ts tests/integration/media-gateway-admission-postgres.test.ts
git commit -m "feat: enforce media gateway admission controls"
```

### Task 4: MEDIA-001B 可信内部上下文与图像/视频提交

**Files:**
- Create: `src/lib/media-gateway/internal-client.ts`
- Create: `src/app/api/gateway/v1/images/route.ts`
- Create: `src/app/api/gateway/v1/videos/route.ts`
- Modify: `src/lib/media-gateway/admission.ts`
- Modify: `src/app/api/generate/route.ts`
- Modify: `src/app/api/video/generate/route.ts`
- Test: `src/__tests__/lib/media-gateway-admission.test.ts`
- Test: `src/__tests__/lib/media-gateway-internal-client.test.ts`
- Test: `src/__tests__/api/media-gateway-submit.test.ts`
- Test: `src/__tests__/api/media-gateway-trusted-context.test.ts`

**Interfaces:**
- Consumes: `GatewayPrincipal`、准入接口、现有 `getInternalRequestHeaders()`。
- Produces: `submitGatewayImage()`、`submitGatewayVideo()`。
- Produces trusted metadata: `sourceChannel='gateway'`、`gatewayRequestId`、`gatewayKeyId`。
- Produces: `recordGatewayAttempt(principal)` 返回模块内不可伪造、绑定 key/user 的一次性尝试凭证；`reserveGatewayRequest()` 携该凭证时不得再次增加 RPM。

> 审查修正：Task 3 原接口同时负责 RPM 与需要正文摘要的准入，无法满足“认证后、读取正文前计数”。Task 4 必须以最小扩展拆出原子尝试计数：认证成功后先记录 RPM，再读取/校验正文；正文有效时携凭证进入原准入事务。缺失、伪造、跨 key/user 或重复使用的凭证必须失败关闭。原有不带凭证的 `reserveGatewayRequest()` 行为保持兼容。

- [ ] **Step 1: 写提交和 Header 欺骗失败测试**

```ts
it('ignores gateway headers from cookie callers and accepts them only for internal auth', async () => {
  await POST(cookieRequest({ 'x-wujie-source-channel': 'gateway' }));
  expect(savedTask.result.sourceChannel).not.toBe('gateway');
  await POST(internalRequest({ 'x-wujie-source-channel': 'gateway',
    'x-wujie-gateway-request-id': 'gwreq_1', 'x-wujie-gateway-key-id': 'gwkey_1' }));
  expect(savedTask.result).toMatchObject({ sourceChannel: 'gateway', gatewayRequestId: 'gwreq_1', gatewayKeyId: 'gwkey_1' });
});
```

覆盖：默认关闭 503、所有已认证尝试（含缺少幂等键、超大/非法 JSON、禁用字段及 schema 错误）均计入 RPM、显式 provider/model、`n=2/3/4` taskIds 不折叠、内部错误不泄密、参数拒绝不占日配额。

- [ ] **Step 2: 运行并确认 RED**

Run: `pnpm exec vitest run src/__tests__/lib/media-gateway-internal-client.test.ts src/__tests__/api/media-gateway-submit.test.ts src/__tests__/api/media-gateway-trusted-context.test.ts`

- [ ] **Step 3: 实现内部客户端**

```ts
async function gatewayHeaders(principal: GatewayPrincipal, requestId: string, gatewayRequestId: string) {
  return {
    'content-type': 'application/json',
    'x-request-id': requestId,
    ...(await getInternalRequestHeaders(principal.userId, 'user')),
    'x-wujie-source-channel': 'gateway',
    'x-wujie-gateway-request-id': gatewayRequestId,
    'x-wujie-gateway-key-id': principal.keyId,
  };
}
```

调用地址沿用项目现有 `http://localhost:${process.env.DEPLOY_RUN_PORT || 5000}` 约定；设置有界提交超时。响应不明确、不可解析、结构异常或 5xx 时返回 `GATEWAY_INTERNAL_UNAVAILABLE` 且保持 `reserved`；仅当内核返回结构明确的 4xx 失败且没有任何 taskId 时标记 rejected。首次拒绝和重放统一映射为同一稳定的网关错误语义；成功状态只允许网关公开状态集合，其他内部字符串归一为默认状态。

- [ ] **Step 4: 实现两个提交路由**

固定顺序：feature flag → Bearer 鉴权 → 原子记录分钟尝试并取得一次性凭证 → 读取/校验请求 → 携凭证准入 → execute 或 reuse → 权威内核提交 → 保存 taskIds → 稳定响应。外部 body 中的 `_skipCredits`、`_skipCloudTaskPersistence`、`sourceChannel`、API Key 字段必须被 schema 拒绝。图像与视频都必须按显式 `providerId + modelId` 失败关闭；现有权威路由不得为网关调用发现或降级到其他供应商/模型。

- [ ] **Step 5: 只在内部认证下持久化来源标签**

在两个现有生成路由中增加一个小函数：

```ts
const gatewayContext = authResult.source === 'internal'
  && request.headers.get('x-wujie-source-channel') === 'gateway'
  ? {
      sourceChannel: 'gateway' as const,
      gatewayRequestId: safeDiagnosticId(request.headers.get('x-wujie-gateway-request-id')),
      gatewayKeyId: safeDiagnosticId(request.headers.get('x-wujie-gateway-key-id')),
    }
  : undefined;
```

只追加到既有任务 metadata/result；不改变模型路由、扣费或任务状态。

- [ ] **Step 6: 回归并提交**

Run: `pnpm exec vitest run src/__tests__/api/media-gateway-submit.test.ts src/__tests__/api/media-gateway-trusted-context.test.ts src/__tests__/api/generate-explicit-provider-contract.test.ts src/__tests__/api/generate-output-count.test.ts src/__tests__/api/video-task-durability-contract.test.ts`

Expected: 新测试通过；现有 provider/model、输出数量与视频持久化合同不变。

```bash
git add src/lib/media-gateway/internal-client.ts src/app/api/gateway/v1/images/route.ts src/app/api/gateway/v1/videos/route.ts src/app/api/generate/route.ts src/app/api/video/generate/route.ts src/__tests__/lib/media-gateway-internal-client.test.ts src/__tests__/api/media-gateway-submit.test.ts src/__tests__/api/media-gateway-trusted-context.test.ts
git commit -m "feat: route gateway submissions through authoritative tasks"
```

### Task 5: MEDIA-001B 状态查询、取消与用户隔离

**Files:**
- Create: `src/lib/media-gateway/task-projection.ts`
- Modify: `src/lib/media-gateway/audit.ts`
- Create: `src/app/api/gateway/v1/tasks/[taskId]/route.ts`
- Create: `src/app/api/gateway/v1/tasks/[taskId]/cancel/route.ts`
- Modify: `src/app/api/cancel-task/route.ts`
- Test: `src/__tests__/api/media-gateway-task-status.test.ts`
- Test: `src/__tests__/api/media-gateway-task-cancel.test.ts`
- Test: `src/__tests__/api/cancel-task.test.ts`
- Test: `src/__tests__/lib/media-gateway-audit.test.ts`

**Interfaces:**
- Produces: `getGatewayTaskProjection(principal, taskId)`。
- Produces: `cancelGatewayTask(principal, taskId)`。
- Consumes existing: `getCloudTaskForUser()`、`terminateCloudTaskAndRefund()`、权威 poll/cancel 路由。

- [ ] **Step 1: 写隔离、终态和退款 RED 测试**

```ts
it('returns 404 for another user task without revealing existence', async () => {
  mocks.getCloudTaskForUser.mockResolvedValue(null);
  const response = await GET(gatewayTaskRequest('task-user-b'), context('task-user-b'));
  expect(response.status).toBe(404);
  expect(await response.json()).toMatchObject({ code: 'GATEWAY_TASK_NOT_FOUND' });
});
```

覆盖：吊销 Key 不能查询/取消、重复取消只退款一次、迟到完成不能覆盖 cancelled、内存注册表丢失仍使用持久化归属。

- [ ] **Step 2: 运行并确认 RED**

Run: `pnpm exec vitest run src/__tests__/api/media-gateway-task-status.test.ts src/__tests__/api/media-gateway-task-cancel.test.ts`

- [ ] **Step 3: 实现状态与取消门面**

状态接口从网关 Key 解析 `userId`，只返回安全字段：`taskId/status/progress/providerId/modelId/result/error/previewUrl/thumbnailUrls`。媒体 URL 只允许有界的受控站内媒体路径，或无 userinfo、无敏感 query、非 loopback/私网字面地址的有界公网 HTTPS；字符串、数组元素数、单元素和总序列化体积均须受限，不满足时省略而非泄漏。取消接口用内部用户身份调用现有取消路由，不自行退款；权威 409、失败和已取消状态映射到稳定网关合同。任意 2xx 只在取消后持久化重读确认为 `cancelled` 时返回成功；其他终态返回稳定 409，活动态或不确定状态返回可重试 503。

任务查询和取消必须复用现有网关脱敏审计，记录 requestId、gatewayKeyId、userId、动作、结果和真实状态码；鉴权失败不得记录 Bearer，成功/404/409/503 均不得写任务结果、媒体 URL、供应商凭据或内部错误。审计失败不得改变权威查询/取消响应。

- [ ] **Step 4: 为现有取消路由补齐可信内部认证**

将 Cookie-only 入口改为复用 `requireApiAuthOrReject()`，但保持现有 Cookie 行为、管理员越权取消规则和数据库原子结算不变。外部伪造内部 Header 仍必须 401/403。

- [ ] **Step 5: 回归并提交**

Run: `pnpm exec vitest run src/__tests__/api/media-gateway-task-status.test.ts src/__tests__/api/media-gateway-task-cancel.test.ts src/__tests__/api/cancel-task.test.ts src/__tests__/api/poll-task-authoritative-direct.test.ts`

```bash
git add src/lib/media-gateway/task-projection.ts src/app/api/gateway/v1/tasks src/app/api/cancel-task/route.ts src/__tests__/api/media-gateway-task-status.test.ts src/__tests__/api/media-gateway-task-cancel.test.ts src/__tests__/api/cancel-task.test.ts
git commit -m "feat: expose isolated gateway task lifecycle"
```

### Task 6: MEDIA-001C 复用缩略图与原图回退

**Files:**
- Modify: `src/lib/media-gateway/task-projection.ts`
- Test: `src/__tests__/lib/media-gateway-task-projection.test.ts`
- Test: `src/__tests__/lib/asset-thumbnail-projection.test.ts`

**Interfaces:**
- Consumes existing thumbnail projection and AssetVersion references from authoritative task result。
- Produces: `{ previewUrl?: string; thumbnailUrls?: { '256'?: string; '512'?: string } }`。

- [ ] **Step 1: 写 ready/pending/failed RED 测试**

```ts
it.each([
  ['ready', { thumbnailUrls: { '256': '/thumb/256.webp', '512': '/thumb/512.webp' }, previewUrl: '/thumb/512.webp' }],
  ['pending', { thumbnailUrls: undefined, previewUrl: '/original.png' }],
  ['failed', { thumbnailUrls: undefined, previewUrl: '/original.png' }],
])('projects %s thumbnail state without changing task completion', async (state, expected) => {
  mocks.thumbnailState = state;
  expect(await getGatewayTaskProjection(principal, 'task-1')).toMatchObject({ status: 'completed', ...expected });
});
```

- [ ] **Step 2: 运行并确认 RED**

Run: `pnpm exec vitest run src/__tests__/lib/media-gateway-task-projection.test.ts`

- [ ] **Step 3: 复用现有投影，不新增 worker**

根据任务结果中的 `assetVersionId` 查询既有 `wujie_asset_thumbnail_variants`；仅 `status='ready'` 且 URL 可用时返回对应尺寸。否则以权威图片 URL 或视频封面作为 `previewUrl`；缩略图异常不得改变任务 completed 状态。

- [ ] **Step 4: 回归并提交**

Run: `pnpm exec vitest run src/__tests__/lib/media-gateway-task-projection.test.ts src/__tests__/lib/asset-thumbnail-projection.test.ts src/__tests__/lib/asset-thumbnail-projection-runtime.test.ts`

```bash
git add src/lib/media-gateway/task-projection.ts src/__tests__/lib/media-gateway-task-projection.test.ts
git commit -m "feat: project existing thumbnails through media gateway"
```

### Task 7: MEDIA-001A/D 管理员界面与脱敏审计

**Files:**
- Modify: `src/lib/media-gateway/audit.ts`
- Modify: `src/lib/media-gateway/key-service.ts`
- Create: `src/components/dashboard/media-gateway-admin.tsx`
- Modify: `src/components/dashboard/dashboard-view.tsx`
- Test: `src/__tests__/lib/media-gateway-audit.test.ts`
- Test: `src/__tests__/lib/media-gateway-key-service.test.ts`
- Test: `src/__tests__/components/media-gateway-admin.test.tsx`
- Test: `src/__tests__/components/dashboard-media-gateway-contract.test.ts`
- Test: `tests/e2e/media-gateway-admin-responsive.spec.ts`

**Interfaces:**
- Produces admin view: 汇总、密钥表、签发/编辑抽屉、一次性密钥模态框。
- Consumes admin routes from Task 2。
- Produces `auditGatewayEvent()` with redacted identifiers only。

- [ ] **Step 1: 写 UI 与日志安全 RED 测试**

```tsx
it('shows the issued secret only in the one-time dialog', async () => {
  render(<MediaGatewayAdmin />);
  await user.click(screen.getByRole('button', { name: '签发密钥' }));
  await user.click(screen.getByRole('button', { name: '确认签发' }));
  expect(await screen.findByText(/^wmg_/)).toBeVisible();
  await user.click(screen.getByRole('button', { name: '关闭' }));
  expect(screen.queryByText(/^wmg_/)).not.toBeInTheDocument();
  expect(localStorage.setItem).not.toHaveBeenCalledWith(expect.anything(), expect.stringMatching(/^wmg_/));
});
```

覆盖：列表永不显示完整 Key、复制图标 tooltip、错误/加载/空状态、吊销确认、375px 无横向溢出。

- [ ] **Step 2: 运行并确认 RED**

Run: `pnpm exec vitest run src/__tests__/lib/media-gateway-audit.test.ts src/__tests__/components/media-gateway-admin.test.tsx src/__tests__/components/dashboard-media-gateway-contract.test.ts`

- [ ] **Step 3: 实现脱敏审计**

审计字段仅含 `gatewayKeyId/keyPrefix/gatewayRequestId/userId/action/outcome/errorCode`；递归移除 `authorization/apiKey/accessToken/secret/password`，不得记录 prompt 或参考图内容。

- [ ] **Step 4: 实现管理员 UI**

在现有管理员导航增加“媒体网关”，不重构 dashboard。既有 Key 查询服务从 Task 3 权威 `wujie_gateway_requests` 按当前 UTC 日期聚合 `admission_status IN ('reserved', 'admitted')` 的真实 `todayUsage`，与日配额消耗口径一致；缺失或非法值不得伪装为 0。表格显示标签、用户、前缀、状态、RPM、日配额、今日使用、最近使用；签发/编辑使用抽屉，一次性 Secret 使用模态框，复制使用 Lucide `Copy` 图标和 Tooltip。GET/POST/PATCH/DELETE 响应必须整体失败关闭；权威 mutation 已成功但响应不可信时，禁止重复提交并重新加载权威列表。表单、复制和吊销错误必须显示在当前模态上下文中。

- [ ] **Step 5: UI 回归与提交**

Run: `pnpm exec vitest run src/__tests__/components/media-gateway-admin.test.tsx src/__tests__/components/dashboard-media-gateway-contract.test.ts src/__tests__/components/dashboard-model-authorization-contract.test.ts`

Run: `pnpm exec playwright test tests/e2e/media-gateway-admin-responsive.spec.ts --project=chromium`

```bash
git add src/lib/media-gateway/audit.ts src/components/dashboard/media-gateway-admin.tsx src/components/dashboard/dashboard-view.tsx src/__tests__/lib/media-gateway-audit.test.ts src/__tests__/components/media-gateway-admin.test.tsx src/__tests__/components/dashboard-media-gateway-contract.test.ts
git commit -m "feat: add media gateway admin controls"
```

### Task 8: MEDIA-001D PostgreSQL 竞态、账务与安全回归

**Files:**
- Create: `tests/integration/media-gateway-lifecycle-postgres.test.ts`
- Create: `src/__tests__/api/media-gateway-security.test.ts`
- Modify only if a failing test proves it necessary: `src/lib/media-gateway/*.ts`

**Interfaces:**
- Exercises all interfaces from Tasks 1–7; produces no new production API。

- [ ] **Step 1: 写 20 路端到端并发测试**

测试必须创建隔离 schema、运行真实迁移并断言：同摘要 20 路只创建一条 gateway request 和一组 cloud task；异摘要冲突；配额不超卖；一笔扣费；取消/失败/timeout 竞态最多一次终态和一次退款；迟到 completed 无法覆盖失败/取消。

- [ ] **Step 2: 写安全测试**

覆盖：缺失/错误/吊销 Key、413、非法 JSON、恶意额外字段、跨用户 taskId、外部伪造 trusted headers、日志 Secret 扫描、数据库失败 fail closed。

- [ ] **Step 3: 运行专项 RED/GREEN 循环**

Run: `if (-not $env:PGDATABASE_URL) { throw 'PGDATABASE_URL is required' }; $env:POSTGRES_TEST_DATABASE_URL=$env:PGDATABASE_URL; pnpm exec vitest run tests/integration/media-gateway-admission-postgres.test.ts tests/integration/media-gateway-lifecycle-postgres.test.ts src/__tests__/api/media-gateway-security.test.ts`

Expected: 0 failed、0 skipped。若没有隔离 PostgreSQL，必须标记 BLOCKED，不得把 skip 当通过。

- [ ] **Step 4: 运行既有任务账务回归**

Run: `if (-not $env:PGDATABASE_URL) { throw 'PGDATABASE_URL is required' }; $env:POSTGRES_TEST_DATABASE_URL=$env:PGDATABASE_URL; pnpm exec vitest run tests/integration/task-billing-concurrency.test.ts tests/integration/task-terminal-race.test.ts src/__tests__/api/cancel-task.test.ts`

Expected: 现有任务扣费、退款和终态竞态全部通过。

- [ ] **Step 5: 提交专项证据**

```bash
git add tests/integration/media-gateway-lifecycle-postgres.test.ts src/__tests__/api/media-gateway-security.test.ts
git commit -m "test: prove media gateway concurrency boundaries"
```

### Task 9: 全量门禁、文档、发布与 Coze 验收

**Files:**
- Modify: `scripts/doctor.mjs`
- Modify: `docs/testing/BUG_REGISTER.md`
- Modify: `docs/testing/REGRESSION_REPORT.md`
- Modify: `docs/testing/RELEASE_READINESS_REPORT.md`
- Modify: `docs/testing/UNVERIFIED_ITEMS.md`
- Create: `docs/testing/evidence/v588-media-gateway-20260913.json`
- Create: `tests/e2e/v588-media-gateway.spec.ts`

**Interfaces:**
- `npm run doctor`/`pnpm doctor` reports gateway enabled/database readiness without revealing secrets。
- Playwright evidence proves cloud behavior; no production code is introduced after the gate except a reproduced defect fix。

- [ ] **Step 1: 为 doctor 写 RED 测试并实现环境检查**

当 `GATEWAY_ENABLED=true` 时，doctor 要求数据库连接和迁移表存在；关闭时输出警告而非失败。任何输出不得包含 Key 或数据库密码。

Run: `pnpm exec vitest run src/__tests__/scripts/doctor-production-auth-contract.test.ts src/__tests__/scripts/media-gateway-doctor.test.ts`

- [ ] **Step 2: 运行专项测试全集**

Run: `pnpm exec vitest run src/__tests__/lib/media-gateway-*.test.ts src/__tests__/api/media-gateway-*.test.ts src/__tests__/api/admin-media-gateway-keys.test.ts src/__tests__/components/media-gateway-admin.test.tsx src/__tests__/components/dashboard-media-gateway-contract.test.ts`

Expected: 0 failed、0 skipped。

- [ ] **Step 3: 运行全量本地门禁**

```bash
pnpm ts-check
pnpm lint:build
pnpm test
pnpm check:protected-baseline
pnpm build
```

Expected: 每条退出码 0；记录测试数、页面数、commit 和时间。保护基线出现任何非白名单漂移则停止，不得更新基线掩盖问题。

- [ ] **Step 4: 默认关闭态部署**

推送 `main` 后让 Coze 拉取 exact commit；核对 tree、迁移、唯一 5000 进程和首页 200。保持 `GATEWAY_ENABLED=false`，验证网关 503 且登录、画布、图像/视频原入口可用。

- [ ] **Step 5: 临时开启真实云端验证**

使用 PearAPI 或 APIMart 稳定模型：签发测试 Key；图像提交并查询完成；稳定视频提交；`n=2` 逐槽返回；取消一次且仅退款一次；错误 Key、吊销 Key、限流、日配额、跨用户 taskId；AssetVersion、256/512 缩略图、刷新恢复。保存截图、Trace、Console、Network、requestId、gatewayRequestId、taskId 和脱敏积分流水。

- [ ] **Step 6: 更新中文报告与结论**

只有 PostgreSQL、全量门禁和 Coze 开启/关闭态均有证据时，将 `V588-MEDIA-001` 标记完成。任何真实供应商、账务或缩略图证据缺失时，结论必须是 `LOCAL PASS / CLOUD UNVERIFIED` 或“不通过”，并写入 `UNVERIFIED_ITEMS.md`。

- [ ] **Step 7: 最终提交**

```bash
git add scripts/doctor.mjs tests/e2e/v588-media-gateway.spec.ts docs/testing/BUG_REGISTER.md docs/testing/REGRESSION_REPORT.md docs/testing/RELEASE_READINESS_REPORT.md docs/testing/UNVERIFIED_ITEMS.md docs/testing/evidence/v588-media-gateway-*.json
git commit -m "docs: record media gateway release evidence"
git push origin main
```

## 自审结果

- **规格覆盖：** 密钥、限流、日配额、数据库幂等、显式模型路由、图像/视频、状态/取消、账务隔离、缩略图复用、管理 UI、审计、默认关闭、PostgreSQL 与 Coze 验收均有对应任务。
- **非目标保护：** 没有 workspace 包抽取、第二状态机、第二缩略图 worker，也没有无限画布、节点模式或独立聊天改造。
- **类型一致性：** `GatewayPrincipal`、`GatewayRequestRecord`、`GatewayAdmissionDecision`、`GatewayError` 在前置任务定义，后续只消费这些固定接口。
- **占位扫描：** 计划中不存在 `TBD`、`TODO`、模糊的“稍后实现”或用 Mock 冒充云端成功的步骤。
- **回滚边界：** `GATEWAY_ENABLED=false` 可立即关闭数据面；迁移只新增表，回滚应用时保留审计数据，不重算既有积分流水。

# V588-AUTH-001 稳定认证密钥与兼容凭据迁移实施计划 (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不破坏 `stable` 回滚登录能力的前提下，消除数据库瞬时故障覆盖认证密钥、密码哈希与会话密钥耦合、持久化模式隐式降级和旧密码绕过风险，并用 PostgreSQL 并发及真实浏览器证据闭环。

**Architecture:** 新增 `src/lib/auth/` 下的纯密码算法、持久化模式、密钥环和严格 PostgreSQL 仓储四个边界，`server-auth.ts` 只负责编排登录、兼容迁移和 session。数据库新增可空 `credential_hash` 旁路字段，保留旧 `password_hash` 供 `stable` 回滚；密钥环以单一 JSON 值在事务和 advisory lock 中原子更新。

**Tech Stack:** Next.js 16、React 19、TypeScript 5、Node.js `crypto.scrypt`、PostgreSQL、Vitest、Playwright、PowerShell、Coze 云端。

## Global Constraints

- 仅修改并推送 `main`；`stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` 始终只读。
- 实施基线为 `main@b20dc96d8a44c18939893c4ee52732edef22e36b`；开始编码前必须重新核对 `origin/main`，若变化则先审计差异并更新本计划基线。
- `J:/无界云端0820` 仅作 V5.8.8 只读参考，禁止复制其“任意八位密码可登录”逻辑。
- 不删除、不覆盖旧 `password_hash`；新增 `credential_hash` 仅作新版优先凭据。
- 不创建测试后门，不在源码、日志、测试证据、Git 或 Obsidian 中记录真实密码、secret、完整 session 或数据库连接串。
- 每项严格执行 RED -> 最小实现 -> 聚焦回归 -> 全量回归 -> 云端 exact SHA 验收。
- PostgreSQL 并发测试必须使用隔离测试库；缺少隔离库时标记“未验证”，不得以 Mock 冒充。
- 只使用已打开的 Google Chrome 标签页；不新建标签页，不使用 360 浏览器。
- 不改变无限画布、节点模式、独立智能对话、模型授权、项目数据、任务和账务行为。
- 不提交现有 `.superpowers/sdd/v588-ui-003-*` 未跟踪文件。

---

## 文件结构

| 文件 | 责任 |
|---|---|
| `src/lib/auth/auth-errors.ts` | 认证错误码、HTTP 状态和安全日志字段 |
| `src/lib/auth/auth-password.ts` | scrypt 凭据生成、严格解析、恒时验证、旧 SHA-256 兼容验证 |
| `src/lib/auth/auth-persistence.ts` | `DB_ONLY` / `DB_PLUS_FILE` / `FILE_ONLY` 解析和文件原子读写 |
| `src/lib/auth/auth-secret-ring.ts` | 密钥环校验、kid、轮换决策、session 验证候选 |
| `src/lib/auth/auth-repository.ts` | PostgreSQL 严格读取、事务、advisory lock、用户 sidecar 更新 |
| `src/lib/server-auth.ts` | 登录、管理员恢复、用户迁移、session 签发和验证编排 |
| `src/lib/db-storage.ts` | 用户行类型与现有批量读写的 `credential_hash` 保留 |
| `migrations/20260823_v588_auth_credentials.sql` | 新增 `credential_hash`，不破坏旧列和旧 UPSERT |
| `scripts/doctor.mjs` | 认证持久化模式和生产配置健康检查 |
| `src/__tests__/lib/auth-*.test.ts` | 密码、模式、密钥环纯单元测试 |
| `src/__tests__/lib/server-auth-stable-migration.test.ts` | 登录迁移、禁止降级和 stable 回滚合同 |
| `tests/integration/v588-auth-postgres.test.ts` | 真实 PostgreSQL 事务、20 并发、字段保留 |
| `src/__tests__/api/auth-login-configuration.test.ts` | 登录 401/409/429/503 与错误码合同 |
| `tests/e2e/v588-auth-001-session.spec.ts` | Chromium、Firefox、WebKit 登录、刷新、退出证据 |

---

### Task 1: 锁定基线与建立失败合同

**Files:**
- Modify: `docs/testing/BUG_REGISTER.md`
- Create: `src/__tests__/lib/auth-password.test.ts`
- Create: `src/__tests__/lib/auth-persistence.test.ts`
- Create: `src/__tests__/lib/auth-secret-ring.test.ts`
- Create: `src/__tests__/lib/server-auth-stable-migration.test.ts`

**Interfaces:**
- Consumes: 已确认设计 `docs/superpowers/specs/2026-08-23-v588-auth-001-stable-auth-migration-design.md`。
- Produces: 后续任务必须实现的公开函数与错误码合同。

- [ ] **Step 1: 核对只读分支与工作区**

Run:

```powershell
git fetch origin
git rev-parse HEAD
git rev-parse origin/main
git rev-parse origin/stable
git status --short
```

Expected: `HEAD == origin/main == b20dc96d8a44c18939893c4ee52732edef22e36b`，`origin/stable == 52f7c601ed150769e15d06fb435c6e360e28c9e7`，仅存在已知 `.superpowers/sdd/v588-ui-003-*` 未跟踪文件。

- [ ] **Step 2: 在缺陷登记中新增 V588-AUTH-001**

记录 P0 风险、精确根因、基线 SHA、不得吸收的 donor 绕过、预期测试证据和状态“RED 待修复”。不得写真实凭据。

- [ ] **Step 3: 写密码算法 RED 测试**

测试导入并固定接口：

```ts
import {
  createScryptCredential,
  verifyScryptCredential,
  verifyLegacyCredential,
} from '@/lib/auth/auth-password';

expect(await verifyScryptCredential('correct', await createScryptCredential('correct'))).toBe(true);
expect(await verifyScryptCredential('wrong-pass', await createScryptCredential('correct'))).toBe(false);
expect(await createScryptCredential('same')).not.toBe(await createScryptCredential('same'));
await expect(verifyScryptCredential('x', 'scrypt-v1$1$1$1$bad$bad')).resolves.toBe(false);
expect(verifyLegacyCredential('wrong-pass', storedHash, [active, previous])).toEqual({ matched: false });
```

同时断言格式为 `scrypt-v1$32768$8$1$...`，盐解码 16 字节、派生值 32 字节，未知版本和超界参数失败关闭；并通过注入测试执行器发起 12 个并发验证，断言同时运行的 scrypt 不超过 4 个。

- [ ] **Step 4: 写模式与密钥环 RED 测试**

固定接口：

```ts
expect(resolveAuthPersistenceMode({ databaseConfigured: true })).toBe('DB_ONLY');
expect(resolveAuthPersistenceMode({ databaseConfigured: false })).toBe('FILE_ONLY');
expect(resolveAuthPersistenceMode({ databaseConfigured: true, rawMode: 'DB_PLUS_FILE' })).toBe('DB_PLUS_FILE');
expect(() => resolveAuthPersistenceMode({ databaseConfigured: true, rawMode: 'invalid' })).toThrow('AUTH_CONFIGURATION_UNAVAILABLE');

const rotated = planSecretRingRotation(existingRing, nextSecret, now, false);
expect(rotated.active.secret).toBe(nextSecret);
expect(rotated.previous?.secret).toBe(existingRing.active.secret);
expect(() => planSecretRingRotation(rotated, thirdSecret, now + 1, true)).toThrow('AUTH_ROTATION_BLOCKED_LEGACY_CREDENTIALS');
```

- [ ] **Step 5: 写认证迁移 RED 测试**

覆盖：存在合法 sidecar 时错误密码不得降级旧哈希；任意八位错误密码不得登录或写入；正确旧密码写 sidecar 但保持 `password_hash` 字节不变；迁移写失败时本次正确登录成功并产生脱敏 `AUTH_CREDENTIAL_MIGRATION_DEFERRED`；管理员恢复只接受与 `WUJIE_ADMIN_PASSWORD` 精确相等的输入。

- [ ] **Step 6: 运行 RED 并保存失败摘要**

Run:

```powershell
pnpm exec vitest run src/__tests__/lib/auth-password.test.ts src/__tests__/lib/auth-persistence.test.ts src/__tests__/lib/auth-secret-ring.test.ts src/__tests__/lib/server-auth-stable-migration.test.ts
```

Expected: FAIL，原因仅为目标模块/导出尚不存在或旧实现违反新合同；不得出现测试语法错误。

- [ ] **Step 7: 提交测试合同**

```powershell
git add docs/testing/BUG_REGISTER.md src/__tests__/lib/auth-password.test.ts src/__tests__/lib/auth-persistence.test.ts src/__tests__/lib/auth-secret-ring.test.ts src/__tests__/lib/server-auth-stable-migration.test.ts
git commit -m "test: define stable authentication migration contracts"
```

---

### Task 2: 实现版本化 scrypt 凭据

**Files:**
- Create: `src/lib/auth/auth-errors.ts`
- Create: `src/lib/auth/auth-password.ts`
- Test: `src/__tests__/lib/auth-password.test.ts`

**Interfaces:**
- Consumes: `AuthErrorCode`。
- Produces:

```ts
export type AuthErrorCode =
  | 'AUTH_CONFIGURATION_UNAVAILABLE'
  | 'AUTH_PERSISTENCE_UNAVAILABLE'
  | 'AUTH_ROTATION_BLOCKED_LEGACY_CREDENTIALS'
  | 'AUTH_CREDENTIAL_FORMAT_INVALID'
  | 'AUTH_CREDENTIAL_MIGRATION_DEFERRED';

export class AuthServiceError extends Error {
  constructor(
    public readonly code: AuthErrorCode,
    message: string,
    public readonly httpStatus: 409 | 503,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'AuthServiceError';
  }
}

export async function createScryptCredential(password: string): Promise<string>;
export async function verifyScryptCredential(password: string, credential: string): Promise<boolean>;
export function isValidScryptCredential(credential: string): boolean;
export function createLegacyPasswordHash(password: string, secret: string): string;
export function verifyLegacyCredential(password: string, storedHash: string, secrets: readonly string[]): { matched: boolean; matchedIndex?: number };
export function resetScryptConcurrencyForTests(): void;
```

- [ ] **Step 1: 实现认证错误类型**

`AuthServiceError` 必须保存 `code`、`httpStatus`、`retryable`，错误消息不得包含 secret、password、hash 或连接串。

- [ ] **Step 2: 实现 scrypt 生成**

使用 `randomBytes(16)`、`scrypt(password, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 })`，以 base64url 编码并输出固定六段格式。

- [ ] **Step 3: 实现严格解析与验证**

先验证段数、版本、数值、salt 16 字节和 key 32 字节，再派生 32 字节并 `timingSafeEqual`。解析异常返回 `false`；编排层发现数据库已有畸形 sidecar 时转换为 `AUTH_CREDENTIAL_FORMAT_INVALID`，不得降级旧哈希。

- [ ] **Step 4: 实现 scrypt 并发边界**

模块内使用最大 4 个 permit 的 FIFO 队列包装生成和验证；队列项完成或抛错都必须在 `finally` 释放 permit。测试重置函数仅在 `NODE_ENV === 'test'` 时可用，生产调用抛错。

- [ ] **Step 5: 实现旧凭据兼容函数**

旧格式保持：

```ts
createHash('sha256').update(`${secret}:${password}`).digest('hex')
```

仅遍历调用方显式传入的 active、previous 和两个固定历史 secret，不接受其他候选。

- [ ] **Step 6: 运行聚焦测试**

Run:

```powershell
pnpm exec vitest run src/__tests__/lib/auth-password.test.ts
```

Expected: PASS；同一密码两次生成不同凭据，正确/错误/畸形/超界用例全部通过。

- [ ] **Step 7: 提交密码边界**

```powershell
git add src/lib/auth/auth-errors.ts src/lib/auth/auth-password.ts src/__tests__/lib/auth-password.test.ts
git commit -m "feat: add versioned scrypt authentication credentials"
```

---

### Task 3: 实现显式认证持久化模式

**Files:**
- Create: `src/lib/auth/auth-persistence.ts`
- Test: `src/__tests__/lib/auth-persistence.test.ts`
- Modify: `.env.example`

**Interfaces:**
- Produces:

```ts
export type AuthPersistenceMode = 'DB_ONLY' | 'DB_PLUS_FILE' | 'FILE_ONLY';
export function resolveAuthPersistenceMode(input: {
  databaseConfigured: boolean;
  rawMode?: string;
  production?: boolean;
}): AuthPersistenceMode;
export async function readAuthJsonFile<T>(filePath: string): Promise<T | null>;
export async function writeAuthJsonFileAtomic(filePath: string, value: unknown): Promise<void>;
```

- [ ] **Step 1: 实现模式解析**

未配置值时，有数据库返回 `DB_ONLY`，无数据库返回 `FILE_ONLY`；仅接受三个精确枚举值；`DB_ONLY` 在无数据库时和 `FILE_ONLY` 在生产已配置数据库时均抛 `AUTH_CONFIGURATION_UNAVAILABLE`。

- [ ] **Step 2: 实现文件原子写入**

在目标同目录写入随机后缀临时文件、权限 `0o600`，`rename` 替换目标；失败时删除临时文件并抛 `AUTH_PERSISTENCE_UNAVAILABLE`。不得先清空目标文件。

- [ ] **Step 3: 增加环境变量说明**

在 `.env.example` 添加：

```dotenv
# Authentication persistence: DB_ONLY (default with PostgreSQL), DB_PLUS_FILE, FILE_ONLY (default without PostgreSQL)
WUJIE_AUTH_PERSISTENCE_MODE=DB_ONLY
# Keep sessions signed by the immediately previous secret valid until their original 7-day expiry.
WUJIE_AUTH_ACCEPT_PREVIOUS_SESSIONS=true
```

- [ ] **Step 4: 运行测试**

```powershell
pnpm exec vitest run src/__tests__/lib/auth-persistence.test.ts
```

Expected: PASS；同时证明 DB 模式不触碰文件、文件 rename 失败不破坏旧文件。

- [ ] **Step 5: 提交持久化边界**

```powershell
git add .env.example src/lib/auth/auth-persistence.ts src/__tests__/lib/auth-persistence.test.ts
git commit -m "feat: make authentication persistence mode explicit"
```

---

### Task 4: 实现密钥环纯逻辑

**Files:**
- Create: `src/lib/auth/auth-secret-ring.ts`
- Test: `src/__tests__/lib/auth-secret-ring.test.ts`

**Interfaces:**
- Produces:

```ts
export interface AuthSecretEntry { kid: string; secret: string; activatedAt: number; retiredAt?: number }
export interface AuthSecretRingV1 { version: 1; active: AuthSecretEntry; previous?: AuthSecretEntry; updatedAt: number }
export function deriveAuthSecretKid(secret: string): string;
export function parseAuthSecretRing(value: unknown): AuthSecretRingV1 | null;
export function planSecretRingRotation(ring: AuthSecretRingV1, nextSecret: string, now: number, previousNeededByLegacyCredentials: boolean): AuthSecretRingV1;
export function sessionVerificationEntries(ring: AuthSecretRingV1, input: { now: number; acceptPrevious: boolean; ttlSeconds: number }): AuthSecretEntry[];
```

- [ ] **Step 1: 实现 kid 与严格解析**

`kid` 使用 `sha256(secret).digest('base64url').slice(0, 16)`；解析拒绝未知版本、短 secret、active 缺失、active/previous kid 不匹配和未来异常时间。不得在错误中输出 secret。

- [ ] **Step 2: 实现轮换决策**

相同 secret 返回同值；第一次变化把 active 原子移到 previous；若已有 previous 且调用方声明仍有旧凭据依赖，则抛 `AUTH_ROTATION_BLOCKED_LEGACY_CREDENTIALS`。

- [ ] **Step 3: 实现 session 候选策略**

始终返回 active；仅当 `acceptPrevious=true`、previous 有 `retiredAt` 且 `now - retiredAt <= 7 * 24 * 60 * 60 * 1000` 时返回 previous。

- [ ] **Step 4: 运行测试并提交**

```powershell
pnpm exec vitest run src/__tests__/lib/auth-secret-ring.test.ts
git add src/lib/auth/auth-secret-ring.ts src/__tests__/lib/auth-secret-ring.test.ts
git commit -m "feat: add atomic authentication secret ring model"
```

Expected: PASS；第二次危险轮换和紧急 previous session 禁用均有永久回归测试。

---

### Task 5: 增加数据库 sidecar 与严格仓储

**Files:**
- Create: `migrations/20260823_v588_auth_credentials.sql`
- Create: `src/lib/auth/auth-repository.ts`
- Modify: `src/lib/db-storage.ts`
- Modify: `src/__tests__/scripts/run-migrations.test.ts`
- Create: `tests/integration/v588-auth-postgres.test.ts`

**Interfaces:**
- Consumes: `AuthSecretRingV1`、`AuthPersistenceMode`。
- Produces:

```ts
export type StrictSettingRead = { found: false } | { found: true; value: unknown };
export async function readSystemSettingStrict(key: string): Promise<StrictSettingRead>;
export async function resolveDatabaseSecretRing(input: { configuredSecret: string | null; now: number }): Promise<AuthSecretRingV1>;
export async function updateUserCredentialSidecar(userId: string, credentialHash: string): Promise<void>;
export async function countLegacyCredentialUsers(): Promise<number>;
```

- [ ] **Step 1: 写迁移**

迁移只执行：

```sql
ALTER TABLE wujie_users ADD COLUMN IF NOT EXISTS credential_hash TEXT;
```

禁止重命名、删除或批量改写 `password_hash`。

- [ ] **Step 2: 扩展 DB 类型和 UPSERT**

`DbUser`、`DbUserReadRow` 和 `dbReadUsers()` 返回 `credential_hash: string | null`。现有普通 UPSERT 不把未提供 sidecar 转成 `NULL`；使用：

```sql
credential_hash = COALESCE(EXCLUDED.credential_hash, wujie_users.credential_hash)
```

新建/改密路径显式提供 sidecar。

- [ ] **Step 3: 实现严格设置读取**

直接使用 `getPool().connect()`；查询成功零行返回 `{ found: false }`，连接/查询错误原样包装为 `AUTH_PERSISTENCE_UNAVAILABLE`。不得调用会吞异常的 `dbGetSystemSetting()`。

- [ ] **Step 4: 实现事务密钥环解析**

事务中执行固定 advisory lock、`SELECT value ... FOR UPDATE`、读取旧 `auth_secret`、计算完整 ring、单次 UPSERT `auth_secret_ring_v1`，提交后返回；任一步失败 `ROLLBACK`。固定锁键通过 `pg_advisory_xact_lock(hashtext('wujie:auth-secret-ring:v1'))` 获得。

- [ ] **Step 5: 实现 sidecar 条件更新**

仅更新目标用户：

```sql
UPDATE wujie_users
SET credential_hash = $2, updated_at = $3
WHERE id = $1 AND credential_hash IS NULL
RETURNING id
```

写失败抛 `AUTH_PERSISTENCE_UNAVAILABLE`；不修改角色、积分、模型授权、状态或 `password_hash`。

- [ ] **Step 6: 写 PostgreSQL RED/并发测试**

使用 `tests/helpers/postgres-test-database.ts` 创建隔离数据库，测试 20 个并发 `resolveDatabaseSecretRing()` 只得到一个相同 active/previous 结果；故障读取不写随机值；sidecar 更新保留其他用户字段；模拟 stable 风格 UPSERT 后 sidecar 不为空；事务故障不产生半个 ring。

- [ ] **Step 7: 运行迁移、单元和 PostgreSQL 测试**

```powershell
pnpm exec vitest run src/__tests__/scripts/run-migrations.test.ts
pnpm exec vitest run tests/integration/v588-auth-postgres.test.ts
```

Expected: 两组 PASS；若未配置隔离 PostgreSQL，集成测试必须明确 SKIP 并记录阻塞，不能记为通过。

- [ ] **Step 8: 提交数据库边界**

```powershell
git add migrations/20260823_v588_auth_credentials.sql src/lib/auth/auth-repository.ts src/lib/db-storage.ts src/__tests__/scripts/run-migrations.test.ts tests/integration/v588-auth-postgres.test.ts
git commit -m "feat: persist compatible authentication credentials atomically"
```

---

### Task 6: 接入 server-auth 登录与兼容迁移

**Files:**
- Modify: `src/lib/server-auth.ts`
- Test: `src/__tests__/lib/server-auth-stable-migration.test.ts`
- Modify: `src/__tests__/lib/server-auth-legacy-rotation.test.ts`
- Modify: `src/__tests__/lib/server-auth-production-security.test.ts`

**Interfaces:**
- Consumes: Task 2-5 的函数。
- Produces: 保持现有 `authenticateUser()`、`createSessionToken()`、`getSessionUser()`、`getAuthSecretForInternalRequests()` 外部签名稳定。

- [ ] **Step 1: 扩展内部用户结构**

`StoredUser` 新增 `credentialHash?: string`；数据库映射读取 `credential_hash`，文件 JSON 兼容缺失字段。

- [ ] **Step 2: 替换 authSecret 编排**

按 `WUJIE_AUTH_PERSISTENCE_MODE` 调用严格仓储/文件密钥环；DB 已配置且读取失败时直接抛 503，不生成随机 secret；仅 `FILE_ONLY` 开发模式可首次生成并原子保存。缓存保存完整 ring，不只保存单一字符串。

- [ ] **Step 3: 让用户存储执行相同持久化合同**

重写 `readStore()` / `writeStore()` 的策略分派：`DB_ONLY` 只读写数据库且失败即抛；`DB_PLUS_FILE` 以数据库为权威，DB 成功后文件副本失败只产生一次脱敏 warning；`FILE_ONLY` 只使用原子 JSON 文件。删除当前“DB 失败后读取旧文件并继续”和“管理员 bootstrap 写失败后以内存数据继续”的成功路径，防止旧副本覆盖真实用户或制造仅当前进程可登录的管理员。

- [ ] **Step 4: 接入优先 sidecar 验证**

逻辑顺序固定为：

```ts
if (user.credentialHash !== undefined) {
  if (!isValidScryptCredential(user.credentialHash)) {
    throw new AuthServiceError(
      'AUTH_CREDENTIAL_FORMAT_INVALID',
      'Stored authentication credential is invalid.',
      503,
      false,
    );
  }
  if (!(await verifyScryptCredential(password, user.credentialHash))) return null;
} else {
  const legacy = verifyLegacyCredential(password, user.passwordHash, allowedLegacySecrets);
  if (!legacy.matched) return null;
  migrationCredential = await createScryptCredential(password);
}
```

禁止 sidecar 错误后回退旧哈希。

- [ ] **Step 5: 接入迁移延迟语义**

正确旧密码后尝试只写 sidecar；失败记录一次包含 `AUTH_CREDENTIAL_MIGRATION_DEFERRED`、userId、kid 和 request-independent timestamp 的 warning，本次仍返回用户。日志不得包含用户名、密码、secret 或哈希。

- [ ] **Step 6: 保留 stable 兼容写入**

创建用户、改密、管理员精确恢复同时计算：

```ts
credentialHash = await createScryptCredential(password);
passwordHash = createLegacyPasswordHash(password, ring.active.secret);
```

普通资料/权限更新不得重新计算凭据，也不得清空 sidecar。

- [ ] **Step 7: 收紧管理员恢复**

只有默认管理员且输入密码精确等于已配置 `WUJIE_ADMIN_PASSWORD` 时允许恢复；用户名存在、角色为 admin 或密码长度不少于八位均不构成通过条件。

- [ ] **Step 8: 运行认证聚焦回归**

```powershell
pnpm exec vitest run src/__tests__/lib/auth-password.test.ts src/__tests__/lib/auth-persistence.test.ts src/__tests__/lib/auth-secret-ring.test.ts src/__tests__/lib/server-auth-stable-migration.test.ts src/__tests__/lib/server-auth-legacy-rotation.test.ts src/__tests__/lib/server-auth-production-security.test.ts
```

Expected: PASS；明确断言错误八位密码不写、正确旧密码不改旧哈希、DB 读取失败不生成 secret。

- [ ] **Step 9: 提交认证编排**

```powershell
git add src/lib/server-auth.ts src/__tests__/lib/server-auth-stable-migration.test.ts src/__tests__/lib/server-auth-legacy-rotation.test.ts src/__tests__/lib/server-auth-production-security.test.ts
git commit -m "fix: migrate authentication without breaking stable rollback"
```

---

### Task 7: Session kid、正常轮换和紧急失效

**Files:**
- Modify: `src/lib/server-auth.ts`
- Modify: `src/lib/auth/auth-secret-ring.ts`
- Modify: `src/__tests__/lib/auth-session.test.ts`
- Modify: `src/__tests__/lib/auth-secret-ring.test.ts`

**Interfaces:**
- Session payload 变为：

```ts
interface SessionPayload {
  sub: string;
  role: 'admin' | 'user';
  name: string;
  exp: number;
  kid?: string;
}
```

- [ ] **Step 1: 写 session RED 测试**

覆盖新 token 携带 active kid；无 kid 的旧 token 可由 active/previous 验证；previous token 在原始 exp 前且退役不超过七天时通过；`WUJIE_AUTH_ACCEPT_PREVIOUS_SESSIONS=false`、token 过期或退役超过七天时失败。

- [ ] **Step 2: 签发 active session**

`createSessionToken()` 把 active kid 写入 payload，并只用 active secret HMAC；Cookie 名称、路径、HttpOnly、SameSite=Lax、条件 Secure 和七天 TTL 不变。

- [ ] **Step 3: 验证受控候选**

有 kid 时只尝试匹配 kid 的允许 entry；无 kid 时按 active、previous 顺序尝试。签名比较使用 `timingSafeEqual`，不在错误中区分密钥来源。

- [ ] **Step 4: 运行并提交**

```powershell
pnpm exec vitest run src/__tests__/lib/auth-session.test.ts src/__tests__/lib/auth-secret-ring.test.ts
git add src/lib/server-auth.ts src/lib/auth/auth-secret-ring.ts src/__tests__/lib/auth-session.test.ts src/__tests__/lib/auth-secret-ring.test.ts
git commit -m "feat: support controlled authentication session rotation"
```

Expected: PASS；正常轮换兼容旧 session，紧急开关立即拒绝 previous session。

---

### Task 8: 登录 API 与 doctor 失败合同

**Files:**
- Modify: `src/app/api/auth/login/route.ts`
- Modify: `src/app/api/auth/me/route.ts`
- Modify: `scripts/doctor.mjs`
- Modify: `src/__tests__/api/auth-login-configuration.test.ts`
- Modify: `src/__tests__/scripts/doctor-production-auth-contract.test.ts`

**Interfaces:**
- Produces: JSON 错误保持 `{ success: false, code, error, retryable }`；表单登录继续 303 到带安全错误枚举的登录页。

- [ ] **Step 1: 写路由 RED 测试**

断言无效凭据 401 且不暴露账号存在；速率限制 429；轮换阻塞 409；配置/持久化失败 503；迁移延迟仍 200/303。不得只断言 HTTP 状态码，同时断言业务 code 和 `retryable`。

- [ ] **Step 2: 映射 AuthServiceError**

登录路由根据错误对象输出规定状态；表单只暴露 `invalid_credentials`、`too_many_attempts`、`configuration`、`temporarily_unavailable`，不得把内部栈或 secret 写入 URL。

- [ ] **Step 3: 贯穿 requestId 与安全日志**

优先使用合法 `x-request-id`，否则生成 `crypto.randomUUID()`；响应回写 `x-request-id`。认证日志只记录 requestId、内部 userId、错误码、持久化模式、kid、持续时间和结果，不记录用户名、凭据、完整 token、哈希或连接串；测试断言敏感测试值不出现在日志和响应中。

- [ ] **Step 4: 修正 `/api/auth/me`**

认证配置/持久化不可用返回 503 和统一 code；无 session 仍返回 200 `{ success: true, user: null }`，不能把正常匿名状态误报成故障。

- [ ] **Step 5: 扩展 doctor**

生产模式检查 `WUJIE_AUTH_PERSISTENCE_MODE` 的枚举与数据库组合；`DB_ONLY`/`DB_PLUS_FILE` 必须有数据库；`FILE_ONLY` 生产模式为 FAIL；`WUJIE_AUTH_ACCEPT_PREVIOUS_SESSIONS` 仅允许 `true`/`false`。输出不得回显值。

- [ ] **Step 6: 运行路由和 doctor 测试**

```powershell
pnpm exec vitest run src/__tests__/api/auth-login-configuration.test.ts src/__tests__/scripts/doctor-production-auth-contract.test.ts
```

Expected: PASS，401/409/429/503 合同和 doctor 枚举均闭环。

- [ ] **Step 7: 提交 API 与健康检查**

```powershell
git add src/app/api/auth/login/route.ts src/app/api/auth/me/route.ts scripts/doctor.mjs src/__tests__/api/auth-login-configuration.test.ts src/__tests__/scripts/doctor-production-auth-contract.test.ts
git commit -m "fix: expose fail-closed authentication health states"
```

---

### Task 9: 本地浏览器、stable 回滚与全仓门禁

**Files:**
- Create: `tests/e2e/v588-auth-001-session.spec.ts`
- Modify: `tests/e2e/p0-auth-session.spec.ts`
- Create: `docs/testing/evidence/v588-auth-001-local-2026-08-23.json`

**Interfaces:**
- Consumes: 测试专用管理员和普通用户环境变量；不得硬编码真实账号密码。
- Produces: 三浏览器 JUnit、HTML、截图/录像/trace、console/network 证据。

- [ ] **Step 1: 写真实 E2E**

测试必须通过真实登录表单执行管理员和普通用户：进入无限画布、项目仪表盘、独立智能对话；刷新保持；退出回“选择入口”；错误密码失败且不改变后续正确登录；不路由 Mock `/api/auth/*`。

- [ ] **Step 2: 启动隔离本地生产实例**

```powershell
$env:E2E_BASE_URL='http://127.0.0.1:5011'
$env:WUJIE_AUTH_PERSISTENCE_MODE='FILE_ONLY'
$env:WUJIE_DATA_DIR=Join-Path $env:TEMP 'wujie-v588-auth-e2e'
pnpm build
pnpm exec next start -p 5011 -H 127.0.0.1
```

Expected: 服务健康且不读取真实生产数据库；测试凭据由临时数据目录提供。

- [ ] **Step 3: 运行三浏览器认证 E2E**

```powershell
pnpm exec playwright test tests/e2e/v588-auth-001-session.spec.ts tests/e2e/p0-auth-session.spec.ts --project=chromium --project=firefox --project=webkit
```

Expected: 全部 PASS；Console error、未处理 Promise、原生 dialog 和失败认证网络请求为 0（预期 401/429 用例在证据中单独标记）。

- [ ] **Step 4: 验证 stable 风格回滚合同**

在隔离数据库中先由新代码创建/迁移测试用户，再运行只读取 `password_hash` 的 stable 兼容验证脚本；正确旧密码必须通过，`credential_hash` 保持存在。禁止 checkout 或修改真实 `stable` 工作树。

- [ ] **Step 5: 运行全仓门禁**

```powershell
node scripts/doctor.mjs --production
pnpm ts-check
pnpm lint
pnpm test
pnpm test:api
pnpm test:regression
pnpm build
git diff --check
```

Expected: 全部退出码 0。若 `node scripts/doctor.mjs --production` 因本机没有生产密钥/数据库失败，保留真实 FAIL 证据，并另运行使用隔离测试变量的 doctor；不得改为假通过。

- [ ] **Step 6: 运行保护边界审计**

```powershell
node scripts/check-protected-baseline.mjs --base 7fdc0108952fb3a68415ca3a2a26b5d33641dc6b --allow-path .env.example --allow-path docs/superpowers/specs/2026-08-23-v588-auth-001-stable-auth-migration-design.md --allow-path docs/superpowers/plans/2026-08-23-v588-auth-001-stable-auth-migration.md --allow-path docs/testing/ --allow-path migrations/20260823_v588_auth_credentials.sql --allow-path scripts/doctor.mjs --allow-path src/app/api/auth/ --allow-path src/lib/auth/ --allow-path src/lib/server-auth.ts --allow-path src/lib/db-storage.ts --allow-path src/__tests__/api/auth-login-configuration.test.ts --allow-path src/__tests__/lib/auth-password.test.ts --allow-path src/__tests__/lib/auth-persistence.test.ts --allow-path src/__tests__/lib/auth-secret-ring.test.ts --allow-path src/__tests__/lib/auth-session.test.ts --allow-path src/__tests__/lib/server-auth-stable-migration.test.ts --allow-path src/__tests__/lib/server-auth-legacy-rotation.test.ts --allow-path src/__tests__/lib/server-auth-production-security.test.ts --allow-path src/__tests__/scripts/doctor-production-auth-contract.test.ts --allow-path src/__tests__/scripts/run-migrations.test.ts --allow-path tests/e2e/p0-auth-session.spec.ts --allow-path tests/e2e/v588-auth-001-session.spec.ts --allow-path tests/integration/v588-auth-postgres.test.ts
```

Expected: PASS，且 `git diff origin/stable --name-only` 仅用于审计，不对 stable 写入。

- [ ] **Step 7: 提交本地验收证据**

```powershell
git add tests/e2e/v588-auth-001-session.spec.ts tests/e2e/p0-auth-session.spec.ts docs/testing/evidence/v588-auth-001-local-2026-08-23.json
git commit -m "test: verify authentication migration across browsers"
```

---

### Task 10: 推送 main 并执行 Coze exact SHA 验收

**Files:**
- Create: `docs/testing/evidence/v588-auth-001-coze-2026-08-23.json`
- Modify: `docs/testing/REGRESSION_REPORT.md`
- Modify: `docs/testing/RELEASE_READINESS_REPORT.md`
- Modify: `docs/testing/UNVERIFIED_ITEMS.md`

**Interfaces:**
- Consumes: 已通过全部本地门禁的候选 SHA。
- Produces: Coze 部署 SHA、登录/刷新/重启/退出证据和未验证边界。

- [ ] **Step 1: 推送前复核**

```powershell
git status --short
git log --oneline origin/main..HEAD
git diff --stat origin/main...HEAD
git rev-parse origin/stable
```

Expected: 仅本任务提交；已知未跟踪文件不被纳入；stable SHA 仍为 `52f7c601ed150769e15d06fb435c6e360e28c9e7`。

- [ ] **Step 2: 推送候选到 main**

```powershell
git push origin HEAD:main
git fetch origin
git rev-parse HEAD
git rev-parse origin/main
```

Expected: 两个 SHA 完全一致；记录为部署候选，不写“已云端通过”。

- [ ] **Step 3: 在现有 Chrome Coze 项目页拉取 exact SHA**

只操作已打开的 Google Chrome 项目页；若出现沙箱断开弹窗，点击刷新并等待沙箱恢复。拉取后从终端确认 `git rev-parse HEAD` 等于候选 SHA，再重启预览服务。

- [ ] **Step 4: 强制刷新现有预览页**

不创建新标签页。确认根页面和 `/api/auth/me` 可访问，页面没有旧 chunk 404，Console error/warning、原生 dialog 和未处理 Promise 为 0。

- [ ] **Step 5: 使用当前相同 secret 验收登录**

用 Chrome 已保存的管理员账号和一个普通测试账号，分别验证入口选择、登录、无限画布、项目仪表盘、独立智能对话、强制刷新保持、退出回入口、再次登录。不得在自动化日志中读取或输出密码值。

- [ ] **Step 6: 验收服务重启**

保持 secret 不变重启 Coze，再次强制刷新预览页；重启前 session 按合同保持，管理员和普通用户仍可使用原密码登录。

- [ ] **Step 7: 只在独立批准后执行真实 secret 轮换**

执行前必须有数据库备份、活动用户统计、未迁移 legacy 数量、回滚 secret 操作和紧急开关核对。缺少任一项则把“真实云端轮换”写入未验证项，不执行，不影响同 secret 部署验收结论。

- [ ] **Step 8: 写云端证据**

JSON 至少包含候选 SHA、stable SHA、Coze 实际 SHA、URL、测试时间、浏览器版本、账号角色（不含用户名/密码）、步骤、网络状态、console/dialog 数量、重启结果和未执行的高影响操作。

- [ ] **Step 9: 更新报告并提交**

只有 PostgreSQL 并发、三浏览器和 Coze 同 secret 验收全部通过，才把 V588-AUTH-001 标为“有条件通过”；真实轮换未执行时不得标“完全通过”。

```powershell
git add docs/testing/evidence/v588-auth-001-coze-2026-08-23.json docs/testing/BUG_REGISTER.md docs/testing/REGRESSION_REPORT.md docs/testing/RELEASE_READINESS_REPORT.md docs/testing/UNVERIFIED_ITEMS.md
git commit -m "docs: record V588 authentication cloud acceptance"
git push origin HEAD:main
```

---

### Task 11: 更新 Obsidian 与吸收清单

**Files:**
- Modify outside Git: `F:/AIGC/vault-template/无界计划/11-阶段进度看板.md`
- Modify outside Git: `F:/AIGC/vault-template/无界计划/16-V5.8.8选择性吸收.md`

**Interfaces:**
- Consumes: 最终本地与云端证据。
- Produces: 唯一进度事实源，防止后续重复修复和目标偏移。

- [ ] **Step 1: 更新阶段进度**

记录完成提交、云端 exact SHA、通过门禁、阻塞项和下一唯一任务；不得把计划完成等同于实现完成。

- [ ] **Step 2: 更新 V5.8.8 吸收结论**

只有证据闭环后把 `V588-AUTH-001` 从“设计已确认/实施中”改为“已吸收”；同时保留 donor 八位密码绕过为“永久拒绝项”。

- [ ] **Step 3: 复核没有重复阶段**

对照 Obsidian 中的 Stage 4/Stage 5 看板，确认下一项不是已完成的 V588-SAFETY-001 或 UI-003；记录下一唯一工作项及其进入条件。

---

## 自检清单

- [ ] 规格第 1-12 节均能映射到至少一个 Task。
- [ ] 计划中不存在未决占位语句或无测试的宽泛修改。
- [ ] `credentialHash` / `credential_hash` 命名在文件、数据库和测试中一致。
- [ ] `AuthSecretRingV1`、错误码、session `kid` 和三种持久化模式签名一致。
- [ ] `stable`、donor 和现有未跟踪文件没有写入、删除或提交。
- [ ] 真实 secret 轮换与同 secret 部署验收被明确分开。
- [ ] 没有把 HTTP 200、Mock 或单一管理员登录作为完整通过证据。

## 完成标准

1. 错误八位密码和 donor 绕过路径永久失败。
2. DB 读取故障不会生成或覆盖 secret。
3. scrypt sidecar 正确生成，旧 `password_hash` 保持可回滚。
4. 20 并发 PostgreSQL 轮换只有一个一致结果。
5. 正常轮换兼容未过期 previous session，紧急开关立即拒绝。
6. Chromium、Firefox、WebKit 登录、刷新、退出均通过。
7. Coze exact SHA 下管理员和普通用户在重启前后均可登录。
8. 全仓门禁、保护基线和空白检查通过。
9. 报告和 Obsidian 只依据真实证据更新，不重复工作、不偏移目标。

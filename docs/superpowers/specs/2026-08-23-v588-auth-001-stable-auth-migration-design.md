# V588-AUTH-001 稳定认证密钥与兼容凭据迁移设计

**状态：** 用户已确认推荐方案与会话轮换策略，等待书面规格复核  
**日期：** 2026-08-23  
**当前基线：** `main@f1b3550e6654be42b155b8b5c01d9f9b3efdfe95`  
**只读稳定线：** `stable@52f7c601ed150769e15d06fb435c6e360e28c9e7`  
**只读参考：** `J:/无界云端0820`

## 1. 目标

1. 数据库瞬时不可用、返回空值或部署重启时，不得随机生成并覆盖正在使用的认证密钥。
2. 明确区分 `DB_ONLY`、`DB_PLUS_FILE` 和 `FILE_ONLY` 三种认证持久化模式；生产写入失败必须显式失败，不能伪装成功。
3. 将用户密码凭据从会话签名密钥中逐步解耦，使用带随机盐的版本化 scrypt 凭据。
4. 旧用户只有在真实旧密码验证成功后才迁移；任意八位密码、用户名存在或管理员身份都不能绕过验证。
5. 正常密钥轮换时，旧会话可继续使用至原七天有效期；紧急轮换可立即拒绝旧会话。
6. 保持 `stable` 可回滚：新版凭据迁移不能让旧稳定版本失去登录能力。
7. 不改变无限画布、节点模式、独立智能对话、用户模型授权、项目数据、任务或账务行为。

## 2. 已确认问题

### 2.1 当前线风险

- `dbGetSystemSetting()` 把“键不存在”和“数据库读取失败”都折叠为 `null`，调用方无法区分确定空值与瞬时故障。
- 非生产运行且数据库已配置时，`authSecret()` 在读到 `null` 后仍可能生成随机 secret 并尝试写回；若读取瞬时失败而写入随后恢复，可能覆盖真实 secret。
- `password_hash` 使用 `sha256(secret + ':' + password)`，会话 secret 变化会同时使所有旧密码哈希失效。
- 当前只识别活动 secret 和两个硬编码历史 secret，不支持受控的部署密钥轮换记录。
- `writeStore()` 总是先尝试文件写入；数据库为权威时会在不可写沙箱中产生重复 EPERM 警告，且存储模式不是显式合同。

### 2.2 V5.8.8 可吸收与拒绝项

可吸收思想：

- 数据库已配置但读取不确定时禁止生成随机 secret。
- 认证存储模式应显式化。
- 轮换时保留受控的前序 secret，用于验证旧凭据和有限期旧会话。

明确拒绝：

- `password.length >= 8` 即允许任意已知用户重新哈希并登录。这是账号接管漏洞。
- 直接复制 donor 的 `auth-persistence.ts`。其解析函数需要原始环境值，但实际调用未传入环境值，`DB_PLUS_FILE` 不能按声明生效；独立测试也没有证明与 `server-auth.ts` 的真实写入路径一致。
- 直接复制 donor 的密钥历史写法。多个设置键不是原子更新，多实例并发时可能产生不一致的 active/previous 状态。

## 3. 总体方案

采用分层、兼容的四个边界：

1. `auth-secret-ring`：解析活动密钥、前序密钥、轮换时间和会话兼容策略。
2. `auth-password`：生成和验证版本化 scrypt 凭据，只负责密码算法。
3. `auth-persistence`：解析三种持久化模式并执行明确的读写策略。
4. `server-auth`：编排用户读取、密码验证、凭据迁移、session 签发和兼容回滚，不再自行实现上述细节。

每个边界先以纯函数和依赖注入建立 RED 测试，再接入真实数据库与登录路由。

## 4. 密钥环设计

### 4.1 数据结构

数据库系统设置新增单一 JSON 值 `auth_secret_ring_v1`：

```ts
interface AuthSecretEntry {
  kid: string;
  secret: string;
  activatedAt: number;
  retiredAt?: number;
}

interface AuthSecretRingV1 {
  version: 1;
  active: AuthSecretEntry;
  previous?: AuthSecretEntry;
  updatedAt: number;
}
```

`kid` 为 secret 的单向摘要前缀，只用于选择验证密钥；日志、API 和错误中不得输出 secret。旧 `auth_secret` 仅作为首次迁移来源，不在完成迁移后继续作为独立权威值。

### 4.2 来源优先级

1. 有效的 `WUJIE_AUTH_SECRET`；
2. 有效的 `NEXTAUTH_SECRET`；
3. 严格读取成功的数据库 `auth_secret_ring_v1`；
4. 仅在 `DB_PLUS_FILE` 或 `FILE_ONLY` 模式读取已存在的本地密钥环文件；
5. 生产环境没有任何确定来源时返回 `AUTH_CONFIGURATION_UNAVAILABLE`，不得随机生成。

开发环境只有在数据库未配置且模式为 `FILE_ONLY` 时，才允许生成随机 secret，并以 0600 权限原子写入文件。

### 4.3 原子轮换

数据库轮换使用事务与 PostgreSQL advisory lock：

1. 锁定固定的认证密钥资源；
2. `SELECT ... FOR UPDATE` 读取当前密钥环和旧 `auth_secret`；
3. 环境 secret 与 active 相同则只返回，不写入；
4. 不同时把原 active 移到 previous，把环境 secret 设为 active；
5. 单次 UPSERT 写入完整 `auth_secret_ring_v1`；
6. 提交后才更新进程缓存。

严格数据库函数必须抛出“键不存在”与“数据库不可用”两种不同结果，不能复用当前吞异常并返回 `null` 的通用 helper。

若 previous 尚承载未迁移旧密码，而又请求第二次轮换，则默认失败关闭并返回 `AUTH_ROTATION_BLOCKED_LEGACY_CREDENTIALS`。不得静默丢弃仍需要的旧密钥。

## 5. 密码凭据设计

### 5.1 新格式

新版凭据采用：

```text
scrypt-v1$32768$8$1$<base64url-salt>$<base64url-derived-key>
```

参数：随机盐 16 字节、派生结果 32 字节、`N=32768`、`r=8`、`p=1`、`maxmem=64 MiB`。比较使用 `crypto.timingSafeEqual()`。解析时严格限制字段数、算法名、数值范围和解码长度，畸形格式失败关闭。

登录路由已有每 IP + 用户名失败限流；本项保留该边界，并增加 scrypt 并发上限测试，避免昂贵哈希形成无界 CPU/内存压力。

### 5.2 stable 兼容侧写

不能直接覆盖现有 `password_hash`，否则回滚到只读 `stable` 后已迁移用户无法登录。采用兼容字段：

- PostgreSQL `wujie_users` 新增可空 `credential_hash TEXT`；
- 文件用户记录新增可选 `credentialHash`；
- `password_hash` 保持旧格式，供 `stable` 紧急回滚；
- 新版存在合法 `credential_hash` 时只验证 scrypt，不再降级到旧哈希；
- `credential_hash` 缺失时，才验证旧 `password_hash`。

旧稳定版本会忽略新增列/字段，现有 UPSERT 不得清空 `credential_hash`。新版密码修改、新用户创建和管理员重置必须同时写入 scrypt 凭据与兼容旧哈希，以保持回滚能力。

### 5.3 受控迁移

旧哈希验证候选仅包括：

1. active secret；
2. 数据库密钥环中的 previous secret；
3. 当前代码明确列出的两个历史固定 secret。

只有输入密码与上述某一候选计算结果完全匹配，才生成 `credential_hash`。错误密码无论长度、用户角色或用户名是否存在都返回 401，不写任何凭据。

迁移写入失败时，已正确验证的本次登录仍可签发 session；记录脱敏、可检索的 `AUTH_CREDENTIAL_MIGRATION_DEFERRED`，下次正确登录重试。不得把持久化瞬时失败误报为密码错误，也不得修改用户输入密码。

默认管理员仅允许在输入密码精确等于 `WUJIE_ADMIN_PASSWORD` 时执行显式管理员恢复。普通用户必须通过旧哈希或 scrypt 验证，不存在通用恢复后门。

## 6. Session 兼容与紧急失效

新 session payload 增加 `kid`，签名始终使用 active secret。旧 payload 没有 `kid` 时按受控顺序验证 active 和 previous。

默认 `WUJIE_AUTH_ACCEPT_PREVIOUS_SESSIONS=true`：

- previous session 仅在 token 自身未过期、且密钥退役时间未超过七天时有效；
- 使用 previous 验证成功后，请求继续，不在读接口中隐式改写用户数据；下一次登录签发 active session。

紧急轮换设置 `WUJIE_AUTH_ACCEPT_PREVIOUS_SESSIONS=false`：

- previous session 立即无效；
- previous 仍只可用于旧密码正确性迁移，不能签发新 session；
- 关闭旧会话不会放宽密码验证。

登出继续清除同一 HttpOnly、SameSite=Lax、HTTPS 条件 Secure 的 Cookie。Cookie 名、路径和七天 TTL 不变。

## 7. 显式持久化模式

环境变量 `WUJIE_AUTH_PERSISTENCE_MODE` 允许：

| 模式 | 默认条件 | 读取 | 写入失败行为 |
|---|---|---|---|
| `DB_ONLY` | 已配置 PostgreSQL | 仅数据库 | 抛 `AUTH_PERSISTENCE_UNAVAILABLE`，不得写文件或伪装成功 |
| `DB_PLUS_FILE` | 仅显式配置 | 数据库权威，文件为受控副本 | DB 失败即失败；文件失败只记一次脱敏 warning |
| `FILE_ONLY` | 未配置 PostgreSQL | 仅固定数据目录 | 原子临时文件 + rename 失败即失败 |

非法环境值在生产 doctor 中为 FAIL，在运行时返回配置错误；不得静默回落到其他模式。模式解析必须实际读取 `process.env.WUJIE_AUTH_PERSISTENCE_MODE`，不能只测试未接线的纯函数。

普通成功登录且不需要迁移时不写用户存储。用户创建、改密、管理员重置和权限修改必须按选定模式完成权威写入后才报告成功。

## 8. 错误与可观测性

统一内部错误码：

- `AUTH_CONFIGURATION_UNAVAILABLE`：缺少确定密钥来源；HTTP 503，可重试；
- `AUTH_PERSISTENCE_UNAVAILABLE`：权威用户存储写入失败；HTTP 503，可重试；
- `AUTH_ROTATION_BLOCKED_LEGACY_CREDENTIALS`：轮换会丢失仍需旧密钥；HTTP 409，不自动重试；
- `AUTH_CREDENTIAL_FORMAT_INVALID`：已存在的新版凭据畸形；HTTP 503，需管理员处理；
- `AUTH_CREDENTIAL_MIGRATION_DEFERRED`：正确登录后迁移暂缓；登录仍成功，日志 warning；
- 无效用户名或密码继续统一返回 401，不暴露账号是否存在。

日志允许记录：时间、环境、版本、requestId、错误码、存储模式、kid、持续时间和成功/失败状态。不得记录密码、secret、完整 session、完整哈希或数据库连接串；用户名只记录不可逆摘要或内部 userId。

## 9. 兼容与发布顺序

1. 先部署数据库可空字段、解析器和只读兼容代码，不主动轮换密钥。
2. 使用当前相同的 `WUJIE_AUTH_SECRET` 启动，证明现有管理员和普通用户登录、刷新保持、三入口导航及退出正常。
3. 正确登录旧用户时写入 sidecar scrypt 凭据，但保留 `password_hash`。
4. 重启 Coze，证明 active secret、scrypt 用户和未迁移旧用户均可登录。
5. 在隔离 PostgreSQL 和测试账号完成并发轮换、旧 session 七天兼容及紧急失效测试。
6. 真实云端环境变量轮换属于独立高影响操作，执行前再次核对数据库备份、活动用户和回滚命令；没有该证据时不得声称轮换云端通过。

回滚到 `stable` 时继续使用轮换前兼容 secret；旧 `password_hash` 未被覆盖，因此账号仍可登录。新增 `credential_hash` 列由 stable 忽略，不执行破坏性回滚迁移。

## 10. 测试合同

### 10.1 RED 单元测试

- scrypt 正确密码通过、错误密码失败、盐不同、畸形格式失败、比较长度固定；
- 存在新版凭据时不得降级旧哈希；
- 任意八位错误密码不能登录或写入；
- 正确旧密码生成 sidecar，但不覆盖 `password_hash`；
- active/previous/两个固定旧 secret 之外的候选不能验证；
- DB 已配置且读失败时不生成、不写入随机 secret；
- 三模式读取、写入与非法值行为；
- 普通轮换接受未过期 previous session，紧急开关拒绝；
- 第二次轮换会丢失未迁移凭据时失败关闭。

### 10.2 PostgreSQL 集成与并发

- 20 个并发实例解析同一新环境 secret，只产生一个 active/previous 轮换结果；
- 读取故障后恢复不会覆盖既有 ring；
- `credential_hash` 迁移与用户更新不丢失模型授权、积分、角色和状态；
- stable 风格 UPSERT 不会清空新增字段；
- 写入失败不返回业务成功，正确登录的延迟迁移除外；
- 数据库事务失败时 ring、用户凭据和审计均回滚。

### 10.3 路由和真实浏览器

- JSON 与表单登录的 200/303、401、409、429、503；
- 管理员与普通用户分别进入无限画布、项目仪表盘和独立智能对话；
- 刷新保持登录，退出回入口选择页；
- 服务重启后旧 session 按策略保持，错误密码始终失败；
- Chromium、Firefox、WebKit 核心认证回归；
- Google Chrome Coze exact SHA 真实登录、强制刷新、退出和再次登录；
- Console error/warning、未处理 Promise、原生 dialog 和失败网络请求均留证。

## 11. 保护边界

- 只修改 `main`；`stable` 和 `J:/无界云端0820` 始终只读。
- 不删除旧 `password_hash`，不批量改写用户密码，不创建测试后门。
- 不把 secret、密码或 session 写入测试证据、Git、日志或 Obsidian。
- 不在没有 RED 的情况下修改认证生产代码。
- 不把本地 Mock、HTTP 200 或单一管理员登录当作完整认证通过。
- 每次最小提交后运行认证聚焦、全仓 TypeScript、ESLint、Vitest、生产构建、doctor、保护基线与空白检查。
- PostgreSQL 专项没有隔离库时必须保持未验证；不得用内存 Mock 冒充并发事务证据。

## 12. 成功标准

- 错误八位密码和 donor 绕过路径永久回归为失败；
- 数据库瞬时故障不会生成或覆盖认证密钥；
- 新密码使用版本化 scrypt，旧密码仅在正确验证后迁移；
- `stable` 回滚仍能使用保留的旧哈希；
- 正常轮换保留七天内旧 session，紧急开关可立即失效；
- DB/file 模式与运行环境一致，权威写入失败不会报告成功；
- 管理员和普通用户在重启前后均可用原密码登录；
- 认证相关 P0/P1 回归、真实 PostgreSQL 并发和 Coze Google Chrome 证据全部通过后，才可把 `V588-AUTH-001` 标记为已吸收。

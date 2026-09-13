# V588-MEDIA-001 Task 7 实施报告

## 结论

- 状态：`DONE_WITH_CONCERNS`
- 提交：`752b2504a46402ad1de62e1b04c505e813fe0b2e`
- 提交信息：`feat: add media gateway admin controls`
- 提交范围：严格为 brief 列出的 6 个源代码/测试文件，共 `796 insertions(+), 22 deletions(-)`。
- 既有 SDD dirty 文件未改写、未暂存、未提交；本报告按要求写入但不纳入 Task 7 提交。

## 实现内容

1. 新增媒体网关管理员界面，延续现有管理员设计系统与 Lucide 图标。
2. 提供密钥汇总、桌面表格、移动端纵向列表、加载/错误/空状态。
3. 提供签发与编辑右侧抽屉，以及不可逆吊销确认框。
4. 完整 Secret 仅保存在 React 内存状态，并且只在签发成功后的一次性模态框中显示；关闭即清除，不写入 localStorage、sessionStorage 或 IndexedDB。
5. 列表只接收并截断公开前缀，不渲染服务端响应中的额外 Secret 字段。
6. 审计详情只保留 `gatewayKeyId/keyPrefix/gatewayRequestId/userId/action/outcome/errorCode` 子集；未知字段整体丢弃，非字符串嵌套值丢弃，Secret 形态与 Bearer/JWT 等敏感值脱敏。
7. 在现有管理员导航中以最小接线方式增加“媒体网关”，未重构 dashboard 或改动其他管理员功能。
8. 375px 使用独立移动列表，根容器 `max-w-full overflow-x-hidden`，桌面表格仅在 `md` 及以上显示。

## TDD 证据

### 首轮 RED

命令：

```bash
pnpm exec vitest run src/__tests__/lib/media-gateway-audit.test.ts src/__tests__/components/media-gateway-admin.test.tsx src/__tests__/components/dashboard-media-gateway-contract.test.ts
```

结果：`3 failed` 测试文件；`8 failed | 3 passed (11)`。失败原因均为预期的缺失行为：管理员组件不存在、dashboard 尚未接线、审计详情仍包含非 allowlist 字段。

### 安全边界 RED

命令：

```bash
pnpm exec vitest run src/__tests__/lib/media-gateway-audit.test.ts
```

结果：`1 failed | 9 passed (10)`。预期失败为 allowlist 标识字段收到嵌套对象时，旧字符串清洗器抛出 `TypeError`。

### 安全边界 GREEN

同一命令结果：`1 passed` 测试文件；`10 passed (10)`。

### 最终目标 GREEN

命令：

```bash
pnpm exec vitest run src/__tests__/lib/media-gateway-audit.test.ts src/__tests__/components/media-gateway-admin.test.tsx src/__tests__/components/dashboard-media-gateway-contract.test.ts
```

结果：`3 passed` 测试文件；`17 passed (17)`。

## 回归与静态检查

### brief 指定 UI 回归

```bash
pnpm exec vitest run src/__tests__/components/media-gateway-admin.test.tsx src/__tests__/components/dashboard-media-gateway-contract.test.ts src/__tests__/components/dashboard-model-authorization-contract.test.ts
```

结果：`3 passed` 测试文件；`13 passed (13)`。

### 媒体网关扩大回归

```bash
pnpm exec vitest run media-gateway
```

结果：`15 passed | 1 skipped (16)` 测试文件；`273 passed | 5 skipped (278)`。5 个 PostgreSQL 集成测试因未设置 `POSTGRES_TEST_DATABASE_URL` 按测试自身门禁跳过。

首次尝试使用 PowerShell 将 `rg` 的路径集合直接传给 Vitest 时被合并为单一过滤参数，结果为 `No test files found`；随后改用 Vitest 路径过滤 `media-gateway` 成功执行完整集合。该次失败是命令编排问题，不是代码失败。

### TypeScript

```bash
pnpm ts-check
```

结果：退出码 `0`；`next typegen` 与 `tsc -p tsconfig.json` 均成功。

### 目标 ESLint

```bash
pnpm exec eslint src/lib/media-gateway/audit.ts src/components/dashboard/media-gateway-admin.tsx src/components/dashboard/dashboard-view.tsx src/__tests__/lib/media-gateway-audit.test.ts src/__tests__/components/media-gateway-admin.test.tsx src/__tests__/components/dashboard-media-gateway-contract.test.ts
```

结果：退出码 `0`，`0 errors / 135 warnings`。135 条告警全部位于既有 `dashboard-view.tsx` 基线。排除该既有大文件后，对其余 5 个本次文件单独执行 ESLint 无输出，即 `0 errors / 0 warnings`。

### Diff 检查与暂存边界

- `git diff --cached --check`：干净，无空白错误。
- 暂存路径精确为 brief 的 6 个文件。
- 全工作树 `git diff --check` 的 3 个尾随空行告警来自既有 dirty 文件 `task-2-brief.md`、`task-2-review.md`、`task-3-brief.md`；遵照要求未改写。
- Secret 持久化扫描仅命中组件内存状态、一次性模态框和复制动作；未命中 localStorage、sessionStorage 或 IndexedDB。

## 自审

- 无 Critical 或 Important 代码问题。
- 管理路由沿用 Task 2 的 GET/POST/PATCH/DELETE 契约，未触碰密钥服务、任务、账务、资产、缩略图或其他管理员逻辑。
- 审计 `detail` 与 `request_data` 使用同一个 allowlist facts 对象，避免两个持久化位置发生脱敏偏差。
- 完整 Secret 不进入列表状态；签发响应只把 Secret 放入一次性模态框状态，关闭或卸载后不可恢复。

## 关注

1. Task 2 当前列表响应没有 `todayUsage` 字段；Task 7 在响应缺失时显示 `0`。要展示真实“今日使用”，后续服务端契约需提供该聚合字段，但本任务受 6 文件边界限制未修改路由或查询。
2. 依赖真实 PostgreSQL 的 5 个集成测试未执行，原因是环境未提供 `POSTGRES_TEST_DATABASE_URL`。
3. `dashboard-view.tsx` 仍有 135 条既有 ESLint warning；本任务未按要求外重构或清理。

---

## 独立评审修复追加（2026-09-13）

### 结论

- 状态：`DONE_WITH_CONCERNS`
- 基线：`main@752b2504a46402ad1de62e1b04c505e813fe0b2e`
- 修复提交：`a9afdacf46f8d869c035e9c41bec06b034e6e3ee`
- 修复范围：仅修改补充后的 Task 7 路径，并纳入控制器已修改的计划文件；其余既有 SDD dirty 文件未改写、未暂存。

### 修复内容

1. `key-service` 从 `wujie_media_gateway_usage_daily` 按 PostgreSQL 当前 UTC 日期聚合 `request_count`，列表、编辑和吊销响应均返回权威 `todayUsage`；新签发密钥返回权威初值 0，服务层拒绝缺失、负数或非安全整数用量。
2. 管理端对 id、userId、keyPrefix、label、createdBy、RPM、日配额、今日用量、enabled 和三个时间戳完整校验。GET 任一项畸形即清空整表并显示“不可信响应”，不再过滤畸形项或伪造用量。
3. POST/PATCH/DELETE 在修改本地 key 状态前完整验证返回对象；HTTP 成功但响应不可信时锁定后续 mutation、保留当前 Sheet/AlertDialog、显示歧义提示并重新加载权威列表。签发还校验 Secret 精确格式及其与 keyPrefix 的对应关系。
4. Secret 复制反馈改为布尔状态，不再把完整 Secret 放入复制状态；关闭一次性 Dialog 同时清除 Secret、复制反馈和 Dialog 错误。运行时测试实际执行复制，并检查 JSON 序列化后的 localStorage/sessionStorage 调用及 IndexedDB 调用均未持久化 Secret。
5. 签发/编辑错误留在 Sheet，Secret 复制错误留在一次性 Dialog，吊销错误留在 AlertDialog；页面级错误仅承载列表加载与前缀复制上下文。
6. 新增真实 Chromium 375x667 E2E，通过路由拦截进入管理员媒体网关，实测根节点、移动列表、Sheet 和一次性 Secret Dialog 均满足 `scrollWidth <= clientWidth`。

### TDD 证据

首轮 RED：

```bash
pnpm exec vitest run src/__tests__/lib/media-gateway-key-service.test.ts src/__tests__/components/media-gateway-admin.test.tsx
```

结果：`2 failed` 测试文件；`13 failed | 21 passed (34)`。失败准确覆盖权威用量、GET fail-closed、Secret 持久化测试、模态内错误和 mutation 歧义处理。

Chromium 几何 RED：

```bash
pnpm exec playwright test tests/e2e/media-gateway-admin-responsive.spec.ts --project=chromium --reporter=line
```

修正 E2E 路由注册顺序后，真实页面在移动列表几何断言失败：`clientWidth=115`、`scrollWidth=194`，`1 failed`。首次执行曾因通配路由覆盖 session 精确路由而停在入口页；该夹具问题修正后才记录上述有效几何 RED。

Secret/前缀关联 RED：

```bash
pnpm exec vitest run src/__tests__/components/media-gateway-admin.test.tsx -t "does not match the returned prefix" --reporter=verbose
```

结果：`1 failed | 15 skipped (16)`；旧实现接受格式合法但与返回前缀不对应的 Secret。

### 最终 GREEN 与回归

原目标修复集：

```bash
pnpm exec vitest run src/__tests__/lib/media-gateway-audit.test.ts src/__tests__/lib/media-gateway-key-service.test.ts src/__tests__/components/media-gateway-admin.test.tsx src/__tests__/components/dashboard-media-gateway-contract.test.ts
```

结果：`4 passed` 测试文件；`56 passed (56)`。

brief 指定 UI 回归：

```bash
pnpm exec vitest run src/__tests__/components/media-gateway-admin.test.tsx src/__tests__/components/dashboard-media-gateway-contract.test.ts src/__tests__/components/dashboard-model-authorization-contract.test.ts
```

结果：`3 passed` 测试文件；`33 passed (33)`。

媒体网关扩大回归：

```bash
pnpm exec vitest run media-gateway
```

结果：`15 passed | 1 skipped (16)` 测试文件；`294 passed | 5 skipped (299)`。5 个 PostgreSQL 集成测试因环境未设置 `POSTGRES_TEST_DATABASE_URL` 被测试门禁明确跳过。

真实浏览器 E2E：

```bash
pnpm exec playwright test tests/e2e/media-gateway-admin-responsive.spec.ts --project=chromium --reporter=line
```

结果：Chromium `1 passed (1)`，耗时 6.3 秒。

TypeScript：

```bash
pnpm ts-check
```

结果：退出码 0；`next typegen` 与 `tsc -p tsconfig.json` 成功。

目标 ESLint：

```bash
pnpm exec eslint src/lib/media-gateway/key-service.ts src/components/dashboard/media-gateway-admin.tsx src/components/dashboard/dashboard-view.tsx src/__tests__/lib/media-gateway-key-service.test.ts src/__tests__/components/media-gateway-admin.test.tsx tests/e2e/media-gateway-admin-responsive.spec.ts
```

结果：退出码 0，`0 errors / 135 warnings`；135 条 warning 全部来自既有 `dashboard-view.tsx` 基线，另外 5 个修复文件为 `0 errors / 0 warnings`。

Diff 检查：修复与计划允许路径的 `git diff --check -- <paths>` 退出码 0。全工作树仍有 3 个既有 SDD 尾随空行告警，未改写。

### 自审与关注

- 自审未发现新的 Critical 或 Important 问题；mutation 的成功体在本地状态改变前完成解析与请求字段一致性验证，歧义分支不显示成功、不关闭当前上下文且锁定重复动作。
- 关注 1：仓库迁移文件中未找到 `wujie_media_gateway_usage_daily` 的建表定义；本修复按控制器明确说明的“既有表”及字段 `gateway_key_id/usage_date/request_count` 接入，当前环境无数据库连接，无法执行真实 SQL 集成验证。
- 关注 2：5 个 PostgreSQL 集成测试因缺少 `POSTGRES_TEST_DATABASE_URL` 跳过；其余网关测试与真实 Chromium 几何 E2E 均执行通过。
- 关注 3：`dashboard-view.tsx` 保留 135 条既有 ESLint warning，本修复仅调整一处移动端侧栏宽度，不清理或重构既有管理员实现。

---

## 权威日用量表纠正（2026-09-13）

### 结论

- 状态：`DONE_WITH_CONCERNS`
- 基线：`a9afdacf46f8d869c035e9c41bec06b034e6e3ee`
- 修复提交：`fcecacb02518c789eb667356c25b8005c2e0351e`
- 本节覆盖上一节关于 `wujie_media_gateway_usage_daily` 的实现与关注：该表并不存在，不再作为任何运行时依赖。

### 修复内容

1. list/update/revoke 的 `todayUsage` 全部改为从 Task 3 权威表 `wujie_gateway_requests` 执行 `COUNT(*)`。
2. 计数仅包含同一 `gateway_key_id` 且 `admission_status IN ('reserved', 'admitted')` 的记录，与 Task 3 日配额消耗口径一致；`rejected` 不计入。
3. 日边界使用 PostgreSQL 当前时间换算出的 UTC 零点闭开区间：`created_at >= UTC day start` 且 `created_at < UTC next day start`，不依赖数据库会话时区。
4. 未新增表、迁移或替代计数数据；旧虚构表名已从生产代码移除。
5. 真实 PostgreSQL 场景测试构造当日 reserved、当日 admitted、当日 rejected、前一日 admitted 和其他 key 当日 admitted，预期目标 key 为 2、其他 key 为 1。

### TDD RED

命令：

```bash
pnpm exec vitest run src/__tests__/lib/media-gateway-key-service.test.ts --reporter=verbose
```

结果：`1 failed` 测试文件；`3 failed | 16 passed (19)`。三个预期失败分别为 list/update/revoke 仍引用 `wujie_media_gateway_usage_daily`，均未满足 `wujie_gateway_requests` 权威口径断言。

### GREEN 与回归

key-service GREEN：

```bash
pnpm exec vitest run src/__tests__/lib/media-gateway-key-service.test.ts --reporter=verbose
```

结果：`1 passed` 测试文件；`19 passed (19)`。

真实 PostgreSQL 用例：

```bash
pnpm exec vitest run tests/integration/media-gateway-admission-postgres.test.ts --reporter=verbose
```

结果：`1 skipped` 测试文件；`6 skipped (6)`，并明确输出 `BLOCKED: media gateway admission requires POSTGRES_TEST_DATABASE_URL`。当前环境无真库权限，新增权威聚合场景已保留，Task 8 必须在提供 `POSTGRES_TEST_DATABASE_URL` 的环境运行。

原目标回归：

```bash
pnpm exec vitest run src/__tests__/lib/media-gateway-audit.test.ts src/__tests__/lib/media-gateway-key-service.test.ts src/__tests__/components/media-gateway-admin.test.tsx src/__tests__/components/dashboard-media-gateway-contract.test.ts
```

结果：`4 passed` 测试文件；`56 passed (56)`。

媒体网关扩大回归：

```bash
pnpm exec vitest run media-gateway
```

结果：`15 passed | 1 skipped (16)` 测试文件；`294 passed | 6 skipped (300)`。6 个 skip 均属于同一真实 PostgreSQL 文件。

TypeScript：`pnpm ts-check` 退出码 0。目标 ESLint（key-service、其单元测试、PostgreSQL 集成测试）退出码 0，`0 errors / 0 warnings`。允许路径的 scoped `git diff --check` 退出码 0。

### 自审与关注

- 自审未发现新的 Critical 或 Important 问题；list/update/revoke 使用同一表、同一状态集合和同一 UTC 闭开区间。
- 唯一关注：当前权限环境未提供 `POSTGRES_TEST_DATABASE_URL`，因此新增的真实 PostgreSQL 聚合用例未实际连接数据库；必须在 Task 8 真库门禁中执行，不能以单元 SQL 字符串断言替代。
# 最终复审修复准备（2026-09-14）

为消除 admission 与 key-service 各自维护 UTC 日边界 SQL 所造成的会话时区分歧风险，本轮需要新增 `src/lib/media-gateway/utc-day-window.ts`。该 helper 只生成受限时间表达式的 PostgreSQL UTC 半开区间，不引入表、状态或新计数口径；这是让准入与管理员权威用量共享同一边界定义的最小必要改动。计划已同步授权该 helper、`admission.ts` 及对应单元/真实 PostgreSQL 集成测试路径，其余 Task 7 边界不变。

## 最终复审 RED 证据

- `pnpm exec vitest run src/__tests__/lib/media-gateway-utc-day-window.test.ts src/__tests__/lib/media-gateway-admission.test.ts`：退出码 1；2 个测试文件失败。已收集的 16 项 admission 测试中 15 通过、1 失败；新增 helper 测试文件因生产模块尚不存在而 suite 失败。失败精确指向 admission 仍使用受会话时区影响的 `date_trunc('day', $2::timestamptz)`。
- `pnpm exec vitest run src/__tests__/components/media-gateway-admin.test.tsx`：退出码 1；1 个测试文件失败，29 项中 22 通过、7 失败。失败覆盖：权威刷新后不解锁、POST fetch 拒绝仍提示安全重试、POST pending 无超时、PATCH 权威确认后不解锁、DELETE 非 2xx 仍提示安全重试、DELETE 权威确认后不解锁、权威 GET pending 时取消按钮与无关操作被全局锁定。
- `pnpm exec vitest run tests/integration/media-gateway-admission-postgres.test.ts`：退出码 0；1 个测试文件及 7 项全部 skip，明确阻塞原因为未配置 `POSTGRES_TEST_DATABASE_URL`。新增非 UTC PostgreSQL 会话交叉验证已保留为可执行用例，不能记为通过。

## 最终复审 GREEN 与交付

- RED 证据提交：`ac65ca82fbc808b9f40409821a5bc6ee863bf37b`。
- 生产修复提交：`301fc4af008ffdce44e6dc7d6f787b8a45970a02`。
- UTC 最小 GREEN：`pnpm exec vitest run src/__tests__/lib/media-gateway-utc-day-window.test.ts src/__tests__/lib/media-gateway-admission.test.ts src/__tests__/lib/media-gateway-key-service.test.ts`，3 个文件、37 项全部通过。
- 管理员 mutation GREEN：`pnpm exec vitest run src/__tests__/components/media-gateway-admin.test.tsx`，1 个文件、30 项全部通过。覆盖 POST fetch 拒绝/超时、PATCH 响应读取失败、DELETE 非 2xx、三种响应结构歧义、authority GET 超时/取消、局部锁、确认后解锁与模态退出。
- 原 Task 7 目标：`pnpm exec vitest run src/__tests__/lib/media-gateway-audit.test.ts src/__tests__/lib/media-gateway-key-service.test.ts src/__tests__/components/media-gateway-admin.test.tsx src/__tests__/components/dashboard-media-gateway-contract.test.ts`，4 个文件、61 项全部通过。
- 扩大媒体网关回归：`pnpm exec vitest run media-gateway`，16 个文件通过、1 个真库文件跳过；301 项通过、7 项跳过，共 308 项。
- 真实 PostgreSQL：`pnpm exec vitest run tests/integration/media-gateway-admission-postgres.test.ts --reporter=verbose`，新增非 UTC 会话交叉验证在内共 7 项全部 skip；原因仅为当前环境没有 `POSTGRES_TEST_DATABASE_URL`，用例保留给 Task 8 必跑。
- TypeScript：`pnpm ts-check` 退出码 0，`next typegen` 与 `tsc -p tsconfig.json` 通过。
- Scoped ESLint：对 helper、admission、key-service、管理员组件及对应测试共 9 个文件执行，退出码 0，`0 errors / 0 warnings`。
- 真实 Chromium 375px：首次因 `127.0.0.1:5000` 未启动而 warmup `ECONNREFUSED`、0 项执行；启动 dev server 后重跑同一 `mobile-375-chromium` 项目，`1 passed (1)`，39.7 秒。dev server 已关闭。
- Scoped `git diff --check` 与 staged `git diff --cached --check` 均退出码 0；全工作树中的 6 个既有 SDD dirty 文件未修改、未暂存、未提交。

### 三项 Important 修复自审

1. `admission.ts` 与 `key-service.ts` 共同调用受限 `postgresUtcDayWindow`，统一生成显式 UTC 半开区间；状态仍仅为 `reserved`/`admitted`，未新增表或计数口径。非 UTC 真库测试把业务连接固定为 `Asia/Shanghai`，构造 UTC 前日与当日边界，并交叉断言准入成功及管理员 `todayUsage === 1`。
2. POST/PATCH/DELETE 共用 5 秒有界 fetch；fetch reject、Abort timeout、body read failure、非 2xx 与 2xx 不可信结构全部进入歧义核对，不再显示“请重试”或先改变本地权威状态。
3. 锁键为 `issue`、`edit:<keyId>`、`revoke:<keyId>`；authority GET 同样有超时和 AbortController。核对成功立即刷新列表并解除对应锁；核对失败只保留对应 scope，当前 Sheet/AlertDialog 可随时取消，退出会 abort 并解锁，手动权威列表刷新成功也会清除锁。

### 关注

- 当前环境缺少 `POSTGRES_TEST_DATABASE_URL`，所以 7 个真实 PostgreSQL 用例未执行；其中新增的 `Asia/Shanghai` 会话 UTC 边界交叉验证必须由 Task 8 真库门禁执行。除此之外未发现未关闭的 Task 7 Important。

## 最后 1 个 Important：body 生命周期 RED（2026-09-14）

- 命令：`pnpm exec vitest run src/__tests__/components/media-gateway-admin.test.tsx`。
- 结果：退出码 1；1 个测试文件失败，34 项中 `30 passed / 4 failed`。
- 四个预期失败分别证明：mutation 已取得响应头后 body 永不 resolve 时不会超时进入歧义；authority GET 的 body 永不 resolve 时仍停在“正在核对”；退出 Sheet 无法 abort 已开始读取的 mutation body；退出后 authority signal 未取消，迟到 body 仍存在污染状态的通路。
- 本轮仍未修改生产代码；RED 测试只增加在既有授权的 `src/__tests__/components/media-gateway-admin.test.tsx`。

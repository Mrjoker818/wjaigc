# Final review fix package: fcecacb02518c789eb667356c25b8005c2e0351e..ada8c8bb4b4134806b93bf356589183ffba75dff

## Commits
ada8c8bb docs: record task 7 final review verification
301fc4af fix: close task 7 final review gaps
ac65ca82 test: capture task 7 final review regressions

## Files changed
 .superpowers/sdd/media-gateway-task-7-report.md    | 320 +++++++++++++++++++++
 .../plans/2026-09-13-v588-media-gateway.md         |   5 +
 .../components/media-gateway-admin.test.tsx        | 159 +++++++++-
 src/__tests__/lib/media-gateway-admission.test.ts  |   3 +
 .../lib/media-gateway-utc-day-window.test.ts       |  19 ++
 src/components/dashboard/media-gateway-admin.tsx   | 194 ++++++++++---
 src/lib/media-gateway/admission.ts                 |   7 +-
 src/lib/media-gateway/key-service.ts               |  14 +-
 src/lib/media-gateway/utc-day-window.ts            |  16 ++
 .../media-gateway-admission-postgres.test.ts       |  46 +++
 10 files changed, 728 insertions(+), 55 deletions(-)

## Diff
diff --git a/.superpowers/sdd/media-gateway-task-7-report.md b/.superpowers/sdd/media-gateway-task-7-report.md
new file mode 100644
index 00000000..565ff540
--- /dev/null
+++ b/.superpowers/sdd/media-gateway-task-7-report.md
@@ -0,0 +1,320 @@
+# V588-MEDIA-001 Task 7 实施报告
+
+## 结论
+
+- 状态：`DONE_WITH_CONCERNS`
+- 提交：`752b2504a46402ad1de62e1b04c505e813fe0b2e`
+- 提交信息：`feat: add media gateway admin controls`
+- 提交范围：严格为 brief 列出的 6 个源代码/测试文件，共 `796 insertions(+), 22 deletions(-)`。
+- 既有 SDD dirty 文件未改写、未暂存、未提交；本报告按要求写入但不纳入 Task 7 提交。
+
+## 实现内容
+
+1. 新增媒体网关管理员界面，延续现有管理员设计系统与 Lucide 图标。
+2. 提供密钥汇总、桌面表格、移动端纵向列表、加载/错误/空状态。
+3. 提供签发与编辑右侧抽屉，以及不可逆吊销确认框。
+4. 完整 Secret 仅保存在 React 内存状态，并且只在签发成功后的一次性模态框中显示；关闭即清除，不写入 localStorage、sessionStorage 或 IndexedDB。
+5. 列表只接收并截断公开前缀，不渲染服务端响应中的额外 Secret 字段。
+6. 审计详情只保留 `gatewayKeyId/keyPrefix/gatewayRequestId/userId/action/outcome/errorCode` 子集；未知字段整体丢弃，非字符串嵌套值丢弃，Secret 形态与 Bearer/JWT 等敏感值脱敏。
+7. 在现有管理员导航中以最小接线方式增加“媒体网关”，未重构 dashboard 或改动其他管理员功能。
+8. 375px 使用独立移动列表，根容器 `max-w-full overflow-x-hidden`，桌面表格仅在 `md` 及以上显示。
+
+## TDD 证据
+
+### 首轮 RED
+
+命令：
+
+```bash
+pnpm exec vitest run src/__tests__/lib/media-gateway-audit.test.ts src/__tests__/components/media-gateway-admin.test.tsx src/__tests__/components/dashboard-media-gateway-contract.test.ts
+```
+
+结果：`3 failed` 测试文件；`8 failed | 3 passed (11)`。失败原因均为预期的缺失行为：管理员组件不存在、dashboard 尚未接线、审计详情仍包含非 allowlist 字段。
+
+### 安全边界 RED
+
+命令：
+
+```bash
+pnpm exec vitest run src/__tests__/lib/media-gateway-audit.test.ts
+```
+
+结果：`1 failed | 9 passed (10)`。预期失败为 allowlist 标识字段收到嵌套对象时，旧字符串清洗器抛出 `TypeError`。
+
+### 安全边界 GREEN
+
+同一命令结果：`1 passed` 测试文件；`10 passed (10)`。
+
+### 最终目标 GREEN
+
+命令：
+
+```bash
+pnpm exec vitest run src/__tests__/lib/media-gateway-audit.test.ts src/__tests__/components/media-gateway-admin.test.tsx src/__tests__/components/dashboard-media-gateway-contract.test.ts
+```
+
+结果：`3 passed` 测试文件；`17 passed (17)`。
+
+## 回归与静态检查
+
+### brief 指定 UI 回归
+
+```bash
+pnpm exec vitest run src/__tests__/components/media-gateway-admin.test.tsx src/__tests__/components/dashboard-media-gateway-contract.test.ts src/__tests__/components/dashboard-model-authorization-contract.test.ts
+```
+
+结果：`3 passed` 测试文件；`13 passed (13)`。
+
+### 媒体网关扩大回归
+
+```bash
+pnpm exec vitest run media-gateway
+```
+
+结果：`15 passed | 1 skipped (16)` 测试文件；`273 passed | 5 skipped (278)`。5 个 PostgreSQL 集成测试因未设置 `POSTGRES_TEST_DATABASE_URL` 按测试自身门禁跳过。
+
+首次尝试使用 PowerShell 将 `rg` 的路径集合直接传给 Vitest 时被合并为单一过滤参数，结果为 `No test files found`；随后改用 Vitest 路径过滤 `media-gateway` 成功执行完整集合。该次失败是命令编排问题，不是代码失败。
+
+### TypeScript
+
+```bash
+pnpm ts-check
+```
+
+结果：退出码 `0`；`next typegen` 与 `tsc -p tsconfig.json` 均成功。
+
+### 目标 ESLint
+
+```bash
+pnpm exec eslint src/lib/media-gateway/audit.ts src/components/dashboard/media-gateway-admin.tsx src/components/dashboard/dashboard-view.tsx src/__tests__/lib/media-gateway-audit.test.ts src/__tests__/components/media-gateway-admin.test.tsx src/__tests__/components/dashboard-media-gateway-contract.test.ts
+```
+
+结果：退出码 `0`，`0 errors / 135 warnings`。135 条告警全部位于既有 `dashboard-view.tsx` 基线。排除该既有大文件后，对其余 5 个本次文件单独执行 ESLint 无输出，即 `0 errors / 0 warnings`。
+
+### Diff 检查与暂存边界
+
+- `git diff --cached --check`：干净，无空白错误。
+- 暂存路径精确为 brief 的 6 个文件。
+- 全工作树 `git diff --check` 的 3 个尾随空行告警来自既有 dirty 文件 `task-2-brief.md`、`task-2-review.md`、`task-3-brief.md`；遵照要求未改写。
+- Secret 持久化扫描仅命中组件内存状态、一次性模态框和复制动作；未命中 localStorage、sessionStorage 或 IndexedDB。
+
+## 自审
+
+- 无 Critical 或 Important 代码问题。
+- 管理路由沿用 Task 2 的 GET/POST/PATCH/DELETE 契约，未触碰密钥服务、任务、账务、资产、缩略图或其他管理员逻辑。
+- 审计 `detail` 与 `request_data` 使用同一个 allowlist facts 对象，避免两个持久化位置发生脱敏偏差。
+- 完整 Secret 不进入列表状态；签发响应只把 Secret 放入一次性模态框状态，关闭或卸载后不可恢复。
+
+## 关注
+
+1. Task 2 当前列表响应没有 `todayUsage` 字段；Task 7 在响应缺失时显示 `0`。要展示真实“今日使用”，后续服务端契约需提供该聚合字段，但本任务受 6 文件边界限制未修改路由或查询。
+2. 依赖真实 PostgreSQL 的 5 个集成测试未执行，原因是环境未提供 `POSTGRES_TEST_DATABASE_URL`。
+3. `dashboard-view.tsx` 仍有 135 条既有 ESLint warning；本任务未按要求外重构或清理。
+
+---
+
+## 独立评审修复追加（2026-09-13）
+
+### 结论
+
+- 状态：`DONE_WITH_CONCERNS`
+- 基线：`main@752b2504a46402ad1de62e1b04c505e813fe0b2e`
+- 修复提交：`a9afdacf46f8d869c035e9c41bec06b034e6e3ee`
+- 修复范围：仅修改补充后的 Task 7 路径，并纳入控制器已修改的计划文件；其余既有 SDD dirty 文件未改写、未暂存。
+
+### 修复内容
+
+1. `key-service` 从 `wujie_media_gateway_usage_daily` 按 PostgreSQL 当前 UTC 日期聚合 `request_count`，列表、编辑和吊销响应均返回权威 `todayUsage`；新签发密钥返回权威初值 0，服务层拒绝缺失、负数或非安全整数用量。
+2. 管理端对 id、userId、keyPrefix、label、createdBy、RPM、日配额、今日用量、enabled 和三个时间戳完整校验。GET 任一项畸形即清空整表并显示“不可信响应”，不再过滤畸形项或伪造用量。
+3. POST/PATCH/DELETE 在修改本地 key 状态前完整验证返回对象；HTTP 成功但响应不可信时锁定后续 mutation、保留当前 Sheet/AlertDialog、显示歧义提示并重新加载权威列表。签发还校验 Secret 精确格式及其与 keyPrefix 的对应关系。
+4. Secret 复制反馈改为布尔状态，不再把完整 Secret 放入复制状态；关闭一次性 Dialog 同时清除 Secret、复制反馈和 Dialog 错误。运行时测试实际执行复制，并检查 JSON 序列化后的 localStorage/sessionStorage 调用及 IndexedDB 调用均未持久化 Secret。
+5. 签发/编辑错误留在 Sheet，Secret 复制错误留在一次性 Dialog，吊销错误留在 AlertDialog；页面级错误仅承载列表加载与前缀复制上下文。
+6. 新增真实 Chromium 375x667 E2E，通过路由拦截进入管理员媒体网关，实测根节点、移动列表、Sheet 和一次性 Secret Dialog 均满足 `scrollWidth <= clientWidth`。
+
+### TDD 证据
+
+首轮 RED：
+
+```bash
+pnpm exec vitest run src/__tests__/lib/media-gateway-key-service.test.ts src/__tests__/components/media-gateway-admin.test.tsx
+```
+
+结果：`2 failed` 测试文件；`13 failed | 21 passed (34)`。失败准确覆盖权威用量、GET fail-closed、Secret 持久化测试、模态内错误和 mutation 歧义处理。
+
+Chromium 几何 RED：
+
+```bash
+pnpm exec playwright test tests/e2e/media-gateway-admin-responsive.spec.ts --project=chromium --reporter=line
+```
+
+修正 E2E 路由注册顺序后，真实页面在移动列表几何断言失败：`clientWidth=115`、`scrollWidth=194`，`1 failed`。首次执行曾因通配路由覆盖 session 精确路由而停在入口页；该夹具问题修正后才记录上述有效几何 RED。
+
+Secret/前缀关联 RED：
+
+```bash
+pnpm exec vitest run src/__tests__/components/media-gateway-admin.test.tsx -t "does not match the returned prefix" --reporter=verbose
+```
+
+结果：`1 failed | 15 skipped (16)`；旧实现接受格式合法但与返回前缀不对应的 Secret。
+
+### 最终 GREEN 与回归
+
+原目标修复集：
+
+```bash
+pnpm exec vitest run src/__tests__/lib/media-gateway-audit.test.ts src/__tests__/lib/media-gateway-key-service.test.ts src/__tests__/components/media-gateway-admin.test.tsx src/__tests__/components/dashboard-media-gateway-contract.test.ts
+```
+
+结果：`4 passed` 测试文件；`56 passed (56)`。
+
+brief 指定 UI 回归：
+
+```bash
+pnpm exec vitest run src/__tests__/components/media-gateway-admin.test.tsx src/__tests__/components/dashboard-media-gateway-contract.test.ts src/__tests__/components/dashboard-model-authorization-contract.test.ts
+```
+
+结果：`3 passed` 测试文件；`33 passed (33)`。
+
+媒体网关扩大回归：
+
+```bash
+pnpm exec vitest run media-gateway
+```
+
+结果：`15 passed | 1 skipped (16)` 测试文件；`294 passed | 5 skipped (299)`。5 个 PostgreSQL 集成测试因环境未设置 `POSTGRES_TEST_DATABASE_URL` 被测试门禁明确跳过。
+
+真实浏览器 E2E：
+
+```bash
+pnpm exec playwright test tests/e2e/media-gateway-admin-responsive.spec.ts --project=chromium --reporter=line
+```
+
+结果：Chromium `1 passed (1)`，耗时 6.3 秒。
+
+TypeScript：
+
+```bash
+pnpm ts-check
+```
+
+结果：退出码 0；`next typegen` 与 `tsc -p tsconfig.json` 成功。
+
+目标 ESLint：
+
+```bash
+pnpm exec eslint src/lib/media-gateway/key-service.ts src/components/dashboard/media-gateway-admin.tsx src/components/dashboard/dashboard-view.tsx src/__tests__/lib/media-gateway-key-service.test.ts src/__tests__/components/media-gateway-admin.test.tsx tests/e2e/media-gateway-admin-responsive.spec.ts
+```
+
+结果：退出码 0，`0 errors / 135 warnings`；135 条 warning 全部来自既有 `dashboard-view.tsx` 基线，另外 5 个修复文件为 `0 errors / 0 warnings`。
+
+Diff 检查：修复与计划允许路径的 `git diff --check -- <paths>` 退出码 0。全工作树仍有 3 个既有 SDD 尾随空行告警，未改写。
+
+### 自审与关注
+
+- 自审未发现新的 Critical 或 Important 问题；mutation 的成功体在本地状态改变前完成解析与请求字段一致性验证，歧义分支不显示成功、不关闭当前上下文且锁定重复动作。
+- 关注 1：仓库迁移文件中未找到 `wujie_media_gateway_usage_daily` 的建表定义；本修复按控制器明确说明的“既有表”及字段 `gateway_key_id/usage_date/request_count` 接入，当前环境无数据库连接，无法执行真实 SQL 集成验证。
+- 关注 2：5 个 PostgreSQL 集成测试因缺少 `POSTGRES_TEST_DATABASE_URL` 跳过；其余网关测试与真实 Chromium 几何 E2E 均执行通过。
+- 关注 3：`dashboard-view.tsx` 保留 135 条既有 ESLint warning，本修复仅调整一处移动端侧栏宽度，不清理或重构既有管理员实现。
+
+---
+
+## 权威日用量表纠正（2026-09-13）
+
+### 结论
+
+- 状态：`DONE_WITH_CONCERNS`
+- 基线：`a9afdacf46f8d869c035e9c41bec06b034e6e3ee`
+- 修复提交：`fcecacb02518c789eb667356c25b8005c2e0351e`
+- 本节覆盖上一节关于 `wujie_media_gateway_usage_daily` 的实现与关注：该表并不存在，不再作为任何运行时依赖。
+
+### 修复内容
+
+1. list/update/revoke 的 `todayUsage` 全部改为从 Task 3 权威表 `wujie_gateway_requests` 执行 `COUNT(*)`。
+2. 计数仅包含同一 `gateway_key_id` 且 `admission_status IN ('reserved', 'admitted')` 的记录，与 Task 3 日配额消耗口径一致；`rejected` 不计入。
+3. 日边界使用 PostgreSQL 当前时间换算出的 UTC 零点闭开区间：`created_at >= UTC day start` 且 `created_at < UTC next day start`，不依赖数据库会话时区。
+4. 未新增表、迁移或替代计数数据；旧虚构表名已从生产代码移除。
+5. 真实 PostgreSQL 场景测试构造当日 reserved、当日 admitted、当日 rejected、前一日 admitted 和其他 key 当日 admitted，预期目标 key 为 2、其他 key 为 1。
+
+### TDD RED
+
+命令：
+
+```bash
+pnpm exec vitest run src/__tests__/lib/media-gateway-key-service.test.ts --reporter=verbose
+```
+
+结果：`1 failed` 测试文件；`3 failed | 16 passed (19)`。三个预期失败分别为 list/update/revoke 仍引用 `wujie_media_gateway_usage_daily`，均未满足 `wujie_gateway_requests` 权威口径断言。
+
+### GREEN 与回归
+
+key-service GREEN：
+
+```bash
+pnpm exec vitest run src/__tests__/lib/media-gateway-key-service.test.ts --reporter=verbose
+```
+
+结果：`1 passed` 测试文件；`19 passed (19)`。
+
+真实 PostgreSQL 用例：
+
+```bash
+pnpm exec vitest run tests/integration/media-gateway-admission-postgres.test.ts --reporter=verbose
+```
+
+结果：`1 skipped` 测试文件；`6 skipped (6)`，并明确输出 `BLOCKED: media gateway admission requires POSTGRES_TEST_DATABASE_URL`。当前环境无真库权限，新增权威聚合场景已保留，Task 8 必须在提供 `POSTGRES_TEST_DATABASE_URL` 的环境运行。
+
+原目标回归：
+
+```bash
+pnpm exec vitest run src/__tests__/lib/media-gateway-audit.test.ts src/__tests__/lib/media-gateway-key-service.test.ts src/__tests__/components/media-gateway-admin.test.tsx src/__tests__/components/dashboard-media-gateway-contract.test.ts
+```
+
+结果：`4 passed` 测试文件；`56 passed (56)`。
+
+媒体网关扩大回归：
+
+```bash
+pnpm exec vitest run media-gateway
+```
+
+结果：`15 passed | 1 skipped (16)` 测试文件；`294 passed | 6 skipped (300)`。6 个 skip 均属于同一真实 PostgreSQL 文件。
+
+TypeScript：`pnpm ts-check` 退出码 0。目标 ESLint（key-service、其单元测试、PostgreSQL 集成测试）退出码 0，`0 errors / 0 warnings`。允许路径的 scoped `git diff --check` 退出码 0。
+
+### 自审与关注
+
+- 自审未发现新的 Critical 或 Important 问题；list/update/revoke 使用同一表、同一状态集合和同一 UTC 闭开区间。
+- 唯一关注：当前权限环境未提供 `POSTGRES_TEST_DATABASE_URL`，因此新增的真实 PostgreSQL 聚合用例未实际连接数据库；必须在 Task 8 真库门禁中执行，不能以单元 SQL 字符串断言替代。
+# 最终复审修复准备（2026-09-14）
+
+为消除 admission 与 key-service 各自维护 UTC 日边界 SQL 所造成的会话时区分歧风险，本轮需要新增 `src/lib/media-gateway/utc-day-window.ts`。该 helper 只生成受限时间表达式的 PostgreSQL UTC 半开区间，不引入表、状态或新计数口径；这是让准入与管理员权威用量共享同一边界定义的最小必要改动。计划已同步授权该 helper、`admission.ts` 及对应单元/真实 PostgreSQL 集成测试路径，其余 Task 7 边界不变。
+
+## 最终复审 RED 证据
+
+- `pnpm exec vitest run src/__tests__/lib/media-gateway-utc-day-window.test.ts src/__tests__/lib/media-gateway-admission.test.ts`：退出码 1；2 个测试文件失败。已收集的 16 项 admission 测试中 15 通过、1 失败；新增 helper 测试文件因生产模块尚不存在而 suite 失败。失败精确指向 admission 仍使用受会话时区影响的 `date_trunc('day', $2::timestamptz)`。
+- `pnpm exec vitest run src/__tests__/components/media-gateway-admin.test.tsx`：退出码 1；1 个测试文件失败，29 项中 22 通过、7 失败。失败覆盖：权威刷新后不解锁、POST fetch 拒绝仍提示安全重试、POST pending 无超时、PATCH 权威确认后不解锁、DELETE 非 2xx 仍提示安全重试、DELETE 权威确认后不解锁、权威 GET pending 时取消按钮与无关操作被全局锁定。
+- `pnpm exec vitest run tests/integration/media-gateway-admission-postgres.test.ts`：退出码 0；1 个测试文件及 7 项全部 skip，明确阻塞原因为未配置 `POSTGRES_TEST_DATABASE_URL`。新增非 UTC PostgreSQL 会话交叉验证已保留为可执行用例，不能记为通过。
+
+## 最终复审 GREEN 与交付
+
+- RED 证据提交：`ac65ca82fbc808b9f40409821a5bc6ee863bf37b`。
+- 生产修复提交：`301fc4af008ffdce44e6dc7d6f787b8a45970a02`。
+- UTC 最小 GREEN：`pnpm exec vitest run src/__tests__/lib/media-gateway-utc-day-window.test.ts src/__tests__/lib/media-gateway-admission.test.ts src/__tests__/lib/media-gateway-key-service.test.ts`，3 个文件、37 项全部通过。
+- 管理员 mutation GREEN：`pnpm exec vitest run src/__tests__/components/media-gateway-admin.test.tsx`，1 个文件、30 项全部通过。覆盖 POST fetch 拒绝/超时、PATCH 响应读取失败、DELETE 非 2xx、三种响应结构歧义、authority GET 超时/取消、局部锁、确认后解锁与模态退出。
+- 原 Task 7 目标：`pnpm exec vitest run src/__tests__/lib/media-gateway-audit.test.ts src/__tests__/lib/media-gateway-key-service.test.ts src/__tests__/components/media-gateway-admin.test.tsx src/__tests__/components/dashboard-media-gateway-contract.test.ts`，4 个文件、61 项全部通过。
+- 扩大媒体网关回归：`pnpm exec vitest run media-gateway`，16 个文件通过、1 个真库文件跳过；301 项通过、7 项跳过，共 308 项。
+- 真实 PostgreSQL：`pnpm exec vitest run tests/integration/media-gateway-admission-postgres.test.ts --reporter=verbose`，新增非 UTC 会话交叉验证在内共 7 项全部 skip；原因仅为当前环境没有 `POSTGRES_TEST_DATABASE_URL`，用例保留给 Task 8 必跑。
+- TypeScript：`pnpm ts-check` 退出码 0，`next typegen` 与 `tsc -p tsconfig.json` 通过。
+- Scoped ESLint：对 helper、admission、key-service、管理员组件及对应测试共 9 个文件执行，退出码 0，`0 errors / 0 warnings`。
+- 真实 Chromium 375px：首次因 `127.0.0.1:5000` 未启动而 warmup `ECONNREFUSED`、0 项执行；启动 dev server 后重跑同一 `mobile-375-chromium` 项目，`1 passed (1)`，39.7 秒。dev server 已关闭。
+- Scoped `git diff --check` 与 staged `git diff --cached --check` 均退出码 0；全工作树中的 6 个既有 SDD dirty 文件未修改、未暂存、未提交。
+
+### 三项 Important 修复自审
+
+1. `admission.ts` 与 `key-service.ts` 共同调用受限 `postgresUtcDayWindow`，统一生成显式 UTC 半开区间；状态仍仅为 `reserved`/`admitted`，未新增表或计数口径。非 UTC 真库测试把业务连接固定为 `Asia/Shanghai`，构造 UTC 前日与当日边界，并交叉断言准入成功及管理员 `todayUsage === 1`。
+2. POST/PATCH/DELETE 共用 5 秒有界 fetch；fetch reject、Abort timeout、body read failure、非 2xx 与 2xx 不可信结构全部进入歧义核对，不再显示“请重试”或先改变本地权威状态。
+3. 锁键为 `issue`、`edit:<keyId>`、`revoke:<keyId>`；authority GET 同样有超时和 AbortController。核对成功立即刷新列表并解除对应锁；核对失败只保留对应 scope，当前 Sheet/AlertDialog 可随时取消，退出会 abort 并解锁，手动权威列表刷新成功也会清除锁。
+
+### 关注
+
+- 当前环境缺少 `POSTGRES_TEST_DATABASE_URL`，所以 7 个真实 PostgreSQL 用例未执行；其中新增的 `Asia/Shanghai` 会话 UTC 边界交叉验证必须由 Task 8 真库门禁执行。除此之外未发现未关闭的 Task 7 Important。
diff --git a/docs/superpowers/plans/2026-09-13-v588-media-gateway.md b/docs/superpowers/plans/2026-09-13-v588-media-gateway.md
index ce3f886a..20f03658 100644
--- a/docs/superpowers/plans/2026-09-13-v588-media-gateway.md
+++ b/docs/superpowers/plans/2026-09-13-v588-media-gateway.md
@@ -502,13 +502,18 @@ git commit -m "feat: project existing thumbnails through media gateway"
 **Files:**
 - Modify: `src/lib/media-gateway/audit.ts`
 - Modify: `src/lib/media-gateway/key-service.ts`
+- Modify: `src/lib/media-gateway/admission.ts`
+- Create: `src/lib/media-gateway/utc-day-window.ts`
 - Create: `src/components/dashboard/media-gateway-admin.tsx`
 - Modify: `src/components/dashboard/dashboard-view.tsx`
 - Test: `src/__tests__/lib/media-gateway-audit.test.ts`
 - Test: `src/__tests__/lib/media-gateway-key-service.test.ts`
+- Test: `src/__tests__/lib/media-gateway-admission.test.ts`
+- Test: `src/__tests__/lib/media-gateway-utc-day-window.test.ts`
 - Test: `src/__tests__/components/media-gateway-admin.test.tsx`
 - Test: `src/__tests__/components/dashboard-media-gateway-contract.test.ts`
 - Test: `tests/e2e/media-gateway-admin-responsive.spec.ts`
+- Test: `tests/integration/media-gateway-admission-postgres.test.ts`

 **Interfaces:**
 - Produces admin view: 汇总、密钥表、签发/编辑抽屉、一次性密钥模态框。
diff --git a/src/__tests__/components/media-gateway-admin.test.tsx b/src/__tests__/components/media-gateway-admin.test.tsx
index 5df308ef..6de4dec7 100644
--- a/src/__tests__/components/media-gateway-admin.test.tsx
+++ b/src/__tests__/components/media-gateway-admin.test.tsx
@@ -62,6 +62,7 @@ describe('MediaGatewayAdmin', () => {
   });

   afterEach(() => {
+    vi.useRealTimers();
     vi.unstubAllGlobals();
   });

@@ -204,7 +205,63 @@ describe('MediaGatewayAdmin', () => {

     const sheet = screen.getByRole('dialog', { name: '签发媒体网关密钥' });
     expect((await within(sheet).findByRole('alert')).textContent).toContain('签发结果无法确认');
-    expect((within(sheet).getByRole('button', { name: '确认签发' }) as HTMLButtonElement).disabled).toBe(true);
+    await waitFor(() => expect(
+      (within(sheet).getByRole('button', { name: '确认签发' }) as HTMLButtonElement).disabled,
+    ).toBe(false));
+    expect(getCount).toBe(2);
+  });
+
+  it('treats a rejected issue fetch as ambiguous and reconciles before allowing another issue', async () => {
+    let getCount = 0;
+    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
+      if ((init?.method ?? 'GET') === 'GET') {
+        getCount += 1;
+        return jsonResponse({ success: true, keys: [] });
+      }
+      throw new TypeError('connection reset after send');
+    }));
+    render(<MediaGatewayAdmin />);
+    await screen.findByText('尚未签发媒体网关密钥');
+    fireEvent.click(screen.getByRole('button', { name: '签发密钥' }));
+    fireEvent.change(screen.getByLabelText('用户 ID'), { target: { value: 'user-1' } });
+    fireEvent.change(screen.getByLabelText('标签'), { target: { value: 'Production' } });
+    fireEvent.click(screen.getByRole('button', { name: '确认签发' }));
+
+    const sheet = screen.getByRole('dialog', { name: '签发媒体网关密钥' });
+    const alert = await within(sheet).findByRole('alert');
+    expect(alert.textContent).toContain('签发结果无法确认');
+    expect(alert.textContent).not.toContain('请重试');
+    await waitFor(() => expect(getCount).toBe(2));
+    expect((within(sheet).getByRole('button', { name: '确认签发' }) as HTMLButtonElement).disabled).toBe(false);
+  });
+
+  it('times out a pending issue request into ambiguity and performs an authoritative refresh', async () => {
+    vi.useFakeTimers();
+    let getCount = 0;
+    vi.stubGlobal('fetch', vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
+      if ((init?.method ?? 'GET') === 'GET') {
+        getCount += 1;
+        return Promise.resolve(jsonResponse({ success: true, keys: [] }));
+      }
+      return new Promise<Response>((_resolve, reject) => {
+        init?.signal?.addEventListener('abort', () => reject(new DOMException('Timed out', 'AbortError')));
+      });
+    }));
+    render(<MediaGatewayAdmin />);
+    await act(async () => {
+      await Promise.resolve();
+      await Promise.resolve();
+    });
+    expect(screen.getByText('尚未签发媒体网关密钥')).toBeTruthy();
+    fireEvent.click(screen.getByRole('button', { name: '签发密钥' }));
+    fireEvent.change(screen.getByLabelText('用户 ID'), { target: { value: 'user-1' } });
+    fireEvent.change(screen.getByLabelText('标签'), { target: { value: 'Production' } });
+    fireEvent.click(screen.getByRole('button', { name: '确认签发' }));
+
+    await act(async () => vi.advanceTimersByTimeAsync(5_000));
+    vi.useRealTimers();
+    const sheet = screen.getByRole('dialog', { name: '签发媒体网关密钥' });
+    expect((await within(sheet).findByRole('alert')).textContent).toContain('签发结果无法确认');
     expect(getCount).toBe(2);
   });

@@ -239,10 +296,36 @@ describe('MediaGatewayAdmin', () => {
     fireEvent.click(within(sheet).getByRole('button', { name: '保存修改' }));

     expect((await within(sheet).findByRole('alert')).textContent).toContain('保存结果无法确认');
-    expect((within(sheet).getByRole('button', { name: '保存修改' }) as HTMLButtonElement).disabled).toBe(true);
+    await waitFor(() => expect(
+      (within(sheet).getByRole('button', { name: '保存修改' }) as HTMLButtonElement).disabled,
+    ).toBe(false));
     expect(screen.queryByText('Renamed')).toBeNull();
   });

+  it('treats a patch response read failure as ambiguous and refreshes authority', async () => {
+    let getCount = 0;
+    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
+      if ((init?.method ?? 'GET') === 'GET') {
+        getCount += 1;
+        return jsonResponse({ success: true, keys: [key] });
+      }
+      return {
+        ok: true,
+        status: 200,
+        json: vi.fn().mockRejectedValue(new TypeError('body stream failed')),
+      } as unknown as Response;
+    }));
+    render(<MediaGatewayAdmin />);
+    await screen.findAllByText('Production');
+    fireEvent.click(screen.getAllByRole('button', { name: '编辑 Production' })[0]);
+    const sheet = screen.getByRole('dialog', { name: '编辑媒体网关密钥' });
+    fireEvent.change(within(sheet).getByLabelText('标签'), { target: { value: 'Renamed' } });
+    fireEvent.click(within(sheet).getByRole('button', { name: '保存修改' }));
+
+    expect((await within(sheet).findByRole('alert')).textContent).toContain('保存结果无法确认');
+    await waitFor(() => expect(getCount).toBe(2));
+  });
+
   it('requires confirmation before revoking a key', async () => {
     const fetchMock = mockApi();
     render(<MediaGatewayAdmin />);
@@ -272,7 +355,9 @@ describe('MediaGatewayAdmin', () => {
     fireEvent.click(screen.getAllByRole('button', { name: '吊销 Production' })[0]);
     const dialog = screen.getByRole('alertdialog');
     fireEvent.click(within(dialog).getByRole('button', { name: '确认吊销' }));
-    expect((await within(dialog).findByRole('alert')).textContent).toContain('吊销密钥失败');
+    const alert = await within(dialog).findByRole('alert');
+    expect(alert.textContent).toContain('吊销结果无法确认');
+    expect(alert.textContent).not.toContain('请重试');
   });

   it('locks duplicate revoke attempts after an untrusted success response', async () => {
@@ -291,10 +376,76 @@ describe('MediaGatewayAdmin', () => {
     fireEvent.click(within(dialog).getByRole('button', { name: '确认吊销' }));

     expect((await within(dialog).findByRole('alert')).textContent).toContain('吊销结果无法确认');
-    expect((within(dialog).getByRole('button', { name: '确认吊销' }) as HTMLButtonElement).disabled).toBe(true);
+    await waitFor(() => expect(
+      (within(dialog).getByRole('button', { name: '确认吊销' }) as HTMLButtonElement).disabled,
+    ).toBe(false));
     expect(getCount).toBe(2);
   });

+  it('keeps an ambiguous issue lock local and lets the sheet exit while authority is pending', async () => {
+    let getCount = 0;
+    let authoritySignal: AbortSignal | null = null;
+    vi.stubGlobal('fetch', vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
+      if ((init?.method ?? 'GET') === 'GET') {
+        getCount += 1;
+        if (getCount === 1) return Promise.resolve(jsonResponse({ success: true, keys: [key] }));
+        authoritySignal = init?.signal ?? null;
+        return new Promise<Response>((_resolve, reject) => {
+          init?.signal?.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')));
+        });
+      }
+      return Promise.resolve(jsonResponse({ success: true, key, secret: 'wmg_too-short' }, 201));
+    }));
+    render(<MediaGatewayAdmin />);
+    await screen.findAllByText('Production');
+    fireEvent.click(screen.getByRole('button', { name: '签发密钥' }));
+    fireEvent.change(screen.getByLabelText('用户 ID'), { target: { value: 'user-1' } });
+    fireEvent.change(screen.getByLabelText('标签'), { target: { value: 'Production' } });
+    fireEvent.click(screen.getByRole('button', { name: '确认签发' }));
+
+    const sheet = screen.getByRole('dialog', { name: '签发媒体网关密钥' });
+    expect((await within(sheet).findByRole('alert')).textContent).toContain('签发结果无法确认');
+    expect((within(sheet).getByRole('button', { name: '取消' }) as HTMLButtonElement).disabled).toBe(false);
+    const unrelatedEdit = document.querySelector<HTMLButtonElement>('[aria-label="编辑 Production"]');
+    expect(unrelatedEdit?.disabled).toBe(false);
+    fireEvent.click(within(sheet).getByRole('button', { name: '取消' }));
+    await waitFor(() => expect(screen.queryByRole('dialog', { name: '签发媒体网关密钥' })).toBeNull());
+    expect((authoritySignal as AbortSignal | null)?.aborted).toBe(true);
+  });
+
+  it('bounds an unavailable authority refresh and releases its local lock on exit', async () => {
+    vi.useFakeTimers();
+    let getCount = 0;
+    vi.stubGlobal('fetch', vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
+      if ((init?.method ?? 'GET') === 'GET') {
+        getCount += 1;
+        if (getCount === 1) return Promise.resolve(jsonResponse({ success: true, keys: [] }));
+        return new Promise<Response>((_resolve, reject) => {
+          init?.signal?.addEventListener('abort', () => reject(new DOMException('Timed out', 'AbortError')));
+        });
+      }
+      return Promise.resolve(jsonResponse({ success: true, key, secret: 'wmg_too-short' }, 201));
+    }));
+    render(<MediaGatewayAdmin />);
+    await act(async () => {
+      await Promise.resolve();
+      await Promise.resolve();
+    });
+    fireEvent.click(screen.getByRole('button', { name: '签发密钥' }));
+    fireEvent.change(screen.getByLabelText('用户 ID'), { target: { value: 'user-1' } });
+    fireEvent.change(screen.getByLabelText('标签'), { target: { value: 'Production' } });
+    fireEvent.click(screen.getByRole('button', { name: '确认签发' }));
+
+    await act(async () => vi.advanceTimersByTimeAsync(5_000));
+    vi.useRealTimers();
+    const sheet = screen.getByRole('dialog', { name: '签发媒体网关密钥' });
+    expect((await within(sheet).findByRole('alert')).textContent).toContain('权威列表暂时无法确认');
+    expect((within(sheet).getByRole('button', { name: '确认签发' }) as HTMLButtonElement).disabled).toBe(true);
+    fireEvent.click(within(sheet).getByRole('button', { name: '取消' }));
+    await waitFor(() => expect(screen.queryByRole('dialog', { name: '签发媒体网关密钥' })).toBeNull());
+    expect((screen.getByRole('button', { name: '签发密钥' }) as HTMLButtonElement).disabled).toBe(false);
+  });
+
   it('uses a bounded mobile layout at 375px without a horizontally scrolling root', async () => {
     vi.stubGlobal('innerWidth', 375);
     mockApi();
diff --git a/src/__tests__/lib/media-gateway-admission.test.ts b/src/__tests__/lib/media-gateway-admission.test.ts
index d53f301b..9ff991df 100644
--- a/src/__tests__/lib/media-gateway-admission.test.ts
+++ b/src/__tests__/lib/media-gateway-admission.test.ts
@@ -149,6 +149,9 @@ describe('media gateway admission transactions', () => {
     expect(sql[3]).toMatch(/FROM wujie_gateway_requests.+idempotency_key/i);
     expect(sql[4]).toMatch(/INSERT INTO wujie_gateway_requests/i);
     expect(sql[5]).toMatch(/FROM wujie_gateway_requests.+FOR UPDATE/i);
+    expect(sql[5]).toContain("date_trunc('day', $2::timestamptz AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'");
+    expect(sql[5]).toContain("date_trunc('day', $2::timestamptz AT TIME ZONE 'UTC') + interval '1 day'");
+    expect(sql[5]).not.toContain("date_trunc('day', $2::timestamptz)");
     expect(sql[6]).toBe('COMMIT');
     expect(client.release).toHaveBeenCalledOnce();
   });
diff --git a/src/__tests__/lib/media-gateway-utc-day-window.test.ts b/src/__tests__/lib/media-gateway-utc-day-window.test.ts
new file mode 100644
index 00000000..764882e5
--- /dev/null
+++ b/src/__tests__/lib/media-gateway-utc-day-window.test.ts
@@ -0,0 +1,19 @@
+import { describe, expect, it } from 'vitest';
+
+import { postgresUtcDayWindow } from '@/lib/media-gateway/utc-day-window';
+
+describe('PostgreSQL UTC day window', () => {
+  it.each(['CURRENT_TIMESTAMP', '$2::timestamptz'] as const)(
+    'builds an explicit UTC half-open day around %s',
+    (reference) => {
+      const window = postgresUtcDayWindow(reference);
+
+      expect(window.startSql).toBe(
+        `(date_trunc('day', ${reference} AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')`,
+      );
+      expect(window.endSql).toBe(
+        `((date_trunc('day', ${reference} AT TIME ZONE 'UTC') + interval '1 day') AT TIME ZONE 'UTC')`,
+      );
+    },
+  );
+});
diff --git a/src/components/dashboard/media-gateway-admin.tsx b/src/components/dashboard/media-gateway-admin.tsx
index 1deb737d..faa60c8f 100644
--- a/src/components/dashboard/media-gateway-admin.tsx
+++ b/src/components/dashboard/media-gateway-admin.tsx
@@ -1,6 +1,6 @@
 'use client';

-import { useCallback, useEffect, useMemo, useState } from 'react';
+import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
 import {
   AlertTriangle,
   Check,
@@ -66,6 +66,9 @@ interface KeyFormState {
 }

 type DrawerMode = 'issue' | 'edit' | null;
+type MutationScope = 'issue' | `edit:${string}` | `revoke:${string}`;
+
+const REQUEST_TIMEOUT_MS = 5_000;

 const initialForm: KeyFormState = {
   userId: '',
@@ -84,6 +87,8 @@ function objectValue(value: unknown): Record<string, unknown> | null {
 const FULL_SECRET_PATTERN = /wmg_[A-Za-z0-9_-]{43,}/;
 const SECRET_PATTERN = /^wmg_[A-Za-z0-9_-]{43}$/;

+class UntrustedResponseError extends Error {}
+
 function safeText(value: unknown, maximum: number): string | null {
   return typeof value === 'string'
     && value.trim().length > 0
@@ -160,8 +165,10 @@ function keyStatus(key: GatewayKeyView): { label: string; className: string } {
 }

 async function responseBody(response: Response): Promise<Record<string, unknown>> {
-  const value: unknown = await response.json().catch(() => null);
-  return objectValue(value) ?? {};
+  const value: unknown = await response.json();
+  const body = objectValue(value);
+  if (!body) throw new UntrustedResponseError('untrusted response');
+  return body;
 }

 export default function MediaGatewayAdmin() {
@@ -180,34 +187,79 @@ export default function MediaGatewayAdmin() {
   const [copiedKeyId, setCopiedKeyId] = useState<string | null>(null);
   const [revokeKey, setRevokeKey] = useState<GatewayKeyView | null>(null);
   const [revoking, setRevoking] = useState(false);
-  const [mutationLocked, setMutationLocked] = useState(false);
+  const [lockedMutations, setLockedMutations] = useState<ReadonlySet<MutationScope>>(new Set());
+  const requestControllers = useRef(new Map<string, AbortController>());
+
+  const setMutationLocked = useCallback((scope: MutationScope, locked: boolean): void => {
+    setLockedMutations(current => {
+      const next = new Set(current);
+      if (locked) next.add(scope);
+      else next.delete(scope);
+      return next;
+    });
+  }, []);
+
+  const runBoundedFetch = useCallback(async (
+    scope: string,
+    input: RequestInfo | URL,
+    init?: RequestInit,
+  ): Promise<Response> => {
+    requestControllers.current.get(scope)?.abort();
+    const controller = new AbortController();
+    requestControllers.current.set(scope, controller);
+    const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
+    try {
+      return await fetch(input, { ...init, signal: controller.signal });
+    } finally {
+      window.clearTimeout(timeout);
+      if (requestControllers.current.get(scope) === controller) {
+        requestControllers.current.delete(scope);
+      }
+    }
+  }, []);
+
+  const cancelRequest = useCallback((scope: string): void => {
+    requestControllers.current.get(scope)?.abort();
+  }, []);
+
+  const readAuthoritativeKeys = useCallback(async (scope: string): Promise<GatewayKeyView[]> => {
+    const response = await runBoundedFetch(scope, '/api/admin/gateway/keys');
+    if (!response.ok) throw new Error('request failed');
+    const body = await responseBody(response);
+    if (body.success !== true || !Array.isArray(body.keys)) {
+      throw new UntrustedResponseError('untrusted response');
+    }
+    const parsedKeys = body.keys.map(parseKey);
+    if (parsedKeys.some(key => key === null)) throw new UntrustedResponseError('untrusted response');
+    return parsedKeys as GatewayKeyView[];
+  }, [runBoundedFetch]);

   const loadKeys = useCallback(async (): Promise<void> => {
     setLoading(true);
     setListError(null);
     try {
-      const response = await fetch('/api/admin/gateway/keys');
-      const body = await responseBody(response);
-      if (!response.ok || body.success !== true || !Array.isArray(body.keys)) {
-        throw new Error('invalid response');
-      }
-      const parsedKeys = body.keys.map(parseKey);
-      if (parsedKeys.some(key => key === null)) {
-        setKeys([]);
-        setListError('服务器响应不可信，未显示任何媒体网关密钥。');
-        return;
-      }
-      setKeys(parsedKeys as GatewayKeyView[]);
-    } catch {
+      const parsedKeys = await readAuthoritativeKeys('list');
+      setKeys(parsedKeys);
+      setLockedMutations(new Set());
+    } catch (error) {
       setKeys([]);
-      setListError('加载媒体网关密钥失败，请稍后重试。');
+      setListError(
+        error instanceof UntrustedResponseError
+          ? '服务器响应不可信，未显示任何媒体网关密钥。'
+          : '加载媒体网关密钥失败，请稍后重试。',
+      );
     } finally {
       setLoading(false);
     }
-  }, []);
+  }, [readAuthoritativeKeys]);

   useEffect(() => {
+    const controllers = requestControllers.current;
     void loadKeys();
+    return () => {
+      controllers.forEach(controller => controller.abort());
+      controllers.clear();
+    };
   }, [loadKeys]);

   const summary = useMemo(() => ({
@@ -243,11 +295,22 @@ export default function MediaGatewayAdmin() {
     setSecretError(null);
   };

-  const reconcileAmbiguousMutation = async (message: string): Promise<void> => {
-    setMutationLocked(true);
-    setSheetError(message);
-    setRevokeError(message);
-    await loadKeys();
+  const reconcileAmbiguousMutation = async (
+    scope: MutationScope,
+    message: string,
+    setContextError: (value: string) => void,
+  ): Promise<void> => {
+    setMutationLocked(scope, true);
+    setContextError(`${message}正在核对权威列表，请勿重复提交。`);
+    try {
+      const authoritativeKeys = await readAuthoritativeKeys(scope);
+      setKeys(authoritativeKeys);
+      setListError(null);
+      setMutationLocked(scope, false);
+      setContextError(`${message}权威列表已刷新，请核对当前状态。`);
+    } catch {
+      setContextError(`${message}权威列表暂时无法确认，请先退出并刷新列表，勿重复提交。`);
+    }
   };

   const submitForm = async (): Promise<void> => {
@@ -261,14 +324,18 @@ export default function MediaGatewayAdmin() {
       setSheetError('请填写有效的用户、标签、RPM 和日配额。');
       return;
     }
-    if (mutationLocked) return;
+    const scope: MutationScope = drawerMode === 'issue'
+      ? 'issue'
+      : `edit:${editingKey?.id ?? ''}`;
+    if (lockedMutations.has(scope)) return;
     setSaving(true);
     setSheetError(null);
     try {
       const isIssue = drawerMode === 'issue';
       const submittedLabel = form.label.trim();
       const submittedUserId = form.userId.trim();
-      const response = await fetch(
+      const response = await runBoundedFetch(
+        scope,
         isIssue ? '/api/admin/gateway/keys' : `/api/admin/gateway/keys/${editingKey?.id ?? ''}`,
         {
           method: isIssue ? 'POST' : 'PATCH',
@@ -287,7 +354,10 @@ export default function MediaGatewayAdmin() {
         },
       );
       const body = await responseBody(response);
-      if (!response.ok) throw new Error('request failed');
+      if (!response.ok) {
+        await reconcileAmbiguousMutation(scope, isIssue ? '签发结果无法确认。' : '保存结果无法确认。', setSheetError);
+        return;
+      }
       const returnedKey = parseKey(body.key);
       const secret = isIssue && typeof body.secret === 'string' && SECRET_PATTERN.test(body.secret)
         ? body.secret
@@ -307,9 +377,9 @@ export default function MediaGatewayAdmin() {
             && returnedKey.enabled === form.enabled);
       if (body.success !== true || !keyMatchesRequest || (isIssue && secret === null)) {
         await reconcileAmbiguousMutation(
-          isIssue
-            ? '签发结果无法确认。已锁定重复签发并重新加载权威列表。'
-            : '保存结果无法确认。已锁定重复提交并重新加载权威列表。',
+          scope,
+          isIssue ? '签发结果无法确认。' : '保存结果无法确认。',
+          setSheetError,
         );
         return;
       }
@@ -325,7 +395,11 @@ export default function MediaGatewayAdmin() {
       setDrawerMode(null);
       setEditingKey(null);
     } catch {
-      setSheetError(drawerMode === 'issue' ? '签发密钥失败，请重试。' : '保存密钥失败，请重试。');
+      await reconcileAmbiguousMutation(
+        scope,
+        drawerMode === 'issue' ? '签发结果无法确认。' : '保存结果无法确认。',
+        setSheetError,
+      );
     } finally {
       setSaving(false);
     }
@@ -356,13 +430,21 @@ export default function MediaGatewayAdmin() {

   const confirmRevoke = async (): Promise<void> => {
     if (!revokeKey) return;
-    if (mutationLocked) return;
+    const scope: MutationScope = `revoke:${revokeKey.id}`;
+    if (lockedMutations.has(scope)) return;
     setRevoking(true);
     setRevokeError(null);
     try {
-      const response = await fetch(`/api/admin/gateway/keys/${revokeKey.id}`, { method: 'DELETE' });
+      const response = await runBoundedFetch(
+        scope,
+        `/api/admin/gateway/keys/${revokeKey.id}`,
+        { method: 'DELETE' },
+      );
       const body = await responseBody(response);
-      if (!response.ok) throw new Error('request failed');
+      if (!response.ok) {
+        await reconcileAmbiguousMutation(scope, '吊销结果无法确认。', setRevokeError);
+        return;
+      }
       const returnedKey = parseKey(body.key);
       if (
         body.success !== true
@@ -371,18 +453,44 @@ export default function MediaGatewayAdmin() {
         || returnedKey.enabled
         || returnedKey.revokedAt === null
       ) {
-        await reconcileAmbiguousMutation('吊销结果无法确认。已锁定重复提交并重新加载权威列表。');
+        await reconcileAmbiguousMutation(scope, '吊销结果无法确认。', setRevokeError);
         return;
       }
       setKeys(current => current.map(key => key.id === returnedKey.id ? returnedKey : key));
       setRevokeKey(null);
     } catch {
-      setRevokeError('吊销密钥失败，请重试。');
+      await reconcileAmbiguousMutation(scope, '吊销结果无法确认。', setRevokeError);
     } finally {
       setRevoking(false);
     }
   };

+  const formScope: MutationScope | null = drawerMode === 'issue'
+    ? 'issue'
+    : editingKey ? `edit:${editingKey.id}` : null;
+
+  const closeDrawer = (): void => {
+    if (formScope) {
+      cancelRequest(formScope);
+      setMutationLocked(formScope, false);
+    }
+    setSaving(false);
+    setDrawerMode(null);
+    setEditingKey(null);
+    setSheetError(null);
+  };
+
+  const closeRevokeDialog = (): void => {
+    if (revokeKey) {
+      const scope: MutationScope = `revoke:${revokeKey.id}`;
+      cancelRequest(scope);
+      setMutationLocked(scope, false);
+    }
+    setRevoking(false);
+    setRevokeError(null);
+    setRevokeKey(null);
+  };
+
   return (
     <section
       data-testid="media-gateway-admin"
@@ -402,7 +510,7 @@ export default function MediaGatewayAdmin() {
               <RefreshCw className={loading ? 'animate-spin' : ''} />
               刷新
             </Button>
-            <Button size="sm" onClick={openIssueDrawer} disabled={mutationLocked}>
+            <Button size="sm" onClick={openIssueDrawer} disabled={lockedMutations.has('issue')}>
               <Plus />
               签发密钥
             </Button>
@@ -467,7 +575,7 @@ export default function MediaGatewayAdmin() {
         )}
       </div>

-      <Sheet open={drawerMode !== null} onOpenChange={open => { if (!open && !saving) { setDrawerMode(null); setSheetError(null); } }}>
+      <Sheet open={drawerMode !== null} onOpenChange={open => { if (!open) closeDrawer(); }}>
         <SheetContent className="w-[calc(100%-1rem)] max-w-md overflow-x-hidden overflow-y-auto border-border sm:w-full">
           <SheetHeader>
             <SheetTitle>{drawerMode === 'issue' ? '签发媒体网关密钥' : '编辑媒体网关密钥'}</SheetTitle>
@@ -497,10 +605,10 @@ export default function MediaGatewayAdmin() {
             {sheetError && <ContextError message={sheetError} />}
           </div>
           <SheetFooter>
-            <Button onClick={() => void submitForm()} disabled={saving || mutationLocked}>
+            <Button onClick={() => void submitForm()} disabled={saving || (formScope !== null && lockedMutations.has(formScope))}>
               {saving ? '提交中...' : drawerMode === 'issue' ? '确认签发' : '保存修改'}
             </Button>
-            <Button variant="outline" onClick={() => setDrawerMode(null)} disabled={saving}>取消</Button>
+            <Button variant="outline" onClick={closeDrawer}>取消</Button>
           </SheetFooter>
         </SheetContent>
       </Sheet>
@@ -531,7 +639,7 @@ export default function MediaGatewayAdmin() {
         </DialogContent>
       </Dialog>

-      <AlertDialog open={revokeKey !== null} onOpenChange={open => { if (!open && !revoking) setRevokeKey(null); }}>
+      <AlertDialog open={revokeKey !== null} onOpenChange={open => { if (!open) closeRevokeDialog(); }}>
         <AlertDialogContent>
           <AlertDialogHeader>
             <AlertDialogTitle>吊销 {revokeKey?.label}</AlertDialogTitle>
@@ -539,8 +647,8 @@ export default function MediaGatewayAdmin() {
           </AlertDialogHeader>
           {revokeError && <ContextError message={revokeError} />}
           <AlertDialogFooter>
-            <AlertDialogCancel disabled={revoking}>取消</AlertDialogCancel>
-            <AlertDialogAction className="bg-destructive text-white hover:bg-destructive/90" disabled={revoking || mutationLocked} onClick={event => { event.preventDefault(); void confirmRevoke(); }}>
+            <AlertDialogCancel>取消</AlertDialogCancel>
+            <AlertDialogAction className="bg-destructive text-white hover:bg-destructive/90" disabled={revoking || (revokeKey !== null && lockedMutations.has(`revoke:${revokeKey.id}`))} onClick={event => { event.preventDefault(); void confirmRevoke(); }}>
               {revoking ? '吊销中...' : '确认吊销'}
             </AlertDialogAction>
           </AlertDialogFooter>
diff --git a/src/lib/media-gateway/admission.ts b/src/lib/media-gateway/admission.ts
index 038748bf..c5d4118d 100644
--- a/src/lib/media-gateway/admission.ts
+++ b/src/lib/media-gateway/admission.ts
@@ -4,6 +4,7 @@ import type { PoolClient, QueryResultRow } from 'pg';

 import { getPool } from '@/lib/db-client';
 import type { GatewayPrincipal } from '@/lib/media-gateway/key-service';
+import { postgresUtcDayWindow } from '@/lib/media-gateway/utc-day-window';
 import {
   GatewayError,
   type GatewayMediaType,
@@ -55,6 +56,8 @@ interface GatewayRequestRow extends QueryResultRow {
   updated_at: string | Date;
 }

+const ADMISSION_UTC_DAY = postgresUtcDayWindow('$2::timestamptz');
+
 const REQUEST_COLUMNS = `
   id, gateway_key_id, user_id, idempotency_key, request_digest, media_type,
   admission_status, task_ids, rejection_code, created_at, updated_at
@@ -331,8 +334,8 @@ export async function reserveGatewayRequest(
          FROM wujie_gateway_requests
         WHERE gateway_key_id = $1
           AND admission_status IN ('reserved', 'admitted')
-          AND created_at >= date_trunc('day', $2::timestamptz)
-          AND created_at < date_trunc('day', $2::timestamptz) + interval '1 day'
+          AND created_at >= ${ADMISSION_UTC_DAY.startSql}
+          AND created_at < ${ADMISSION_UTC_DAY.endSql}
         ORDER BY created_at, id
         FOR UPDATE`,
       [key.id, now.toISOString()],
diff --git a/src/lib/media-gateway/key-service.ts b/src/lib/media-gateway/key-service.ts
index 53bbff9d..b2a39b39 100644
--- a/src/lib/media-gateway/key-service.ts
+++ b/src/lib/media-gateway/key-service.ts
@@ -2,6 +2,7 @@ import { createHash, randomBytes, randomUUID } from 'node:crypto';

 import { execSql } from '@/lib/db-client';
 import { GatewayError, type GatewayKeyRecord } from '@/lib/media-gateway/types';
+import { postgresUtcDayWindow } from '@/lib/media-gateway/utc-day-window';

 export interface GatewayKeyView {
   id: string;
@@ -60,6 +61,7 @@ const PUBLIC_COLUMNS = `
   enabled, created_by, created_at, last_used_at, revoked_at
 `;
 const SECRET_PATTERN = /^wmg_[A-Za-z0-9_-]{43,}$/;
+const CURRENT_UTC_DAY = postgresUtcDayWindow('CURRENT_TIMESTAMP');

 function invalidRequest(message = 'Invalid gateway key request', status = 400): GatewayError {
   return new GatewayError('GATEWAY_INVALID_REQUEST', status, message);
@@ -195,8 +197,8 @@ export async function listGatewayKeys(): Promise<GatewayKeyView[]> {
          SELECT gateway_key_id, COUNT(*)::integer AS today_usage
            FROM wujie_gateway_requests
           WHERE admission_status IN ('reserved', 'admitted')
-            AND created_at >= date_trunc('day', CURRENT_TIMESTAMP AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
-            AND created_at < (date_trunc('day', CURRENT_TIMESTAMP AT TIME ZONE 'UTC') + interval '1 day') AT TIME ZONE 'UTC'
+            AND created_at >= ${CURRENT_UTC_DAY.startSql}
+            AND created_at < ${CURRENT_UTC_DAY.endSql}
           GROUP BY gateway_key_id
        ) AS usage ON usage.gateway_key_id = keys.id
       ORDER BY keys.created_at DESC, keys.id ASC`,
@@ -242,8 +244,8 @@ export async function updateGatewayKey(
          FROM wujie_gateway_requests AS usage
         WHERE usage.gateway_key_id = changed.id
           AND usage.admission_status IN ('reserved', 'admitted')
-          AND usage.created_at >= date_trunc('day', CURRENT_TIMESTAMP AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
-          AND usage.created_at < (date_trunc('day', CURRENT_TIMESTAMP AT TIME ZONE 'UTC') + interval '1 day') AT TIME ZONE 'UTC'
+          AND usage.created_at >= ${CURRENT_UTC_DAY.startSql}
+          AND usage.created_at < ${CURRENT_UTC_DAY.endSql}
      ), 0)::integer AS today_usage
        FROM changed`,
     [keyId, ...entries.map(([, value]) => value)],
@@ -277,8 +279,8 @@ export async function revokeGatewayKey(keyId: string): Promise<GatewayKeyView> {
          FROM wujie_gateway_requests AS usage
         WHERE usage.gateway_key_id = changed.id
           AND usage.admission_status IN ('reserved', 'admitted')
-          AND usage.created_at >= date_trunc('day', CURRENT_TIMESTAMP AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
-          AND usage.created_at < (date_trunc('day', CURRENT_TIMESTAMP AT TIME ZONE 'UTC') + interval '1 day') AT TIME ZONE 'UTC'
+          AND usage.created_at >= ${CURRENT_UTC_DAY.startSql}
+          AND usage.created_at < ${CURRENT_UTC_DAY.endSql}
      ), 0)::integer AS today_usage
        FROM changed`,
     [keyId],
diff --git a/src/lib/media-gateway/utc-day-window.ts b/src/lib/media-gateway/utc-day-window.ts
new file mode 100644
index 00000000..f2aa2df0
--- /dev/null
+++ b/src/lib/media-gateway/utc-day-window.ts
@@ -0,0 +1,16 @@
+export type PostgresUtcDayReference = 'CURRENT_TIMESTAMP' | '$2::timestamptz';
+
+export interface PostgresUtcDayWindow {
+  startSql: string;
+  endSql: string;
+}
+
+export function postgresUtcDayWindow(
+  reference: PostgresUtcDayReference,
+): PostgresUtcDayWindow {
+  const utcLocalTimestamp = `${reference} AT TIME ZONE 'UTC'`;
+  return {
+    startSql: `(date_trunc('day', ${utcLocalTimestamp}) AT TIME ZONE 'UTC')`,
+    endSql: `((date_trunc('day', ${utcLocalTimestamp}) + interval '1 day') AT TIME ZONE 'UTC')`,
+  };
+}
diff --git a/tests/integration/media-gateway-admission-postgres.test.ts b/tests/integration/media-gateway-admission-postgres.test.ts
index 96c40a02..0bf21ca3 100644
--- a/tests/integration/media-gateway-admission-postgres.test.ts
+++ b/tests/integration/media-gateway-admission-postgres.test.ts
@@ -26,6 +26,52 @@ function input(overrides: Record<string, unknown> = {}) {
 }

 describe('media gateway admission on PostgreSQL', () => {
+  postgresIt('keeps admission and admin usage aligned in a non-UTC session', async () => {
+    const { withIsolatedPostgres } = await import('../helpers/postgres-test-database');
+    await withIsolatedPostgres('gateway-non-utc-day-window', async ({ databaseUrl, query }) => {
+      await prepareSchema(query);
+      await query(`INSERT INTO wujie_users (id) VALUES ('gateway-user')`);
+      await query(`INSERT INTO wujie_gateway_keys
+        (id, user_id, key_hash, key_prefix, label, requests_per_minute, daily_quota, created_by)
+        VALUES ('gwkey_timezone', 'gateway-user', 'hash', 'wmg_time0000', 'timezone', 100, 1, 'admin')`);
+      const boundary = await query(
+        `SELECT date_trunc('day', CURRENT_TIMESTAMP AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' AS utc_start`,
+      ) as { rows: Array<{ utc_start: Date }> };
+      const utcStart = new Date(boundary.rows[0].utc_start);
+      const previousDay = new Date(utcStart.getTime() - 30 * 60_000);
+      const currentDay = new Date(utcStart.getTime() + 30 * 60_000);
+      await query(`INSERT INTO wujie_gateway_requests
+        (id, gateway_key_id, user_id, idempotency_key, request_digest, media_type, admission_status, created_at)
+        VALUES ('gwreq_previous_timezone', 'gwkey_timezone', 'gateway-user', 'previous', repeat('b', 64),
+          'image', 'admitted', $1)`, [previousDay.toISOString()]);
+
+      const nonUtcUrl = new URL(databaseUrl);
+      const existingOptions = nonUtcUrl.searchParams.get('options');
+      nonUtcUrl.searchParams.set(
+        'options',
+        [existingOptions, '-cTimeZone=Asia/Shanghai'].filter(Boolean).join(' '),
+      );
+      const { closePool, execSql } = await import('@/lib/db-client');
+      await closePool();
+      process.env.DATABASE_URL = nonUtcUrl.toString();
+      process.env.PGDATABASE_URL = nonUtcUrl.toString();
+      expect((await execSql(
+        `SELECT current_setting('TimeZone') AS timezone`,
+      )).rows[0]?.timezone).toBe('Asia/Shanghai');
+
+      const { reserveGatewayRequest } = await import('@/lib/media-gateway/admission');
+      const { listGatewayKeys } = await import('@/lib/media-gateway/key-service');
+      await expect(reserveGatewayRequest(input({
+        principal: { ...input().principal, keyId: 'gwkey_timezone', dailyQuota: 1 },
+        idempotencyKey: 'current',
+        now: currentDay,
+      }))).resolves.toMatchObject({ kind: 'execute' });
+
+      const keys = await listGatewayKeys();
+      expect(keys.find((candidate) => candidate.id === 'gwkey_timezone')?.todayUsage).toBe(1);
+    });
+  }, 30_000);
+
   postgresIt('projects authoritative UTC daily usage from reserved and admitted requests only', async () => {
     const { withIsolatedPostgres } = await import('../helpers/postgres-test-database');
     await withIsolatedPostgres('gateway-admin-daily-usage', async ({ query }) => {

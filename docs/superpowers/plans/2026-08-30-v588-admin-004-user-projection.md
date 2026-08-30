# V588-ADMIN-004 管理员用户真实投影实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `/api/admin/users` 使用权威积分、项目与活动数据，并在管理员用户管理、积分管理和数据管理之间保持逐用户一致。

**Architecture:** `listManagedUsers()` 继续拥有用户身份集合；新增纯函数投影模块负责解析和合并。管理员 GET 路由在数据库可用时执行固定三组批量 SQL，不复制 V5.8.8 donor 的逐用户 N+1 查询；数据库未配置时保留身份列表并明确返回不可用覆盖信息。

**Tech Stack:** Next.js 16 App Router、React 19、TypeScript 5、PostgreSQL、Vitest。

## Global Constraints

- 只修改 GitHub `main`；`stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` 和 `J:\无界云端0820` 只读。
- 不修改用户创建、删除、批量删除、密码、模型授权、积分扣费、充值、支付、项目持久化或审计写入。
- 数据库已配置但查询失败时失败关闭，禁止把错误静默伪装为全部 `0`。
- 没有活动证据时不伪造当前时间。
- 先 RED，再最小实现；每个阶段运行聚焦回归。

---

### Task 1: 建立纯投影合同

**Files:**
- Create: `src/lib/admin-user-projection.ts`
- Create: `src/__tests__/lib/admin-user-projection.test.ts`

**Interfaces:**
- Consumes: `User[]`、积分行、项目行、活动行。
- Produces: `projectAdminUsers(input): AdminProjectedUser[]`、`countProjects(value): number`、`ProjectionCoverage`。

- [x] **Step 1: 写入 RED 单元测试**

覆盖：积分余额；项目数组、对象、JSON 字符串和畸形值；无统计行用户保留为 0；最后活动取审计、项目更新时间与用户 `updatedAt` 最大值。

```ts
expect(projectAdminUsers({
  users: [userA, userB],
  creditRows: [{ user_id: 'a', balance: '403' }],
  projectRows: [
    { user_id: 'a', data_value: '[{"id":"p1"}]', updated_at: 200 },
    { user_id: 'b', data_value: { p1: {}, p2: {} }, updated_at: 150 },
  ],
  activityRows: [{ user_id: 'a', last_activity: 300 }],
})).toEqual([
  expect.objectContaining({ id: 'a', credits: 403, project_count: 1, last_login: 300 }),
  expect.objectContaining({ id: 'b', credits: 0, project_count: 2 }),
]);
```

- [x] **Step 2: 运行 RED**

Run: `pnpm exec vitest run src/__tests__/lib/admin-user-projection.test.ts`

Expected: FAIL，因为 `@/lib/admin-user-projection` 尚不存在。

- [x] **Step 3: 实现最小纯函数模块**

```ts
export interface ProjectionCoverage {
  identity: 'available';
  credits: 'available' | 'unavailable';
  projects: 'available' | 'unavailable';
  activity: 'available' | 'unavailable';
}

export interface AdminProjectedUser extends User {
  credits: number;
  project_count: number;
  last_login?: number;
}

export function countProjects(value: unknown): number;
export function projectAdminUsers(input: {
  users: User[];
  creditRows: CreditProjectionRow[];
  projectRows: ProjectProjectionRow[];
  activityRows: ActivityProjectionRow[];
}): AdminProjectedUser[];
```

实现只做安全解析、Map 合并和最大有效时间戳计算，不执行 SQL。

- [x] **Step 4: 运行 GREEN**

Run: `pnpm exec vitest run src/__tests__/lib/admin-user-projection.test.ts`

Expected: PASS，零 warning。

---

### Task 2: 将管理员 GET 接入固定三组批量查询

**Files:**
- Modify: `src/app/api/admin/users/route.ts`
- Create: `src/__tests__/api/admin-user-projection.test.ts`
- Modify: `src/__tests__/api/admin-users-password-audit.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `projectAdminUsers()` 与 `ProjectionCoverage`。
- Produces: `{ success, users, projectionCoverage }`；查询失败返回 `ADMIN_USER_PROJECTION_FAILED`。

- [x] **Step 1: 写入 RED 路由测试**

测试应 mock `requireAdminUser`、`listManagedUsers`、`isDatabaseConfigured` 和 `execSql`，并验证：

```ts
expect(execSql).toHaveBeenCalledTimes(3);
expect(body.projectionCoverage).toEqual({
  identity: 'available',
  credits: 'available',
  projects: 'available',
  activity: 'available',
});
expect(body.users[0]).toMatchObject({ credits: 403, project_count: 10 });
```

同时锁定：100 个用户仍只有 3 次 SQL；非管理员 403 且 0 次 SQL；数据库未配置为 0 次 SQL和三项 `unavailable`；任一 SQL 失败返回 HTTP 500、`code=ADMIN_USER_PROJECTION_FAILED`。

- [x] **Step 2: 运行 RED**

Run: `pnpm exec vitest run src/__tests__/api/admin-user-projection.test.ts src/__tests__/api/admin-users-password-audit.test.ts`

Expected: 新投影断言失败，既有密码审计测试保持可加载。

- [x] **Step 3: 最小接入批量 SQL**

在管理员鉴权和 `listManagedUsers()` 之后执行：

```ts
const userIds = users.map(user => user.id);
const [credits, projects, activity] = await Promise.all([
  execSql('SELECT user_id, balance FROM wujie_credits WHERE user_id = ANY($1::text[])', [userIds]),
  execSql("SELECT user_id, data_value, updated_at FROM wujie_user_data WHERE data_key = 'projects' AND user_id = ANY($1::text[])", [userIds]),
  execSql('SELECT user_id, MAX(created_at) AS last_activity FROM wujie_audit_log WHERE user_id = ANY($1::text[]) GROUP BY user_id', [userIds]),
]);
```

数据库未配置或用户集合为空时不执行 SQL。数据库已配置的查询异常返回：

```json
{
  "success": false,
  "code": "ADMIN_USER_PROJECTION_FAILED",
  "error": "Failed to load authoritative user metrics"
}
```

POST 分支保持原样。

- [x] **Step 4: 运行 GREEN 和管理员关联回归**

Run:

```bash
pnpm exec vitest run src/__tests__/api/admin-user-projection.test.ts src/__tests__/api/admin-users-password-audit.test.ts src/__tests__/api/admin-user-count-consistency.test.ts src/__tests__/api/admin-dashboard-metrics-contract.test.ts
```

Expected: 全部 PASS，SQL 次数固定。

---

### Task 3: 对齐管理员 UI 类型与永久合同

**Files:**
- Modify: `src/components/dashboard/admin-tabs.tsx`
- Modify: `src/lib/user-types.ts`
- Create: `src/__tests__/components/admin-user-projection-contract.test.ts`

**Interfaces:**
- Consumes: 路由返回的 `credits`、`project_count`、`last_login`。
- Produces: UI 可接受毫秒时间戳或历史字符串，缺失时显示“从未”。

- [x] **Step 1: 写入 RED 类型/源码合同**

断言 `AdminUser.last_login` 接受 `string | number`，且用户详情与列表均读取 `project_count` 和 `credits`，不自行重算或伪造时间。

- [x] **Step 2: 运行 RED**

Run: `pnpm exec vitest run src/__tests__/components/admin-user-projection-contract.test.ts`

Expected: FAIL，因为当前 `last_login` 只接受字符串。

- [x] **Step 3: 最小类型调整**

```ts
last_login?: string | number;
```

在 `User` 中增加只读管理员投影可选字段，避免路由到组件之间的断言转换：

```ts
credits?: number;
project_count?: number;
last_login?: string | number;
```

不改布局、按钮和现有格式化函数。

- [x] **Step 4: 运行 GREEN**

Run: `pnpm exec vitest run src/__tests__/components/admin-user-projection-contract.test.ts`

Expected: PASS。

---

### Task 4: 完整验证、记录与发布候选

**Files:**
- Modify: `docs/plans/v588/V588_ABSORPTION_INVENTORY.md`
- Modify: `docs/testing/BUG_REGISTER.md`
- Modify: `docs/testing/REGRESSION_REPORT.md`
- Modify: `docs/testing/RELEASE_READINESS_REPORT.md`
- Modify: `docs/testing/UNVERIFIED_ITEMS.md`

**Interfaces:**
- Consumes: Tasks 1-3 的最终代码和测试结果。
- Produces: 可推送 `main` 的本地候选与明确云端验收门禁。

- [x] **Step 1: 运行完整本地门禁**

```bash
pnpm exec vitest run
pnpm ts-check
pnpm lint
pnpm check:protected-baseline
pnpm build
git diff --check
```

Expected: 已执行测试 0 failed；PostgreSQL 跳过项单独报告；TypeScript、Lint、保护门禁、构建和空白检查退出 0。

- [x] **Step 2: 更新中文记录**

记录 RED、GREEN、固定 SQL 次数、完整门禁、未验证项和当前提交；不得把本地测试写成云端通过。

- [x] **Step 3: 只提交并推送 `main`**

```bash
git add src/lib/admin-user-projection.ts src/app/api/admin/users/route.ts src/components/dashboard/admin-tabs.tsx src/lib/user-types.ts src/__tests__/lib/admin-user-projection.test.ts src/__tests__/api/admin-user-projection.test.ts src/__tests__/api/admin-users-password-audit.test.ts src/__tests__/components/admin-user-projection-contract.test.ts docs/plans/v588/V588_ABSORPTION_INVENTORY.md docs/testing/BUG_REGISTER.md docs/testing/REGRESSION_REPORT.md docs/testing/RELEASE_READINESS_REPORT.md docs/testing/UNVERIFIED_ITEMS.md docs/testing/evidence/v588-stability-002-pear-final-defer-20260830.json docs/superpowers/plans/2026-08-30-v588-admin-004-user-projection.md
git commit -m "fix: project authoritative admin user metrics"
git push origin main
```

- [ ] **Step 4: Coze 与 Google Chrome 验收**

Coze 拉取 exact SHA、重启沙箱、强制刷新既有 Google Chrome 预览标签后，使用同一管理员会话对比：

```text
/api/admin/users
/api/admin/credits/overview
/api/admin/user-images
/api/admin/dashboard-stats
```

要求四处总用户数一致；逐用户积分与积分管理一致；项目数与数据管理一致；有真实活动才显示时间；页面刷新后保持一致；Console error/warning 为 0。无法取得浏览器控制时标记为云端未验证，不回滚已通过的本地候选。

## 自检

- 规格覆盖：积分、项目、最后活动、无行用户、固定查询次数、数据库不可用、失败关闭、非管理员均有任务。
- 占位符扫描：无 TBD/TODO/“稍后实现”。
- 类型一致：路由、纯函数、`User` 与 `AdminUser` 均使用 `credits`、`project_count`、`last_login`。
- 范围检查：未包含用户 CRUD、积分写入、支付、操作日志或 UI 重构。

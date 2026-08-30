# V588-PROVIDER-002 精确模型授权写入门禁实施计划

> 依据：`docs/superpowers/specs/2026-08-30-v588-provider-002-exact-model-authorization-design.md`
>
> 约束：V5.8.8 donor 与 `stable` 全程只读；只修改 `main`；严格 RED -> 最小实现 -> 专项回归 -> 全量回归 -> exact-SHA 云端验收。

## 任务 1：建立纯规范化器 RED 测试

- [x] 新建 `src/__tests__/lib/admin-model-authorization.test.ts`。
- [x] 覆盖唯一裸键迁移、多供应商同名歧义、无效/禁用精确键、命名空间错误、畸形/非字符串输入、稳定去重和空数组。
- [x] 运行该测试并保存旧代码缺少模块/行为的 RED 输出，不修改生产代码。

验证：

```powershell
pnpm exec vitest run src/__tests__/lib/admin-model-authorization.test.ts
```

## 任务 2：实现纯规范化器

- [x] 新建 `src/lib/admin-model-authorization.ts`。
- [x] 只消费公开 `ModelInfo[]`，不读取数据库、网络或私有凭证。
- [x] 输出精确 `providerId::modelId` 数组、迁移记录或结构化歧义/无效错误。
- [x] 运行任务 1 测试转绿并执行 `git diff --check`。

## 任务 3：建立管理员 API 写入边界 RED 测试

- [x] 新建 `src/__tests__/api/admin-model-authorization.test.ts`。
- [x] Mock `getPublicModelCatalogSnapshot()`、`updateManagedUser()` 与 `dbAddAuditLog()`。
- [x] 证明旧 API 对歧义与无效授权会写入，记录稳定 RED。
- [x] 覆盖唯一裸键迁移、chat/image 共用一次快照、无模型字段零目录读取、非管理员目录读取前拒绝。

验证：

```powershell
pnpm exec vitest run src/__tests__/api/admin-model-authorization.test.ts
```

## 任务 4：接入管理员 API 最小门禁

- [x] 修改 `src/app/api/admin/users/route.ts`。
- [x] 仅当 update 请求包含模型授权字段时读取一次公开目录快照。
- [x] 任一字段失败时返回 409/400，确保用户更新和成功审计均为零调用。
- [x] 成功时只把规范化精确键写入，并在脱敏审计中记录迁移数量。
- [x] 保留 `undefined` 不更新、`[]` 不限的既有语义。
- [x] 运行任务 1、3 与既有管理员用户专项。

## 任务 5：建立并补齐管理员界面反馈合同

- [x] 扩展 `src/__tests__/components/dashboard-model-authorization-contract.test.ts`，先证明当前回调未检查 HTTP/业务失败。
- [x] 修改 `src/components/dashboard/dashboard-view.tsx`：仅成功刷新，成功/歧义/无效/网络失败均有明确 toast。
- [x] 不改变授权选择器布局、选项来源和空数组行为。
- [x] 运行组件合同测试转绿。

## 任务 6：专项与全量回归

- [x] 运行新纯函数、API、组件测试。
- [x] 回归管理员用户投影、密码审计、模型目录、普通用户目录、生成面板授权合同与任务精确路由。
- [x] 运行 TypeScript、构建版 Lint、全仓测试与 8 GiB 生产构建。
- [x] 披露所有跳过项；失败不得删除、屏蔽或扩大白名单。
- [x] 以实现提交为来源登记新生产文件的精确路径后，在干净候选工作树重跑保护基线。

```powershell
pnpm exec vitest run src/__tests__/lib/admin-model-authorization.test.ts src/__tests__/api/admin-model-authorization.test.ts src/__tests__/components/dashboard-model-authorization-contract.test.ts src/__tests__/api/admin-user-projection.test.ts src/__tests__/api/admin-users-password-audit.test.ts src/__tests__/api/models-configured-catalog.test.ts src/__tests__/api/models-defaults.test.ts src/__tests__/lib/task-model-catalog.test.ts
pnpm check:protected-baseline
pnpm ts-check
pnpm lint:build
pnpm test
$env:NODE_OPTIONS='--max-old-space-size=8192'; pnpm build
git diff --check
```

## 任务 7：记录、提交与云端真实验收

- [x] 更新 V5.8.8 吸收清单、Bug 登记、回归报告、发布准备报告和未验证项。
- [x] 创建本地机器可读证据，包含 base/head/tree、测试统计、构建、保护基线和 `stable` 哈希。
- [x] 原候选已只推送 `main` 并在 `318fe2d7` Coze 验证，`origin/stable` 未变化；2026-08-31 空数组补丁另行记录，不重复原候选流程。
- [x] 原候选 `318fe2d7` 已完成 Coze 拉取、单一 5000 重启和原 Google Chrome 标签强刷；新补丁仍需一次独立部署验收。
- [ ] 同一管理员会话验证：唯一裸键迁移、歧义拒绝、无效拒绝、普通用户模型可见、刷新/重启保持、Console 零新增错误。
- [ ] 不创建真实供应商任务，不扣费，不修改支付、积分和供应商配置。

完成标准：本地与云端证据均闭环后，才把 `V588-PROVIDER-002` 标记为已吸收。

## 2026-08-31：真实数据库双结构补证

- [x] 建立仅监听 `127.0.0.1:55439` 的全新临时 PostgreSQL 18.4 集群；不连接 Coze 数据库，不改现有数据库服务。
- [x] 执行此前 123 个环境跳过项，并新增 TEXT[] / JSONB 真库测试。全量 RED 为 `4408 passed / 1 failed / 0 skipped`；聚焦重复 RED 为 `18 passed / 1 failed`，同一失败均是 JSONB 空数组变为对象。
- [x] 只调整既有模型授权序列化尝试顺序，不修改 SQL、用户/密码 CAS 条件、登录流程、目录授权语义或账务。
- [x] 聚焦 8 文件 / 85 测试通过，管理员读投影专项 3 项通过；独立审查未发现 Critical / Important，两个 Minor 测试补证建议已补入。
- [x] 最终全仓 606 文件 / 4413 测试、0 跳过；静态检查、构建 118/118、干净保护基线 38/38 通过。临时数据库停止、测试 schema 剩余 0。源码提交 `bd9655b88ec037a0ebb6891addaba19a8280240f`；证据 `docs/testing/evidence/v588-admin-provider-postgres-20260831.json`。
- [ ] 新补丁 Coze 验收；普通用户三个工作区可见性继续未验证，不得用本地结果代替。只进行下一次必要的 main 更新，不重复旧候选验证或本轮数据库门禁。

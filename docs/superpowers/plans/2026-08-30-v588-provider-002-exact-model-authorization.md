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
- [x] 原候选 `318fe2d7` 已完成 Coze 拉取、单一 5000 重启和原 Google Chrome 标签强刷；新补丁已在 `f91ada6b` 完成构建重启与两次强刷，不重复部署。
- [x] 管理员有效精确授权保存、关闭重开保持、恢复“不限”：`318fe2d7` 真实 UI 和 POST 证据已取得。
- [ ] 管理员唯一裸键迁移：本地已有永久测试，尚未定位到云端真实请求与持久化复读证据，不能以有效精确键保存代替。
- [ ] 管理员歧义拒绝：本地已有 409/零写入测试，尚未定位到云端真实错误码、原值保持和无成功审计证据。
- [ ] 管理员无效授权拒绝：旧 `cdfb47a7` 曾真实返回 `400 MODEL_ASSIGNMENT_INVALID`；那次是停用项混入导致正常 UI 保存失败的 RED，不能替代修复后完整拒绝验收。
- [ ] 普通用户三个工作区目录、刷新/重启保持：需要真实普通用户登录状态，不能用管理员或模拟身份替代。
- [x] 到目前为止未为本项创建真实供应商任务或扣费，未修改支付、积分和供应商配置；后续仍维持此约束。

完成标准：本地与云端证据均闭环后，才把 `V588-PROVIDER-002` 标记为已吸收。

## 2026-08-31：真实数据库双结构补证

- [x] 建立仅监听 `127.0.0.1:55439` 的全新临时 PostgreSQL 18.4 集群；不连接 Coze 数据库，不改现有数据库服务。
- [x] 执行此前 123 个环境跳过项，并新增 TEXT[] / JSONB 真库测试。全量 RED 为 `4408 passed / 1 failed / 0 skipped`；聚焦重复 RED 为 `18 passed / 1 failed`，同一失败均是 JSONB 空数组变为对象。
- [x] 只调整既有模型授权序列化尝试顺序，不修改 SQL、用户/密码 CAS 条件、登录流程、目录授权语义或账务。
- [x] 聚焦 8 文件 / 85 测试通过，管理员读投影专项 3 项通过；独立审查未发现 Critical / Important，两个 Minor 测试补证建议已补入。
- [x] 最终全仓 606 文件 / 4413 测试、0 跳过；静态检查、构建 118/118、干净保护基线 38/38 通过。临时数据库停止、测试 schema 剩余 0。源码提交 `bd9655b88ec037a0ebb6891addaba19a8280240f`；证据 `docs/testing/evidence/v588-admin-provider-postgres-20260831.json`。
- [x] 新补丁 `main@f91ada6b` 已构建重启并强刷，管理员会话和只读投影正常。记录：`docs/testing/evidence/v588-f91ada6b-coze-sync-20260831.json`；不重复此部署与本轮数据库门禁。
- [ ] 普通用户三个工作区可见性继续未验证，不得用本地结果代替。

## 2026-08-31 验收范围复核

本节是已批准规格的追溯核对，不是新功能或追加改造。此前“只剩普通用户目录”的摘要过窄，以上三类管理员边界云端证据同样保持开放；本地全量通过不替代真实请求、业务拒绝和原值不变。

| 工作区 | 当前真实代码入口 | 必须核对的集合 | 当前证据等级 |
|---|---|---|---|
| 无限画布图像生成 | `generation-panel.tsx:353` -> `useTaskModelCatalog('image')` -> `/api/models?type=image` | 已授权图像模型的 `providerId::modelId`、供应商显示名、选定值与刷新后值 | 静态接线已核对；普通用户当前云端 UI 未验证 |
| 节点模式 | `canvas-workspace.tsx:483` -> `useTaskModelCatalog('all')` -> 传入 `NodeEditor` 的 `taskModelOptions`；`node-editor.tsx:1431` 分出图像/聊天选项 | 同一个精确键集合按模型实际类型筛选，不把 `/api/workflow/models` HTTP 200 当成节点 UI 已消费 | 静态接线已核对；普通用户当前云端 UI 未验证 |
| 独立智能对话 | `simple-chat/chat-area.tsx:515` 与 `:604` 分别加载 `/api/models?type=chat`、`type=image` | 两个模型菜单独立验证精确键与供应商，不能只检查聊天菜单或画布聊天窗口 | 静态接线已核对；普通用户当前云端 UI 未验证 |

服务端 `src/lib/task-core/model-catalog.ts` 的普通用户路径先检查状态和功能权限，再应用图像/聊天授权。空模型数组“不限”不等于忽略功能权限，也不要求普通用户目录无条件等于管理员所有类型目录。当前 Chrome 仍为管理员，未通过代登录、令牌替换或密码重置绕过此缺口。

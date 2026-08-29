# V588-STABILITY-002 完成态父任务恢复报告

## RED

按测试先行新增最小回归契约后，依次运行：

```text
pnpm vitest run src/__tests__/lib/element-decomposition-idempotency.test.ts
pnpm vitest run src/__tests__/api/element-decompose.test.ts
pnpm vitest run src/__tests__/lib/element-decomposition-client.test.ts
pnpm vitest run src/__tests__/components/element-decomposition-ui.test.ts
```

预期失败已确认：

- service：3 项失败。新父任务没有顶层 `projectId`；`findLatestElementDecompositionForProject` 尚不存在。
- API：2 项失败。`GET ?projectId=` 返回 400，`taskId` 与 `projectId` 同时传入仍返回 200。
- client：2 项失败。`recoverElementDecomposition` 尚不存在。
- Canvas：1 项失败。没有懒恢复引用、只读调用和项目/请求代次竞态保护。

## 改动文件

- `src/lib/element-decomposition/service.ts`
- `src/app/api/element-decompose/route.ts`
- `src/lib/element-decomposition/client.ts`
- `src/components/infinite-canvas.tsx`
- `src/__tests__/lib/element-decomposition-idempotency.test.ts`
- `src/__tests__/api/element-decompose.test.ts`
- `src/__tests__/lib/element-decomposition-client.test.ts`
- `src/__tests__/components/element-decomposition-ui.test.ts`
- `.superpowers/sdd/task-v588-stability-002-completed-task-hydration-report.md`

生产修改保持在最小边界：新父任务写入 `projectId`；service 通过当前用户的只读任务列表恢复最新匹配父任务，并兼容 `project_id` 为空但 `result.request.projectId` 匹配的旧记录；API 增加认证后的 `projectId` GET 分支；client 增加单次 GET helper；Canvas 仅在面板打开且当前无任务时恢复，并使用项目 ID、请求代次及 AbortController 防止旧响应污染新项目。

## GREEN 与验证

最小 GREEN：

```text
pnpm vitest run src/__tests__/lib/element-decomposition-idempotency.test.ts src/__tests__/api/element-decompose.test.ts src/__tests__/lib/element-decomposition-client.test.ts src/__tests__/components/element-decomposition-ui.test.ts
```

结果：4 个文件、68 项测试全部通过。

规格聚焦套件：

```text
pnpm vitest run src/__tests__/lib/element-decomposition-client.test.ts src/__tests__/api/element-decompose.test.ts src/__tests__/lib/element-decomposition-idempotency.test.ts src/__tests__/lib/element-decomposition-source.test.ts src/__tests__/lib/element-decomposition-partial-result.test.ts src/__tests__/components/element-decomposition-ui.test.ts src/__tests__/components/layer-editing-e2e-contract.test.ts src/__tests__/api/layer-documents.test.ts src/__tests__/lib/layer-document-client.test.ts src/__tests__/lib/layer-document-storage.test.ts src/__tests__/lib/layer-document-validation.test.ts
```

结果：11 个文件、123 项测试全部通过。

其他验证：

- `pnpm ts-check`：退出 0。
- 改动文件 `pnpm exec eslint ...`：退出 0，0 error；`infinite-canvas.tsx` 报告 18 条既有 warning，本次新增代码没有对应新 warning。
- `git diff --check`：退出 0。
- 未执行浏览器云端操作，未创建供应商任务，未触发扣费、退款、retry 或 poll。

## 自审

- 用户隔离：service 查询显式传入认证 `userId`，测试覆盖其他用户的更新任务不会被返回。
- 项目隔离：优先使用顶层 `projectId`；仅当其为空时才读取旧记录的 `result.request.projectId`，测试覆盖跨项目与旧记录。
- 类型和新旧顺序：只接受 `element-decompose-parent`，依赖 `listCloudTasks` 的 `updated_at DESC` 顺序取第一条匹配记录。
- 只读性：恢复函数不调用子任务状态、provider、POST、poll、retry 或 `updateCloudTask`；测试显式断言这些调用未发生。
- 前端竞态：关闭面板会作废请求代次，项目切换会清理旧项目卡片；响应写入前同时校验请求代次和当前项目。
- 完成态复用：恢复后仍使用持久化父 `taskId`、冻结 source 和 branches；“打开编辑器”继续走原有 payload，不重新分层。
- 禁区检查：未修改 `stable`、donor、账务状态机或 Pear 质量门禁。

## 风险

- （复审前风险，已由下方复审修复消除）原实现受 `listCloudTasks` 最新 500 条窗口限制；现已改为数据库精确过滤并 `LIMIT 1`。
- 未进行会创建付费任务的云端端到端验证；云端验证应仅使用已有历史任务执行刷新恢复与“打开编辑器”点击。

## 复审修复（2026-08-30）

### RED

先只新增复审 findings 对应测试，再依次运行：

```text
pnpm vitest run src/__tests__/components/element-decomposition-ui.test.ts
pnpm vitest run src/__tests__/lib/element-decomposition-idempotency.test.ts
pnpm vitest run src/__tests__/lib/cloud-task-storage.test.ts
```

预期失败已确认：

- Canvas：16 项中 3 项失败。缺少恢复 AbortController ref；新提交未先作废/abort 恢复；项目切换与卸载没有统一 abort submit/poll 和恢复请求；异步提交回调缺少 abort/项目写入保护。
- service：24 项中 1 项失败。恢复仍调用 `listCloudTasks({ userId, limit: 500 })`，未调用精确存储 helper。
- storage：49 项中 2 项失败。精确查询 helper 不存在；通用 `listCloudTasks` 仅按 `updated_at DESC` 排序。

### 最小修复

- Canvas 增加恢复 controller ref 和统一 `abortElementDecomposeRequests`；新提交开始前递增恢复 `requestId`、清恢复项目并 abort 恢复 GET。
- 项目切换和 InfiniteCanvas 卸载同时 abort 恢复 controller 与 submit/poll controller；submit/poll 每个异步边界后检查 signal 和当前项目，旧回调不能写卡片、消费结果或打开编辑器。
- 存储层新增 `getLatestElementDecomposeParentForProject(userId, projectId)`，SQL 在数据库内精确限制用户、父任务类型和新/旧项目绑定，稳定排序后 `LIMIT 1`。
- service 只调用精确 helper，不再获取 500 条任务后内存过滤。
- 精确查询和通用 `listCloudTasks` 均使用 `updated_at DESC, created_at DESC, id DESC` 稳定排序。

### GREEN

```text
pnpm vitest run src/__tests__/components/element-decomposition-ui.test.ts src/__tests__/lib/element-decomposition-idempotency.test.ts src/__tests__/lib/cloud-task-storage.test.ts
```

结果：3 个文件、89 项测试全部通过。

`pnpm ts-check` 退出 0。最终聚焦套件、改动文件 ESLint 和 `git diff --check` 结果见本次提交前验证；未发起任何网络付费任务。

最终聚焦验证命令：

```text
pnpm vitest run src/__tests__/lib/element-decomposition-client.test.ts src/__tests__/api/element-decompose.test.ts src/__tests__/lib/element-decomposition-idempotency.test.ts src/__tests__/lib/element-decomposition-source.test.ts src/__tests__/lib/element-decomposition-partial-result.test.ts src/__tests__/components/element-decomposition-ui.test.ts src/__tests__/components/layer-editing-e2e-contract.test.ts src/__tests__/api/layer-documents.test.ts src/__tests__/lib/layer-document-client.test.ts src/__tests__/lib/layer-document-storage.test.ts src/__tests__/lib/layer-document-validation.test.ts src/__tests__/lib/cloud-task-storage.test.ts
```

结果：12 个文件、175 项测试全部通过。改动文件 ESLint 退出 0、0 error（`infinite-canvas.tsx` 保留 18 条既有 warning）；`git diff --check` 退出 0。

### 复审自查

- Important 1：新提交使旧恢复代次失效并主动 abort，恢复响应无法覆盖活动提交。
- Important 2：项目切换和卸载形成网络生命周期闭环；即使不依赖 `CanvasWorkspace` 的 project key，旧请求也会被取消，旧回调不能打开编辑器。
- Important 3：查询由数据库完成过滤与 `LIMIT 1`，500 条扫描风险已消除。
- Minor：精确查询和通用列表均有稳定排序测试。
- 边界保持不变：未修改 stable、donor、Pear 质量门禁或账务状态机，未调用付费供应商。

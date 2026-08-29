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

- 现有 `listCloudTasks` 单次查询上限为 500，因此恢复在当前用户最新 500 条任务内查找。该限制来自既有只读存储 API；本任务没有扩大通用存储接口或引入新查询路径。
- 未进行会创建付费任务的云端端到端验证；云端验证应仅使用已有历史任务执行刷新恢复与“打开编辑器”点击。

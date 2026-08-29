# PSD 图层文档持久化实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 PSD 图层移动、显隐、锁定、重命名、顺序和导出模式按用户、项目、源图版本与分层任务持久化，并以 revision 乐观锁安全恢复。

**Architecture:** 新增独立 `wujie_layer_documents` 表及小型存储模块，API 层复用项目图片来源验证和云任务终态验证；编辑器通过独立客户端恢复、创建、保存和冲突处理。旧的 `imageUrl + initialResult` 调用保持兼容，缺少完整来源时仅临时编辑。

**Tech Stack:** Next.js 16 App Router、React 19、TypeScript、PostgreSQL、Vitest、Playwright。

## Global Constraints

- V5.8.8 donor 只读，`stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` 永久不动，只向 `main` 提交。
- 不修改 Pear/local/smart 分层算法、质量阈值、账务状态机或 `cloud_tasks.result`。
- JSON 请求体上限 60 KiB（适配浏览器 keepalive 安全预算）、最多 64 层、名称 128 字符、ID 256 字符；拒绝 data/blob/任意外部 URL 和非有限坐标。
- 数据库失败必须显式失败；revision 冲突返回 409，禁止最后写入覆盖。
- 所有生产行为遵循 RED -> 最小实现 -> GREEN -> 扩展回归。

---

### Task 1: 文档 schema 与规范化

**Files:**
- Create: `src/lib/layer-documents/types.ts`
- Create: `src/lib/layer-documents/validation.ts`
- Test: `src/__tests__/lib/layer-document-validation.test.ts`

**Interfaces:**
- Produces: `LayerDocumentSource`、`LayerDocumentContent`、`LayerDocumentRecord`、`LayerDocumentError`、`readLayerDocumentContent()`。

- [x] **Step 1: 写入失败测试**，覆盖 64 层、字符串、URL、有限数值、顺序唯一性、60 KiB 请求体和 schema version 1。
- [x] **Step 2: 运行 RED**：`pnpm exec vitest run src/__tests__/lib/layer-document-validation.test.ts`，预期因模块缺失失败。
- [x] **Step 3: 最小实现**：只接受受管 `/api/serve-upload/`、`/uploads/`、`/api/media/` 等现有媒体引用，并输出规范化完整文档。
- [x] **Step 4: 运行 GREEN**：同一命令全部通过。
- [x] **Step 5: 提交**：`ca6858f6 feat: validate layer documents`。

### Task 2: PostgreSQL 独立存储与乐观锁

**Files:**
- Create: `src/lib/layer-documents/storage.ts`
- Test: `src/__tests__/lib/layer-document-storage.test.ts`
- Test: `src/__tests__/lib/layer-document-postgres.test.ts`

**Interfaces:**
- Consumes: Task 1 types。
- Produces: `ensureLayerDocumentTables()`、`createLayerDocument()`、`findLatestLayerDocument()`、`updateLayerDocument()`、`deleteLayerDocumentsForProject()`。

- [x] **Step 1: 写入失败测试**，断言表/索引/唯一键 SQL、同 task 幂等、用户隔离与 revision 条件更新。
- [x] **Step 2: 运行 RED**，预期存储模块缺失。
- [x] **Step 3: 最小实现**：独立幂等建表；创建使用 `(user_id, task_id)` 唯一键；PATCH 使用 `WHERE id=$1 AND user_id=$2 AND revision=$3 RETURNING *`。
- [x] **Step 4: 在隔离 PostgreSQL 18 中并发 PATCH**，已证明一个成功、一个 `LAYER_DOCUMENT_REVISION_CONFLICT`。
- [x] **Step 5: 运行 GREEN 并提交**：`f8c9bf44 feat: persist layer documents`。

### Task 3: 鉴权 API、来源与任务验证

**Files:**
- Create: `src/app/api/layer-documents/route.ts`
- Create: `src/lib/layer-documents/service.ts`
- Test: `src/__tests__/api/layer-documents.test.ts`

**Interfaces:**
- Consumes: `findOwnedAnnotationSource()`、`getCloudTaskForUser()`、Task 1/2 API。
- Produces: GET/POST/PATCH `/api/layer-documents`，统一 `{success,code,message,requestId,retryable}` 错误结构。

- [x] **Step 1: 写入失败 API 测试**，覆盖未登录、跨用户/项目、旧版本、伪造/非终态 task、404、幂等 POST、409 PATCH 和数据库失败。
- [x] **Step 2: 运行 RED**，预期路由不存在。
- [x] **Step 3: 最小实现**：严格匹配项目、图片、版本、URL；只接受已完成 `layer-decomposition` 或元素拆解图层分支任务；管理员也按自身 userId 隔离。
- [x] **Step 4: 运行 GREEN 与相关鉴权/任务回归**。
- [x] **Step 5: 提交**：`5dfa1f0c feat: add layer document api`。

### Task 4: 编辑器恢复、保存、冲突与关闭 flush

**Files:**
- Create: `src/lib/layer-documents/client.ts`
- Modify: `src/components/psd-editor/PsdLayerEditor.tsx`
- Modify: `src/components/infinite-canvas.tsx`
- Test: `src/__tests__/components/psd-layer-document-persistence.test.tsx`
- Test: `src/__tests__/components/layer-editing-e2e-contract.test.ts`

**Interfaces:**
- `PsdLayerEditor` 新增可选 `source: LayerDocumentSource`；无 source 时继续临时编辑。
- 客户端提供 `loadLayerDocument/createLayerDocument/saveLayerDocument`。

- [x] **Step 1: 写入失败组件测试**，覆盖恢复、dirty、保存中再编辑、保存/创建失败、关闭守卫、导出最终快照、409 显式选择、来源切换和卸载 keepalive。
- [x] **Step 2: 运行 RED**，确认旧实现存在导出旧快照、外部卸载和创建失败丢失边界。
- [x] **Step 3: 最小实现**：串行追赶新编辑；关闭、visibilitychange、beforeunload 和导出前显式 flush；失败保留本地状态，409 停止自动覆盖；所有写请求使用 keepalive。
- [x] **Step 4: `InfiniteCanvas` 使用冻结的项目、图片 ID、sourceVersionId、canonical URL 和 taskId 构造 source；不向大型项目 JSON 写图层内容。
- [x] **Step 5: 运行 GREEN、PSD 导出与取消回归**，提交 `68242e43 feat: restore durable layer editing`。

### Task 5: 全量门禁、文档与云端验收

**Files:**
- Modify: `docs/plans/v588/V588_ABSORPTION_INVENTORY.md`
- Modify: `docs/testing/BUG_REGISTER.md`
- Modify: `docs/testing/REGRESSION_REPORT.md`
- Modify: `docs/testing/RELEASE_READINESS_REPORT.md`
- Modify: `docs/testing/UNVERIFIED_ITEMS.md`

- [x] **Step 1: 运行 focused Vitest 和隔离 PostgreSQL 并发套件**，失败不得跳过。
- [x] **Step 2: 运行完整门禁**：`pnpm ts-check`、`pnpm lint:build`、`pnpm lint`、带隔离 PostgreSQL 的 `pnpm test`、8 GiB `pnpm build` 和保护基线干净候选门禁。
- [x] **Step 3: 更新中文报告和 Obsidian 看板**，逐项记录已通过与未验证边界。
- [ ] **Step 4: 仅推送 `main`**，核对 `stable` 未变。
- [ ] **Step 5: 执行 Coze 与 Chrome 验收**：exact-SHA 后复用现有 Google Chrome 标签验证创建、移动、显隐、锁定、重命名、排序、刷新恢复、冲突和导出 `8BPS`；不新建标签。

# V588 Yjs 多人画布文档协作实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付有独立编辑授权、可恢复持久化和真实多实例收敛的 Yjs 画布协作，同时保留既有项目、资产版本、任务与积分权威。

**Architecture:** 协作项目以 Yjs 文档管理可编辑画布状态，PostgreSQL 更新日志和物化投影为持久权威；资产图继续管理媒体/版本。现有同源 Node 入口增加精确文档升级分流，编辑权限、票据与 presence 权限分开；未开启项目仍运行旧保存路径。

**Tech Stack:** Next.js 16.2.11、React 19、TypeScript、稳定 Yjs v13、`ws`、PostgreSQL 18、Vitest、Playwright。

**Spec:** `docs/superpowers/specs/2026-09-25-v588-yjs-canvas-collaboration-design.md`

## Global Constraints

- 只修改本地 `main`；六份用户 `.superpowers/sdd` 修改不能暂存、覆盖或删除；`stable` 与 V5.8.8 donor 只读。
- `WUJIE_YJS_ENABLED` 默认关闭，且 `WUJIE_PRESENCE_ENABLED` 的现有在线资格绝不自动授予编辑权。
- 已关闭的只读分享、WebSocket 在线状态、Stage 2/3/4、21 个 Skills 等不重做。
- 不把 `data:`/`blob:` URL、二进制媒体、API Key、账本或任务占位框写入 Yjs 文档；跨项目资产引用拒绝。
- 每个实现任务先 RED、后最小 GREEN；真库只用全新 localhost PostgreSQL；先本地全量回归，再按 exact-main 做 Chrome/Coze 验证。
- 全站严格 NFT 审计当前仍红；门禁未绿前不推送、同步 Coze、部署或宣称云端阶段通过。未真实验证的结果写 `UNVERIFIED`。

## 文件职责图

| 文件 | 职责 |
| --- | --- |
| `src/lib/collaboration/canvas-document.ts` | 可协作字段白名单、Yjs 文档读写和物化投影，不含数据库/网络 |
| `migrations/20260925_yjs_canvas_editors.sql` | 项目编辑授权与 per-project 启用状态 |
| `migrations/20260925_yjs_canvas_asset_adoptions.sql` | 编辑者成品采纳幂等记录 |
| `migrations/20260925_yjs_canvas_documents.sql` | 协作文档快照、物化投影和更新日志 |
| `migrations/20260925_yjs_canvas_tickets.sql` | 独立文档一次性票据 |
| `src/lib/collaboration/document-access.ts` | owner/editor 资格和启用条件，不复用 presence 资格 |
| `src/lib/collaboration/document-tickets.ts` | 独立短时票据签发/消费 |
| `src/lib/collaboration/document-store.ts` | 快照、更新序号、提交前验证、压缩和实例补读 |
| `src/lib/collaboration/document-gateway.ts` | 精确 WebSocket 文档协议与资源预算 |
| `src/lib/collaboration/document-project-bridge.ts` | 旧项目启用迁移、资产图投影和旧自动保存写入围栏 |
| `src/lib/collaboration/document-client.ts` | 浏览器 Y.Doc、同源票据连接、重连/确认/项目切换 |
| `src/components/collaboration/document-status.tsx` | 同步状态与编辑权限 UI |
| `src/lib/collaboration/document-assets.ts` | 已就绪项目媒体引用及编辑者任务成品采纳 |
| `src/lib/asset-core/collaboration-adoption.ts` | 在既有资产图内原子建立项目版本和父系，不改任务/账本归属 |

---

### Task 1：Yjs 文档合同与依赖

**Files:** Create `src/lib/collaboration/canvas-document.ts`; create `src/__tests__/lib/canvas-document.test.ts`; modify `package.json`, `pnpm-lock.yaml`。

**Interfaces:** `createCanvasDocument(): Y.Doc`；`applyCanvasImagePatch(doc, patch: CanvasImagePatch, origin: unknown): void`；`readCanvasDocument(doc): CanvasDocumentProjection`；`validateCanvasDocumentProjection(value): CanvasDocumentProjection`。`CanvasImagePatch` 使用稳定 `placementId`，只含有限数值变换、分组/标注和项目内 `assetVersionId`；不含媒体字节或来源 URL。

- [ ] **Step 1：写 RED。** 使用两个真实 `Y.Doc`，分别更改不同 placement；更新反序/重复应用后两个投影相等。拒绝 `data:`、跨域 URL、非有限坐标、未定义字段和 processing 占位。测试关键断言如下：

```ts
const first = createCanvasDocument();
applyCanvasImagePatch(first, { placementId: 'p1', x: 10, y: 20, width: 80, height: 60 }, 'local');
const update = Y.encodeStateAsUpdate(first);
const second = createCanvasDocument();
Y.applyUpdate(second, update);
expect(readCanvasDocument(second).placements.p1.x).toBe(10);
expect(() => validateCanvasDocumentProjection({ placements: { p1: { x: Infinity } } })).toThrow();
```

- [ ] **Step 2：运行 RED。** `pnpm exec vitest run src/__tests__/lib/canvas-document.test.ts --reporter=dot`；应因缺少文档合同而失败，不是环境错误。
- [ ] **Step 3：最小 GREEN。** 安装稳定 `yjs@^13`；用 `Y.Map` 按 `placementId` 存白名单记录，同一 placement 的 transform 作为整体字段更新。白名单 schema 在读/写两侧共用，限制图层数量、文本长度与数值范围。
- [ ] **Step 4：聚焦验证与提交。** 重跑上项、`pnpm ts-check`、`pnpm lint:build`；只提交这四个文件。真实资产归属留给 Task 3，不把客户端白名单当成授权。

### Task 2：独立项目编辑授权与启用前置

**Files:** Create `migrations/20260925_yjs_canvas_editors.sql`、`src/lib/collaboration/document-access.ts`、`src/app/api/collaboration/editors/route.ts`、`src/__tests__/api/collaboration-editors.test.ts`、`tests/integration/document-access-postgres.test.ts`。

**Interfaces:** `assertDocumentEditor(actorUserId, projectId, client?): Promise<{ ownerId: string }>`；`grantDocumentEditor(ownerId, projectId, memberId): Promise<void>`；`revokeDocumentEditor(...): Promise<void>`。独立 `wujie_project_document_editors`，owner 隐式 editor，presence member 不自动通过。

- [ ] **Step 1：写 RED。** 独立真库验证 owner、被邀请 editor、仅 presence member、同名异用户、禁用用户、归档项目、跨项目、撤销后立即拒绝；API 要求登录、同源和 owner。

```ts
await grantPresenceMember(ownerId, projectId, presenceOnlyId);
await expect(assertDocumentEditor(presenceOnlyId, projectId))
  .rejects.toMatchObject({ code: 'DOCUMENT_FORBIDDEN' });
await grantDocumentEditor(ownerId, projectId, editorId);
await expect(assertDocumentEditor(editorId, projectId)).resolves.toMatchObject({ ownerId });
```

- [ ] **Step 2：运行 RED。** 显式将 `DATABASE_URL`、`PGDATABASE_URL`、`POSTGRES_TEST_DATABASE_URL`、`TEST_POSTGRES_URL` 都指向本次新建的 localhost 测试库；运行上述两份测试。
- [ ] **Step 3：最小 GREEN。** 迁移建项目/owner/member 唯一授权表，所有状态变化以服务端 ID 和项目所有权校验；撤销事务通知在线网关并使旧票据失效。项目启用状态独立字段，不改 presence 表语义。
- [ ] **Step 4：复验并提交。** 迁移首次应用和二次跳过、相关 API/真库测试、`pnpm validate`；只提交本任务文件。

### Task 3：项目资产引用校验与编辑者成品采纳

**Files:** Create `migrations/20260925_yjs_canvas_asset_adoptions.sql`、`src/lib/collaboration/document-assets.ts`、`src/lib/asset-core/collaboration-adoption.ts`、`src/__tests__/lib/document-assets.test.ts`、`tests/integration/document-assets-postgres.test.ts`。

**Interfaces:** `assertProjectAssetVersion(ownerId, projectId, versionId, client): Promise<void>`；`adoptCompletedResultIntoProject({ actorId, ownerId, projectId, taskId, sourceVersionId, idempotencyKey }): Promise<{ assetVersionId; placementId }>`。

- [ ] **Step 1：写 RED。** 已就绪同项目版本通过；他人/跨项目/trashed/未完成版本拒绝；编辑者任务只在 `completed` 且媒体可用时被采纳；重放幂等；原任务扣费与 owner 不变；原图和原版本不覆盖。

```ts
await expect(assertProjectAssetVersion(ownerId, projectId, foreignVersionId, client))
  .rejects.toMatchObject({ code: 'DOCUMENT_ASSET_FORBIDDEN' });
const first = await adoptCompletedResultIntoProject(input);
expect(await adoptCompletedResultIntoProject(input)).toEqual(first);
```

- [ ] **Step 2：运行 RED。** 独立真库跑本任务两份测试，记录实际失败分支。
- [ ] **Step 3：最小 GREEN。** 对原任务及版本精确加锁，校验 actor 和项目 editor；为项目创建独立资产/版本及父系引用，媒体校验先于项目采纳提交；用 actor+项目+task+sourceVersion 作为幂等域，不复制或重记积分流水。
- [ ] **Step 4：复验并提交。** 真库并发 20 路重放、一份资产投影、零额外扣费；相关既有任务/资产回归、类型/Lint 后只提交目标文件。

### Task 4：持久 Yjs 更新、物化投影与多实例补读

**Files:** Create `migrations/20260925_yjs_canvas_documents.sql`、`src/lib/collaboration/document-store.ts`、`src/__tests__/lib/document-store.test.ts`、`tests/integration/document-store-postgres.test.ts`。已应用的 Task 2/3 迁移不可回写，迁移 checksum 必须稳定。

**Interfaces:** `loadDocument(projectId): Promise<{ doc: Y.Doc; sequence: number }>`；`commitDocumentUpdate({ actorId, projectId, bytes }): Promise<{ sequence: number; update: Uint8Array }>`；`readDocumentUpdatesAfter(projectId, sequence)`；`compactDocument(projectId)`。

- [ ] **Step 1：写 RED。** 更新确认后重建进程仍存在，重复更新幂等，两个实例反序提交收敛；通知丢失按序号补读；错误素材、超大更新或错误投影不写日志/投影；压缩前后状态向量相等。

```ts
const ack = await commitDocumentUpdate({ actorId, projectId, bytes: validUpdate });
expect(ack.sequence).toBe(1);
expect(readCanvasDocument((await loadDocument(projectId)).doc)).toEqual(expectedProjection);
```

- [ ] **Step 2：运行 RED。** 新库迁移后跑单元/集成测试，确认缺少 store 导致失败。
- [ ] **Step 3：最小 GREEN。** 项目事务锁下从快照+日志构造临时 `Y.Doc`，应用更新、验证白名单与 Task 3 资产归属，原子追加 BYTEA 更新/序号/JSONB 投影；`pg_notify` 仅发送项目与序号。提交后才广播；定期压缩保留有界恢复日志。
- [ ] **Step 4：复验并提交。** 断开 LISTEN、强制重建进程、迁移二次运行，跑聚焦和类型/Lint 后只提交目标文件。

### Task 5：独立票据、同源升级与文档 WebSocket 网关

**Files:** Create `migrations/20260925_yjs_canvas_tickets.sql`、`src/lib/collaboration/document-tickets.ts`、`src/lib/collaboration/document-gateway.ts`、`src/app/api/collaboration/document-ticket/route.ts`、对应 `src/__tests__/lib/` 与 `src/__tests__/api/` 测试；modify `scripts/presence-server.ts`、`src/__tests__/scripts/presence-server-contract.test.ts`；create `tests/integration/document-websocket-postgres.test.ts`。

**Interfaces:** `issueDocumentTicket(userId, projectId)`、`consumeDocumentTicket(raw)`；`handleDocumentUpgrade(request, socket, head)`。精确 `/api/collaboration/document`，子协议 `wujie-document-v1` 与一次性票据；只传有界状态向量/更新/确认帧。

- [ ] **Step 1：写 RED。** 无票据、重放、过期、跨源、仅 presence、撤销、二进制超限和慢客户端拒绝；合法双端更新在数据库确认后互达；普通 HTTP/静态资源及原 presence upgrade 仍可用。

```ts
const socket = await connectDocument({ ticket: await issueDocumentTicket(editorId, projectId) });
expect(socket.firstFrame.type).toBe('sync');
await expect(connectDocument({ ticket: socket.ticket })).rejects.toMatchObject({ status: 401 });
```

- [ ] **Step 2：运行 RED。** 独立 localhost PG+HTTP/ws 跑聚焦，确认失败发生在新文档路径。
- [ ] **Step 3：最小 GREEN。** 精确路由分流，不复用 presence ticket；升级前原子消费并复核 editor；每帧复核有效权限、字节/速率/连接上限；由 Task 4 store 确认后广播；其他实例按序号补读。
- [ ] **Step 4：复验并提交。** 真 socket、重连、两实例、原 HTTP/presence/匿名分享回归和 `pnpm validate`；只提交目标文件。

### Task 6：旧项目启用、权威切换及旧保存写入围栏

**Files:** Create `src/lib/collaboration/document-project-bridge.ts`、`src/app/api/collaboration/document-enable/route.ts`、`src/app/api/collaboration/document-project/route.ts`、相关单元/真库/API 测试；modify `src/lib/asset-core/canvas-project-sync.ts`、`src/lib/user-manager.ts` 中精确项目写入分支及对应既有测试。

**Interfaces:** `enableCollaborativeProject(ownerId, projectId, expectedRevision)`；`readCollaborativeProject(actorId, projectId)`；`assertLegacyCanvasWriteAllowed(projectId, expectedRevision)`。

- [ ] **Step 1：写 RED。** legacy/shadow 已就绪项目一次性种入，坏媒体/旧 revision 不启用；启用后 owner 旧快照写入返回冲突，editor 不写 owner 的 `wujie_user_data.projects`；非协作项目写入保持原行为；关闭开关后协作项目只读不可回退到旧双写。

```ts
await enableCollaborativeProject(ownerId, projectId, revision);
await expect(writeLegacyCanvasSnapshot(ownerId, projectId, oldImages))
  .rejects.toMatchObject({ code: 'DOCUMENT_AUTHORITY_CONFLICT' });
```

- [ ] **Step 2：运行 RED。** 聚焦加独立真库，确保失败不是迁移环境导致。
- [ ] **Step 3：最小 GREEN。** 事务中检查原项目 revision/媒体/资产映射，保留回滚快照、种 Yjs 文档与投影、标记 per-project 权威；旧同步写入在数据库侧按标志拒绝 `canvasImages` 覆盖，列举仍可读投影。失败完全回滚。
- [ ] **Step 4：复验并提交。** 旧项目两模式、asset-v3、账号隔离和现有 Canvas Share 回归；全量真库相关测试、`pnpm validate` 后只提交目标文件。

### Task 7：浏览器文档桥、画布编辑和局部撤销

**Files:** Create `src/lib/collaboration/document-client.ts`、`src/components/collaboration/document-status.tsx`、相关 client/component 测试；modify `src/components/canvas-workspace.tsx` 的项目加载、`setImages` 与保存切换点；modify `src/components/infinite-canvas.tsx` 仅需要的状态提示接口；create `tests/e2e/yjs-canvas-collaboration.spec.ts`。

**Interfaces:** `useCollaborativeCanvas(projectId, actorId)` 提供 `images`、`applyLocalChange`、`undoLocal`、`status`、`disconnect`；非协作项目仍用原 `CanvasPersistenceScheduler`。

- [ ] **Step 1：写 RED。** 双标签不同素材同时移动合并；同素材 transform 确定性收敛；远端更新不回声；本地 Ctrl+Z 不撤销别人改动；切项目、登出、禁用时 socket 和 Y.Doc 清理；断线待确认不显示“已保存”。

```ts
first.applyLocalChange({ placementId: 'p1', x: 100 });
second.applyLocalChange({ placementId: 'p2', x: 200 });
await waitForConvergence();
expect(first.images).toEqual(second.images);
```

- [ ] **Step 2：运行 RED。** client/component 聚焦及两浏览器真 socket E2E，记录缺失行为。
- [ ] **Step 3：最小 GREEN。** 画布入口只增加协作状态桥；owner/editor 对协作项目的变动走 Yjs，原项目保持原路径。仅持久 placement 字段入文档；远端应用带 origin 标记，旧调度器对协作项目彻底禁止写入。
- [ ] **Step 4：复验并提交。** 既有画布撤销、生成、图生图、项目刷新/切换回归；Chromium/Firefox/WebKit 与 320/375/393px 本地矩阵，`pnpm validate` 后只提交目标文件。

### Task 8：媒体命令、跨工作区视图与全局回归

**Files:** Create `src/app/api/collaboration/document-assets/route.ts`、`src/__tests__/api/collaboration-document-assets.test.ts`、`tests/integration/document-assets-command-postgres.test.ts`、`docs/testing/v588-yjs-collaboration-evidence.md`；modify `src/lib/collaboration/document-assets.ts`、`src/components/canvas-workspace.tsx` 的新增/删除接入点、`src/lib/simple-chat-workspace-handoff-server.ts` 的协作项目作用域读取；extend `src/__tests__/components/node-editor-asset-reference.test.ts` 与 `src/__tests__/api/simple-chat-workspace-handoff.test.ts`。

**Interfaces:** `POST /api/collaboration/document-assets` 接受 `attach|remove|replace` 命令及幂等键；返回项目资产版本和文档更新序号。节点/对话从协作物化投影读取，不获文档写权。

- [ ] **Step 1：写 RED。** editor 上传/生成结果附加只扣本人一次，跨项目结果拒绝；删除摆放不删除原媒体；节点与对话读到相同项目版本；旧分享快照仍不可写。

```ts
const result = await attachCompletedTaskResult({ actorId: editorId, projectId, taskId, idempotencyKey });
expect(result.documentSequence).toBeGreaterThan(0);
expect(await readProjectAssetVersion(projectId, result.assetVersionId)).toBeTruthy();
```

- [ ] **Step 2：运行 RED。** 项目作用域 API、真库和既有三工作区回归。
- [ ] **Step 3：最小 GREEN。** 将 Task 3 的已验版本采纳与 Task 4 文档更新合成受控命令；只在两者均提交后回复，失败不附加半个 placement；三工作区统一读物化投影。
- [ ] **Step 4：复验并提交。** 隔离真库 20 并发重放、原始素材 SHA/版本与账本不变、前端项目切换回归，更新中文证据后只提交目标文件。

### Task 9：阶段门禁与发布前移交

**Files:** Modify `docs/testing/baselines/protected-baseline-allowed-paths.json`（逐项授权精确路径）、`docs/testing/v588-yjs-collaboration-evidence.md`、Obsidian `11-阶段进度看板.md` 和 `16-V5.8.8选择性吸收.md`。

**Interfaces:** 产出本地/云端分层证据、精确构建身份、残余风险及下一阶段草图转代码交接；不自动宣布总体发布。

- [ ] **Step 1：保护基线 RED→GREEN。** `pnpm check:protected-baseline` 先记录阻断，再逐项授权，不加目录通配符。
- [ ] **Step 2：全量本地。** 新 localhost PG 完整迁移，`pnpm exec vitest run --reporter=dot --silent`、`pnpm validate`、`pnpm build`、`node scripts/audit-build-traces.mjs --strict`，逐项记录退出码、页数、测试数、构建树和警告；停止专用 PG。
- [ ] **Step 3：浏览器/云端。** 本地三浏览器两用户两项目矩阵后，仅在严格 NFT 与精确 `main` 身份门禁绿时进入 Coze 同源 `101`、双实例/重启和 Chrome 验收；任何未运行项目写 `UNVERIFIED`。
- [ ] **Step 4：阶段复审与中文留证。** 独立代码复审后只关闭有实际证据的 Yjs 子项；WebSocket 云端、真实付费取消唯一退款、CI、Pear、草图转代码与总体发布未过则继续保持开放，`stable` 不动。

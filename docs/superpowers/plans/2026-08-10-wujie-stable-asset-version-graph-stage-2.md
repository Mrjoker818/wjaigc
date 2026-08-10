# 无界素材与版本图 Stage 2 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不删除任何现有功能、不破坏旧项目的前提下，为无限画布、节点模式和独立智能对话建立统一的 `Asset`、不可变 `AssetVersion` 与 `WorkspacePlacement`，完成三工作区流转、来源追踪、回收站、孤儿媒体治理、空白图片框治理和旧项目渐进兼容。

**Architecture:** 保留现有 `Project.canvasImages`、工作流 JSON、聊天 JSON 与 URL 字段作为兼容投影，在 PostgreSQL 中新增可审计的素材图表和迁移账本。迁移按 `legacy -> shadow -> asset-v3` 三态推进：先只读旧数据并旁路写新表，完成一致性校验后才启用新读取器；回滚只切回 `legacy`，不删除新表或版本记录。

**Tech Stack:** Next.js 16、React 19、TypeScript 5、PostgreSQL、Vitest、Playwright、现有 `cloud_tasks`/任务核心、现有 `/api/save-image` 与三工作区组件。

## Global Constraints

- 实施基线固定为 `origin/main@ffe810939a446bbf7288d177b95040b36a05484c`；工作分支为 `codex/wj-stable-s2`，工作目录为 `.worktrees/wj-stable-s2`。
- `stable` 分支永久只读；最后一次已确认值为 `a53da24aa9f3813aae24f697dfb90d0b67f0a455`，网络恢复后每个推送检查点重新核对。
- 38 项受保护功能、7 个产品表面、无限画布/节点模式/独立智能对话三个工作区入口保留率必须为 100%。
- 本阶段不重构无限画布渲染/选择/历史内核，不重做节点编辑器或 Agent，不处理与本阶段无关的 P2。
- 旧项目只读打开不得触发破坏性重写；首次明确写操作才允许 copy-on-write，并且转换失败必须继续使用旧读取器。
- URL 继续作为渲染和供应商调用的兼容字段，但 URL 本身不能证明素材归属；所有新写接口按登录用户和目标项目双重授权。
- 删除工作区节点只删除/软删除 `WorkspacePlacement`；只有最后一个活动引用消失后 `Asset` 才进入回收站，保留期内不得删除物理文件。
- `failed`、`cancelled`、`timeout` 与迟到结果不得成为当前有效版本；只有数据库权威 `completed` 转换可投影新版本。
- 新版本父级顺序稳定；单图编辑一个父版本，多图融合/多参考图记录全部父版本。
- 开关固定为 `WUJIE_ASSET_GRAPH_MODE=legacy|shadow|asset-v3`。默认 `legacy`；云端先验证 `shadow`，一致性门禁通过后才允许 `asset-v3`。
- 无隔离 PostgreSQL、无可确认云端 Commit、无三浏览器证据时，对应结论只能标记 `BLOCKED` 或 `UNVERIFIED`。

## File Structure

- `src/lib/asset-core/types.ts`: 领域类型与状态常量，不访问数据库。
- `src/lib/asset-core/mode.ts`: 三态开关与读写策略。
- `src/lib/asset-core/storage.ts`: PostgreSQL 事务、所有权过滤、版本与放置查询。
- `src/lib/asset-core/service.ts`: 创建版本、跨工作区流转、删除/恢复/回收语义。
- `src/lib/asset-core/project-readers.ts`: v1/v2/v3 读取分发与无副作用兼容投影。
- `src/lib/asset-core/legacy-migration.ts`: copy-on-write 和可恢复批量迁移。
- `src/lib/asset-core/task-projector.ts`: 权威终态到素材版本的幂等投影。
- `src/lib/asset-core/media-health.ts`: 缺失媒体、恢复尝试与孤儿候选判定。
- `src/app/api/assets/**`: 登录用户素材、放置、流转、回收和恢复接口。
- `migrations/20260810_wj_stable_s2_assets.sql`: 只增不删的 Stage 2 架构。
- `scripts/run-migrations.mjs`: 带账本和校验和的显式迁移器。
- `tests/fixtures/projects/**`: 不含真实用户数据的小型旧项目夹具。

---

### Task 0: 固定可信基线与阶段账本

**Files:**
- Modify: `src/__tests__/api/poll-task-recovery-lease-contract.test.ts`
- Create: `.superpowers/sdd/progress.md`
- Modify: `docs/testing/REGRESSION_REPORT.md`
- Modify: `docs/testing/UNVERIFIED_ITEMS.md`

**Interfaces:**
- Produces: 可重复的 Stage 2 基线；静态契约使用空白无关的正则匹配，不依赖源码缩进。

- [ ] **Step 1: 保留已观察到的 RED 证据**

记录基线结果：`1 failed / 1806 passed / 8 skipped`，失败项为 `poll-task-recovery-lease-contract` 的固定缩进匹配；确认业务源码已有按顺序的 deadline、abort、timeout settlement 与 backoff。

- [ ] **Step 2: 使用语义正则修正契约测试**

```ts
const settlementMatch = source.slice(abort).match(
  /terminateCloudTaskAndRefund\(\s*recovery\.taskId,\s*'timeout'/,
);
const settlement = settlementMatch?.index === undefined
  ? -1
  : abort + settlementMatch.index;
```

- [ ] **Step 3: 运行聚焦测试并确认 GREEN**

Run: `pnpm exec vitest run src/__tests__/api/poll-task-recovery-lease-contract.test.ts`  
Expected: `1 passed, 13 tests passed`。

- [ ] **Step 4: 建立阶段进度账本**

`.superpowers/sdd/progress.md` 必须记录：Task、状态、RED 命令、GREEN 命令、评审结论、Commit、云端 SHA、未验证项。初始状态只把 Task 0 标为完成，Task 1 标为进行中。

- [ ] **Step 5: 重新运行全量基线并提交**

Run: `pnpm test`  
Expected: 除明确由环境变量门控的 PostgreSQL 测试外全部通过，无失败测试。

Commit: `test: stabilize stage two baseline contract`

### Task 1: 建立素材领域契约与可审计数据库迁移

**Files:**
- Create: `src/lib/asset-core/types.ts`
- Create: `src/lib/asset-core/mode.ts`
- Create: `migrations/20260810_wj_stable_s2_assets.sql`
- Create: `scripts/run-migrations.mjs`
- Modify: `package.json`
- Test: `src/__tests__/lib/asset-core-types.test.ts`
- Test: `tests/integration/stage-2-asset-schema-postgres.test.ts`

**Interfaces:**
- Produces: `AssetKind`, `AssetStatus`, `AssetVersion`, `WorkspacePlacement`, `MediaAvailability`, `AssetGraphMode`。
- Produces: `resolveAssetGraphMode(raw?: string): 'legacy' | 'shadow' | 'asset-v3'`。
- Produces: `pnpm migrate`，按迁移文件 SHA-256 写入 `wujie_schema_migrations(version, checksum, applied_at)`。

- [ ] **Step 1: 编写领域不变量失败测试**

```ts
expect(resolveAssetGraphMode(undefined)).toBe('legacy');
expect(resolveAssetGraphMode('shadow')).toBe('shadow');
expect(isTerminalMediaAvailability('missing')).toBe(false);
expect(assertWorkspaceEntityType('canvas-image')).toBe('canvas-image');
expect(() => assertWorkspaceEntityType('canvas-node')).toThrow();
```

- [ ] **Step 2: 编写 PostgreSQL 架构失败测试**

在隔离 schema 中运行迁移并断言：

```ts
expect(await tableExists('wujie_projects')).toBe(true);
expect(await tableExists('wujie_assets')).toBe(true);
expect(await tableExists('wujie_asset_versions')).toBe(true);
expect(await tableExists('wujie_asset_version_parents')).toBe(true);
expect(await tableExists('wujie_workspace_placements')).toBe(true);
expect(await tableExists('wujie_asset_migration_checkpoints')).toBe(true);
expect(await tableExists('wujie_media_gc_candidates')).toBe(true);
```

同时验证非法 kind/status、跨资产父版本、同 owner/project 重复幂等键和同迁移版本不同校验和均被数据库拒绝。

- [ ] **Step 3: 运行 RED**

Run: `pnpm exec vitest run src/__tests__/lib/asset-core-types.test.ts tests/integration/stage-2-asset-schema-postgres.test.ts`  
Expected: FAIL，模块和表尚不存在；无 `POSTGRES_TEST_DATABASE_URL` 时集成测试明确 skip，并在报告中登记阻塞。

- [ ] **Step 4: 实现领域类型**

```ts
export type AssetKind = 'image' | 'video' | 'model-3d' | 'psd' | 'svg' | 'document' | 'audio';
export type AssetStatus = 'active' | 'trashed';
export type MediaAvailability = 'ready' | 'pending-persist' | 'missing' | 'recovering' | 'unrecoverable';
export type WorkspaceKind = 'canvas' | 'workflow' | 'chat';
export type WorkspaceEntityType = 'canvas-image' | 'workflow-input' | 'workflow-output' | 'chat-attachment' | 'chat-result';
export type AssetGraphMode = 'legacy' | 'shadow' | 'asset-v3';
```

`AssetVersion.file` 增加 `availability` 与可选 `recoverySourceUrl`；放置包含独立 `status: 'active' | 'trashed'`、`entityId`、`deletedAt`，不把几何数据写回 Asset。

- [ ] **Step 5: 实现只增不删迁移与迁移账本**

迁移创建七张表、状态 CHECK、owner/project 查询索引、task/version 与 placement/workspace 索引。`wujie_assets.current_version_id` 初始可空，创建首版后再更新；数据库层禁止父版本跨 owner/project/asset 图。

- [ ] **Step 6: 运行 GREEN 与幂等复跑**

Run: `pnpm migrate && pnpm migrate && pnpm exec vitest run src/__tests__/lib/asset-core-types.test.ts tests/integration/stage-2-asset-schema-postgres.test.ts`  
Expected: 第二次迁移不重复建表，校验和相同，全部测试通过。

- [ ] **Step 7: 提交**

Commit: `feat: add asset graph schema and contracts`

### Task 2: 实现原子素材仓储、所有权与幂等流转

**Files:**
- Create: `src/lib/asset-core/storage.ts`
- Create: `src/lib/asset-core/service.ts`
- Test: `src/__tests__/lib/asset-service.test.ts`
- Test: `tests/integration/stage-2-asset-storage-postgres.test.ts`

**Interfaces:**
- Consumes: Task 1 的类型与表。
- Produces:

```ts
createAssetVersion(input: CreateAssetVersionInput): Promise<{ asset: Asset; version: AssetVersion; reused: boolean }>;
createWorkspacePlacement(input: CreatePlacementInput): Promise<{ placement: WorkspacePlacement; reused: boolean }>;
sendVersionToWorkspace(input: TransferVersionInput): Promise<{ version: AssetVersion; placement: WorkspacePlacement; reused: boolean }>;
trashPlacement(input: PlacementCommand): Promise<{ placementTrashed: boolean; assetTrashed: boolean }>;
restorePlacement(input: PlacementCommand): Promise<{ placement: WorkspacePlacement; asset: Asset }>;
```

- [ ] **Step 1: 编写纯服务 RED**

覆盖同键同摘要复用、同键不同摘要返回 `ASSET_IDEMPOTENCY_CONFLICT`、父级顺序保留、删除一个放置不删除共享素材、最后一个放置删除后素材进入回收站。

- [ ] **Step 2: 编写真实 PostgreSQL 并发 RED**

并发 20 次 `sendVersionToWorkspace()`，断言只产生一个目标 placement；跨用户 sourceVersion、跨用户 targetProject、伪造 ownerId、并发删除/恢复均被事务与 owner/project 条件约束正确处理。

- [ ] **Step 3: 运行 RED**

Run: `pnpm exec vitest run src/__tests__/lib/asset-service.test.ts tests/integration/stage-2-asset-storage-postgres.test.ts`  
Expected: FAIL，仓储和服务尚不存在。

- [ ] **Step 4: 实现数据库仓储**

所有写操作使用单一事务；用户 ID 只来自服务端会话调用者。查询条件至少包含 `owner_id=$1 AND project_id=$2`，找不到或不属于用户统一返回 not-found，避免 IDOR 枚举。

- [ ] **Step 5: 实现跨工作区幂等键**

```ts
type TransferVersionInput = {
  actorUserId: string;
  sourceVersionId: string;
  targetProjectId: string;
  targetWorkspaceId: string;
  entityType: WorkspaceEntityType;
  entityId: string;
  idempotencyKey: string;
  requestDigest: string;
  transform?: WorkspaceTransform;
  metadata?: Record<string, unknown>;
};
```

唯一性范围固定为 actor + sourceVersion + targetProject + targetWorkspace + entityType + entityId + idempotencyKey；同键不同摘要冲突。

- [ ] **Step 6: 运行 GREEN**

Run: `pnpm exec vitest run src/__tests__/lib/asset-service.test.ts tests/integration/stage-2-asset-storage-postgres.test.ts`  
Expected: unit 全绿；PostgreSQL 20 并发只创建一个 placement。

- [ ] **Step 7: 提交**

Commit: `feat: add transactional asset graph service`

### Task 3: 建立 v1/v2/v3 项目读取器与 copy-on-write 迁移

**Files:**
- Create: `src/lib/asset-core/project-readers.ts`
- Create: `src/lib/asset-core/legacy-migration.ts`
- Create: `tests/fixtures/projects/v1-images-alias.json`
- Create: `tests/fixtures/projects/v1-data-url.json`
- Create: `tests/fixtures/projects/v1-blob-url.json`
- Create: `tests/fixtures/projects/v1-source-url-recovery.json`
- Create: `tests/fixtures/projects/v1-video-3d-svg.json`
- Create: `tests/fixtures/projects/v1-processing-matrix.json`
- Create: `tests/fixtures/projects/v1-shared-placement.json`
- Create: `tests/fixtures/projects/v1-corrupt-project.json`
- Modify: `src/lib/user-types.ts`
- Test: `src/__tests__/lib/project-readers.test.ts`
- Test: `tests/integration/stage-2-legacy-migration-postgres.test.ts`

**Interfaces:**
- Produces:

```ts
readProjectSnapshot(raw: unknown): ProjectReadResult;
migrateLegacyProjectOnWrite(input: LegacyMigrationInput): Promise<MigrationResult>;
compareLegacyAndAssetProjection(input: ProjectionComparisonInput): ProjectionComparison;
```

`ProjectReadResult` 返回 `project`、`sourceSchemaVersion`、`writeTargetVersion: 3`、`warnings`、`unresolvedMedia`，且不得修改传入对象。

- [ ] **Step 1: 提交八个匿名小型夹具并写 RED**

测试 absent `schemaVersion` 走 v1；`images` 别名被投影但原始 JSON 字节不变；v2 走 transitional；v3 走 unified；损坏项目返回 quarantine warning 而非 `canvasImages: []`。

- [ ] **Step 2: 编写 copy-on-write RED**

断言只读打开不创建新表记录；第一次明确保存事务性创建 project/assets/versions/placements；任一媒体转换失败则不切换项目读取指针，并可再次用 v1 打开。

- [ ] **Step 3: 运行 RED**

Run: `pnpm exec vitest run src/__tests__/lib/project-readers.test.ts tests/integration/stage-2-legacy-migration-postgres.test.ts`  
Expected: FAIL，读取器和迁移器尚不存在。

- [ ] **Step 4: 实现无副作用读取器**

旧 `/uploads/` 仅在返回的 read model 中投影为 `/api/serve-upload/uploads/`；完整保留 `sourceUrl`、video/3D/SVG/PSD、处理占位符、注释与 group metadata。`data:` 为 `pending-persist`，失效 `blob:` 为 `missing`，不删除 placement。

- [ ] **Step 5: 实现可恢复迁移与 checkpoint**

迁移按 project 写 checkpoint，重复执行复用 legacy image ID 映射；不在迁移阶段下载远程 URL，不按 URL 相等合并素材。首次写成功后 `schemaVersion=3`，旧 payload 以只读审计字段保留。

- [ ] **Step 6: 运行 GREEN**

Run: `pnpm exec vitest run src/__tests__/lib/project-readers.test.ts tests/integration/stage-2-legacy-migration-postgres.test.ts`  
Expected: 八个夹具全部通过，迁移复跑不新增重复记录。

- [ ] **Step 7: 提交并形成云端检查点 A**

Run: `pnpm ts-check && pnpm lint:build && pnpm build`  
Expected: 全部通过。

Commit: `feat: add lossless legacy project readers`

Push 条件：Task 1-3、全量测试、登录保护、38 项保护门禁通过；Coze 仅以 `legacy` 或 `shadow` 启动，禁止直接 `asset-v3`。

### Task 4: 在画布边界接入 placement shadow 与显式坏图状态

**Files:**
- Create: `src/lib/asset-core/canvas-adapter.ts`
- Modify: `src/lib/user-manager.ts`
- Modify: `src/app/api/user-data/sync/route.ts`
- Modify: `src/components/canvas-workspace.tsx`
- Modify: `src/components/infinite-canvas.tsx`
- Modify: `src/lib/user-types.ts`
- Test: `src/__tests__/lib/canvas-asset-adapter.test.ts`
- Test: `src/__tests__/components/canvas-project-reopen-contract.test.ts`
- Test: `src/__tests__/components/project-autosave-wiring.test.ts`
- Test: `src/__tests__/components/canvas-broken-media-state.test.ts`

**Interfaces:**
- Consumes: `readProjectSnapshot`、`migrateLegacyProjectOnWrite`、Asset service。
- Produces: `hydrateCanvasPlacements()` 与 `serializeCanvasPlacements()`；现有 UI `CanvasImage` 新增可选 `assetId`、`assetVersionId`、`placementId`、`mediaAvailability`、`mediaErrorCode`。

- [ ] **Step 1: 编写 RED**

验证旧项目打开后的图片数量/坐标/尺寸不变，`sourceUrl` 在 open-save-reopen 后仍存在；坏 managed URL 显示 `missing` 而不是普通空白框；缺图 placement 在 autosave 后仍存在。

- [ ] **Step 2: 运行 RED**

Run: `pnpm exec vitest run src/__tests__/lib/canvas-asset-adapter.test.ts src/__tests__/components/canvas-broken-media-state.test.ts src/__tests__/components/canvas-project-reopen-contract.test.ts src/__tests__/components/project-autosave-wiring.test.ts`  
Expected: 当前映射缺少版本/放置字段并会丢失 sourceUrl，测试失败。

- [ ] **Step 3: 实现模式策略**

```ts
export function getAssetGraphReadStrategy(mode: AssetGraphMode) {
  return mode === 'asset-v3' ? 'asset-authoritative' : 'legacy-authoritative';
}
export function shouldWriteAssetShadow(mode: AssetGraphMode) {
  return mode === 'shadow' || mode === 'asset-v3';
}
```

`legacy` 行为保持不变；`shadow` 同时写旧 JSON 和新 placement；`asset-v3` 从 placement 读并继续写兼容 JSON。

- [ ] **Step 4: 在 CanvasWorkspace 边界接入适配器**

只修改 load/autosave/新增/删除边界，不进入 pan/zoom/selection/history。保存 geometry 到 placement，媒体与来源到 version，兼容字段继续写回 `canvasImages`。

- [ ] **Step 5: 实现坏图可见状态**

图片加载最终失败后写 `mediaAvailability='missing'` 和错误码；渲染保留固定尺寸占位、文件名/原因、重试和恢复按钮，不能渲染成透明空白，也不能由 autosave 当作删除。

- [ ] **Step 6: 运行 GREEN 与现有画布回归**

Run: `pnpm exec vitest run src/__tests__/lib/canvas-asset-adapter.test.ts src/__tests__/components/canvas-broken-media-state.test.ts src/__tests__/components/canvas-project-reopen-contract.test.ts src/__tests__/components/project-autosave-wiring.test.ts src/__tests__/components/canvas-image-drag-contract.test.ts src/__tests__/lib/canvas-incremental-history.test.ts`  
Expected: 新测试与拖动/历史保护测试全部通过。

- [ ] **Step 7: 提交**

Commit: `feat: shadow canvas assets and surface broken media`

### Task 5: 建立受权的素材 API 与画布/嵌入聊天/节点流转

**Files:**
- Create: `src/app/api/assets/route.ts`
- Create: `src/app/api/assets/transfer/route.ts`
- Create: `src/app/api/assets/placements/[placementId]/route.ts`
- Modify: `src/components/canvas-workspace.tsx`
- Modify: `src/components/chat-panel.tsx`
- Modify: `src/components/node-editor.tsx`
- Modify: `src/lib/workflow-engine.ts`
- Test: `src/__tests__/api/assets-ownership.test.ts`
- Test: `src/__tests__/api/workspace-transfer.test.ts`
- Test: `src/__tests__/components/canvas-chat-asset-transfer.test.ts`
- Test: `src/__tests__/components/node-editor-asset-reference.test.ts`
- Test: `src/__tests__/lib/workflow-engine.test.ts`

**Interfaces:**
- API request does not accept trusted owner ID；会话用户由 `getSessionUser()` 注入。
- Produces compatibility envelope:

```ts
type WorkspaceAssetReference = {
  assetId?: string;
  assetVersionId?: string;
  placementId?: string;
  url: string;
  name?: string;
};
```

- [ ] **Step 1: 编写 API 鉴权与幂等 RED**

覆盖未登录 401、他人版本/项目统一 404、同请求复用、不同摘要 409；断言响应仍含 `url`，旧客户端可渲染。

- [ ] **Step 2: 编写三条流转 RED**

验证 canvas -> embedded chat 产生 `chat-attachment` placement；canvas -> workflow 产生 `workflow-input`；workflow output -> canvas 使用同一 version 新建 canvas placement，不重新上传文件。

- [ ] **Step 3: 运行 RED**

Run: `pnpm exec vitest run src/__tests__/api/assets-ownership.test.ts src/__tests__/api/workspace-transfer.test.ts src/__tests__/components/canvas-chat-asset-transfer.test.ts src/__tests__/components/node-editor-asset-reference.test.ts src/__tests__/lib/workflow-engine.test.ts`  
Expected: 新路由和版本引用尚不存在。

- [ ] **Step 4: 实现 API**

`POST /api/assets/transfer` 只接受 sourceVersion、targetProject、targetWorkspace、entityType/entityId、idempotencyKey、transform/metadata；服务端生成 request digest 并执行 source read + target write 授权。

- [ ] **Step 5: 扩展嵌入聊天和节点引用**

保持 URL 字段；pending image、mention、node config 额外保存 `assetVersionId`。工作流执行前由服务端解析可用 URL，不信任客户端替换后的 URL。

- [ ] **Step 6: 运行 GREEN 与功能保护**

Run: `pnpm exec vitest run src/__tests__/api/assets-ownership.test.ts src/__tests__/api/workspace-transfer.test.ts src/__tests__/components/canvas-chat-asset-transfer.test.ts src/__tests__/components/node-editor-asset-reference.test.ts src/__tests__/lib/workflow-engine.test.ts src/__tests__/components/workflow-persistence-wiring.test.ts`  
Expected: 新旧 URL 流程均通过。

- [ ] **Step 7: 提交**

Commit: `feat: transfer asset versions across canvas chat and workflow`

### Task 6: 修复独立智能对话桥接并持久化聊天 placement

**Files:**
- Modify: `src/components/simple-chat/simple-chat-types.ts`
- Modify: `src/components/simple-chat/chat-area.tsx`
- Modify: `src/app/simple-chat/page.tsx`
- Modify: `src/app/api/simple-chat/chat/route.ts`
- Modify: `src/components/canvas-workspace.tsx`
- Test: `src/__tests__/components/simple-chat-asset-transfer.test.ts`
- Test: `src/__tests__/components/simple-chat-workspace-return-contract.test.ts`
- Test: `src/__tests__/api/simple-chat-auth.test.ts`

**Interfaces:**
- `SimpleChatMessage` 保留 `images?: string[]`，新增 `imageRefs?: WorkspaceAssetReference[]`。
- `ChatAttachment` 保留 `url`，新增可选 `assetId/assetVersionId/placementId`。
- 旧 `wujie_canvas_bridge` reader 同时兼容 `string[]` 与 `{ images: string[] }`；新 writer 使用服务器 transfer，不再把 localStorage 当授权边界。

- [ ] **Step 1: 编写旧桥接结构 RED**

验证数组和对象两种旧 payload 均可读取；当前 writer/reader 结构不一致的用例必须先失败。

- [ ] **Step 2: 编写真实服务器流转 RED**

聊天结果发送到指定 canvas project 后，返回同一 `assetVersionId` 与新 placement；刷新独立聊天后引用仍存在；他人项目拒绝。

- [ ] **Step 3: 运行 RED**

Run: `pnpm exec vitest run src/__tests__/components/simple-chat-asset-transfer.test.ts src/__tests__/components/simple-chat-workspace-return-contract.test.ts src/__tests__/api/simple-chat-auth.test.ts`  
Expected: 当前 localStorage 数组桥接被画布忽略，测试失败。

- [ ] **Step 4: 实现兼容 reader 与服务器 transfer**

新聊天消息先写 `chat-result`/`chat-attachment` placement，再允许发送到画布；已有 URL-only 历史消息延迟迁移，不在只读打开时重上传。

- [ ] **Step 5: 运行 GREEN**

Run: `pnpm exec vitest run src/__tests__/components/simple-chat-asset-transfer.test.ts src/__tests__/components/simple-chat-workspace-return-contract.test.ts src/__tests__/api/simple-chat-auth.test.ts src/__tests__/components/simple-chat-dashboard-sync-contract.test.ts`  
Expected: 独立聊天返回工作台、数据同步和素材流转全部通过。

- [ ] **Step 6: 提交并形成云端检查点 B**

Commit: `feat: persist standalone chat asset placements`

Push 条件：Task 4-6、全量回归、登录保护与 protected baseline 通过；Coze 使用 `shadow`，实际验证三工作区传递不重复上传且旧项目仍可打开。

### Task 7: 将权威 completed 任务幂等投影为 AssetVersion

**Files:**
- Create: `src/lib/asset-core/task-projector.ts`
- Modify: `src/lib/cloud-task-persistence.ts`
- Modify: `src/lib/agent-task-persistence.ts`
- Modify: `src/app/api/poll-task/route.ts`
- Modify: `src/app/api/workflow/execute/route.ts`
- Modify: `src/app/api/simple-chat/chat/route.ts`
- Test: `src/__tests__/lib/asset-task-projector.test.ts`
- Test: `tests/integration/stage-2-task-projection-postgres.test.ts`
- Test: `src/__tests__/api/task-result-asset-projection.test.ts`

**Interfaces:**
- Produces:

```ts
projectCompletedTaskToAssets(input: {
  actorUserId: string;
  taskId: string;
  targetProjectId: string;
  workspace: WorkspaceKind;
  sourceEntityId?: string;
  parentVersionIds: string[];
}): Promise<{ versions: AssetVersion[]; reused: boolean }>;
```

- [ ] **Step 1: 编写终态与迟到结果 RED**

`completed` 产生版本；`failed/cancelled/timeout` 不产生版本；相同 task/output 重放只复用；终态后迟到 URL 记录为隔离审计，不提升 currentVersion，不创建活动 placement。

- [ ] **Step 2: 编写扣费与来源 RED**

版本记录 taskId、providerId、modelId、参数、billingTransactionId；多参考图父版本顺序与请求顺序一致；生成多图每个输出独立版本。

- [ ] **Step 3: 运行 RED**

Run: `pnpm exec vitest run src/__tests__/lib/asset-task-projector.test.ts tests/integration/stage-2-task-projection-postgres.test.ts src/__tests__/api/task-result-asset-projection.test.ts`  
Expected: 任务结果仍只有 URL JSON，测试失败。

- [ ] **Step 4: 实现权威投影器**

先按 `user_id + task_id` 读取数据库终态；只有 `status='completed'` 才在同一事务插入版本/父边/placement。唯一键绑定 taskId + output index + checksum/url digest，防止 SSE、轮询和恢复路径重复投影。

- [ ] **Step 5: 接入现有完成边界**

只在已有数据库完成转换之后调用投影器；投影失败不把任务改回失败，不重复扣费，而是记录 `projection_pending` 供可重试恢复作业处理。

- [ ] **Step 6: 运行 GREEN 与 S1 账务回归**

Run: `pnpm exec vitest run src/__tests__/lib/asset-task-projector.test.ts tests/integration/stage-2-task-projection-postgres.test.ts src/__tests__/api/task-result-asset-projection.test.ts tests/integration/task-state-postgres.test.ts tests/integration/task-billing-concurrency.test.ts`  
Expected: 素材投影和 S1 终态/账务测试全部通过。

- [ ] **Step 7: 提交**

Commit: `feat: project completed tasks into immutable assets`

### Task 8: 回收站、恢复、媒体健康与孤儿文件治理

**Files:**
- Create: `src/lib/asset-core/media-health.ts`
- Create: `src/app/api/assets/[assetId]/restore/route.ts`
- Create: `src/app/api/assets/[assetId]/purge/route.ts`
- Create: `src/app/api/assets/media/recover/route.ts`
- Create: `src/app/api/admin/assets/orphans/route.ts`
- Modify: `src/app/api/recover-images/route.ts`
- Modify: `src/components/project-data-panel.tsx`
- Modify: `src/components/dashboard/dashboard-view.tsx`
- Test: `src/__tests__/lib/asset-media-health.test.ts`
- Test: `src/__tests__/api/asset-trash-restore.test.ts`
- Test: `tests/integration/stage-2-asset-lifecycle-postgres.test.ts`
- Test: `src/__tests__/api/asset-orphan-scan.test.ts`

**Interfaces:**
- Produces `scanMediaHealth({ dryRun: true })`、`markGcCandidate()`、`purgeEligibleAsset()`。
- 默认回收保留期 30 天；仅管理员显式 purge 或过期 sweeper 可尝试物理删除。

- [ ] **Step 1: 编写生命周期 RED**

验证删除一个 placement 不删共享版本；最后引用删除后资产 trashed；30 天内恢复；有活动 placement、未过保留期、迁移未确认或 legacy URL 仍引用时 purge 拒绝。

- [ ] **Step 2: 编写孤儿与恢复 RED**

扫描只报告 managed media；未知/旧项目引用默认保护；sourceUrl/S3 可恢复时写 recovery attempt；无法恢复时持久化 `unrecoverable`，UI 仍保留 placement。

- [ ] **Step 3: 运行 RED**

Run: `pnpm exec vitest run src/__tests__/lib/asset-media-health.test.ts src/__tests__/api/asset-trash-restore.test.ts tests/integration/stage-2-asset-lifecycle-postgres.test.ts src/__tests__/api/asset-orphan-scan.test.ts`  
Expected: 当前没有回收站、引用计数和安全 purge。

- [ ] **Step 4: 实现软删除优先的生命周期**

删除和恢复使用条件更新；purge 再次事务检查所有 placement/version/legacy 引用。物理 S3/本地删除失败时保留数据库记录与重试状态，不谎报成功。

- [ ] **Step 5: 实现用户恢复与管理员 dry-run**

普通用户只能恢复自己项目的素材；管理员孤儿接口默认 `dryRun=true`，返回 candidate、protected reason 与预计字节数。真正 purge 必须提供 candidate ID 和再次确认摘要。

- [ ] **Step 6: 运行 GREEN**

Run: `pnpm exec vitest run src/__tests__/lib/asset-media-health.test.ts src/__tests__/api/asset-trash-restore.test.ts tests/integration/stage-2-asset-lifecycle-postgres.test.ts src/__tests__/api/asset-orphan-scan.test.ts src/__tests__/api/recover-images-admin-contract.test.ts`  
Expected: 生命周期、隔离与旧恢复接口兼容测试全部通过。

- [ ] **Step 7: 提交并形成云端检查点 C**

Commit: `feat: add asset trash recovery and orphan governance`

Push 条件：Task 7-8、真实 PostgreSQL 并发、S1 账务门禁、全量回归通过；Coze 继续 shadow 验证，不执行物理 purge。

### Task 9: 三工作区 E2E、切换门禁、报告与发布回退

**Files:**
- Create: `tests/e2e/stage-2-asset-lifecycle.spec.ts`
- Create: `tests/e2e/stage-2-cross-workspace.spec.ts`
- Modify: `scripts/doctor.mjs`
- Modify: `docs/testing/FUNCTION_INVENTORY.md`
- Modify: `docs/testing/BUG_REGISTER.md`
- Modify: `docs/testing/REGRESSION_REPORT.md`
- Modify: `docs/testing/RELEASE_READINESS_REPORT.md`
- Modify: `docs/testing/UNVERIFIED_ITEMS.md`
- Modify: `F:/AIGC/vault-template/无界计划/10-变更决策日志.md`
- Modify: `F:/AIGC/vault-template/无界计划/11-阶段进度看板.md`
- Modify: `F:/AIGC/vault-template/无界计划/13-阶段执行同步与防偏移纪律.md`

**Interfaces:**
- Doctor 输出 asset mode、迁移版本/校验和、shadow comparison、missing/unrecoverable 数、trash/purge 候选数，并在 `asset-v3` 一致性不满足时阻止发布。

- [ ] **Step 1: 编写 Playwright 场景**

场景必须覆盖：旧 v1 项目只读打开；首次保存 copy-on-write；上传图进入画布；canvas -> embedded chat -> result -> canvas；canvas -> workflow -> output -> canvas；standalone chat -> 指定 canvas；删除一个 placement 后其他工作区仍可用；回收/恢复；缺图可见且可重试；刷新恢复。

- [ ] **Step 2: 在 Chromium/Firefox/WebKit 与移动视口运行本地 E2E**

Run: `pnpm exec playwright test tests/e2e/stage-2-asset-lifecycle.spec.ts tests/e2e/stage-2-cross-workspace.spec.ts --project=chromium --project=firefox --project=webkit`  
Expected: 全部通过；失败保留 screenshot/video/trace/console/network。

- [ ] **Step 3: 执行完整本地门禁**

Run:

```bash
pnpm doctor
pnpm lint
pnpm ts-check
pnpm test
pnpm test:api
pnpm test:regression
pnpm build
pnpm check:protected-baseline -- --base ffe810939a446bbf7288d177b95040b36a05484c --candidate HEAD
```

Expected: 0 errors；历史 warning 单独记录；38/38 受保护功能保留；真实 PostgreSQL 专项通过。

- [ ] **Step 4: 云端 shadow 验证**

推送 main 后由 Coze 部署标签页拉取精确 SHA。Chrome 已登录真实操作上述链路；核对 legacy 与 shadow 的项目数、素材数、placement 数、owner/project 归属、任务/扣费引用；禁止使用 Mock 冒充。

- [ ] **Step 5: 受控切换 asset-v3 并验证回滚**

只有 shadow comparison 连续通过才将测试环境切到 `asset-v3`。验证旧项目、三个工作区、刷新恢复、删除/恢复后，再切回 `legacy` 并证明旧 JSON 仍完整可用；`stable` 不变。

- [ ] **Step 6: 更新报告和 Obsidian**

记录最终 main SHA、云端 SHA、测试数、缺陷数、证据路径、未验证项、回退点和下一阶段唯一目标。Stage 2 只有在 PostgreSQL、三浏览器、真实云端三工作区与 legacy 回滚均闭环后才可标记“已完成”。

- [ ] **Step 7: 最终提交与推送**

Commit: `test: close stage two asset graph rollout`

## Checkpoint Review Rules

每个 Task 都执行：实现者自检 -> 规格评审 -> 代码质量评审 -> 聚焦测试 -> 受影响模块回归 -> 更新 `.superpowers/sdd/progress.md`。评审未通过时只修复当前 Task，不提前进入下一 Task。

三个云端检查点分别是：

1. **A / Reader-first:** Task 1-3，只增表、读取器与 shadow 基础，不改变用户读取权。
2. **B / Workspace shadow:** Task 4-6，三工作区旁路写与传递，仍可一键回 legacy。
3. **C / Lifecycle:** Task 7-8，权威任务投影、回收与恢复；物理 purge 保持关闭。

最终 `asset-v3` 切换必须在 Task 9 完整门禁后进行。任一检查点出现登录、云端启动、旧项目、账务或数据隔离回归，立即切回 `legacy` 并恢复到该检查点前 Commit，不删除新表。

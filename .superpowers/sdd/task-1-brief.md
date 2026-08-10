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


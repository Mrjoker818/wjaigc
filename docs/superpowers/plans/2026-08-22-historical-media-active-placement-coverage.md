# 历史媒体活跃放置覆盖修复实施计划

> **供执行智能体使用：** 必须使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans`，逐项执行本计划。所有步骤使用复选框追踪，任何 RED 测试不得跳过或删除。

**目标：** 让历史媒体修复候选覆盖所有仍被活跃 placement 引用的不可持久化坏版本，包括非当前版本；归档时只处理明确选中的坏版本及其 placement，并在覆盖不完整时拒绝写入。

**架构：** 以 `historical-media-remediation.ts` 为唯一候选判定与归档事务边界，统一 GET 候选发现、POST 写入前覆盖校验和锁后事实复算。候选摘要新增 `isCurrentVersion`，使当前版本身份变化自动令旧审批失效；发布就绪检查继续保持独立且权威，不通过减少 blocker 或修改 doctor 口径制造“通过”。

**技术栈：** Next.js 16 App Router、React 19、TypeScript 5、PostgreSQL、Vitest、现有 Asset Graph 事务/审计/快照基础设施。

## 全局约束

- 仅在 `main` 对应开发分支实施；禁止修改、合并、变基或推送 `stable`。
- V5.8.8 仅作为只读 donor，本计划不从 donor 复制业务代码。
- 必须遵循 RED → 最小实现 → GREEN → 模块回归 → 全量回归 → 云端验证。
- 不改变 `scripts/doctor-asset-status.mjs` 的 readiness 判定谓词，不降低 `asset-v3` 发布门禁。
- 不引入物理删除、媒体重新生成、供应商调用、积分扣除、退款或直接生产 SQL。
- 不提供“归档全部”行为；POST 只处理管理员明确提交并通过摘要复核的候选。
- 覆盖不完整时返回稳定错误码 `HISTORICAL_MEDIA_COVERAGE_INCOMPLETE`，数据库不得产生任何变更。
- 云端写操作必须在展示精确候选版本、placement、摘要和影响后，再获取一次操作时确认；本地实现完成不等于授权云端归档。
- 三个受保护的既有文件 `.superpowers/sdd/progress.md`、`.superpowers/sdd/task-1-brief.md`、`.superpowers/sdd/task-2-brief.md` 不修改、不暂存、不提交。
- 新增或更新的设计、计划、测试、缺陷和发布文档使用中文；代码标识、接口字段、命令、模型名和稳定错误码保留原文。

---

## 文件责任映射

- `src/lib/asset-core/historical-media-remediation.ts`：候选类型、摘要、数据库发现、覆盖聚合、锁后复算、原子归档和幂等边界。
- `src/app/api/admin/assets/remediation/route.ts`：管理员 GET/POST HTTP 契约与稳定错误映射。
- `src/__tests__/lib/historical-media-remediation.test.ts`：纯函数摘要和请求规范化回归。
- `src/__tests__/api/historical-media-remediation.test.ts`：认证、响应结构、覆盖错误和 HTTP 状态回归。
- `tests/integration/stage-4-historical-media-remediation-postgres.test.ts`：真实 PostgreSQL 发现、并发、归档隔离、回滚、审计和 readiness 对账。
- `scripts/doctor-asset-status.mjs`：只读验证对象；不得为通过测试而修改 blocker 谓词。
- `src/lib/asset-core/asset-release-readiness.ts`：只读验证对象；保持 `asset-v3` fail-closed。
- `tests/unit/protected-baseline-gate.spec.ts` 与 `docs/testing/baselines/protected-source-authorizations.json`：记录本次经过批准的精确源码路径及来源提交。
- `docs/testing/BUG_REGISTER.md`、`docs/testing/REGRESSION_REPORT.md`、`docs/testing/RELEASE_READINESS_REPORT.md`、`docs/testing/UNVERIFIED_ITEMS.md`：中文记录本地和云端证据边界。
- `docs/testing/evidence/`：保存去敏后的机器可读验证证据，不保存管理员密码、Cookie、Token、完整用户数据或图片内容。

---

### 任务 1：用 RED 测试锁定候选契约和当前版本身份摘要

**文件：**
- 修改：`src/__tests__/lib/historical-media-remediation.test.ts`
- 修改：`src/lib/asset-core/historical-media-remediation.ts`

**接口：**
- 产出：

```ts
export interface HistoricalMediaCandidate {
  ownerId: string;
  projectId: string;
  assetId: string;
  assetVersionId: string;
  isCurrentVersion: boolean;
  availability: MediaAvailability;
  urlClass: 'empty' | 'ephemeral-proxy';
  placements: HistoricalMediaPlacementFact[];
  candidateDigest: string;
}

export interface HistoricalMediaDiscoveryCounts {
  versions: number;
  activePlacements: number;
  currentVersions: number;
  nonCurrentVersions: number;
}

export interface HistoricalMediaCoverage {
  eligibleBlockingPlacements: number;
  candidatePlacements: number;
  uncoveredBlockingPlacements: number;
  complete: boolean;
}

export interface HistoricalMediaDiscovery {
  candidates: HistoricalMediaCandidate[];
  counts: HistoricalMediaDiscoveryCounts;
  coverage: HistoricalMediaCoverage;
}
```

- 保持：`HistoricalMediaArchiveSelection` 请求字段不新增 `isCurrentVersion`；该事实由 `candidateDigest` 绑定并在锁后重新计算。

- [ ] **步骤 1：先添加摘要身份变化的失败测试**

在现有 candidate fixture 中加入 `isCurrentVersion: true`，并新增：

```ts
it('changes the candidate digest when current-version identity changes', () => {
  expect(buildHistoricalMediaCandidateDigest(candidate)).not.toBe(
    buildHistoricalMediaCandidateDigest({
      ...candidate,
      isCurrentVersion: false,
    }),
  );
});
```

- [ ] **步骤 2：运行纯函数测试并确认 RED**

运行：

```powershell
pnpm exec vitest run src/__tests__/lib/historical-media-remediation.test.ts
```

预期：测试失败，原因是当前摘要规范值尚未包含 `isCurrentVersion`，或 TypeScript fixture 缺少新字段。

- [ ] **步骤 3：最小修改候选类型与摘要规范值**

在 `HistoricalMediaCandidate` 添加布尔字段；在 `candidateCanonicalValue()` 中严格验证并返回该字段：

```ts
function readBoolean(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new Error(INVALID_REQUEST);
  return value;
}

const isCurrentVersion = readBoolean(candidate.isCurrentVersion);

return {
  ownerId,
  projectId,
  assetId,
  assetVersionId,
  isCurrentVersion,
  availability,
  urlClass,
  placements,
};
```

同时将 `isCurrentVersion: true` 加入 `MAX_CANONICAL_CANDIDATE_BASE_BYTES` 的规范样本，确保 placement 数量上限仍按真实摘要体积计算。

- [ ] **步骤 4：运行测试并确认 GREEN**

运行：

```powershell
pnpm exec vitest run src/__tests__/lib/historical-media-remediation.test.ts
pnpm ts-check
```

预期：纯函数测试通过；`ts-check` 只报告尚未迁移的候选构造点，逐一补齐后为 0 error。

- [ ] **步骤 5：提交候选契约改动**

```powershell
git add src/lib/asset-core/historical-media-remediation.ts src/__tests__/lib/historical-media-remediation.test.ts
git commit -m "test: bind historical media digest to current version"
```

---

### 任务 2：用真实 PostgreSQL 复现并修复非当前坏版本遗漏

**文件：**
- 修改：`tests/integration/stage-4-historical-media-remediation-postgres.test.ts`
- 修改：`src/lib/asset-core/historical-media-remediation.ts`
- 只读核对：`scripts/doctor-asset-status.mjs`

**接口：**
- 消费：任务 1 的 `HistoricalMediaCandidate`、`HistoricalMediaDiscoveryCounts`、`HistoricalMediaCoverage`。
- 产出：`discoverHistoricalMediaArchiveCandidates(input?: { limit?: number }): Promise<HistoricalMediaDiscovery>`。
- 共享资格谓词：活跃 Asset、活跃 placement、空 URL 或 `/v1/images/proxy/`、无 `storage_key`、无 `recovery_source_url`、availability 属于 `ready | missing | unrecoverable`。

- [ ] **步骤 1：在 PostgreSQL fixture 中加入“健康当前版本 + 非当前坏版本 + 活跃 placement”**

新增独立 Asset：当前版本使用 `/api/serve-upload/healthy-current.png` 与 `uploads/healthy-current.png`；旧版本使用 `/v1/images/proxy/non-current-expired`、无持久化来源且 availability 为 `missing`。为两个版本分别创建活跃 placement，并保存归档前的完整行 JSON。

测试断言必须包含：

```ts
expect(nonCurrentCandidate).toMatchObject({
  assetId: 'asset-non-current-broken',
  assetVersionId: 'version-non-current-broken',
  isCurrentVersion: false,
});
expect(discovery.coverage).toEqual({
  eligibleBlockingPlacements: 5,
  candidatePlacements: 5,
  uncoveredBlockingPlacements: 0,
  complete: true,
});
```

数字取自该隔离 fixture，不得引用或硬编码云端当前统计。

- [ ] **步骤 2：运行 PostgreSQL 测试并确认 RED**

运行：

```powershell
$env:POSTGRES_TEST_DATABASE_URL=$env:WUJIE_LOCAL_TEST_POSTGRES_URL
pnpm exec vitest run tests/integration/stage-4-historical-media-remediation-postgres.test.ts -t "discovers current and non-current broken media"
```

预期：旧查询遗漏 `version-non-current-broken`，并且返回值缺少 `coverage`。

- [ ] **步骤 3：把发现 SQL 改为从活跃 placement 指向版本，而不是从 `current_version_id` 指向版本**

候选聚合 SQL 采用以下连接方向，并计算当前身份：

```sql
FROM wujie_assets asset
JOIN wujie_workspace_placements placement
  ON placement.asset_id = asset.id
 AND placement.owner_id = asset.owner_id
 AND placement.project_id = asset.project_id
 AND placement.status = 'active'
JOIN wujie_asset_versions version
  ON version.id = placement.asset_version_id
 AND version.asset_id = asset.id
 AND version.owner_id = asset.owner_id
 AND version.project_id = asset.project_id
WHERE asset.status = 'active'
  AND nullif(btrim(coalesce(version.storage_key, '')), '') IS NULL
  AND nullif(btrim(coalesce(version.recovery_source_url, '')), '') IS NULL
  AND (
    btrim(coalesce(version.file_url, '')) = ''
    OR version.file_url LIKE '/v1/images/proxy/%'
  )
  AND version.availability IN ('ready', 'missing', 'unrecoverable')
```

查询行新增：

```sql
(asset.current_version_id = version.id) AS is_current_version
```

`DiscoveryRow` 与 `mapDiscoveryCandidates()` 必须传播该布尔字段，不得按 Asset 合并不同版本。

- [ ] **步骤 4：在同一只读事务内计算全量覆盖与有界候选**

实现一个内部结果函数，使全量 aggregate 不受 GET `limit` 和单候选 placement 上限截断；有界候选继续受限制。返回值按以下公式计算：

```ts
const candidatePlacements = candidates.reduce(
  (sum, candidate) => sum + candidate.placements.length,
  0,
);
const uncoveredBlockingPlacements = Math.max(
  0,
  eligibleBlockingPlacements - candidatePlacements,
);

return {
  candidates,
  counts: {
    versions: candidates.length,
    activePlacements: candidatePlacements,
    currentVersions: candidates.filter(item => item.isCurrentVersion).length,
    nonCurrentVersions: candidates.filter(item => !item.isCurrentVersion).length,
  },
  coverage: {
    eligibleBlockingPlacements,
    candidatePlacements,
    uncoveredBlockingPlacements,
    complete: uncoveredBlockingPlacements === 0,
  },
};
```

全量统计只返回 aggregate，不返回未覆盖记录的 owner、project、asset 或 version 标识。

- [ ] **步骤 5：覆盖 limit 截断和超大候选的 fail-closed 测试**

扩展现有 oversized 测试并新增 limit 测试：

```ts
expect(discovery.coverage.complete).toBe(false);
expect(discovery.coverage.uncoveredBlockingPlacements).toBeGreaterThan(0);
expect(discovery.coverage.eligibleBlockingPlacements).toBe(
  discovery.coverage.candidatePlacements
  + discovery.coverage.uncoveredBlockingPlacements,
);
```

同时断言 `counts` 只描述实际返回候选，而 `coverage.eligibleBlockingPlacements` 描述完整资格集合。

- [ ] **步骤 6：运行 PostgreSQL 发现测试并确认 GREEN**

```powershell
pnpm exec vitest run tests/integration/stage-4-historical-media-remediation-postgres.test.ts -t "discovery|oversized|coverage"
```

预期：非当前坏版本被发现，健康版本不成为候选，覆盖完整时差值为 0；limit 或单候选超界时 `complete=false`。

- [ ] **步骤 7：提交发现与覆盖聚合**

```powershell
git add src/lib/asset-core/historical-media-remediation.ts tests/integration/stage-4-historical-media-remediation-postgres.test.ts
git commit -m "fix: cover active non-current media placements"
```

---

### 任务 3：让非当前版本归档保持健康当前媒体逐字段不变

**文件：**
- 修改：`tests/integration/stage-4-historical-media-remediation-postgres.test.ts`
- 修改：`src/lib/asset-core/historical-media-remediation.ts`

**接口：**
- 产出：锁后的 `LockedHistoricalMediaCandidate.isCurrentVersion`。
- 保持：`markVersionUnrecoverable()`、`softTrashPlacement()`、`trashAssetWhenUnreferenced()` 的版本级和 placement 级作用域。

- [ ] **步骤 1：先写非当前版本原子归档 RED 测试**

测试只提交非当前坏版本候选，并在事务前后查询：Asset 全行、健康当前版本全行、健康 placement 全行、坏版本、坏 placement、Canvas 快照、revision、ledger 和 audit。

关键断言：

```ts
expect(after.asset).toEqual(before.asset);
expect(after.healthyCurrentVersion).toEqual(before.healthyCurrentVersion);
expect(after.healthyPlacement).toEqual(before.healthyPlacement);
expect(after.badVersion.availability).toBe('unrecoverable');
expect(after.badPlacement).toMatchObject({ status: 'trashed', deleted: true });
expect(after.asset.current_version_id).toBe('version-non-current-healthy');
```

- [ ] **步骤 2：运行测试并确认 RED**

```powershell
pnpm exec vitest run tests/integration/stage-4-historical-media-remediation-postgres.test.ts -t "archives only a non-current broken version"
```

预期：旧 `lockCandidateFacts()` 因 `row.current_version_id !== row.asset_version_id` 返回 `HISTORICAL_MEDIA_CANDIDATE_STALE`。

- [ ] **步骤 3：最小调整锁后事实复算**

移除“所选版本必须是当前版本”的资格限制，但保留身份一致性、Asset 活跃和坏媒体条件。锁后候选显式计算：

```ts
const isCurrentVersion = row.current_version_id === row.asset_version_id;

return {
  ownerId: row.owner_id,
  projectId: row.project_id,
  assetId: row.asset_id,
  assetVersionId: row.asset_version_id,
  isCurrentVersion,
  availability: row.availability,
  urlClass,
  placements: placementsResult.rows.map(mapLockedPlacement),
  candidateDigest: '',
};
```

不得执行任何 `UPDATE wujie_assets SET current_version_id = ...`。`trashAssetWhenUnreferenced()` 继续只在所有版本均无活跃 placement 时将 Asset 软删除。

`HistoricalMediaBeforeCandidate` 与 `createBeforeCandidate()` 同步记录锁后事实：

```ts
interface HistoricalMediaBeforeCandidate {
  ownerId: string;
  projectId: string;
  assetId: string;
  assetVersionId: string;
  isCurrentVersion: boolean;
  availability: MediaAvailability;
  urlClass: 'empty' | 'ephemeral-proxy';
  candidateDigest: string;
  placementCount: number;
}
```

ledger 仅记录该布尔事实和既有去敏字段，不增加 URL、密钥、Token 或完整 metadata。

- [ ] **步骤 4：添加身份升降级摘要失效测试**

分别在 GET 后、POST 前把健康版本或坏版本切换为 current，断言归档失败且无写入：

```ts
await expect(service.archiveHistoricalMedia(command)).rejects.toMatchObject({
  code: 'HISTORICAL_MEDIA_CANDIDATE_STALE',
});
expect(await readArchiveState(query)).toEqual(beforeMutationState);
```

- [ ] **步骤 5：确认当前版本与非当前版本归档均 GREEN**

```powershell
pnpm exec vitest run tests/integration/stage-4-historical-media-remediation-postgres.test.ts -t "non-current|current-version identity|stale"
```

预期：只处理所选坏版本；身份变化会因摘要不一致而拒绝；健康当前媒体逐字段不变。

- [ ] **步骤 6：提交原子归档修复**

```powershell
git add src/lib/asset-core/historical-media-remediation.ts tests/integration/stage-4-historical-media-remediation-postgres.test.ts
git commit -m "fix: archive broken historical versions atomically"
```

---

### 任务 4：在 API 和事务入口建立覆盖完整性写入门禁

**文件：**
- 修改：`src/lib/asset-core/historical-media-remediation.ts`
- 修改：`src/app/api/admin/assets/remediation/route.ts`
- 修改：`src/__tests__/api/historical-media-remediation.test.ts`
- 修改：`tests/integration/stage-4-historical-media-remediation-postgres.test.ts`

**接口：**
- 新增错误码：`HISTORICAL_MEDIA_COVERAGE_INCOMPLETE`。
- GET 成功响应：`{ candidates, counts, coverage, requestId, success }`。
- POST 覆盖不完整：HTTP 409、稳定错误码、通用消息，不暴露跨用户标识。

- [ ] **步骤 1：先添加 API RED 测试**

更新 GET mock：

```ts
mocks.discover.mockResolvedValue({
  candidates: [candidate],
  counts: {
    versions: 1,
    activePlacements: 2,
    currentVersions: 1,
    nonCurrentVersions: 0,
  },
  coverage: {
    eligibleBlockingPlacements: 2,
    candidatePlacements: 2,
    uncoveredBlockingPlacements: 0,
    complete: true,
  },
});
```

新增 POST 错误断言：

```ts
mocks.archive.mockRejectedValue(
  new MockHistoricalMediaRemediationError('HISTORICAL_MEDIA_COVERAGE_INCOMPLETE'),
);
const response = await POST(administratorJsonRequest(validRequest));
expect(response.status).toBe(409);
expect(await response.json()).toMatchObject({
  success: false,
  code: 'HISTORICAL_MEDIA_COVERAGE_INCOMPLETE',
});
```

- [ ] **步骤 2：运行 API 测试并确认 RED**

```powershell
pnpm exec vitest run src/__tests__/api/historical-media-remediation.test.ts
```

预期：GET 旧 fixture 类型不匹配，POST 新错误暂落入 500。

- [ ] **步骤 3：在归档事务内、任何 mutation 之前重新校验全局可表示性**

新增内部函数，使用与发现完全相同的资格谓词，以 `MAX_CANDIDATES=20` 和 `MAX_CANDIDATE_PLACEMENTS` 计算服务可表示的 placement 总数：

```ts
async function assertHistoricalMediaCoverageComplete(
  client: AssetCoreSqlTransaction,
): Promise<void> {
  const coverage = await readHistoricalMediaCoverage(client, MAX_CANDIDATES);
  if (!coverage.complete) {
    throw remediationError('HISTORICAL_MEDIA_COVERAGE_INCOMPLETE');
  }
}
```

调用位置必须在幂等历史结果读取之后、候选锁与任何更新之前：

```ts
if (existing) return resolveExistingOrConflict(existing, normalized.requestDigest);
await assertHistoricalMediaCoverageComplete(client);
const sortedSelections = await resolveArchiveSelections(client, normalized.request.candidates);
```

这样字节相同的已完成重试仍返回原结果；新写请求在覆盖不完整时 fail-closed。

- [ ] **步骤 4：将新错误映射为 HTTP 409**

在 route 冲突分支加入：

```ts
if (
  error.code === 'HISTORICAL_MEDIA_CANDIDATE_STALE'
  || error.code === 'HISTORICAL_MEDIA_IDEMPOTENCY_CONFLICT'
  || error.code === 'HISTORICAL_MEDIA_COVERAGE_INCOMPLETE'
) {
  return errorResponse(409, error.code, 'Historical media archive conflict', requestId);
}
```

- [ ] **步骤 5：添加 PostgreSQL 无副作用测试**

分别通过 `limit` 超界数据和单候选 placement 超界数据触发覆盖不完整；调用 POST 服务前后比较完整归档状态，断言：

```ts
await expect(service.archiveHistoricalMedia(command)).rejects.toMatchObject({
  code: 'HISTORICAL_MEDIA_COVERAGE_INCOMPLETE',
});
expect(await readArchiveState(query)).toEqual(before);
```

- [ ] **步骤 6：运行 API 与 PostgreSQL 门禁测试并确认 GREEN**

```powershell
pnpm exec vitest run src/__tests__/api/historical-media-remediation.test.ts
pnpm exec vitest run tests/integration/stage-4-historical-media-remediation-postgres.test.ts -t "coverage incomplete|oversized"
```

预期：API 结构稳定；覆盖不完整返回 409；数据库、快照、revision、ledger、audit 均无变更。

- [ ] **步骤 7：提交覆盖写入门禁**

```powershell
git add src/lib/asset-core/historical-media-remediation.ts src/app/api/admin/assets/remediation/route.ts src/__tests__/api/historical-media-remediation.test.ts tests/integration/stage-4-historical-media-remediation-postgres.test.ts
git commit -m "fix: block incomplete historical media archives"
```

---

### 任务 5：完成并发、回滚、审计和 readiness 对账回归

**文件：**
- 修改：`tests/integration/stage-4-historical-media-remediation-postgres.test.ts`
- 只读验证：`scripts/doctor-asset-status.mjs`
- 只读验证：`src/lib/asset-core/asset-release-readiness.ts`

**接口：**
- 保持：同 actor + 同 `idempotencyKey` + 同规范请求返回同一 `remediationId`。
- 保持：同 key 不同请求摘要返回 `HISTORICAL_MEDIA_IDEMPOTENCY_CONFLICT`。
- 保持：ledger 和管理员 audit 与 Asset Graph mutation 同事务提交或回滚。

- [ ] **步骤 1：扩展并发测试覆盖非当前候选**

两个并发调用提交同一非当前候选，断言：

```ts
expect(results.map(result => result.reused).sort()).toEqual([false, true]);
expect(new Set(results.map(result => result.remediationId))).toHaveLength(1);
expect(ledgerCount).toBe(1);
expect(auditCount).toBe(1);
expect(trashedBadPlacementCount).toBe(1);
```

- [ ] **步骤 2：扩展同 key 冲突测试**

先归档一个候选，再用相同 key、不同 reason 或候选摘要提交，断言 `HISTORICAL_MEDIA_IDEMPOTENCY_CONFLICT`，且第二次不新增 ledger/audit。

- [ ] **步骤 3：扩展 snapshot 与 audit 故障回滚测试**

复用现有 PostgreSQL failure trigger，确保包含非当前坏版本的批次在 Canvas snapshot 或 audit 写入失败时，Asset、所有版本、所有 placement、revision、ledger 和 audit 完整恢复到调用前状态。

- [ ] **步骤 4：直接用 doctor 同口径 SQL 对账归档前后 blocker**

测试复制 doctor 现有 `active-placement-version-availability` 与 `false-ready-active-placements` 查询语义，但不修改生产脚本。归档前断言坏 placement 被 readiness 计数，归档后断言所选坏 placement 不再计入，同时健康当前版本仍为 `ready` 且 placement 仍为 `active`。

- [ ] **步骤 5：运行完整历史媒体 PostgreSQL 套件**

```powershell
pnpm exec vitest run tests/integration/stage-4-historical-media-remediation-postgres.test.ts
```

预期：全部通过且 0 skip；若 `POSTGRES_TEST_DATABASE_URL` 缺失，结果只能记录为“阻塞”，不得记为通过。

- [ ] **步骤 6：提交可靠性回归**

```powershell
git add tests/integration/stage-4-historical-media-remediation-postgres.test.ts
git commit -m "test: prove historical media archive isolation"
```

---

### 任务 6：更新精确源码授权并执行本地全量门禁

**文件：**
- 修改：`docs/testing/baselines/protected-source-authorizations.json`
- 修改：`tests/unit/protected-baseline-gate.spec.ts`
- 修改：`docs/testing/BUG_REGISTER.md`
- 修改：`docs/testing/REGRESSION_REPORT.md`
- 修改：`docs/testing/RELEASE_READINESS_REPORT.md`
- 修改：`docs/testing/UNVERIFIED_ITEMS.md`
- 新建：`docs/testing/evidence/s4-bug-014-local-postgres-2026-08-22.json`

**接口：**
- 产出：精确路径来源提交证明、中文验证结论和去敏机器证据。
- 不修改：protected feature 数量、`stable`、V5.8.8 donor、readiness blocker 谓词。

- [ ] **步骤 1：记录源码实现提交 SHA**

```powershell
$remediationCommit = (git log -1 --format=%h -- src/lib/asset-core/historical-media-remediation.ts).Trim()
$routeCommit = (git log -1 --format=%h -- src/app/api/admin/assets/remediation/route.ts).Trim()
git diff-tree --no-commit-id --name-only -r $remediationCommit -- src/lib/asset-core/historical-media-remediation.ts
git diff-tree --no-commit-id --name-only -r $routeCommit -- src/app/api/admin/assets/remediation/route.ts
```

预期：两个变量均为 7 位十六进制提交号；每条 `diff-tree` 只输出对应的精确源码路径。即使两条路径最后由同一提交修改，也分别从 Git 历史读取，不假设当前 `HEAD` 就是来源提交。

- [ ] **步骤 2：更新两个精确路径的来源授权**

在 `protected-source-authorizations.json` 与 `historicalSourceAuthorizations` 中，把以下两项的 `sourceCommit` 分别同步为步骤 1 的 `$remediationCommit` 和 `$routeCommit`：

```text
src/lib/asset-core/historical-media-remediation.ts
src/app/api/admin/assets/remediation/route.ts
```

其余历史授权条目、数量和顺序保持不变。随后运行：

```powershell
pnpm exec vitest run tests/unit/protected-baseline-gate.spec.ts
```

预期：精确路径、来源提交和无宽泛目录授权测试通过。

- [ ] **步骤 3：运行受影响测试矩阵**

```powershell
pnpm exec vitest run src/__tests__/lib/historical-media-remediation.test.ts src/__tests__/api/historical-media-remediation.test.ts tests/integration/stage-4-historical-media-remediation-postgres.test.ts src/__tests__/api/production-readiness.test.ts src/__tests__/lib/asset-release-readiness.test.ts tests/unit/protected-baseline-gate.spec.ts
```

预期：全部通过，PostgreSQL 测试 0 skip。

- [ ] **步骤 4：运行全量质量门禁**

```powershell
pnpm ts-check
pnpm lint
pnpm test
pnpm build
pnpm check:protected-baseline
git diff --check
```

预期：所有命令退出码为 0；不得通过删除失败测试、关闭规则或增加任意等待时间获得绿色结果。

- [ ] **步骤 5：生成中文本地证据与报告**

用运行时读取的 Git 值生成证据对象，禁止把说明文字写入结果：

```powershell
$headCommit = (git rev-parse HEAD).Trim()
$stableCommit = (git rev-parse origin/stable).Trim()
$evidence = [ordered]@{
  bugId = 'S4-BUG-014'
  date = '2026-08-22'
  branch = 'codex/wj-stable-s4'
  commit = $headCommit
  stableCommitBefore = $stableCommit
  stableCommitAfter = $stableCommit
  postgres = [ordered]@{
    nonCurrentDiscovery = '通过'
    healthyCurrentPreserved = '通过'
    coverageFailClosed = '通过'
    idempotency = '通过'
    rollback = '通过'
  }
  cloudArchive = '未执行，等待操作时确认'
  assetV3 = '禁止切换'
}
$evidence | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath 'docs/testing/evidence/s4-bug-014-local-postgres-2026-08-22.json' -Encoding utf8
```

生成后重新读取 JSON，确认 commit 为 40 位十六进制值且 stable 前后相同；不得写入数据库 URL、密码、Cookie、Token、用户图片或完整用户标识。

- [ ] **步骤 6：提交授权、证据与中文报告**

```powershell
git add docs/testing/baselines/protected-source-authorizations.json tests/unit/protected-baseline-gate.spec.ts docs/testing/BUG_REGISTER.md docs/testing/REGRESSION_REPORT.md docs/testing/RELEASE_READINESS_REPORT.md docs/testing/UNVERIFIED_ITEMS.md docs/testing/evidence/s4-bug-014-local-postgres-2026-08-22.json
git commit -m "docs: record historical media coverage verification"
```

---

### 任务 7：推送 main 并执行云端只读验收

**文件：**
- 修改：`F:\AIGC\vault-template\无界计划\09-测试发布与回退门禁.md`
- 修改：`F:\AIGC\vault-template\无界计划\11-阶段进度看板.md`
- 修改：`F:\AIGC\vault-template\无界计划\16-V5.8.8选择性吸收.md`
- 新建：`docs/testing/evidence/s4-bug-014-cloud-readonly-2026-08-22.json`

**接口：**
- 云端目标：`https://62afe49a-716e-4d9e-99cd-a0be49c4794c-5000.dev.coze.site`
- 模式：`shadow`。
- 写入前停止点：必须在归档 POST 前获取新的操作时确认。

- [ ] **步骤 1：确认分支和保护边界**

```powershell
git fetch origin
git rev-parse origin/stable
git rev-parse origin/main
git status --short --branch
```

预期：`origin/stable` 仍为 `52f7c601ed150769e15d06fb435c6e360e28c9e7`；工作区只允许三份已知受保护 SDD 文件保持既有修改，提交内容不得包含它们。

- [ ] **步骤 2：以 fast-forward 方式集成并只推送 main**

当前实施工作树含三份不可触碰的既有 SDD 修改，不在该工作树执行 rebase 或 stash。先使用 `superpowers:using-git-worktrees` 建立干净 release worktree，再按提交顺序集成：

```powershell
git fetch origin
$releaseRoot = 'J:\无界本地版\projects\_upstream-wjaigc-restore\.worktrees\wj-stable-s4-release'
git worktree add -b codex/wj-stable-s4-release $releaseRoot origin/main
$commits = git rev-list --reverse --no-merges origin/main..codex/wj-stable-s4
foreach ($commit in $commits) {
  git -C $releaseRoot cherry-pick $commit
  if ($LASTEXITCODE -ne 0) { throw "cherry-pick failed: $commit" }
}
git -C $releaseRoot status --short --branch
```

预期：release worktree 干净，所有候选提交按顺序存在。若发生冲突立即停止，不自动采用 ours/theirs。随后在 release worktree 重跑任务 6 的全量门禁，全部通过后才执行：

```powershell
git -C $releaseRoot push origin HEAD:main
```

预期：普通 fast-forward 只更新 `main`；拒绝时停止，禁止 `--force`；`stable` SHA 不变。

- [ ] **步骤 3：由 Coze 拉取精确 main SHA 并构建 shadow**

记录：

```powershell
$expectedSha = (git rev-parse origin/main).Trim()
$expectedSha
```

在现有 Google Chrome 项目页完成拉取与沙箱恢复，不创建新标签页、不使用 360 浏览器。若项目页提示沙箱断开，刷新项目页等待恢复，再强制刷新现有预览页。必须从云端版本信息或构建日志证明运行的是 `$expectedSha`。

- [ ] **步骤 4：在管理员会话中执行两轮只读 GET**

连续两次读取：

```text
GET /api/admin/assets/remediation?limit=20
GET /api/admin/production-readiness
GET /api/auth/me
```

必须证明：

```text
coverage.complete = true
coverage.uncoveredBlockingPlacements = 0
两轮 candidate ID、isCurrentVersion、candidateDigest 和 placement 数量一致
mode = shadow
switchAuthorized = false，直到 readiness 独立判定允许
```

只保存去敏后的 aggregate、候选 ID/摘要、requestId、Git SHA、时间和 Console/Network 证据；不保存凭据。

- [ ] **步骤 5：完成只读云端报告并停在写操作确认门前**

更新中文报告与 Obsidian，明确列出：候选版本数、活跃 placement 数、当前/非当前版本数、精确摘要、预期软删除影响、不会发生的操作，以及 `asset-v3` 仍禁止切换。

此时必须停止，不调用 POST，并向用户请求一次新的操作时确认。

---

### 任务 8：获得操作时确认后执行一次云端归档及幂等重试

**前置条件：** 任务 7 的两轮只读结果稳定、`coverage.complete=true`、用户已看到精确候选与影响并明确确认。

**文件：**
- 新建：`docs/testing/evidence/s4-bug-014-cloud-archive-2026-08-22.json`
- 修改：`docs/testing/BUG_REGISTER.md`
- 修改：`docs/testing/REGRESSION_REPORT.md`
- 修改：`docs/testing/RELEASE_READINESS_REPORT.md`
- 修改：`docs/testing/UNVERIFIED_ITEMS.md`
- 修改：`F:\AIGC\vault-template\无界计划\09-测试发布与回退门禁.md`
- 修改：`F:\AIGC\vault-template\无界计划\11-阶段进度看板.md`
- 修改：`F:\AIGC\vault-template\无界计划\16-V5.8.8选择性吸收.md`

- [ ] **步骤 1：构造一个有界、显式、可审计的 POST 请求**

请求必须由任务 7 两次稳定返回的候选对象程序化构造，并使用新的唯一 `idempotencyKey`：

```ts
const confirmedCandidates = secondDiscovery.candidates.filter(candidate =>
  confirmedCandidateDigests.has(candidate.candidateDigest),
);
if (
  confirmedCandidates.length !== confirmedCandidateDigests.size
  || secondDiscovery.coverage.complete !== true
  || secondDiscovery.coverage.uncoveredBlockingPlacements !== 0
) {
  throw new Error('HISTORICAL_MEDIA_ACTION_CONFIRMATION_STALE');
}

const archiveRequest = {
  action: 'archive-unrecoverable' as const,
  idempotencyKey: crypto.randomUUID(),
  reason: 'Stage 4 S4-BUG-014 已确认的不可恢复历史媒体归档',
  candidates: confirmedCandidates.map(({
    projectId,
    assetId,
    assetVersionId,
    candidateDigest,
  }) => ({ projectId, assetId, assetVersionId, candidateDigest })),
};
```

`confirmedCandidateDigests` 只能来自向用户展示并在操作时确认的精确摘要集合；不得自动补入未确认候选。

- [ ] **步骤 2：执行一次 POST 和一次字节相同重试**

两次请求的 JSON 字节、Origin、身份来源与幂等键必须一致。预期第一次 `reused=false`，第二次 `reused=true`，且 `remediationId` 完全相同。

- [ ] **步骤 3：验证事务和无副作用边界**

验证：

```text
remediation ledger = 1
管理员 audit = 1
积分事件 = 0
退款事件 = 0
物理删除 = 0
供应商调用 = 0
健康 current_version_id 不变
健康当前版本和 placement 可正常刷新、显示和访问
```

- [ ] **步骤 4：重新读取 readiness 与 shadow 对账**

再次读取 remediation 和 production readiness，确认已归档 placement 不再计入 blocker，shadow comparison 仍为 `6/6`，无新增 query error。只有 doctor 独立返回 `switchAuthorized=true` 时，才允许另立任务评估 `asset-v3`；本计划不执行切换。

- [ ] **步骤 5：保存云端证据并更新中文结论**

证据包含精确 main SHA、测试时间、requestId、remediationId、两次响应摘要、readiness 前后 aggregate、Chrome 截图、Console 与 Network 结果。任何未能通过数据库或管理员只读接口证明的项目必须写入 `UNVERIFIED_ITEMS.md`，不得标记通过。

- [ ] **步骤 6：提交最终证据，不修改业务源码**

```powershell
git add docs/testing/BUG_REGISTER.md docs/testing/REGRESSION_REPORT.md docs/testing/RELEASE_READINESS_REPORT.md docs/testing/UNVERIFIED_ITEMS.md docs/testing/evidence/s4-bug-014-cloud-archive-2026-08-22.json
git commit -m "docs: record cloud historical media archive acceptance"
git push origin HEAD:main
```

最终再次证明 `origin/stable` 与 V5.8.8 donor 均未变化。

---

## 完成判定

本计划只有同时满足以下条件才算完成：

- 非当前坏版本能被候选发现，且候选摘要绑定 `isCurrentVersion`。
- 覆盖统计由数据库实时计算，完整时差值为 0，截断或超界时 fail-closed。
- 归档非当前坏版本后，健康当前版本、`current_version_id`、健康 placement 和活跃 Asset 保持不变。
- 只处理显式选择的版本和 placement，无隐式批量归档。
- 并发相同请求只有一个 ledger 和一个 audit，同 key 不同请求冲突。
- snapshot 或 audit 故障导致整笔事务回滚。
- readiness blocker 在不改变 doctor 谓词的前提下正确对账。
- TypeScript、ESLint、全量 Vitest、PostgreSQL、生产构建、保护基线和 whitespace 检查全部通过。
- `stable` SHA 不变，V5.8.8 donor 未写入。
- 云端两轮只读结果稳定；任何归档 POST 都有新的操作时确认和完整证据。
- `asset-v3` 未被本计划擅自启用。

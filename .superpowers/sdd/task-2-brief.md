# WJ-STABLE-001 Stage 2 Task 2 Brief

## Task 2: 实现原子素材仓储、所有权与幂等流转

### Files

- Create: `src/lib/asset-core/storage.ts`
- Create: `src/lib/asset-core/service.ts`
- Test: `src/__tests__/lib/asset-service.test.ts`
- Test: `tests/integration/stage-2-asset-storage-postgres.test.ts`

### Interfaces

Consumes Task 1 types and tables. Produces:

```ts
createAssetVersion(input: CreateAssetVersionInput): Promise<{ asset: Asset; version: AssetVersion; reused: boolean }>;
createWorkspacePlacement(input: CreatePlacementInput): Promise<{ placement: WorkspacePlacement; reused: boolean }>;
sendVersionToWorkspace(input: TransferVersionInput): Promise<{ version: AssetVersion; placement: WorkspacePlacement; reused: boolean }>;
trashPlacement(input: PlacementCommand): Promise<{ placementTrashed: boolean; assetTrashed: boolean }>;
restorePlacement(input: PlacementCommand): Promise<{ placement: WorkspacePlacement; asset: Asset }>;
```

### Required TDD Sequence

1. Write pure-service RED coverage for same-key/same-digest reuse, same-key/different-digest `ASSET_IDEMPOTENCY_CONFLICT`, stable parent order, deleting one placement without deleting a shared asset, and trashing the asset after deleting its last active placement.
2. Write real PostgreSQL concurrency RED coverage: 20 concurrent `sendVersionToWorkspace()` calls create one target placement; cross-user sourceVersion, cross-user targetProject, forged ownerId, and concurrent delete/restore are rejected or serialized by transaction and owner/project predicates.
3. Run RED:

```powershell
pnpm exec vitest run src/__tests__/lib/asset-service.test.ts tests/integration/stage-2-asset-storage-postgres.test.ts
```

4. Implement a PostgreSQL repository. Every write uses one transaction. User identity comes only from the server-side session caller. Queries include `owner_id=$1 AND project_id=$2`; absent and foreign resources share a not-found result to avoid IDOR enumeration.
5. Implement transfer idempotency with this exact input:

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

The uniqueness scope is actor + sourceVersion + targetProject + targetWorkspace + entityType + entityId + idempotencyKey. The same key with a different digest conflicts.

6. Run GREEN with the same focused command. Unit tests must all pass; real PostgreSQL must prove 20 concurrent calls create exactly one placement.
7. Commit as `feat: add transactional asset graph service`.

### Binding Global Constraints

- Work only on `codex/wj-stable-s2` in `.worktrees/wj-stable-s2`; the implementation baseline is `origin/main@ffe810939a446bbf7288d177b95040b36a05484c`.
- `stable@a53da24aa9f3813aae24f697dfb90d0b67f0a455` is permanently read-only.
- Preserve all 38 protected functions, 5 product surfaces, and the infinite-canvas/node/standalone-chat workspace entries.
- Do not refactor the canvas kernel, node editor, Agent, or unrelated P2 defects.
- Legacy projects are read-only until explicit write; copy-on-write belongs to Task 3.
- URLs remain compatibility render/provider fields and never prove ownership.
- All new writes require authenticated actor and target-project authorization.
- Deleting a workspace node only trashes its `WorkspacePlacement`; an `Asset` becomes trashed only after its final active placement disappears. No physical file deletion.
- Failed/cancelled/timeout/late task results cannot become current versions; projection belongs to Task 7.
- Preserve parent-version order.
- `WUJIE_ASSET_GRAPH_MODE=legacy|shadow|asset-v3`, default `legacy`; Task 2 must not change rollout mode.
- Without real PostgreSQL evidence, conclusions remain BLOCKED/UNVERIFIED.

# WJ-STABLE-001 Stage 2 Task 1 Independent Review

Verdict=CHANGES_REQUESTED

Scope reviewed: Task 1 brief, implementer report, the full `dd20b84..b7dcd79` diff, and the Stage 2 plan's Global Constraints. No implementation files were modified and the implementer's test commands were not rerun.

## Critical

None.

## Important

### I1. Migration runner does not use the project's required `sslmode=require` normalization

- **File:line:** `scripts/run-migrations.mjs:18-24,50`
- **Impact:** `pnpm migrate` may not connect with the same PostgreSQL TLS semantics used by the deployed application. This is a release-blocking operability risk for Coze/cloud PostgreSQL URLs using `sslmode=require`; the reported verification used only `sslmode=disable`.
- **Evidence:** The established client normalizes `sslmode=require` by adding `uselibpqcompat=true` before constructing `pg` clients (`src/lib/db-client.ts:10-24,36-45`). The real-PostgreSQL test helper and doctor script do the same (`tests/helpers/postgres-test-database.ts:48-61`, `scripts/doctor.mjs:41-55`). The new runner instead passes the original connection string unchanged. `task-1-report.md` records a local URL ending in `sslmode=disable`, and `tests/integration/stage-2-asset-schema-postgres.test.ts:25-30` inherits that path.
- **Suggestion:** Extract or duplicate the existing pure connection-string normalizer for the `.mjs` runner and pass the normalized value to `Client`. Add a focused runner test for an `sslmode=require` URL; this need not contact a real service.

### I2. Ledger lookup and insertion are not serialized, so concurrent `pnpm migrate` processes can fail

- **File:line:** `scripts/run-migrations.mjs:54-79`
- **Impact:** Two deployment processes can both observe no ledger row at lines 59-63. One then applies and records the migration; the other can fail on the named `ALTER TABLE ... ADD CONSTRAINT` or the ledger primary-key insert. This turns a normally idempotent migration into a deployment race and leaves the second process failed rather than re-reading the committed checksum.
- **Evidence:** The read occurs before `BEGIN` (lines 59-73) and there is no advisory lock, row lock, or conflict-retry path. The SQL migration contains a non-idempotent `ALTER TABLE ... ADD CONSTRAINT` at `migrations/20260810_wj_stable_s2_assets.sql:58-62`, which makes the race deterministic after the first commit. The integration test runs the two migrations serially (`tests/integration/stage-2-asset-schema-postgres.test.ts:38-40`), so it cannot expose this behavior.
- **Suggestion:** Start a transaction before reading the ledger, take a transaction-scoped advisory migration lock, then re-read the checksum inside that lock before applying/inserting. Add a real PostgreSQL test that launches two runners against the same isolated schema and asserts both exit successfully with one ledger row.

### I3. The database accepts entity types that contradict their workspace

- **File:line:** `migrations/20260810_wj_stable_s2_assets.sql:87-102`
- **Impact:** A `canvas` placement can be persisted as `chat-result`, or a `chat` placement as `workflow-input`. Later readers and authorization/transfer code will have no reliable workspace/entity contract, risking invalid placements that cannot be rendered or deleted through their intended surface.
- **Evidence:** The schema independently checks the permitted workspace kinds (line 87) and entity types (lines 89-91), but contains no pairing constraint. The typed contract also accepts any `WorkspaceKind` with any `WorkspaceEntityType` (`src/lib/asset-core/types.ts:19-26,65-76`). The integration test verifies only a cross-asset parent and idempotency behavior; it never attempts an invalid workspace/entity pair (`tests/integration/stage-2-asset-schema-postgres.test.ts:93-117`).
- **Suggestion:** Add a `CHECK` that permits only `canvas/canvas-image`, `workflow/workflow-input|workflow-output`, and `chat/chat-attachment|chat-result`, then add rejection tests for each invalid pairing.

## Minor

### M1. The checksum tests do not verify the runner's SHA-256 audit behavior

- **File:line:** `tests/integration/stage-2-asset-schema-postgres.test.ts:33-40,114-117`
- **Impact:** A regression that writes a non-SHA checksum, skips mismatch detection, or changes the ledger lookup could pass the current suite. The test at lines 114-117 only proves that a second row with the same primary-key `version` is rejected; it does not exercise `run-migrations.mjs:58-68` with a recorded mismatching checksum.
- **Evidence:** The test never reads `wujie_schema_migrations.checksum` and never invokes the runner after preloading the migration version with a different checksum. Its two runner calls both use the unchanged migration file and therefore cover only the happy idempotent rerun.
- **Suggestion:** In a fresh isolated schema, precreate the ledger with the Task 1 migration version and a fake checksum, invoke the runner, and assert non-zero exit plus the mismatch error. In the happy path, assert that the stored checksum equals the SHA-256 of the migration bytes.

## Global Constraints Audit

1. `实施基线固定为 origin/main@ffe810939a446bbf7288d177b95040b36a05484c；工作分支为 codex/wj-stable-s2，工作目录为 .worktrees/wj-stable-s2。`
   - **STATIC PASS:** `ffe8109` is an ancestor of `b7dcd79`; HEAD is `codex/wj-stable-s2`; the Task 1 diff is limited to the seven specified implementation/test/package files.
2. `stable 分支永久只读；最后一次已确认值为 a53da24aa9f3813aae24f697dfb90d0b67f0a455，网络恢复后每个推送检查点重新核对。`
   - **UNVERIFIED:** no local or `origin/stable` ref is available in this worktree, and no remote checkpoint evidence is in the review package. The diff contains no branch-operation artifact, but that cannot prove the remote branch remained unchanged.
3. `38 项受保护功能、7 个产品表面、无限画布/节点模式/独立智能对话三个工作区入口保留率必须为 100%。`
   - **STATIC PASS / RUNTIME UNVERIFIED:** Task 1 changes none of those product modules. The required all-surface regression evidence is not part of this Task 1 package.
4. `本阶段不重构无限画布渲染/选择/历史内核，不重做节点编辑器或 Agent，不处理与本阶段无关的 P2。`
   - **PASS:** no such source files are in `dd20b84..b7dcd79`.
5. `旧项目只读打开不得触发破坏性重写；首次明确写操作才允许 copy-on-write，并且转换失败必须继续使用旧读取器。`
   - **STATIC PASS / RUNTIME UNVERIFIED:** no project-reader or migration behavior changed in Task 1; end-to-end reader behavior belongs to later tasks.
6. `URL 继续作为渲染和供应商调用的兼容字段，但 URL 本身不能证明素材归属；所有新写接口按登录用户和目标项目双重授权。`
   - **NOT YET APPLICABLE:** Task 1 adds no write API. The schema keeps `file_url` as data only; no authorization path exists yet to assess.
7. `删除工作区节点只删除/软删除 WorkspacePlacement；只有最后一个活动引用消失后 Asset 才进入回收站，保留期内不得删除物理文件。`
   - **NOT YET APPLICABLE:** no deletion service exists. The placement table has independent `status`/`deleted_at` fields, but lifecycle semantics remain unimplemented.
8. `failed、cancelled、timeout 与迟到结果不得成为当前有效版本；只有数据库权威 completed 转换可投影新版本。`
   - **NOT YET APPLICABLE:** Task 1 adds no task projector or authoritative completion query. This must be enforced and tested in Task 7.
9. `新版本父级顺序稳定；单图编辑一个父版本，多图融合/多参考图记录全部父版本。`
   - **PARTIAL STATIC PASS:** `wujie_asset_version_parents` keeps `parent_order` and uniquely constrains `(version_id, parent_order)` (`migrations/20260810_wj_stable_s2_assets.sql:64-79`). No service exists yet to preserve caller order, and no test verifies ordering, so runtime behavior remains unverified.
10. `开关固定为 WUJIE_ASSET_GRAPH_MODE=legacy|shadow|asset-v3。默认 legacy；云端先验证 shadow，一致性门禁通过后才允许 asset-v3。`
    - **PARTIAL STATIC PASS:** `resolveAssetGraphMode` returns only the three allowed values and defaults unknown/undefined input to `legacy` (`src/lib/asset-core/mode.ts:3-6`). No environment wiring, cloud shadow comparison, or asset-v3 gate exists in Task 1.
11. `无隔离 PostgreSQL、无可确认云端 Commit、无三浏览器证据时，对应结论只能标记 BLOCKED 或 UNVERIFIED。`
    - **UNVERIFIED FOR THIS REVIEW:** the report claims a real isolated PostgreSQL run, but provides no raw command output and it was not rerun per review instruction. There is no cloud commit or three-browser evidence. These are not counted as passing release evidence.

## Verification Boundaries

- Independently inspected the full diff, baseline ancestry, changed-file scope, SQL/TypeScript source, current database connection conventions, and the test source.
- `node --check scripts/run-migrations.mjs` succeeded.
- The implementer's focused Vitest run, `pnpm migrate` rerun, TypeScript check, and lint were deliberately not repeated.
- No real PostgreSQL, Coze deployment, cloud commit, or browser evidence was independently executed or confirmed in this review.

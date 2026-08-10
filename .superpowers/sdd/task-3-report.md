# WJ-STABLE-001 Stage 2 Task 3 Report

## Scope

Implemented only the binding Task 3 surface:

- pure v1/v2/v3 project readers and projection comparison;
- eight anonymous legacy project fixtures;
- explicit-write PostgreSQL copy-on-write migration;
- lossless compatibility fields in `src/lib/user-types.ts`;
- focused unit and real-PostgreSQL integration tests.

No product UI, infinite canvas, node editor, Agent, rollout mode, Task 4+, Task 1/2
review file, controller progress, Obsidian file, protected branch, or remote was changed.

## TDD Evidence

### RED

Raw command:

```powershell
$env:POSTGRES_TEST_DATABASE_URL='postgresql://postgres@127.0.0.1:55433/wujie_stage2_test?sslmode=disable'
pnpm exec vitest run src/__tests__/lib/project-readers.test.ts tests/integration/stage-2-legacy-migration-postgres.test.ts
```

Observed before either production module existed:

- exit code: `1`;
- test files: `2 failed / 2`;
- tests: `no tests` (collection stopped at the intended missing-module boundary);
- duration: `959ms`;
- exact causes:
  - `Cannot find module '@/lib/asset-core/project-readers'`;
  - `Cannot find module '@/lib/asset-core/legacy-migration'`.

This was the expected RED: fixture/test parsing reached the new imports and failed
only because the requested production interfaces did not exist.

### GREEN

Raw command (same focused command and real database):

```powershell
$env:POSTGRES_TEST_DATABASE_URL='postgresql://postgres@127.0.0.1:55433/wujie_stage2_test?sslmode=disable'
pnpm exec vitest run src/__tests__/lib/project-readers.test.ts tests/integration/stage-2-legacy-migration-postgres.test.ts
```

Observed after implementation:

- exit code: `0`;
- test files: `2 passed / 2`;
- tests: `16 passed / 16`;
- reader tests: `10 passed`;
- real PostgreSQL migration tests: `6 passed`;
- final pre-report run duration: `7.03s` (`5.84s` test body time).

## Fixture Matrix

| Fixture | Minimal legacy condition | Required evidence |
|---|---|---|
| `v1-images-alias.json` | absent `schemaVersion`, `images` alias, `/uploads/` URL | v1 dispatch, alias projection, returned URL normalization, frozen input and fixture bytes unchanged |
| `v1-data-url.json` | primary `data:` media | placement retained, `pending-persist`, `_pendingPersist`, unresolved-media entry |
| `v1-blob-url.json` | expired `blob:` media | placement retained, URL retained, `missing`, unresolved-media entry |
| `v1-source-url-recovery.json` | empty primary URL with remote `sourceUrl` | source preserved as recovery metadata, no remote download, media remains `missing` |
| `v1-video-3d-svg.json` | video, 3D maps/textures, SVG data/file, PSD file | all compatibility fields retained; only returned legacy local URLs normalized |
| `v1-processing-matrix.json` | active and failed processing placeholders | placeholder identity, progress/task/error/retry state retained |
| `v1-shared-placement.json` | two legacy IDs share one URL, group and annotation metadata | two assets/versions/placements, ID-keyed mappings, group/annotation retention |
| `v1-corrupt-project.json` | `canvasImages` is an object | `PROJECT_QUARANTINED`; no destructive `canvasImages: []` substitution |

The reader suite also supplies explicit inline schema v2 and v3 snapshots. V2 emits
`PROJECT_V2_TRANSITIONAL`; v3 uses the unified reader without compatibility warning.

## Reader Evidence

- `readProjectSnapshot(raw)` performs only cloning, validation, URL projection, and
  availability classification. It imports no DB or network facility.
- Deep-freeze plus before/after JSON bytes prove caller input is unchanged.
- Legacy `/uploads/...` values are normalized only in the returned model to
  `/api/serve-upload/uploads/...`; audit/source payload bytes remain unchanged.
- `sourceUrl`, video, 3D, SVG, PSD, processing, annotation, group, and unknown legacy
  metadata are carried forward.
- Duplicate legacy placement IDs quarantine rather than silently collapsing data.
- `compareLegacyAndAssetProjection` compares reader-normalized compatibility models
  while excluding only schema/audit/legacy-alias wrapper fields.

## Migration And Rollback Evidence

The migration is invoked only through the explicit
`migrateLegacyProjectOnWrite(input)` write interface. Read-only opening calls only the
pure reader.

Real PostgreSQL assertions:

- read-only open: `0 project / 0 asset / 0 version / 0 placement / 0 checkpoint` rows;
- first explicit write: `1 / 1 / 1 / 1 / 1` rows in one transaction;
- shared-URL migration: `1 project / 2 assets / 2 versions / 2 placements / 1 checkpoint`;
- rerun: identical checkpoint mappings, no new graph rows, `reused: true`;
- persistence failure: all five graph counts return to zero, no schema pointer exists,
  and the unchanged `wujie_user_data` payload reopens through source schema v1;
- successful data persistence: the injected persistence adapter runs once and the
  resulting version is `ready`;
- remote recovery URL: adapter call count does not increase, file remains `missing`,
  and `recovery_source_url` is retained;
- unauthorized actor: `LEGACY_PROJECT_NOT_FOUND` and zero actor-scoped graph rows.

The transaction locks the database-authoritative project inside
`wujie_user_data(user_id, data_key='projects')` by actor and project ID. All graph
lookups and updates include owner/project scope. URL values are never authorization
evidence and are never used for deduplication. Checkpoints map each legacy image ID to
one asset/version/placement triple. Successful completion alone updates
`wujie_projects.schema_version` to `3`; the original payload remains unchanged in
`wujie_user_data` and is copied to `metadata.legacyAuditPayload` for read-only audit.

There is no remote fetch and no physical-media deletion. If a persistence adapter has
already materialized one file before a later item fails, database graph and pointer
state still roll back; the materialized file is intentionally not deleted and remains
eligible for later orphan-media governance.

## Static Gates

Commands run during implementation:

```powershell
pnpm ts-check
pnpm exec eslint src/lib/asset-core/project-readers.ts src/lib/asset-core/legacy-migration.ts src/lib/user-types.ts src/__tests__/lib/project-readers.test.ts tests/integration/stage-2-legacy-migration-postgres.test.ts --quiet
git diff --check -- src/lib/asset-core/project-readers.ts src/lib/asset-core/legacy-migration.ts src/lib/user-types.ts src/__tests__/lib/project-readers.test.ts tests/integration/stage-2-legacy-migration-postgres.test.ts tests/fixtures/projects .superpowers/sdd/task-3-report.md
```

- `pnpm ts-check`: initial static pass exposed two invalid generic matcher uses in the
  new integration test (`TS2558`); assertions were changed to the repository's
  `satisfies Partial<...>` pattern. Fresh rerun exited `0`.
- changed-file ESLint: exit `0`, no output.
- Task 3 path `git diff --check`: exit `0`, no output.

Final fresh command outputs after the initial report edit:

- focused tests: exit `0`, `2 passed / 2` files, `16 passed / 16` tests,
  duration `6.83s`;
- `pnpm ts-check`: exit `0`;
- changed-file ESLint: exit `0`, no output;
- Task 3 path `git diff --check`: exit `0`; Git emitted only its working-tree
  LF-to-CRLF conversion notice for this report, with no whitespace error.

Per the brief, the controller runs full-repository tests, production build, login gate,
and 38-function protected gate after review; this implementer did not pre-empt those
controller gates.

## Self-Review

- [x] Eight fixtures are synthetic, anonymous, and minimal.
- [x] RED was observed before production implementation.
- [x] Reader has no mutation, DB, network, or write side effect.
- [x] V1 absent schema, V2 transitional, V3 unified, and corrupt quarantine are explicit.
- [x] Placements survive pending/missing media classifications.
- [x] Rich media, processing, annotation, and group metadata are retained.
- [x] Copy-on-write occurs only on explicit migration invocation.
- [x] Project, graph, checkpoint, and schema-pointer update share one transaction.
- [x] Reruns use owner/project/legacy-ID checkpoint mappings, not URLs.
- [x] Source legacy JSON stays unchanged and available for rollback/reopen.
- [x] Actor/project authorization is fail-closed; URLs never prove ownership.
- [x] No media is physically deleted and no remote URL is downloaded.
- [x] No rollout mode or protected product/runtime surface was modified.

## Risks And Checkpoint A

- External `stable@52f7c60` drift remains an explicit Checkpoint A governance blocker.
  It was not fetched into, reconciled by, reverted by, or pushed from this task.
- Full repository, build, login, protected-function, and cloud SHA conclusions remain
  pending controller review and must not be inferred from this focused evidence.
- External media persistence cannot be transactionally erased after a later database
  rollback because physical deletion is forbidden; such files remain unreferenced and
  await the later orphan-media governance task.

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

## Independent Review Fixes

This follow-up closes all three implementation-blocking findings against commit
`8b73b68d59675d2f5af20d8be6f8e6eee44750a4`. It remains limited to the two Task 3
implementation files, their two covering test files, and this report.

### Review RED

The three new regressions were added before changing production code. Raw command:

```powershell
$env:POSTGRES_TEST_DATABASE_URL='postgresql://postgres@127.0.0.1:55433/wujie_stage2_test?sslmode=disable'
pnpm exec vitest run src/__tests__/lib/project-readers.test.ts tests/integration/stage-2-legacy-migration-postgres.test.ts
```

Pre-fix result:

- exit code: `1`;
- test files: `2 failed / 2`;
- tests: `3 failed / 16 passed / 19 total`;
- duration: `6.84s`;
- failures:
  - project description `/uploads/not-a-url-note` was incorrectly rewritten to a
    serve-upload URL, proving normalization escaped media fields;
  - semantically identical nested objects with different key insertion order returned
    `project:projection-mismatch`;
  - persistence adapters received no retry-stable mapping, so the failed-attempt values
    were `undefined` while the retry returned new random graph IDs.

### Fix 1: URL-Bearing Fields Only

The reader now clones the full project without URL rewriting, then normalizes only these
direct CanvasImage media fields: `url`, `videoUrl`, `videoThumbnailUrl`,
`threeDModelUrl`, `svgUrl`, and `psdUrl`. It recursively normalizes values only inside
the typed 3D URL containers `threeDModelUrls`, `threeDThumbnailUrls`, and
`threeDTextureUrls`.

Prompt, description, annotation text, group name/note, image unknown metadata, project
unknown metadata, and `sourceUrl` are preserved exactly even when their text begins
with `/uploads/`. Existing actual media URL projection remains
`/api/serve-upload/uploads/...`.

Focused reader proof after this change:

```powershell
pnpm exec vitest run src/__tests__/lib/project-readers.test.ts
```

Result: exit `0`, `1 passed / 1` file, `12 passed / 12` tests, duration `519ms`.

### Fix 2: Rollback-Safe Stable Mappings

Asset, version, and placement IDs are now deterministic UUID-shaped identifiers derived
with SHA-256 from:

```text
wujie-legacy-migration-v1 + actor owner ID + project ID + legacy image ID + graph role
```

The migration checkpoint ID is likewise deterministic per owner/project. URL is not an
input, so shared URLs do not merge and URLs still prove no ownership. The mapping is
created before a `data:` persistence adapter runs and is included in the adapter input,
allowing external persistence to use the same IDs across retries without retaining a
failed database checkpoint.

The real PostgreSQL regression uses two `data:` placements. Attempt one successfully
returns from the first persistence call and fails on the second. It then proves all five
database counts are zero, including checkpoints. The retry observes the exact same two
mappings, commits one project graph, and proves final counts of `1 project / 2 assets /
2 versions / 2 placements / 1 checkpoint`, with two distinct IDs in each graph table.

No remote URL is downloaded, no URL is used for deduplication or authorization, no
physical media is deleted, and the graph/schema pointer remains fully transactional.

### Fix 3: Canonical Structural Comparison

`compareLegacyAndAssetProjection` now recursively sorts object keys before comparison.
Array order remains significant. The regression reverses top-level, image, settings,
and nested metadata key insertion order while retaining identical values and expects
`{ matches: true, differences: [] }`.

### Review GREEN And Static Gates

Raw focused command:

```powershell
$env:POSTGRES_TEST_DATABASE_URL='postgresql://postgres@127.0.0.1:55433/wujie_stage2_test?sslmode=disable'
pnpm exec vitest run src/__tests__/lib/project-readers.test.ts tests/integration/stage-2-legacy-migration-postgres.test.ts
```

Observed result after all three fixes:

- exit code: `0`;
- test files: `2 passed / 2`;
- tests: `19 passed / 19`;
- reader tests: `12 passed`;
- real PostgreSQL migration tests: `7 passed`;
- duration: `7.19s` (`6.11s` test body time).

Additional commands:

```powershell
pnpm ts-check
pnpm exec eslint src/lib/asset-core/project-readers.ts src/lib/asset-core/legacy-migration.ts src/__tests__/lib/project-readers.test.ts tests/integration/stage-2-legacy-migration-postgres.test.ts --quiet
git diff --check -- src/lib/asset-core/project-readers.ts src/lib/asset-core/legacy-migration.ts src/__tests__/lib/project-readers.test.ts tests/integration/stage-2-legacy-migration-postgres.test.ts .superpowers/sdd/task-3-report.md
```

- `pnpm ts-check`: exit `0`;
- changed-file ESLint: exit `0`, no output;
- path diff check: exit `0`; the working-tree run emitted only Git LF-to-CRLF notices,
  with no whitespace error. The staged commit is checked again before commit.

The follow-up does not amend `8b73b68`, update controller progress, include an external
review file, touch UI/Task 4+, or push any branch. Checkpoint A concerns above remain
unchanged.

## Controller Gate Results

After the second independent review approved the task with zero findings, the
controller ran the complete local Checkpoint A gate against
`b1fc8f40f4c8aa41f798e0dc3c03463675b6c9a0`:

- real PostgreSQL Task 3 suite: `19/19` passed;
- login protection suite: `18/18` passed;
- `pnpm ts-check`: exit `0`;
- `pnpm lint:build`: exit `0`;
- full `pnpm test`: exit `0`;
- `pnpm build`: exit `0`, `112/112` routes/pages generated;
- protected baseline: `38/38`, no unapproved drift and zero warnings.

The all-suite run intentionally retained environment-gated PostgreSQL skips; Task 1-3
database behavior has separate fresh evidence against the isolated PostgreSQL 18
database. No cloud or exact-runtime conclusion is inferred from local evidence.

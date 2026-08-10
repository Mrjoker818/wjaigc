# WJ-STABLE-001 Stage 2 Task 3 Brief

## Task 3: 建立 v1/v2/v3 项目读取器与 copy-on-write 迁移

### Files

- Create: `src/lib/asset-core/project-readers.ts`
- Create: `src/lib/asset-core/legacy-migration.ts`
- Create eight anonymized fixtures under `tests/fixtures/projects/`:
  - `v1-images-alias.json`
  - `v1-data-url.json`
  - `v1-blob-url.json`
  - `v1-source-url-recovery.json`
  - `v1-video-3d-svg.json`
  - `v1-processing-matrix.json`
  - `v1-shared-placement.json`
  - `v1-corrupt-project.json`
- Modify: `src/lib/user-types.ts`
- Test: `src/__tests__/lib/project-readers.test.ts`
- Test: `tests/integration/stage-2-legacy-migration-postgres.test.ts`

### Interfaces

```ts
readProjectSnapshot(raw: unknown): ProjectReadResult;
migrateLegacyProjectOnWrite(input: LegacyMigrationInput): Promise<MigrationResult>;
compareLegacyAndAssetProjection(input: ProjectionComparisonInput): ProjectionComparison;
```

`ProjectReadResult` returns `project`, `sourceSchemaVersion`, `writeTargetVersion: 3`, `warnings`, and `unresolvedMedia`, without mutating the input object.

### Required TDD Sequence

1. Commit eight anonymous, minimal fixtures and write RED tests. Absent `schemaVersion` is v1; `images` aliases project into the read model while the original JSON bytes remain unchanged; v2 uses the transitional reader; v3 uses the unified reader; corrupt input returns a quarantine warning rather than `canvasImages: []`.
2. Write copy-on-write RED tests. Read-only open creates no graph rows. The first explicit save transactionally creates project/assets/versions/placements. If any media conversion fails, the read pointer does not switch and the project can still reopen through v1.
3. Run RED:

```powershell
pnpm exec vitest run src/__tests__/lib/project-readers.test.ts tests/integration/stage-2-legacy-migration-postgres.test.ts
```

4. Implement a side-effect-free reader. Project old `/uploads/` only in the returned read model as `/api/serve-upload/uploads/`. Preserve `sourceUrl`, video/3D/SVG/PSD, processing placeholders, annotations, and group metadata. Classify `data:` as `pending-persist` and invalid `blob:` as `missing`; never delete a placement.
5. Implement recoverable migration with a per-project checkpoint. Reruns reuse legacy image-ID mappings. Do not download remote URLs during migration and do not merge assets merely because URLs match. After the first successful explicit write, set `schemaVersion=3` and retain the old payload as a read-only audit field.
6. Run GREEN with the same focused command. All eight fixtures pass and rerunning migration creates no duplicate rows.
7. Run `pnpm ts-check`, `pnpm lint:build`, full tests, protected/login gates and `pnpm build`. Commit as `feat: add lossless legacy project readers`.

### Checkpoint A Gate

- Checkpoint A requires Tasks 1-3 complete, full tests, login protection, 38 protected functions, and production build.
- Coze may start only in `legacy` or `shadow`; direct `asset-v3` is forbidden.
- The externally observed `stable@52f7c60` is not yet accepted as the protected baseline. Local Task 3 may proceed, but no Checkpoint A push/deploy occurs until branch governance is confirmed.

### Binding Global Constraints

- Work only on `codex/wj-stable-s2` in `.worktrees/wj-stable-s2`.
- Do not touch or push `stable`; do not push `main` before Checkpoint A.
- Preserve all protected functions and all three workspace entries.
- Do not refactor the canvas kernel, node editor, Agent, or business tools.
- Read-only legacy open must have no side effect. Copy-on-write occurs only on explicit write and must roll back completely on failure.
- Keep URL compatibility fields; URL never proves ownership.
- Do not delete old JSON, readers, fields, new tables, versions, placements, or physical media.
- `WUJIE_ASSET_GRAPH_MODE` remains `legacy|shadow|asset-v3`, default `legacy`.
- Without real PostgreSQL and exact cloud SHA evidence, cloud conclusions remain UNVERIFIED.

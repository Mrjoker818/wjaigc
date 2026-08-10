# WJ-STABLE-001 Stage 2 Data Model Audit

Scope: approved design section 5 and Stage 2 only. No production code or tests were changed.

## Current persistence

- PostgreSQL access is raw `pg` through `src/lib/db-client.ts`; Drizzle contains only
  `health_check` in `src/storage/database/shared/schema.ts`. There is no checked-in SQL
  migration directory, migration ledger, or migration runner. Schema changes are issued
  lazily by `CREATE TABLE IF NOT EXISTS` and `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`.
- `wujie_user_data(user_id, data_key, data_value JSONB, updated_at)` is the actual
  general project store. `dbGetUserData`, `dbSetUserData`, and `dbDeleteUserData` in
  `src/lib/db-storage.ts` replace the whole JSON value per `(user_id, data_key)`.
  `projects` is an array of `Project` documents, not a relational project table.
- `Project` and `CanvasImage` (`src/lib/user-types.ts`) combine project identity,
  canvas placement (`x/y/width/height/rotation/zIndex`), image URL, generation metadata,
  task state, and media metadata in one mutable document. `canvas-workspace.tsx` persists
  it through `/api/user-data/sync`; the route filters by `userId` and repairs cross-user
  project-id collisions, but does not validate asset ownership or media URLs.
- Durable task truth is `cloud_tasks`: owner, optional `project_id/session_id/message_id`,
  provider/model, state, lease, idempotency, credit references, and JSONB `result`.
  `cloud-task-storage.ts` exposes create/update/CAS transition/read/list operations;
  `cloud-task-persistence.ts` stores image URL arrays, masks, video URLs, and 3D URLs in
  `result`; `agent-task-persistence.ts` stores image URL plus steps. These are URL
  snapshots, not asset/version records.
- Media bytes are stored in server data directories and best-effort S3 at `images/{filename}`.
  `/api/save-image`, `/api/cache-image`, and `persistRemoteImage` write local files and may
  upload to S3. `wujie_image_source_map(filename, source_url, created_at)` is only a global
  recovery lookup. `/api/serve-upload/[...path]` is public by design and authorizes neither
  a user nor a project; it falls back from local disk to S3 and then the saved source URL.
- Nearby but non-unified records are `wujie_artifacts` plus `wujie_artifact_versions`
  (text artifacts, project/user scoped), `brand_ip_projects` plus `brand_ip_assets`
  (per-project image rows with a local integer version), `ai_psd_tasks` plus
  `ai_psd_files`, `wujie_resources`, `wujie_backups`, `wujie_desktop_devices`,
  `wujie_local_generation_records`, `wujie_chat_memories`, and
  `wujie_shared_conversations`. Core tables also include users, providers, system settings,
  recharge orders, brand assets, groups, credits, credit transactions, and audit logs.

## Gap against the approved contract

| Contract | Current state | Stage 2 gap |
| --- | --- | --- |
| `UnifiedProject` | Project JSON is embedded under one user-data key. | No project row, status, workspace references, or `schemaVersion`; whole-document overwrite prevents scoped concurrent updates. |
| `Asset` | URLs occur in canvas images, task JSON, specialized tables, and filesystem/S3. | No canonical id/owner/project/kind/status/current-version identity; no recycle-bin semantics. |
| immutable `AssetVersion` | Brand IP has an unrelated sequence number; artifacts retain prior text. | No immutable file/provenance/generation/billing record, checksum, byte/dimension metadata, parent-version graph, or atomic current-version promotion. |
| `WorkspacePlacement` | Canvas geometry is embedded in `CanvasImage`; workflow/chat contain URL references. | No common placement id, workspace scope, entity type, lifecycle, or independent deletion/reuse across canvas/workflow/chat. |
| task result projection | `cloud_tasks.result` persists URLs and is recoverable after restart. | A completed task does not atomically create versions or placements; cancelled/timeout/late-result isolation is only task-state logic, not data-model enforced. |

## Additive migration and rollback constraints

1. Introduce an explicit, ordered SQL migration ledger before Stage 2 data writes. A runtime
   initializer is insufficient for auditable, multi-replica backfill/rollback. The initial
   migration should create only additive tables: `wujie_projects`, `wujie_assets`,
   `wujie_asset_versions`, `wujie_workspace_placements`, and (recommended)
   `wujie_asset_version_parents` for ordered multi-parent lineage. Keep legacy project JSON
   readable throughout Stage 2.
2. All new rows need explicit `owner_id` and `project_id` where they are queried. Enforce
   status/kind/workspace/entity-type check constraints, unique `(owner_id, project_id, id)`
   lookup paths, a unique active placement identity appropriate to each workspace, and indexes
   on owner/project/status, asset/current version, version/asset/created time, task id, and
   placement/workspace. Do not add a foreign key to legacy project JSON; reference only new
   relational project rows. A nullable/deferrable `current_version_id` is required to break
   the Asset <-> AssetVersion creation cycle.
3. Write a resumable, idempotent backfill: read legacy `projects`, create a relational
   project and one asset/version/placement per valid `canvasImages` entry, preserve the legacy
   image id in migration metadata, and record a durable per-project checkpoint. Do not fetch
   or trust remote URLs during schema backfill. Missing/invalid media becomes an explicit
   unavailable version state, never a synthetic blank image.
4. Roll forward by dual-read, then dual-write behind `legacy`, `core-v2-shadow`, and
   `core-v2` flags. Compare counts and owner/project membership before selecting the new
   reader. Keep old JSON and URL fields until at least one verified stable cycle.
5. Deployment rollback must turn off the new reader/writer only; it must not drop new tables,
   columns, indexes, or version records. Any later destructive down migration requires an
   export, confirmed absence of references, and a separate stable-cycle decision. If indexes
   are created concurrently, run them outside the transactional DDL step and make each one
   independently retryable.

## TDD implementation candidates

Create:

- `migrations/20260810_wj_stable_s2_assets.sql` and `migrations/20260810_wj_stable_s2_assets.down.sql`, plus an explicit migration runner/ledger (no existing runner is present).
- `src/lib/asset-types.ts`, `src/lib/asset-storage.ts`, `src/lib/asset-version-projector.ts`, and `src/lib/project-versioned-reader.ts`.
- `tests/integration/stage-2-asset-storage-postgres.test.ts` using `tests/helpers/postgres-test-database.ts` for constraints, transactions, idempotent backfill, lineage, tombstones, and rollback compatibility.
- `src/__tests__/lib/asset-storage.test.ts`, `src/__tests__/lib/asset-version-projector.test.ts`, `src/__tests__/api/assets-ownership.test.ts`, `src/__tests__/api/workspace-placements-ownership.test.ts`, and `src/__tests__/api/task-result-asset-projection.test.ts`.

Modify only after those tests fail:

- `src/lib/user-types.ts`, `src/lib/user-manager.ts`, `src/components/canvas-workspace.tsx`, and `src/app/api/user-data/sync/route.ts` for dual readers/writers and placement projection.
- `src/lib/cloud-task-persistence.ts`, `src/lib/agent-task-persistence.ts`, `src/lib/task-core/task-service.ts`, and terminal producers under `src/app/api/` to create versions only from authoritative completed transitions.
- `src/app/api/save-image/route.ts`, `src/app/api/cache-image/route.ts`, `src/lib/s3-storage.ts`, `src/lib/image-source-map.ts`, and `src/app/api/serve-upload/[...path]/route.ts` to return/store media identity rather than treating a public URL as ownership proof.
- Extend `src/__tests__/lib/cloud-task-persistence.test.ts`, `tests/integration/task-state-postgres.test.ts`, `src/__tests__/api/save-image-auth-contract.test.ts`, `src/__tests__/api/public-media-access-contract.test.ts`, `src/__tests__/components/project-autosave-wiring.test.ts`, and `src/__tests__/lib/user-manager-project-delete.test.ts`.

## Security and isolation risks

- Public `/api/serve-upload` exposes any guessed allowed media path without an owner/project
  check. S3 keys and source-map keys are global filenames, not tenant namespaces. Stage 2 must
  decide which assets are deliberately public and serve private assets through an authenticated,
  owner-scoped resolver or short-lived signed URL.
- `wujie_image_source_map` can associate a colliding filename with another user's source URL;
  recovery then fetches it without tenant validation. Source URLs are also a stored SSRF/replay
  surface: the recovery/serve path needs the same host/DNS validation as ingestion, redirect
  handling, content validation, and a revalidation policy.
- The projects JSON endpoint checks `Project.userId` but accepts arbitrary nested image URLs and
  is a last-writer-wins whole-array write. It cannot prove that a referenced task result, media
  object, or placement belongs to the caller. New read/write APIs must query by both owner and
  project in every mutation and never accept owner ids from the client.
- `cloud_tasks.project_id` is not a foreign key and task-result JSON has no ownership-bound
  version reference. A projector must load the task with `user_id`, reject terminal races via
  the existing revision/status transition, and make version insertion plus current-version
  promotion atomic. Late completions for failed/cancelled/timed-out tasks go to an isolated
  record, never the current asset or placement.
- Existing specialized project tables are inconsistent: some provide user-scoped CRUD while
  `wujie_artifacts` accepts a project id then checks only its own `user_id`. Do not infer that a
  matching project id grants access; enforce canonical project ownership before bridging any
  legacy Brand IP, PSD, desktop, workflow, or chat record into AssetVersion.

## Evidence

- Design: `docs/superpowers/specs/2026-08-08-wujie-stable-core-upgrade-design.md` sections 5 and 9/Stage 2.
- Storage: `src/lib/db-storage.ts`, `src/lib/cloud-task-storage.ts`, `src/lib/cloud-task-persistence.ts`, `src/lib/agent-task-persistence.ts`, `src/lib/image-source-map.ts`, `src/lib/s3-storage.ts`.
- Project/media/API: `src/lib/user-types.ts`, `src/lib/user-manager.ts`, `src/app/api/user-data/sync/route.ts`, `src/app/api/save-image/route.ts`, `src/app/api/cache-image/route.ts`, `src/app/api/serve-upload/[...path]/route.ts`, `src/app/api/artifacts/route.ts`.

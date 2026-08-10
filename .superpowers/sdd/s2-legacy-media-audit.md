# WJ-STABLE-001 Stage 2: Legacy Project and Media Audit

## Scope and Method

Planning audit only. No production source or test file was changed. This report
inspected the existing project JSON reader/writer, browser and database sync,
canvas restoration, processing placeholders, media persistence/recovery, and
delete paths against the Stage 2 design requirement for `Asset`, `AssetVersion`,
`WorkspacePlacement`, trash, orphan handling, broken-media presentation, and
versioned legacy readers.

The Stage 2 design calls for `schemaVersion` readers (`1 -> LegacyProjectReader`,
`2 -> TransitionalProjectReader`, `3 -> UnifiedProjectReader`) and a copy-on-write
migration. See `docs/superpowers/specs/2026-08-08-wujie-stable-core-upgrade-design.md`
sections 5.1-5.4 and 9, especially the requirement that a broken medium must not
silently render as an ordinary blank frame.

## Current Reproducible Behavior

### Project reads and schema handling

1. `UserManager.loadData()` parses `unbounded_ai_user_data` as untyped JSON. A
   legacy single-user shape (`{ user, projects, ... }`) is wrapped into the
   multi-user shape and immediately persisted. Other payloads are assigned as-is.
   There is no project `schemaVersion` dispatch, validation, warning state, or
   reader fallback. `Project` itself has no version/status field.
2. `UserManager.loadProjectsFromServer()` recognizes one historical field alias:
   `project.images` is assigned to `project.canvasImages`; a non-array
   `canvasImages` is changed to `[]`. This normalization happens for server,
   local, and filtered local project lists, then the merged payload is saved.
3. Import accepts JSON or HTML `.wujie` exports, checks only `format` and
   `project`, ignores the export version, clones the object with a new project ID,
   and saves it. No import schema migration or media verification occurs.
4. `normalizeImageUrls()` rewrites legacy `/uploads/...` URLs to
   `/api/serve-upload/uploads/...`, preserves `blob:` URLs while marking
   `_needsPersist`, and marks `data:` URLs `_pendingPersist`. It does not verify
   accessibility or record a user-visible broken-media state.

### Autosave, restore, and placeholders

1. `CanvasWorkspace` maps persisted canvas images into UI images on both project
   load paths and marks any existing `processing` record as `isResumed: true`.
   The 1-second autosave serializes a selected set of fields, persists only rows
   with `url`, `videoUrl`, `svgDataUrl`, or an active processing placeholder, and
   updates the JSON blob through `UserManager.updateProject()`.
2. Active placeholder task IDs are written before initial polling. On reopening,
   task-ID placeholders resume `/api/poll-task`; legacy placeholders without a
   task ID query `/api/tasks/recover` and attach only an exact, unambiguous
   prompt/model match. Resumed polling gives up after 400 attempts and labels the
   placeholder failed.
3. `UserManager.protectAgainstDataLoss()` retains at most four local snapshots,
   but first removes all `data:` and `blob:` URLs. It restores only when a project
   fell from at least ten images to zero and a snapshot contains at least ten.
4. On quota failure, `saveData()` writes a deep-cloned version in which every
   `data:`/`blob:` URL is `''` with `_needsPersist: true`. A reload has no original
   in-memory URL from which to restore. The canvas load path creates an image with
   the empty URL, the renderer returns no image for that row, and the autosave
   filter drops it unless it is a processing placeholder.
5. A normal project load currently omits `sourceUrl` from both persisted-to-UI
   mappings (`canvas-workspace.tsx` around lines 448 and 688). The subsequent
   autosave writes `sourceUrl: img.sourceUrl || ''`; opening and saving a project
   can therefore erase an otherwise recoverable source URL.

### Broken media and media recovery

1. The canvas image `onError` retries a thumbnail as the original, rewrites
   `/uploads/` to `/api/serve-upload/`, and for an external URL attempts
   `/api/save-image`. It has no terminal visual state, retry action, recovery
   action, or persisted reason. A failed local `/api/serve-upload/` URL only tries
   an in-memory cache mapping and can remain blank.
2. `completeProcessingFrame()` explicitly logs and skips fallback when a managed
   local URL cannot load. That behavior prevents a recursive persistence attempt,
   but leaves no durable broken-media state for the user.
3. `/api/recover-images` is an admin-only repair endpoint. It scans only database
   `canvasImages[].url` values under `/api/serve-upload/`, checks local files, and
   restores S3/source-map content when possible. It neither updates project data
   nor serves end-user recovery, ignores video/3D/PSD/SVG references and
   `sourceUrl` stored in the project, and has no UI caller.
4. `stable-image-url.ts` provides best-effort remote persistence and transient
   in-memory URL caches. A failed persistence returns the original URL without a
   durability guarantee or asset record.

### Deletion, batch deletion, trash, and orphan media

1. Canvas deletion and project-data-panel batch deletion remove canvas rows only.
   The workspace records recently deleted IDs for merge suppression (60 seconds
   in `UserManager`, five seconds in its local ref) and autosaves the changed
   project. It does not delete or trash the backing media.
2. Dashboard batch asset deletion loops through affected projects and removes
   image rows one project at a time. Project deletion removes project JSON and
   performs one optimistic complete-project sync. Both interfaces tell the user
   deletion is irreversible.
3. No `trash`/`trashed` project or media status, restore endpoint, retention
   policy, reference count, deletion journal, or orphan sweeper exists in the
   canvas project system. `deleteImageFile()` is only used by layer-decomposition
   temporary output cleanup, not canvas/project deletion.
4. Consequently all normal deletion paths create retained files/S3 objects with
   no project reference. Conversely, adding a naive physical delete in Stage 2
   would break shared or copied URLs because the current model has no asset ID,
   version ID, reference count, or ownership-aware placement table.

## Exact Risks

| Risk | Reproduction | Impact |
| --- | --- | --- |
| Silent destructive migration | Load an old project with an invalid/missing `canvasImages` or unsupported shape, then trigger any save. | The reader writes `[]` without a version gate; legacy data becomes unrecoverable from the main record. |
| Data/blob media loss | Store a project with a large `data:` URL, force localStorage quota fallback, reload, then autosave. | Empty URL row becomes invisible and is filtered out; snapshots also lack recoverable bytes. |
| Source recovery erased | Persist a local media URL plus `sourceUrl`, open the project, then wait for autosave. | Existing recovery provenance is overwritten with an empty string. |
| Blank means healthy | Break a managed URL or remove the file and reopen the project. | The canvas has no durable failed-media state, accessible explanation, repair route, or retry history. |
| Limited recovery inventory | Lose a video, 3D model, PSD, SVG, external URL, or a `sourceUrl` not in the source map. | Admin scan cannot see or recover it. |
| Orphan cost and privacy exposure | Delete canvas items/projects repeatedly. | Managed files and S3 objects remain forever; no retention or evidence of ownership/deletion. |
| Unsafe future physical deletion | Reuse one URL across projects/workspaces, then delete one placement. | A URL-level delete would break still-live references because current project JSON is the only relation. |
| Restore races | Delete an image while a delayed sync/placeholder completion arrives. | Short-lived ID filters reduce one race but do not give durable delete precedence or a tombstone. |
| Placeholder over-retention | Persist a non-terminal placeholder that never receives a task ID or a provider response. | It can survive autosaves with no durable diagnostic/dead-letter model; existing legacy matching intentionally refuses ambiguity. |

## Compatibility and Migration Strategy

1. Introduce a pure, side-effect-free `readProjectSnapshot(raw)` dispatcher. Treat
   absent `schemaVersion` as legacy version 1. Keep current `images` alias and
   historical URL forms inside `LegacyProjectReader`; do not mutate the supplied
   JSON during read.
2. Define v2 only as an explicit transitional envelope and v3 as the unified
   `Project/Asset/AssetVersion/WorkspacePlacement` record described in the
   approved design. Every reader returns: normalized read model, source version,
   migration warnings, unresolved media descriptors, and a `writeTargetVersion`.
3. Copy on write: old records remain byte-for-byte readable. On the first explicit
   successful mutation, create v3 asset/version/placement records transactionally,
   retain legacy payload/audit metadata, and switch the project pointer only after
   all required media records are committed. Reader or migration failure must keep
   the legacy reader active and expose a non-destructive warning.
4. Convert each legacy `CanvasImage` to one Asset, one AssetVersion, and one
   Canvas WorkspacePlacement. Deduplicate only on a verified media checksum plus
   owner/project policy; do not use raw URL equality as identity. Preserve
   `sourceUrl`, dimensions, prompt/model/provider, SVG/3D/video metadata, group
   relation, processing provenance, and canvas transform separately.
5. Materialize a media state (`ready`, `pending-persist`, `missing`, `recovering`,
   `unrecoverable`, `trashed`) rather than blanking a URL. `blob:` may only be
   current-session pending media; after reload it must become an explicit missing
   state unless a persisted object/version is known. Never autosave a missing media
   placement as deletion without a user delete command.
6. Make delete a placement removal first. Move an unreferenced Asset to trash in
   a transaction, retain versions and blob records through a fixed retention
   window, and restore placements/assets before final purge. A scheduled sweeper
   may purge only media confirmed unreferenced after the retention deadline; it
   must be idempotent, owner-scoped, auditable, and resilient to concurrent restore.
7. Keep `/api/recover-images` as an admin repair tool during transition, but make
   it operate on asset/version records and write a recovery attempt/result. The
   user-facing broken-media UI should request a scoped repair/retry endpoint and
   never rely on an invisible canvas image error.

## Fixtures and Tests Needed

Create committed, small JSON fixtures under `tests/fixtures/projects/`; no such
legacy project fixture set exists today. Do not use real user data or remote URLs.

| Fixture | Required coverage |
| --- | --- |
| `v1-images-alias.json` | No `schemaVersion`, legacy `images`, `/uploads/` URL, all canvas transform and provenance fields. Verify read-only open and first-write v3 conversion. |
| `v1-data-url.json` | A tiny data URL marked pending plus its expected media-state result. Verify quota/reload cannot silently remove its placement. |
| `v1-blob-url.json` | Expired `blob:` URL and no object record. Verify explicit missing state, not normal blank output. |
| `v1-source-url-recovery.json` | Managed URL plus `sourceUrl`. Verify open-save-reopen preserves provenance and broken-media recovery can use it. |
| `v1-video-3d-svg.json` | Image, video, model-3d, SVG/PSD references and thumbnails. Verify all become asset versions and remain valid/recoverable. |
| `v1-processing-matrix.json` | Submitting without task ID, resumable task ID, ambiguous legacy match, completed, failed, and cancelled placeholder. Verify no guessed task attachment or valid-version creation for terminal failure. |
| `v1-shared-placement.json` | Two placements/projects referencing one version. Verify deleting one removes only that placement; trash occurs only after the final reference. |
| `v1-corrupt-project.json` | Unsupported/malformed fields. Verify a quarantined read error and no write-back of `canvasImages: []`. |

Add behavioral tests rather than source-string contracts where possible:

- Unit: version dispatcher/readers, lossless legacy projection, copy-on-write
  migration, source URL retention, media-state transitions, reference accounting,
  trash/restore/purge eligibility, and idempotent orphan sweep.
- API + PostgreSQL: atomic asset/version/placement creation; owner isolation;
  delete-versus-restore and delete-versus-late-task races; broken-media recovery;
  404/expired object state; final purge after retention; no object deletion while a
  placement or live version remains.
- Component: old project opens with identical item count/transforms; missing
  media has a visible actionable error; restore updates the placement; a deleted
  item can be restored; a failed placeholder does not masquerade as an asset.
- E2E (Chromium, Firefox, WebKit): import each fixture, save/reopen, send a media
  across canvas/workflow/chat, delete/restore it, and validate no blank frame or
  duplicate upload. Include a locally missing managed file and a recoverable
  source URL.
- Keep and extend the existing tests for task placeholders, autosave quota,
  project reopen, sync precedence, project batch delete, and admin recovery. The
  present tests mostly assert source fragments or narrow in-memory behavior; they
  do not supply legacy fixtures or prove end-to-end media lifecycle semantics.

## Candidate Implementation Files

**New modules likely required**

- `src/lib/project-readers.ts`: v1/v2/v3 dispatch, lossless legacy projections,
  validation diagnostics, and copy-on-write migration inputs.
- `src/lib/asset-types.ts` and `src/lib/asset-service.ts`: Asset, AssetVersion,
  WorkspacePlacement, references, trash/recovery, media states, checksums, and
  orphan-sweep decisions.
- `src/app/api/assets/route.ts`, `src/app/api/assets/[assetId]/restore/route.ts`,
  and a scoped media recovery route: user-facing asset/placement commands.
- `src/__tests__/fixtures/projects/*` plus reader, service, route, component,
  PostgreSQL, and cross-browser lifecycle suites.

**Existing files expected to change during Stage 2 implementation**

- `src/lib/user-types.ts`, `src/lib/user-manager.ts`, and
  `src/app/api/user-data/sync/route.ts`: schema-aware read/write boundary and
  backward-compatible persistence.
- `src/lib/db-storage.ts` (and its table/bootstrap helpers): transactional tables,
  migration markers, reference indexes, retention fields, and query helpers.
- `src/components/canvas-workspace.tsx`: reader output hydration, full provenance
  preservation, autosave through placements, task-to-version resolution, and
  delete precedence.
- `src/components/infinite-canvas.tsx`, `src/components/project-data-panel.tsx`,
  and `src/components/dashboard/dashboard-view.tsx`: visible failed-media states,
  retry/recover, trash/restore, and destructive-action copy.
- `src/lib/stable-image-url.ts`, `src/lib/server-data-root.ts`,
  `src/app/api/save-image/route.ts`, `src/app/api/serve-upload/[...path]/route.ts`,
  `src/app/api/recover-images/route.ts`, and S3/source-map helpers: managed media
  identity, controlled reads, recovery recording, and physical purge integration.

## Existing Test Inventory

- `src/__tests__/lib/canvas-task-placeholders.test.ts` covers active/terminal
  placeholder persistence and slot identity.
- `src/__tests__/lib/legacy-task-recovery.test.ts` covers exact unambiguous
  prompt/model matching and retry backoff.
- `src/__tests__/lib/user-manager-autosave-quota-contract.test.ts` only confirms
  source ordering for trimmed snapshots; it does not exercise recovery.
- `src/__tests__/lib/user-manager-project-delete.test.ts` covers optimistic
  project batch removal with stalled sync, not media lifecycle.
- `src/__tests__/components/canvas-project-reopen-contract.test.ts` and
  `canvas-sync-completed-image-state.test.ts` are source-level contracts for
  reopen and stale placeholder precedence.
- `src/__tests__/api/recover-images-admin-contract.test.ts` verifies only access
  control and path validation.
- Existing binary fixtures are limited to generic test images and an annotation
  source; they are not versioned legacy-project fixtures.


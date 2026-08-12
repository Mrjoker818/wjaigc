# Stage 2 E2E Controlled Fixtures

## Purpose

The Stage 2 suites mutate real PostgreSQL-backed projects and must never run against ordinary user projects. Every run uses newly seeded, scenario-specific projects and a unique run ID. Missing, reused, or stale fixtures make the dedicated gate fail.

## Playwright projects

Every matrix must contain these keys:

- `chromium`
- `chromium-1080p`
- `firefox`
- `webkit`
- `mobile-chromium`

Example:

```json
{
  "chromium": "stage2-upload-run-20260812-chromium",
  "chromium-1080p": "stage2-upload-run-20260812-chromium-1080p",
  "firefox": "stage2-upload-run-20260812-firefox",
  "webkit": "stage2-upload-run-20260812-webkit",
  "mobile-chromium": "stage2-upload-run-20260812-mobile"
}
```

Set `E2E_STAGE2_RUN_ID=run-20260812`. Every controlled project ID must contain this exact run ID. A project ID cannot be assigned to two scenario variables.

## Required inputs

Account and file inputs:

- `E2E_BASE_URL`
- `E2E_TEST_USERNAME`
- `E2E_TEST_PASSWORD`
- `E2E_STAGE2_RUN_ID`
- `E2E_STAGE2_UPLOAD_FIXTURE`

Lifecycle project matrices:

- `E2E_STAGE2_LEGACY_PROJECT_IDS`: legacy v1, read-only open.
- `E2E_STAGE2_COPY_ON_WRITE_PROJECT_IDS`: fresh legacy-only projects. These are single-use because the test proves the first COW transition; the suite removes them after the scenario.
- `E2E_STAGE2_UPLOAD_PROJECT_IDS`: empty controlled canvas projects.
- `E2E_STAGE2_LIFECYCLE_PROJECT_IDS`, `E2E_STAGE2_LIFECYCLE_ASSET_IDS`, `E2E_STAGE2_LIFECYCLE_VERSION_IDS`, `E2E_STAGE2_LIFECYCLE_PLACEMENT_IDS`: matching owner-scoped rows.
- `E2E_STAGE2_MISSING_PROJECT_IDS`: projects with a visible recoverable missing-media card.
- `E2E_STAGE2_MISSING_FILENAMES`: exact filenames displayed by those controlled missing-media cards.
- `E2E_STAGE2_REFRESH_PROJECT_IDS`: stable projects with at least one persisted placement.

Cross-workspace matrices:

- `E2E_STAGE2_EMBEDDED_CHAT_PROJECT_IDS`, `E2E_STAGE2_EMBEDDED_CHAT_SOURCE_URLS`: seeded embedded-chat result and its exact managed URL.
- `E2E_STAGE2_WORKFLOW_PROJECT_IDS`: seeded executable workflow with a managed image output.
- `E2E_STAGE2_STANDALONE_CHAT_PROJECT_IDS`, `E2E_STAGE2_STANDALONE_TARGET_PROJECT_IDS`, `E2E_STAGE2_STANDALONE_SOURCE_URLS`: seeded standalone-chat result and an isolated target canvas.
- `E2E_STAGE2_SHARED_REFERENCE_PROJECT_IDS`, `E2E_STAGE2_SHARED_CHAT_PROJECT_IDS`, `E2E_STAGE2_SHARED_ASSET_IDS`, `E2E_STAGE2_SHARED_VERSION_IDS`, `E2E_STAGE2_SHARED_PLACEMENT_IDS`: one shared version referenced by canvas, standalone chat, and workflow.

All values above use the same JSON matrix shape. Asset, version, placement, project, and URL entries at the same browser key must refer to the same controlled fixture.

## Cleanup contract

- Upload, embedded-chat, workflow, and standalone-chat scenarios delete the placement created by that scenario and restore the original project JSON snapshot.
- Lifecycle and shared-reference scenarios restore the deleted placement in `finally`.
- Transfer idempotency and lineage rows remain as audit evidence; each new run uses a new run ID and new seeded projects.
- COW fixtures are not reusable. Each run seeds a new run-specific project; the suite removes that controlled project and its active placements after the scenario. It never writes the old JSON back and calls that a v1 rollback.
- No scenario may target a production user project or a project used by another browser/scenario.

## Evidence contract

The dedicated command is `pnpm test:e2e:stage-2`. A skip, global setup failure, missing request ID, missing video, or missing trace produces a non-zero result. Completed evidence includes a screenshot, video, sanitized Playwright trace, Console log, Network log, request IDs, task/execution IDs when applicable, and a manifest under `test-results/evidence/`.

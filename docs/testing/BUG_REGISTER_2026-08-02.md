# Bug Register - 2026-08-02

## AUD-20260802-001: Requested image provider is not auditable after generation

- Severity: P1
- Module: Quick Create, task polling, canvas persistence, administrator cloud-task monitor
- Environment: deployed production-like site `https://wjaigc.coze.site/`
- Commit: `4d58688e9b08af516d0c3c4a63ba572560694982`
- Browser: authenticated Chrome
- Status: OPEN, not fixed in this test round

### Preconditions

- Administrator account is logged in.
- `AI link image / gpt-image-2` and `FHL image model` are configured as enabled providers.

### Reproduction

1. Open a project and launch Quick Create.
2. Explicitly choose `Gpt Image 2 / AI link image`.
3. Submit an image-generation request and wait for completion.
4. Inspect the completed canvas card, then reload the browser and reopen the project.
5. Compare the card metadata with the administrator cloud-task monitor.

### Expected

- The result records requested provider/model and actual provider/model separately.
- Any fallback is explicitly shown with a reason.
- The same routing metadata survives task polling, canvas persistence, refresh, and project reopen.

### Actual

- The cloud-task monitor retained `AI link image / gpt-image-2` as requested metadata.
- The canvas card displayed `FHL image model` before reload.
- After reload and project reopen, the image persisted but the provider label was absent.
- The system therefore cannot prove the actual provider/model that executed the request.

### Evidence

- Three-output task ID: `async-1785628488840-y7keqm`
- Full test transcript: `docs/testing/QUICK_CREATE_DEPLOYMENT_RECHECK_2026-08-02.md`
- Dashboard evidence after canvas persistence check:
  - `test-results/screenshots/deploy-2026-08-02-dashboard-after-delete-persisted.jpg`
  - `test-results/console/deploy-2026-08-02-dashboard-after-delete.dom.txt`

### Root-cause hypothesis

The generation/polling/persistence flow stores a single mutable provider-name field. It does not preserve immutable requested-route metadata and immutable actual-execution-route metadata. A candidate-provider fallback may also overwrite or fail to populate that field.

### Required fix

1. Persist `requestedProviderId`, `requestedModelId`, `actualProviderId`, `actualModelId`, and optional `fallbackReason` in the durable task record and final canvas image.
2. Return these fields consistently from submit, poll, and project-sync APIs.
3. Show an explicit fallback badge in the canvas and task monitor.
4. Add API, persistence, and browser regression tests for successful primary routing and fallback routing.

## AUD-20260802-002: Quick Create compiler state can be visible across project changes

- Severity: P2
- Module: Quick Create
- Environment: deployed production-like site `https://wjaigc.coze.site/`
- Commit: `4d58688e9b08af516d0c3c4a63ba572560694982`
- Browser: authenticated Chrome
- Status: OPEN, requires targeted reproduction before code changes

### Observation

After completing the three-output Quick Create fallback test and creating a new blank project, the previous compiler/fallback status was briefly visible before the new request was submitted.

### Expected

Quick Create status is scoped to the active project and is reset when the active project changes.

### Next investigation

Create an automated project-switch test that captures the state before a new submission. Confirm whether the compiler state is global or correctly reset asynchronously before implementing a fix.

## AUD-20260802-003: Saved canvas image can reopen outside the visible viewport

- Severity: P1
- Module: canvas upload/paste, move/resize, project persistence, project reopen
- Environment: deployed production-like site `https://wjaigc.coze.site/`
- Commit: `4d58688e9b08af516d0c3c4a63ba572560694982`
- Browser: authenticated Chrome
- Status: OPEN, stable browser reproduction captured; no code change in this test round

### Preconditions

- Administrator account is logged in.
- A newly created project is open on the infinite canvas.

### Reproduction

1. Paste a real JPEG image into the blank canvas and wait for `canvas image` to appear.
2. Select the image, drag it, and resize it with the bottom-right corner handle.
3. Reload the browser. The application returns to the project dashboard.
4. Reopen the newest project card, which reports `1 张图片`.
5. Click `重置视图`.

### Expected

- The saved image remains visible after reopening the project.
- A reset-view action brings the user to a usable default view containing the saved canvas content, or the project restores its saved viewport.

### Actual

- The dashboard card confirms the project contains one image and the stored media URL returns HTTP 200 as `image/jpeg`.
- The reopened canvas has an accessible `canvas image` element, but the rendered viewport is blank.
- The image wrapper has persisted coordinates `left: 2104px; top: 965.5px; width: 553px; height: 248.85px`.
- Reopening initializes the view at `translate(0px, 0px) scale(1)`, leaving the image outside the viewport.
- `重置视图` keeps the viewport blank because it resets the transform instead of fitting the persisted content.

### Evidence

- Before refresh: `test-results/screenshots/deploy-2026-08-02-p0-canvas-before-refresh.jpg`
- Dashboard showing the newest project has one image: `test-results/screenshots/deploy-2026-08-02-p0-canvas-refresh-diagnostic.jpg`
- Reopened blank viewport: `test-results/screenshots/deploy-2026-08-02-p0-canvas-reopened-after-refresh.jpg`
- Reset-view remains blank: `test-results/screenshots/deploy-2026-08-02-p0-canvas-reload-reset-view.jpg`
- Reopened DOM/log evidence:
  - `test-results/console/deploy-2026-08-02-p0-canvas-reopened-after-refresh.dom.txt`
  - `test-results/console/deploy-2026-08-02-p0-canvas-reopened-after-refresh.logs.json`

### Root-cause hypothesis

Image coordinates are persisted in the canvas coordinate system, but the viewport translation used when the image was placed is neither restored with the project nor recalculated to fit content after a reload. The current reset-view behavior resets to origin rather than centering/fitting persisted canvas nodes.

### Required fix

1. Persist and restore a validated project viewport, or fit the visible content when opening a project that has images.
2. Make `重置视图` center/fit canvas content instead of only resetting the transform to `(0, 0, 1)`.
3. Add a browser regression test: paste/upload → move → resize → reload → reopen → assert the image is visually within viewport.

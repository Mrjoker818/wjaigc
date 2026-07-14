# Implementation Plan: Canvas V62 And Bottom Toolbar Reliability

## Overview

Restore the V62 canvas protections on top of `8f9d053`, then make every bottom-toolbar generation panel preserve the user-selected model/provider and send server-readable reference images. The first repair target is Display3D Pro; the remaining panels are audited against the same request contract.

## Architecture Decisions

- Keep canvas result merging as a pure helper so placeholder replacement and multi-result addition happen in one state/ref update.
- Treat `wujie_selected_model` as the canonical global image-model preference. A panel-local selection may override it, but must retain both model and provider ID.
- Persist local input files through the existing upload API before any server-side generation request. Browser-only `blob:` URLs are never sent to an API route.
- The requested model takes precedence over a provider's default selected model. The backend validates that the requested model belongs to the chosen provider before submitting it.
- Audit each bottom-toolbar panel as a vertical request path: selected model/provider -> request payload -> API route -> polling payload -> canvas metadata.

## Task List

### Phase 1: Regression Foundation

#### Task 1: Add Canvas And Display3D Contract Tests

**Description:** Add focused failing tests for panning virtualization, atomic multi-image completion, requested-model precedence, and server-readable uploaded assets.

**Acceptance criteria:**
- [ ] Tests fail against the current implementation for each identified regression.
- [ ] Tests exercise pure request/result helpers rather than implementation-only mocks.

**Verification:**
- [ ] `pnpm exec vitest run` on the new tests fails for the expected missing behavior.

**Dependencies:** None

**Files likely touched:**
- `src/__tests__/lib/canvas-*.test.ts`
- `src/__tests__/lib/display3d-*.test.ts`

**Estimated scope:** Medium

#### Task 2: Restore V62 Canvas Behavior

**Description:** Reapply the panning virtualization safeguard and atomic multi-result update using the tests from Task 1.

**Acceptance criteria:**
- [ ] Active pan never culls images with stale viewport coordinates.
- [ ] Each completed generation URL is retained and the placeholder is replaced in one update.

**Verification:**
- [ ] New canvas tests pass.
- [ ] Existing annotation and task-placeholder tests pass.

**Dependencies:** Task 1

**Files likely touched:**
- `src/components/infinite-canvas.tsx`
- `src/lib/canvas-pan-virtualization.ts`
- `src/lib/canvas-generation-results.ts`

**Estimated scope:** Medium

### Phase 2: Display3D Pro

#### Task 3: Repair Display3D Model And Asset Contract

**Description:** Make Display3D Pro initialize from the canonical model preference, upload selected files before submission, preserve selected model/provider through polling, and make the API route honor the requested model over provider defaults.

**Acceptance criteria:**
- [ ] A selected Gemini model is the model sent to the provider, not the provider's GPT default.
- [ ] Uploaded reference assets use a server-readable URL or data URL, never `blob:`.
- [ ] Polling and canvas metadata use the same selected model/provider.

**Verification:**
- [ ] Display3D request-contract tests pass.
- [ ] Targeted API route tests pass.

**Dependencies:** Task 1

**Files likely touched:**
- `src/components/display3d-panel.tsx`
- `src/app/api/display-3d/generate/route.ts`
- `src/app/api/display-3d/decompose/route.ts`
- `src/lib/selected-image-model.ts`

**Estimated scope:** Medium

### Phase 3: Toolbar Audit

#### Task 4: Audit Image-Generating Bottom Panels

**Description:** Audit Brand E-commerce, Refine Engine, Font Design, Brand Factory, Logo Pro, Scene Studio, Brand Packaging, AI PSD, Sticker Assistant, and Image-to-3D for model/provider preservation and server-readable reference uploads.

**Acceptance criteria:**
- [ ] Every panel is recorded in an audit matrix with its route, model source, provider source, upload path, and poll path.
- [ ] Every panel with the Display3D defect class is fixed and covered by a targeted test.

**Verification:**
- [ ] Targeted tests pass for affected panels.
- [ ] No request sends a `blob:` asset URL to an API route.

**Dependencies:** Task 3

**Files likely touched:**
- `src/components/*-panel.tsx`
- `src/app/api/**/route.ts`
- `src/lib/selected-image-model.ts`

**Estimated scope:** Large, executed as independent small panel groups.

### Phase 4: Verification And Delivery

#### Task 5: Full Regression Verification

**Description:** Validate all repaired paths, remove accidental backup artifacts, and publish a branch/package only after the latest local code is green.

**Acceptance criteria:**
- [ ] `src/components/infinite-canvas.tsx.bak` is removed from the delivery change set.
- [ ] `pnpm ts-check`, `pnpm test`, and `pnpm exec next build` pass.
- [ ] Lint delta is reported without claiming legacy debt is resolved.

**Verification:**
- [ ] Production build succeeds.
- [ ] GitHub branch files match the verified local files.

**Dependencies:** Tasks 2-4

**Files likely touched:**
- Tests and delivery metadata only, plus removal of the backup artifact.

**Estimated scope:** Small

## Risks And Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Provider contracts differ for image references | High | Keep compatibility profile handling and test payload construction without real API keys. |
| Bottom panels have independent legacy implementations | High | Audit in bounded panel groups and share only a narrow model/upload helper. |
| V62 conflicts with the recent canvas extraction | Medium | Reapply behavior through pure helpers and tests, not a blind file replacement. |
| Cloud credentials are unavailable locally | Medium | Validate outgoing payloads and task metadata locally; document any remaining live-provider check. |

## Checkpoints

- After Tasks 1-2: Canvas regressions have failing-then-passing tests and no existing canvas test failures.
- After Task 3: Display3D request payload is deterministic and model/asset traceability is preserved.
- After Task 4: Audit matrix covers every bottom-toolbar panel; only verified defect classes receive shared fixes.
- Complete: Type check, full tests, and production build pass.

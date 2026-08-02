# Unified Failed Validation Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve every reproducible failed validation from the full-platform audit without regressing deployed P0 login, canvas interaction, or multi-image generation behavior.

**Architecture:** Work is grouped by shared contracts rather than by isolated screens. First make persisted canvas view state and generation routing metadata durable; then make image-editing and long-running tasks converge to explicit terminal states; finally repair individual workspace, provider, and administration surfaces on top of those contracts.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Vitest, Playwright, PostgreSQL-backed storage, task registry, Chrome deployment verification.

## Global Constraints

- Preserve the verified P0 behavior: login/logout/relogin, clipboard image insertion, image selection/move/resize/delete, and Quick Create multi-output fallback.
- Every defect requires a red regression test or stable browser reproduction before source changes.
- Failed remote providers must resolve to a structured terminal task state; never use an alert or silently remove a processing card.
- Do not claim a supplier-specific model works until it has passed a real deployed validation.
- No credentials, tokens, passwords, or unredacted prompts may be written to source, test fixtures, reports, or audit logs.
- Do not commit pre-existing `.playwright-cli/`, `output/`, or historic untracked testing reports unless explicitly selected as final evidence.

---

## File and Contract Map

| Area | Primary files | Contract to establish |
| --- | --- | --- |
| Project view restoration | `src/components/canvas-workspace.tsx`, `src/components/infinite-canvas.tsx` | A project load restores a valid saved viewport; reset view fits persisted nodes. |
| Generation traceability | `src/app/api/generate/route.ts`, `src/app/api/poll-task/route.ts`, `src/components/canvas-workspace.tsx`, `src/components/infinite-canvas.tsx` | Requested and actual provider/model fields coexist and survive polling, persistence, refresh, and fallback. |
| Image-edit terminal behavior | `src/app/api/image-edit/route.ts`, `src/components/infinite-canvas.tsx`, image-edit helpers | Every edit task has visible completed, failed, cancelled, or timeout state with an actionable error and no duplicate charge. |
| Decomposition/PSD preview | layer decomposition services and editor components | Transparent output contains alpha and layer visibility recomposes the preview. |
| Workspace modules | ChatCanvas, Agent, Node Editor, 3D, Video, Upscale components/routes | Capability failures preserve request/task diagnostics and do not leave silent UI states. |
| Admin reliability | `src/components/dashboard/*`, `src/app/api/admin/*`, `src/app/api/credits/*` | One authoritative user/statistics/log contract and safely empty new-user fields. |
| Quality gates | `.github/workflows/quality.yml`, `tests/e2e/*`, test helpers | Paid E2E authorization is parsed consistently and cannot accidentally charge. |

## Task 1: Establish a Current Failure Ledger and Test Selection

**Files:**
- Modify: `docs/testing/BUG_REGISTER.md`
- Modify: `docs/testing/REGRESSION_REPORT.md`
- Create: `src/__tests__/lib/failed-validation-ledger.test.ts`

**Interfaces:**
- Consumes: historical AUD records and current deployed evidence.
- Produces: a machine-checkable list of open, superseded, provider-blocked, and unverified records.

- [ ] **Step 1: Write a failing ledger test**

```ts
it('keeps current failed findings separate from superseded and unverified evidence', () => {
  const ledger = buildFailedValidationLedger();
  expect(ledger.open).toContain('AUD-20260802-003');
  expect(ledger.superseded).toContain('AUD-20260801-019');
  expect(ledger.unverified).toContain('native-file-picker-download');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run src/__tests__/lib/failed-validation-ledger.test.ts`
Expected: FAIL because the ledger module does not exist.

- [ ] **Step 3: Add the minimal ledger module and report references**

```ts
export type ValidationDisposition = 'open' | 'superseded' | 'provider-blocked' | 'unverified';
export function buildFailedValidationLedger(): Record<ValidationDisposition, string[]> {
  return { open: [], superseded: [], providerBlocked: [], unverified: [] };
}
```

- [ ] **Step 4: Run the focused test**

Run: `pnpm exec vitest run src/__tests__/lib/failed-validation-ledger.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib src/__tests__/lib docs/testing
git commit -m "test: register current failed validation ledger"
```

## Task 2: Repair Project View Restoration and Fit-to-Content Reset

**Files:**
- Modify: `src/components/canvas-workspace.tsx:355-405, 590-635, 1170-1305, 4740-4800`
- Modify: `src/components/infinite-canvas.tsx:530-550, 17245-17255, 9277-9283`
- Create: `src/lib/canvas-view-state.ts`
- Test: `src/__tests__/lib/canvas-view-state.test.ts`
- Test: `src/__tests__/components/canvas-project-reopen-contract.test.ts`
- Test: `tests/e2e/p0-canvas-reopen.spec.ts`

**Interfaces:**
- Consumes: `CanvasImage[]`, optional persisted `{ offsetX, offsetY, zoom }`, viewport dimensions.
- Produces: `normalizeCanvasViewState()` and `fitCanvasContent()` returning finite, bounded view state.

- [ ] **Step 1: Write failing view-state tests**

```ts
it('fits an offscreen persisted image inside the viewport', () => {
  const result = fitCanvasContent([{ x: 2104, y: 965.5, width: 553, height: 248.85 }], 1200, 800);
  expect(result.offsetX + 2104 * result.zoom).toBeGreaterThan(0);
  expect(result.offsetY + 965.5 * result.zoom).toBeGreaterThan(0);
});

it('rejects invalid saved viewport values', () => {
  expect(normalizeCanvasViewState({ offsetX: Number.NaN, offsetY: Infinity, zoom: 99 })).toBeNull();
});
```

- [ ] **Step 2: Run the focused tests to verify failure**

Run: `pnpm exec vitest run src/__tests__/lib/canvas-view-state.test.ts src/__tests__/components/canvas-project-reopen-contract.test.ts`
Expected: FAIL because the helper and restoration wiring do not exist.

- [ ] **Step 3: Implement the helper and use it on project load/reset**

```ts
export function fitCanvasContent(images: CanvasRect[], viewportWidth: number, viewportHeight: number): CanvasViewState {
  const bounds = getCanvasBounds(images);
  const zoom = clamp(Math.min((viewportWidth - 96) / bounds.width, (viewportHeight - 96) / bounds.height, 1), 0.1, 5);
  return {
    zoom,
    offsetX: viewportWidth / 2 - (bounds.x + bounds.width / 2) * zoom,
    offsetY: viewportHeight / 2 - (bounds.y + bounds.height / 2) * zoom,
  };
}
```

Load `metadata.viewState` into `viewStateRef` for every project-load path, fall back to one-time fit when no valid state exists, and make the visible reset button call the same fit helper.

- [ ] **Step 4: Run focused unit/component tests**

Run: `pnpm exec vitest run src/__tests__/lib/canvas-view-state.test.ts src/__tests__/components/canvas-project-reopen-contract.test.ts`
Expected: PASS.

- [ ] **Step 5: Run deployed browser regression after deployment**

Run: `pnpm exec playwright test tests/e2e/p0-canvas-reopen.spec.ts` with authorized deployment configuration.
Expected: paste/upload → move → resize → reload → reopen keeps the image visible; reset view fits it.

- [ ] **Step 6: Commit**

```bash
git add src/components/canvas-workspace.tsx src/components/infinite-canvas.tsx src/lib/canvas-view-state.ts src/__tests__ tests/e2e
git commit -m "fix: restore and fit persisted canvas view state"
```

## Task 3: Make Generation Provider Routing Durable and Auditable

**Files:**
- Modify: `src/app/api/generate/route.ts`
- Modify: `src/app/api/poll-task/route.ts`
- Modify: `src/components/canvas-workspace.tsx`
- Modify: `src/components/infinite-canvas.tsx`
- Modify: shared task and persistence types that define `CanvasImage`.
- Test: `src/__tests__/api/generate-routing-audit.test.ts`
- Test: `src/__tests__/api/poll-task-routing-audit.test.ts`
- Test: `src/__tests__/components/canvas-routing-metadata.test.ts`

**Interfaces:**
- Produces `GenerationRouteAudit`:

```ts
interface GenerationRouteAudit {
  requestedProviderId: string;
  requestedModelId: string;
  actualProviderId?: string;
  actualModelId?: string;
  fallbackReason?: string;
}
```

- [ ] **Step 1: Write failing routing tests**

```ts
expect(body.routeAudit).toEqual({
  requestedProviderId: 'primary',
  requestedModelId: 'image-model',
  actualProviderId: 'fallback',
  actualModelId: 'fallback-model',
  fallbackReason: 'primary_timeout',
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `pnpm exec vitest run src/__tests__/api/generate-routing-audit.test.ts src/__tests__/api/poll-task-routing-audit.test.ts src/__tests__/components/canvas-routing-metadata.test.ts`
Expected: FAIL because the final result only carries a mutable provider name.

- [ ] **Step 3: Implement immutable route audit propagation**

Attach request metadata at submission, update only actual-route fields on a verified fallback, return the structure from polling, and persist it inside canvas image metadata without overwriting requested fields.

- [ ] **Step 4: Run the focused tests**

Run: `pnpm exec vitest run src/__tests__/api/generate-routing-audit.test.ts src/__tests__/api/poll-task-routing-audit.test.ts src/__tests__/components/canvas-routing-metadata.test.ts`
Expected: PASS.

- [ ] **Step 5: Browser validation**

Select a primary image model, induce or observe a real fallback if it occurs, then verify requested and actual fields survive dashboard reopen and are shown in the task monitor.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/generate src/app/api/poll-task src/components src/__tests__
git commit -m "fix: retain requested and actual generation routing"
```

## Task 4: Unify Image-Edit Terminal States and Source/Mask Validation

**Files:**
- Modify: `src/app/api/image-edit/route.ts`
- Modify: `src/components/infinite-canvas.tsx`
- Modify: `src/components/image-editor/*`
- Modify: image download and mask helper modules.
- Test: `src/__tests__/api/image-edit-terminal-state.test.ts`
- Test: `src/__tests__/components/image-edit-source-mask.test.ts`
- Test: `tests/e2e/image-toolbar-editing.spec.ts`

**Interfaces:**
- Produces a terminal task response:

```ts
type EditTerminal = {
  status: 'completed' | 'failed' | 'cancelled' | 'timeout';
  taskId: string;
  requestId?: string;
  error?: { code: string; message: string; retryable: boolean };
};
```

- [ ] **Step 1: Write failing API and component tests**

```ts
expect(await submitEditWithRejectedFetch()).toMatchObject({
  status: 'failed',
  error: { code: 'NETWORK_ERROR', retryable: true },
});
expect(exportedMaskHasWhitePixels(maskDataUrl)).toBe(true);
```

- [ ] **Step 2: Run red tests**

Run: `pnpm exec vitest run src/__tests__/api/image-edit-terminal-state.test.ts src/__tests__/components/image-edit-source-mask.test.ts`
Expected: FAIL for silent cleanup/generic errors or invalid source/mask handling.

- [ ] **Step 3: Implement explicit task finalization**

Use one terminal-state transition helper for remove-background, erase, mask, color adjustment, expand, and upscale. Keep failed cards visible with error/retry details; validate source loading and non-empty masks before submission; ensure adjustment panels use a viewport-safe layer.

- [ ] **Step 4: Run focused tests and browser flows**

Run: `pnpm exec vitest run src/__tests__/api/image-edit-terminal-state.test.ts src/__tests__/components/image-edit-source-mask.test.ts`
Expected: PASS.

Run: `pnpm exec playwright test tests/e2e/image-toolbar-editing.spec.ts`
Expected: each action either creates a persisted result or ends visibly with a structured retryable/non-retryable error.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/image-edit src/components/image-editor src/components/infinite-canvas.tsx src/__tests__ tests/e2e
git commit -m "fix: make image editing tasks visible and terminal"
```

## Task 5: Repair Decomposition, PSD Rendering, ChatCanvas, Agent, Node, Video, 3D, and Upscale Contracts

**Files:**
- Modify: relevant decomposition, PSD editor, annotation, agent, node, video, 3D, and upscale routes/components discovered by failing tests.
- Test: `src/__tests__/api/layered-decompose*.test.ts`
- Test: `src/__tests__/components/*annotation*.test.ts`
- Test: `src/__tests__/components/*node*.test.ts`
- Test: module-specific Playwright specs under `tests/e2e/`.

**Interfaces:**
- All asynchronous modules consume the terminal task contract from Task 4.
- Every model capability UI reads one provider/model capability record instead of hard-coded choices.

- [ ] **Step 1: Write one failing regression per verified defect**

```ts
expect(alphaChannelContainsTransparency(subjectPng)).toBe(true);
expect(renderedPreviewAfterHidingAllLayers()).toBeTransparent();
expect(pointSelectionFailure()).toMatchObject({ code: 'SUBJECT_NOT_FOUND', fallbackAction: 'box' });
expect(firstNodeMutationCanUndo()).toBe(true);
```

- [ ] **Step 2: Verify all selected tests are red**

Run the exact relevant Vitest command per module and retain each failure artifact before editing.

- [ ] **Step 3: Implement minimal per-module repairs**

Do not share a speculative rewrite. Use the common terminal task contract, capability contract, and result persistence contract from Tasks 3–4.

- [ ] **Step 4: Verify module regression**

Run each module’s focused Vitest suite plus its browser path. A supplier rejection is acceptable only if the UI records request/task identifiers, terminal state, and refund outcome.

- [ ] **Step 5: Commit per independently reviewable module**

```bash
git add <focused-files-and-tests>
git commit -m "fix: harden <module> validation path"
```

## Task 6: Repair Administrator Data Integrity, Password Safety, and Payment Time Formatting

**Files:**
- Modify: `src/components/dashboard/dashboard-view.tsx`
- Modify: `src/components/dashboard/admin-tabs.tsx`
- Modify: `src/app/api/admin/users/route.ts`
- Modify: admin dashboard, credits, data, audit, and payment APIs as identified by failing integration tests.
- Test: `src/__tests__/components/admin-user-create-form-contract.test.ts`
- Test: `src/__tests__/api/admin-dashboard-consistency.test.ts`
- Test: `src/__tests__/api/payment-order-date.test.ts`

**Interfaces:**
- A newly opened user form must use `{ name: '', email: '', password: '' }`.
- Statistics endpoints must identify the same canonical user population and include a storage status marker rather than silently returning a contradictory zero.

- [ ] **Step 1: Write failing integrity and legacy-default tests**

```ts
expect(readFileSync('src/components/dashboard/dashboard-view.tsx', 'utf8')).not.toContain("setNewUserPassword('123456')");
expect(summary.totalUsers).toBe(users.items.length);
expect(formatPaymentTimestamp(order.createdAt)).not.toBe('Invalid Date');
```

- [ ] **Step 2: Run red tests**

Run: `pnpm exec vitest run src/__tests__/components/admin-user-create-form-contract.test.ts src/__tests__/api/admin-dashboard-consistency.test.ts src/__tests__/api/payment-order-date.test.ts`
Expected: FAIL until the legacy path and inconsistent query contracts are repaired.

- [ ] **Step 3: Implement canonical admin data reads and safe defaults**

Remove legacy default credentials, normalize timestamp parsing at API boundaries, return explicit storage-unavailable states, and align user/credit/data/audit aggregation to the same user query.

- [ ] **Step 4: Verify**

Run the focused tests and a real administrator browser check that creates only a disposable test record when permitted, then compares all four counts after refresh.

- [ ] **Step 5: Commit**

```bash
git add src/components/dashboard src/app/api/admin src/app/api/credits src/__tests__
git commit -m "fix: align admin statistics and remove legacy credential defaults"
```

## Task 7: Repair Quality Gates and Safety Tests

**Files:**
- Modify: `.github/workflows/quality.yml`
- Modify: `tests/e2e/p0-core.spec.ts`
- Modify: E2E environment helper.
- Test: `src/__tests__/scripts/quality-workflow-contract.test.ts`
- Test: `src/__tests__/lib/dependency-security-contract.test.ts`

**Interfaces:**
- `isPaidGenerationAuthorized(value?: string): boolean` accepts exactly documented authorized values and reports a reason for every other value.

- [ ] **Step 1: Write failing environment parsing tests**

```ts
expect(isPaidGenerationAuthorized('1')).toBe(true);
expect(isPaidGenerationAuthorized('true')).toBe(true);
expect(isPaidGenerationAuthorized('false')).toBe(false);
expect(isPaidGenerationAuthorized(undefined)).toBe(false);
```

- [ ] **Step 2: Run red tests**

Run: `pnpm exec vitest run src/__tests__/scripts/quality-workflow-contract.test.ts`
Expected: FAIL because CI and Playwright parse the same flag differently.

- [ ] **Step 3: Implement one shared parser and bounded paid-test policy**

Use the same helper in CI and P0 tests; require explicit provider/model identity; cap paid test count; preserve clear skipped-vs-failed reporting.

- [ ] **Step 4: Verify quality checks**

Run: `pnpm exec vitest run src/__tests__/scripts/quality-workflow-contract.test.ts src/__tests__/lib/dependency-security-contract.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add .github tests/e2e src/__tests__
git commit -m "fix: align paid e2e authorization contract"
```

## Task 8: Full Regression, Evidence, and Release Decision

**Files:**
- Modify: `docs/testing/BUG_REGISTER.md`
- Modify: `docs/testing/REGRESSION_REPORT.md`
- Modify: `docs/testing/RELEASE_READINESS_REPORT.md`
- Modify: `docs/testing/UNVERIFIED_ITEMS.md`

- [ ] **Step 1: Run static and automated verification**

```bash
pnpm run doctor
pnpm run ts-check
pnpm run lint
pnpm test
pnpm test:api
pnpm test:regression
pnpm build
```

- [ ] **Step 2: Run the authorized deployed browser suite**

Run Chromium deployment tests first, then Firefox/WebKit where credentials and stable deployment access are available. Retain screenshot, video, trace, console, and network artifacts for every failure.

- [ ] **Step 3: Classify unresolved work honestly**

Mark provider outages as provider-blocked only when a structured platform failure path passed. Mark browser-automation limitations as unverified, never as passing.

- [ ] **Step 4: Commit and push only verified changes**

```bash
git add <only-source-tests-docs-created-for-this-remediation>
git commit -m "fix: complete verified failed-validation remediation"
git push origin main
```

## Plan Review

- **Coverage:** Tasks 2–7 cover every open historical category: canvas persistence, route auditing, image edit/decomposition, ChatCanvas/Agent/node/3D/video/upscale, administration, and quality/security gates. Provider-only outages remain explicit verification gates rather than guessed source changes.
- **No-placeholder check:** Every task names files, a test shape, a command, and the produced contract. Module-specific Task 5 remains intentionally split into independently red-tested commits because merging unrelated image/video/node rewrites would make regression ownership unreviewable.
- **Type consistency:** `CanvasViewState`, `GenerationRouteAudit`, and `EditTerminal` are introduced before downstream modules rely on them.

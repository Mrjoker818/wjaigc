# Dual Element Decomposition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a Cloud Leopard-style element board and a Pear/local editable layer document from one frozen source image, with persistent branch state and measured reconstruction quality.

**Architecture:** Introduce a persistent parent task in the existing `cloud_tasks` store and keep board and layer work as independent child branches. Freeze and hash the source before either branch starts, reuse the existing Pear layer service, and add deterministic reconstruction rendering plus correction assets without misrepresenting corrected quality as native provider quality.

**Tech Stack:** Next.js 16, React 19, TypeScript 5, PostgreSQL cloud task storage, Sharp, ag-psd, JSZip, Vitest, Playwright/Chrome

## Global Constraints

- Output mode is `board`, `layers`, or `both`; `both` is the default.
- Both branches use the same frozen source hash and dimensions.
- Pear remains asynchronous and ZIP/PSD processing stays inside the existing safe downloader and extraction limits.
- Parent and branch idempotency bind user, source hash, branch, and normalized request digest.
- A completed branch is never resubmitted or recharged when retrying another branch.
- Native reconstruction and corrected reconstruction are reported separately.
- Partial completion is visible and retryable by branch.
- Preserve unrelated work and do not commit `.playwright-cli/` or `output/`.

---

## File Structure

- Create `src/lib/element-decomposition/types.ts`: parent request, branch state, and result contracts.
- Create `src/lib/element-decomposition/source-snapshot.ts`: resolve, hash, and freeze source identity.
- Create `src/lib/element-decomposition/reconstruction.ts`: render layers, calculate metrics, and create correction assets.
- Create `src/lib/element-decomposition/service.ts`: persistent parent orchestration and branch retry.
- Create `src/app/api/element-decompose/route.ts`: authenticated POST/GET/DELETE API.
- Modify `src/lib/display-decompose.ts`: explicit board background mode and immutable source metadata.
- Modify `src/lib/layer-decomposition/types.ts`: expose reconstruction report and correction/reference roles.
- Modify `src/lib/layer-decomposition/service.ts`: call reconstruction evaluation after Pear/local refinement.
- Modify `src/components/infinite-canvas.tsx`: output-mode UI and two-branch progress/results.
- Add focused tests under `src/__tests__/lib`, `src/__tests__/api`, and `src/__tests__/components`.

### Task 1: Define Parent Request and Source Snapshot

**Files:**
- Create: `src/lib/element-decomposition/types.ts`
- Create: `src/lib/element-decomposition/source-snapshot.ts`
- Test: `src/__tests__/lib/element-decomposition-source.test.ts`

**Interfaces:**

```ts
export type ElementDecomposeOutputMode = 'board' | 'layers' | 'both';
export type ElementBranchStatus =
  | 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled' | 'timeout';

export interface ElementDecomposeRequest {
  sourceImageId: string;
  sourceVersionId?: string;
  imageUrl: string;
  outputMode: ElementDecomposeOutputMode;
  board: { aspectRatio: string; background: 'light-gray' | 'transparent' };
  layers: { engine: 'smart' | 'cloud' | 'local'; providerId?: string; modelId?: string };
}

export interface FrozenElementSource {
  sourceImageId: string;
  sourceVersionId?: string;
  canonicalUrl: string;
  sha256: string;
  width: number;
  height: number;
  mimeType: string;
  buffer: Buffer;
}

export async function freezeElementSource(
  request: ElementDecomposeRequest,
  options?: { signal?: AbortSignal },
): Promise<FrozenElementSource>;
```

- [ ] **Step 1: Write failing source tests**

Verify that the same image bytes under two URLs produce the same SHA-256, a changed image produces a different hash, dimensions are captured, and an empty `sourceImageId` is rejected.

- [ ] **Step 2: Verify RED**

```bash
pnpm exec vitest run src/__tests__/lib/element-decomposition-source.test.ts
```

Expected: FAIL because the modules do not exist.

- [ ] **Step 3: Implement source freezing**

Use `resolveLayerSourceImage()` for safe input resolution and:

```ts
const sha256 = createHash('sha256').update(resolved.buffer).digest('hex');
const metadata = await sharp(resolved.buffer, {
  failOn: 'error',
  limitInputPixels: 67_108_864,
}).metadata();
```

Return an immutable object and never resolve `imageUrl` again inside child branches.

- [ ] **Step 4: Verify GREEN**

```bash
pnpm exec vitest run src/__tests__/lib/element-decomposition-source.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/element-decomposition/types.ts src/lib/element-decomposition/source-snapshot.ts src/__tests__/lib/element-decomposition-source.test.ts
git commit -m "feat: freeze element decomposition source"
```

### Task 2: Extend Reconstruction Metrics

**Files:**
- Create: `src/lib/element-decomposition/reconstruction.ts`
- Modify: `src/lib/layer-decomposition/types.ts`
- Test: `src/__tests__/lib/layer-reconstruction.test.ts`

**Interfaces:**

```ts
export interface ReconstructionMetrics {
  widthMatches: boolean;
  heightMatches: boolean;
  alphaMae: number;
  rgbMae: number;
  maxChannelError: number;
  mismatchedPixelRatio: number;
  ssim: number;
}

export interface ReconstructionReport {
  native: ReconstructionMetrics;
  corrected: ReconstructionMetrics;
  correctionApplied: boolean;
  correctionLayer?: EditableLayerAsset;
  pixelPerfectReferenceLayer?: EditableLayerAsset;
}

export async function evaluateAndCorrectReconstruction(input: {
  source: Buffer;
  layers: EditableLayerAsset[];
  loadLayer: (layer: EditableLayerAsset) => Promise<Buffer>;
  persistLayer: (buffer: Buffer, filename: string) => string | Promise<string>;
}): Promise<ReconstructionReport>;
```

- [ ] **Step 1: Write failing reconstruction tests**

Use synthetic 8x8 layers. Prove:

- exact layers yield `rgbMae: 0` and no correction;
- a missing opaque pixel creates `reconstruction/correction`;
- a transparent-source mismatch creates `reconstruction/pixel-perfect-reference`;
- native metrics remain unchanged after correction.

- [ ] **Step 2: Verify RED**

```bash
pnpm exec vitest run src/__tests__/lib/layer-reconstruction.test.ts
```

Expected: FAIL because the reconstruction module does not exist.

- [ ] **Step 3: Implement rendering and metrics**

Reuse normal/multiply/screen blend behavior from `quality-gate.ts`, but return the rendered RGBA buffer. Calculate normalized RGB and alpha mean absolute error, maximum channel error, mismatched-pixel ratio at channel delta `> 1`, and a bounded SSIM implementation on luminance blocks.

For opaque mismatches, persist a sparse correction PNG with source RGB and alpha `255` only at mismatched pixels. If the source contains transparency that ordinary over-compositing cannot restore exactly, persist the original as a named reference layer and mark `correctionApplied: true`.

- [ ] **Step 4: Verify GREEN**

```bash
pnpm exec vitest run src/__tests__/lib/layer-reconstruction.test.ts src/__tests__/lib/layer-quality-gate.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/element-decomposition/reconstruction.ts src/lib/layer-decomposition/types.ts src/__tests__/lib/layer-reconstruction.test.ts
git commit -m "feat: measure editable layer reconstruction"
```

### Task 3: Attach Reconstruction to Pear and Local Results

**Files:**
- Modify: `src/lib/layer-decomposition/service.ts:620-700`
- Modify: `src/lib/layer-decomposition/types.ts`
- Test: `src/__tests__/lib/layer-service-reconstruction.test.ts`
- Update: `src/__tests__/api/layered-decompose.test.ts`

**Interfaces:**
- `LayerDecompositionResult` gains `reconstruction: ReconstructionReport`.
- Existing `quality` remains available for compatibility.

- [ ] **Step 1: Write a failing service test**

Mock a completed Pear extraction and assert:

```ts
expect(result.reconstruction.native).toBeDefined();
expect(result.reconstruction.corrected).toBeDefined();
expect(result.layers.some(layer => layer.name === 'reconstruction/correction')).toBe(true);
```

- [ ] **Step 2: Verify RED**

```bash
pnpm exec vitest run src/__tests__/lib/layer-service-reconstruction.test.ts src/__tests__/api/layered-decompose.test.ts
```

Expected: FAIL because the service returns only the existing quality score.

- [ ] **Step 3: Wire reconstruction after refinement**

Call `evaluateAndCorrectReconstruction` after `refineLayerAssets`. Append correction/reference assets without changing the native metric input. Persist them under `layer-decomposition` and return both quality systems.

- [ ] **Step 4: Run Pear-focused regression**

```bash
pnpm exec vitest run src/__tests__/lib/pear-layer-adapter.test.ts src/__tests__/lib/layer-source-image.test.ts src/__tests__/lib/layer-service-reconstruction.test.ts src/__tests__/api/layered-decompose.test.ts
```

Expected: PASS, including ZIP artifact compatibility.

- [ ] **Step 5: Commit**

```bash
git add src/lib/layer-decomposition/service.ts src/lib/layer-decomposition/types.ts src/__tests__/lib/layer-service-reconstruction.test.ts src/__tests__/api/layered-decompose.test.ts
git commit -m "feat: attach reconstruction reports to layer tasks"
```

### Task 4: Make the Board Request Explicit and Source-Bound

**Files:**
- Modify: `src/lib/display-decompose.ts`
- Test: `src/__tests__/lib/display-decompose.test.ts`

**Interfaces:**

```ts
export type DisplayBoardBackground = 'light-gray' | 'transparent';

export function buildDisplayDecomposeRequestBody(params: {
  model: string;
  imageUrl: string;
  sourceHash: string;
  aspectRatio?: unknown;
  background: DisplayBoardBackground;
  extraPrompt?: string;
}): Record<string, unknown>;
```

- [ ] **Step 1: Write failing prompt/request tests**

Assert light-gray mode contains `浅灰色极简背景`, transparent mode contains `真实透明 alpha=0` and excludes checkerboard, and both requests contain exactly one `image_urls` entry equal to the frozen source URL.

- [ ] **Step 2: Verify RED**

```bash
pnpm exec vitest run src/__tests__/lib/display-decompose.test.ts
```

Expected: FAIL because background mode and source hash are not explicit.

- [ ] **Step 3: Implement explicit board variants**

Keep the proven Cloud Leopard semantics. Add `source_hash` to internal task metadata, not the third-party payload unless the provider supports metadata. Never append a currently selected canvas URL after the request is built.

- [ ] **Step 4: Verify GREEN**

```bash
pnpm exec vitest run src/__tests__/lib/display-decompose.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/display-decompose.ts src/__tests__/lib/display-decompose.test.ts
git commit -m "feat: bind display board generation to frozen source"
```

### Task 5: Build Persistent Parent and Branch Idempotency

**Files:**
- Create: `src/lib/element-decomposition/service.ts`
- Test: `src/__tests__/lib/element-decomposition-idempotency.test.ts`
- Test: `src/__tests__/lib/element-decomposition-partial-result.test.ts`

**Interfaces:**

```ts
export async function submitElementDecomposition(input: {
  userId: string;
  userRole: string;
  idempotencyKey: string;
  request: ElementDecomposeRequest;
}): Promise<ElementDecomposeTaskResponse>;

export async function getElementDecomposition(input: {
  taskId: string;
  userId: string;
  userRole: string;
}): Promise<ElementDecomposeTaskResponse>;

export async function retryElementBranch(input: {
  taskId: string;
  branch: 'board' | 'layers';
  userId: string;
  userRole: string;
}): Promise<ElementDecomposeTaskResponse>;
```

- [ ] **Step 1: Write failing concurrency and partial-result tests**

Prove that two concurrent submissions with the same user/key return the same parent task, the child keys are:

```ts
`${parentKey}:board:${sourceHash}:${requestDigest}`
`${parentKey}:layers:${sourceHash}:${requestDigest}`
```

and retrying a failed board does not change a completed layer child ID.

- [ ] **Step 2: Verify RED**

```bash
pnpm exec vitest run src/__tests__/lib/element-decomposition-idempotency.test.ts src/__tests__/lib/element-decomposition-partial-result.test.ts
```

Expected: FAIL because the parent service does not exist.

- [ ] **Step 3: Implement parent orchestration with `cloud_tasks`**

Create type `element-decompose-parent` with `creditStatus: 'not-applicable'`. Store source metadata and child IDs in `result`. Submit the board and layer child only when requested by `outputMode`. Parent progress is the weighted mean of requested branches. Parent terminal mapping is:

```ts
completed + completed => completed
completed + failed => completed with result.overallStatus = 'partial'
failed + failed => failed
cancelled/timeout with no completed branch => corresponding terminal status
```

Branch services remain responsible for their own charge/refund transitions.

- [ ] **Step 4: Verify PostgreSQL-style concurrency behavior**

```bash
pnpm exec vitest run src/__tests__/lib/element-decomposition-idempotency.test.ts src/__tests__/lib/element-decomposition-partial-result.test.ts src/__tests__/api/layered-decompose-postgres-concurrency.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/element-decomposition/service.ts src/__tests__/lib/element-decomposition-idempotency.test.ts src/__tests__/lib/element-decomposition-partial-result.test.ts
git commit -m "feat: persist dual decomposition branch state"
```

### Task 6: Add the Authenticated Parent API

**Files:**
- Create: `src/app/api/element-decompose/route.ts`
- Test: `src/__tests__/api/element-decompose.test.ts`

**Interfaces:**
- `POST /api/element-decompose`: submit parent task.
- `GET /api/element-decompose?taskId=...`: read parent and child state.
- `DELETE /api/element-decompose?taskId=...`: cancel active branches.
- `POST /api/element-decompose` with `{ action: "retry", taskId, branch }`: retry one failed branch.

- [ ] **Step 1: Write failing API tests**

Cover authenticated success, unauthenticated rejection, source ownership failure, invalid output mode, idempotent duplicate, branch retry, and cross-user task access.

- [ ] **Step 2: Verify RED**

```bash
pnpm exec vitest run src/__tests__/api/element-decompose.test.ts
```

Expected: FAIL because the route does not exist.

- [ ] **Step 3: Implement the route**

Use `requireApiAuthOrReject`, `validateLayerIdempotencyKey`, `normalizeTrustedManagedMediaInput`, and the parent service. Return the established error shape:

```json
{
  "success": false,
  "code": "ELEMENT_SOURCE_MISMATCH",
  "message": "元素拆解源图与提交快照不一致",
  "retryable": false
}
```

- [ ] **Step 4: Verify GREEN**

```bash
pnpm exec vitest run src/__tests__/api/element-decompose.test.ts src/__tests__/api/layered-decompose.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/element-decompose/route.ts src/__tests__/api/element-decompose.test.ts
git commit -m "feat: expose dual element decomposition API"
```

### Task 7: Implement the Dual-Output Canvas Experience

**Files:**
- Modify: `src/components/infinite-canvas.tsx:7300-7445,15945-16040`
- Create: `src/lib/element-decomposition/client.ts`
- Test: `src/__tests__/lib/element-decomposition-client.test.ts`
- Test: `src/__tests__/components/element-decomposition-ui.test.ts`

**Interfaces:**

```ts
export async function pollElementDecomposition(
  taskId: string,
  onUpdate: (task: ElementDecomposeTaskResponse) => void,
  signal?: AbortSignal,
): Promise<ElementDecomposeTaskResponse>;
```

- [ ] **Step 1: Write failing client and UI tests**

Assert the default mode is `both`, the request includes frozen `sourceImageId` and URL, selection changes do not alter the submitted request, progress exposes both branch labels, and partial success renders one result plus a retry button for the failed branch.

- [ ] **Step 2: Verify RED**

```bash
pnpm exec vitest run src/__tests__/lib/element-decomposition-client.test.ts src/__tests__/components/element-decomposition-ui.test.ts
```

Expected: FAIL because the parent client/UI does not exist.

- [ ] **Step 3: Replace the single display-only submit path**

At confirm time copy the active image:

```ts
const sourceSnapshot = {
  sourceImageId: img.id,
  sourceVersionId: img.annotationVersionId || buildAnnotationSourceVersionId(
    img.id,
    img.url,
    img.originalWidth || Math.round(img.width),
    img.originalHeight || Math.round(img.height),
  ),
  imageUrl: img.url,
  width: img.originalWidth || Math.round(img.width),
  height: img.originalHeight || Math.round(img.height),
};
```

Submit this immutable object to `/api/element-decompose`. Show progress for source freezing, board generation, Pear waiting, artifact download, PSD extraction, reconstruction verification, and result preparation.

- [ ] **Step 4: Verify GREEN**

```bash
pnpm exec vitest run src/__tests__/lib/element-decomposition-client.test.ts src/__tests__/components/element-decomposition-ui.test.ts src/__tests__/lib/canvas-active-image.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/infinite-canvas.tsx src/lib/element-decomposition/client.ts src/__tests__/lib/element-decomposition-client.test.ts src/__tests__/components/element-decomposition-ui.test.ts
git commit -m "feat: add dual output element decomposition UI"
```

### Task 8: Verify Pear ZIP, Reconstruction, and Cloud Results

**Files:**
- Create: `tests/e2e/dual-element-decomposition.spec.ts`
- Update: `docs/testing/BUG_REGISTER.md`
- Update: `docs/testing/REGRESSION_REPORT.md`
- Update: `docs/testing/RELEASE_READINESS_REPORT.md`
- Update: `docs/testing/UNVERIFIED_ITEMS.md`
- Evidence: `test-results/screenshots/element-decomposition/`
- Evidence: `test-results/traces/element-decomposition/`

**Interfaces:**
- Consumes the deployed commit and logged-in cloud preview.
- Produces task evidence, ZIP/PSD inspection, board screenshots, and reconstruction metrics.

- [ ] **Step 1: Add the browser cases**

Cover `board`, `layers`, and `both`; source selection changes during processing; one-branch failure; branch retry; cancellation; and project reload.

- [ ] **Step 2: Run the focused automated suite**

```bash
pnpm exec vitest run src/__tests__/lib/pear-layer-adapter.test.ts src/__tests__/lib/layer-source-image.test.ts src/__tests__/lib/layer-reconstruction.test.ts src/__tests__/lib/element-decomposition-source.test.ts src/__tests__/lib/element-decomposition-idempotency.test.ts src/__tests__/lib/element-decomposition-partial-result.test.ts src/__tests__/api/layered-decompose.test.ts src/__tests__/api/layered-decompose-concurrency.test.ts src/__tests__/api/layered-decompose-postgres-concurrency.test.ts src/__tests__/api/element-decompose.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run the widening verification ladder**

```bash
pnpm ts-check
pnpm lint
pnpm test
pnpm build
```

Expected: zero command failures.

- [ ] **Step 4: Perform cloud artifact verification**

Using the logged-in Chrome preview:

- confirm the initial parent request returns promptly;
- record separate board/layer task IDs and progress;
- download the Pear ZIP through the application;
- verify ZIP MIME and safe extraction;
- parse the primary PSD with `ag-psd`;
- verify at least two editable layers;
- render layers and compare the saved metrics;
- verify only one charge per cloud branch;
- inspect the presentation board for missing, overlapping, clipped, or invented major elements.

Firefox/WebKit and PostgreSQL concurrency remain unverified unless they are executed with evidence.

- [ ] **Step 5: Update reports and commit**

```bash
git add tests/e2e/dual-element-decomposition.spec.ts docs/testing/BUG_REGISTER.md docs/testing/REGRESSION_REPORT.md docs/testing/RELEASE_READINESS_REPORT.md docs/testing/UNVERIFIED_ITEMS.md
git commit -m "test: verify dual element decomposition workflow"
```

# Pear Hybrid Layer Editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the low-quality element segmentation path with a single, recoverable pipeline that supports Pear `image-layered` PSD output, local edge refinement, a stronger CPU-only local fallback, and the same editable-layer result in the image toolbar, PSD editor, PSD export, and workflow node mode.

**Architecture:** `/api/layered-decompose` becomes the authenticated submit/status/cancel boundary. A Pear adapter handles only provider protocol, a PSD extractor converts the provider artifact into persisted transparent PNG layers, post-processing and quality-gate modules refine and validate those layers, and a local pipeline supplies the explicit local mode and smart-mode fallback. Every billable request is claimed in `cloud_tasks` before provider submission, is charged once with the existing atomic credit functions, and is resumed through persisted task state rather than an in-memory `Map`.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5, PostgreSQL, `ag-psd`, `sharp`, Vitest, Playwright.

## Global Constraints

- The approved design is `docs/superpowers/specs/2026-07-28-pear-hybrid-layer-editing-design.md`.
- Preserve the existing image-toolbar entry named `编辑元素`; do not add a duplicate toolbar command.
- Expose exactly three modes: `smart`, `cloud`, and `local`; default to `smart`.
- Pear submission uses `/v1/images/edits`; `/v1/images/generations` is allowed only after an unambiguous pre-task endpoint rejection (`404`, `405`, or a recognized unsupported-endpoint response).
- A timeout, connection reset, malformed response, or any response that may have created a remote task is an indeterminate submission and must never trigger a second submit.
- Bind idempotency to `userId + idempotencyKey + canonical request hash`; the same key with different input returns `409`.
- A request creates at most one application cloud task and is charged at most once; terminal failure, timeout, or cancellation is refunded at most once.
- For normal users, both `apiPermissions.layer` and `imageModels` assignment for `providerId::modelId` must be valid. Administrators may use every enabled configured layer model.
- All remote source images and PSD artifacts use DNS-resolved, pinned, no-redirect safe download. All local paths must stay under controlled media roots.
- Reject request bodies over 16 MiB, decoded data URLs over 15 MiB, PSD files over 80 MiB, documents over 8192 x 8192, more than 64 decoded pixel layers, nesting deeper than 16, or aggregate decoded pixels over 256 million.
- External `sharp` inputs must set `limitInputPixels`; no GPU dependency is introduced.
- Keep `.playwright-cli/` and `output/` untracked. Do not edit or commit the pending 302 files `src/lib/302-upscale-models.ts`, `src/lib/server-api-config.ts`, or `src/__tests__/lib/302-upscale-models.test.ts` as part of this plan.
- Do not change authentication entry, session verification, or workspace routing code.

---

## File Structure

### New server modules

- `src/lib/layer-decomposition/types.ts`: shared request, task phase, editable layer, quality, and response contracts.
- `src/lib/layer-decomposition/validation.ts`: bounded JSON reading, URL/data-URL validation, mode and idempotency validation.
- `src/lib/layer-decomposition/idempotency.ts`: canonical request hashing and atomic `cloud_tasks` claim/replay.
- `src/lib/layer-decomposition/provider.ts`: exact Pear provider/model authorization for the authenticated user.
- `src/lib/layer-decomposition/pear-adapter.ts`: Pear submit and poll protocol only.
- `src/lib/layer-decomposition/source-image.ts`: controlled local media reads and safe public image downloads.
- `src/lib/layer-decomposition/psd-extractor.ts`: PSD signature/limit validation and `ag-psd` extraction.
- `src/lib/layer-decomposition/post-process.ts`: alpha-edge cleanup, duplicate/empty-layer removal, and persisted PNG generation.
- `src/lib/layer-decomposition/quality-gate.ts`: reconstruction error and structural quality result.
- `src/lib/layer-decomposition/local-pipeline.ts`: CPU-only Lab/gradient/region-growth fallback.
- `src/lib/layer-decomposition/service.ts`: task state machine, settlement, smart fallback, and task replay.

### New client modules

- `src/lib/layer-decomposition-client.ts`: submit, status polling, cancellation, and progress translation.
- `src/lib/editable-layer-adapter.ts`: `EditableLayerAsset` to existing `DesignLayer` conversion shared by editor/export consumers.

### Existing integration points

- `src/app/api/layered-decompose/route.ts`: replace legacy direct execution with submit/status/cancel handlers.
- `src/app/api/segment-elements/route.ts`: remove chat-completions and `/segment` protocol guesses; retain a compatibility wrapper over the unified service.
- `src/components/psd-editor/PsdLayerEditor.tsx`: mode control, persisted progress, warning state, retry, and cancellation.
- `src/lib/psd-export.ts`: consume the unified editable-layer contract before its legacy local scene builder.
- `src/lib/workflow-engine.ts`: send `engine`, precise `providerId`, and precise `modelId` for `ai-segment`.
- `src/app/api/workflow/execute/route.ts`: poll the layered task status endpoint and preserve layer/PSD outputs.
- `tests/e2e/layer-editing.spec.ts`: real browser evidence for toolbar and node-mode entry.

---

### Task 1: Lock the shared contract and request limits

**Files:**
- Create: `src/lib/layer-decomposition/types.ts`
- Create: `src/lib/layer-decomposition/validation.ts`
- Test: `src/__tests__/lib/layer-decomposition-validation.test.ts`

**Interfaces:**
- Produces: `LayerEngineMode`, `LayerTaskPhase`, `EditableLayerAsset`, `LayerDecompositionResult`, `readLayerRequest()`, and `validateLayerIdempotencyKey()`.
- Consumes: no new project interfaces.

- [ ] **Step 1: Write failing validation tests**

```ts
import { describe, expect, it } from 'vitest';
import {
  parseLayerRequest,
  validateLayerIdempotencyKey,
} from '@/lib/layer-decomposition/validation';

describe('layer decomposition request validation', () => {
  it('accepts the three explicit engine modes', () => {
    for (const engine of ['smart', 'cloud', 'local'] as const) {
      expect(parseLayerRequest({ imageUrl: '/api/serve-upload/source.png', engine }).engine)
        .toBe(engine);
    }
  });

  it('rejects oversized data URLs and unknown modes', () => {
    expect(() => parseLayerRequest({ imageUrl: `data:image/png;base64,${'A'.repeat(21_000_000)}` }))
      .toThrow(/image/i);
    expect(() => parseLayerRequest({ imageUrl: '/a.png', engine: 'automatic' }))
      .toThrow(/mode/i);
  });

  it('requires a stable 8-128 character idempotency key', () => {
    expect(validateLayerIdempotencyKey('layer_123456')).toBe('layer_123456');
    expect(() => validateLayerIdempotencyKey('short')).toThrow(/idempotency/i);
    expect(() => validateLayerIdempotencyKey('bad key')).toThrow(/idempotency/i);
  });
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `pnpm vitest run src/__tests__/lib/layer-decomposition-validation.test.ts`

Expected: FAIL because `@/lib/layer-decomposition/validation` does not exist.

- [ ] **Step 3: Add the contract and bounded parser**

```ts
export type LayerEngineMode = 'smart' | 'cloud' | 'local';
export type LayerTaskPhase =
  | 'reading-source'
  | 'submitting-pear'
  | 'waiting-for-pear'
  | 'downloading-psd'
  | 'extracting-psd'
  | 'refining-layers'
  | 'checking-quality'
  | 'running-local-fallback'
  | 'ready';

export interface EditableLayerAsset {
  id: string;
  parentId?: string;
  name: string;
  role: 'background' | 'subject' | 'text' | 'decoration' | 'shadow' | 'unknown';
  imageUrl: string;
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
  opacity: number;
  blendMode: string;
  visible: boolean;
  source: 'pear-psd' | 'local-enhanced';
  qualityWarnings?: string[];
}

export interface LayerDecompositionResult {
  width: number;
  height: number;
  layers: EditableLayerAsset[];
  psdUrl?: string;
  engine: 'pear' | 'local';
  quality: { status: 'pass' | 'warning'; score: number; warnings: string[] };
}
```

Implement `readLayerRequest(request)` by reading `request.body.getReader()` and stopping at `16 * 1024 * 1024`, then call `parseLayerRequest()`. Validate `imageUrl` length, decoded base64 estimate, `providerId`/`modelId` lengths, and `engine` with Zod or explicit type guards. Reject unknown fields that can alter routing.

- [ ] **Step 4: Run validation tests and static checks**

Run: `pnpm vitest run src/__tests__/lib/layer-decomposition-validation.test.ts && pnpm eslint src/lib/layer-decomposition src/__tests__/lib/layer-decomposition-validation.test.ts`

Expected: all tests PASS and ESLint exits `0`.

- [ ] **Step 5: Commit the contract**

```bash
git add src/lib/layer-decomposition/types.ts src/lib/layer-decomposition/validation.ts src/__tests__/lib/layer-decomposition-validation.test.ts
git commit -m "feat(layering): define decomposition task contract"
```

### Task 2: Add database idempotency and exact Pear authorization

**Files:**
- Create: `src/lib/layer-decomposition/idempotency.ts`
- Create: `src/lib/layer-decomposition/provider.ts`
- Test: `src/__tests__/lib/layer-decomposition-idempotency.test.ts`
- Test: `src/__tests__/lib/layer-provider-authorization.test.ts`

**Interfaces:**
- Consumes: `createCloudTask()`, `getCloudTaskForUserByIdempotencyKey()`, `findProviderById()`, `dbGetUserById()`, and `isModelAssignedToUser()`.
- Produces: `createLayerRequestHash()`, `claimLayerTask()`, and `resolveLayerProvider()`.

- [ ] **Step 1: Write failing idempotency and permission tests**

```ts
it('replays the same request and rejects key reuse with another image', async () => {
  const first = await claimLayerTask(inputFor('/image-a.png'));
  expect(first.owner).toBe(true);
  const replay = await claimLayerTask(inputFor('/image-a.png'));
  expect(replay).toEqual({ owner: false, taskId: first.taskId });
  await expect(claimLayerTask(inputFor('/image-b.png'))).rejects.toMatchObject({
    code: 'LAYER_IDEMPOTENCY_CONFLICT',
  });
});

it('rejects a layer model not assigned to a normal user', async () => {
  await expect(resolveLayerProvider({
    userId: 'user-1',
    userRole: 'user',
    providerId: 'pear',
    modelId: 'Image-Layered',
  })).rejects.toMatchObject({ code: 'LAYER_MODEL_FORBIDDEN' });
});
```

- [ ] **Step 2: Verify both test files fail before implementation**

Run: `pnpm vitest run src/__tests__/lib/layer-decomposition-idempotency.test.ts src/__tests__/lib/layer-provider-authorization.test.ts`

Expected: FAIL on missing modules.

- [ ] **Step 3: Implement canonical claim and exact authorization**

Use sorted-key JSON canonicalization and SHA-256, matching the proven pattern in `src/lib/vector-design-idempotency.ts`. Store `{ requestHash, request: { imageUrl, engine, providerId, modelId } }` in the task result. Create tasks with type `layer-decomposition`, status `pending`, `creditStatus: 'not-applicable'`, and a `layer_${randomUUID()}` ID.

```ts
export async function resolveLayerProvider(input: ResolveLayerProviderInput) {
  const provider = await findProviderById(input.providerId);
  if (!provider || provider.modelType !== 'layer' || !provider.apiKey) {
    throw new LayerProviderError('LAYER_PROVIDER_UNAVAILABLE');
  }
  const modelId = normalizeLayerModelId(input.modelId);
  const configured = provider.selectedModels?.length
    ? provider.selectedModels
    : provider.discoveredModels.map(model => model.id);
  if (!configured.some(value => normalizeLayerModelId(value) === modelId)) {
    throw new LayerProviderError('LAYER_MODEL_UNSUPPORTED');
  }
  if (input.userRole !== 'admin') {
    const user = await dbGetUserById(input.userId);
    if (!user || user.apiPermissions?.layer === false ||
        !isModelAssignedToUser(user.imageModels, provider.id, input.modelId)) {
      throw new LayerProviderError('LAYER_MODEL_FORBIDDEN');
    }
  }
  return { provider, modelId: 'image-layered' as const };
}
```

Normalize `Image-Layered`, `image_layered`, and `image-layered` only for the Pear request payload; retain the administrator's configured ID in task/audit metadata.

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run src/__tests__/lib/layer-decomposition-idempotency.test.ts src/__tests__/lib/layer-provider-authorization.test.ts`

Expected: PASS, including concurrent `Promise.all()` claims returning one owner.

- [ ] **Step 5: Commit**

```bash
git add src/lib/layer-decomposition/idempotency.ts src/lib/layer-decomposition/provider.ts src/__tests__/lib/layer-decomposition-idempotency.test.ts src/__tests__/lib/layer-provider-authorization.test.ts
git commit -m "feat(layering): enforce idempotency and model access"
```

### Task 3: Implement the Pear protocol without double submission

**Files:**
- Create: `src/lib/layer-decomposition/pear-adapter.ts`
- Test: `src/__tests__/lib/pear-layer-adapter.test.ts`

**Interfaces:**
- Consumes: resolved provider credentials and an `AbortSignal`.
- Produces: `submitPearLayerTask()`, `pollPearLayerTask()`, `PearSubmissionIndeterminateError`, and normalized remote status.

- [ ] **Step 1: Write protocol tests for sync, async, fallback, and ambiguity**

```ts
it('uses edits and never calls generations after a task id exists', async () => {
  fetchMock.mockResolvedValueOnce(jsonResponse({ task_id: 'pear-1' }));
  const result = await submitPearLayerTask(input);
  expect(result).toEqual({ kind: 'async', remoteTaskId: 'pear-1', endpoint: 'edits' });
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it('falls back to generations only for an explicit unsupported endpoint', async () => {
  fetchMock
    .mockResolvedValueOnce(jsonResponse({ error: 'Not Found' }, 404))
    .mockResolvedValueOnce(jsonResponse({ task_id: 'pear-2' }));
  expect(await submitPearLayerTask(input)).toMatchObject({ endpoint: 'generations' });
});

it('does not fallback after timeout because submission is indeterminate', async () => {
  fetchMock.mockRejectedValueOnce(new DOMException('timeout', 'AbortError'));
  await expect(submitPearLayerTask(input)).rejects.toBeInstanceOf(PearSubmissionIndeterminateError);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `pnpm vitest run src/__tests__/lib/pear-layer-adapter.test.ts`

Expected: FAIL on missing adapter.

- [ ] **Step 3: Implement the exact protocol**

```ts
const EDITS_PATH = '/v1/images/edits';
const GENERATIONS_PATH = '/v1/images/generations';

export async function submitPearLayerTask(input: PearSubmitInput): Promise<PearSubmitResult> {
  const payload = { model: 'image-layered', image: input.image, response_format: 'url' };
  const primary = await callSubmission(input, EDITS_PATH, payload);
  if (primary.kind === 'accepted') return primary.result;
  if (!primary.endpointUnsupported) throw primary.error;
  const fallback = await callSubmission(input, GENERATIONS_PATH, payload);
  if (fallback.kind === 'accepted') return fallback.result;
  throw fallback.error;
}
```

Send `Authorization: Bearer ...`, `Content-Type: application/json`, `Idempotency-Key: <application task id>`, and `X-Request-Id`. Parse task IDs from `task_id`, `taskId`, `id`, and nested `data.id`; parse synchronous PSD URLs only from documented URL-bearing response fields. Poll `GET /v1/images/tasks/{encodeURIComponent(remoteTaskId)}` and normalize `queued`, `running`, `completed`, `failed`, `cancelled`, and `timeout`. Reject non-JSON, an empty completed result, image-only output, and status regressions.

- [ ] **Step 4: Run protocol tests and lint**

Run: `pnpm vitest run src/__tests__/lib/pear-layer-adapter.test.ts && pnpm eslint src/lib/layer-decomposition/pear-adapter.ts src/__tests__/lib/pear-layer-adapter.test.ts`

Expected: PASS and exit `0`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/layer-decomposition/pear-adapter.ts src/__tests__/lib/pear-layer-adapter.test.ts
git commit -m "feat(layering): add Pear layered image adapter"
```

### Task 4: Securely read source media and extract real PSD layers

**Files:**
- Modify: `src/lib/safe-image-download.ts`
- Create: `src/lib/layer-decomposition/source-image.ts`
- Create: `src/lib/layer-decomposition/psd-extractor.ts`
- Test: `src/__tests__/lib/layer-source-image.test.ts`
- Test: `src/__tests__/lib/pear-psd-extractor.test.ts`
- Fixture: `src/__tests__/fixtures/layered/minimal-layered.psd`
- Fixture: `src/__tests__/fixtures/layered/corrupt.psd`

**Interfaces:**
- Consumes: `downloadPublicImage()`, controlled upload roots, `readPsd()`, `initializeCanvas()`, and `saveImageFile()`.
- Produces: `resolveLayerSourceImage()` and `extractEditableLayersFromPsd()`.

- [ ] **Step 1: Add failing SSRF, base64, PSD signature, and limit tests**

```ts
it('rejects a PSD URL resolving to loopback', async () => {
  lookupMock.mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);
  await expect(downloadPearPsd('https://attacker.example/result.psd', signal))
    .rejects.toThrow(/private|reserved/i);
});

it('rejects a fake PSD and a decoded pixel bomb', async () => {
  await expect(extractEditableLayersFromPsd(Buffer.from('not-a-psd'), options))
    .rejects.toThrow(/signature/i);
  await expect(extractEditableLayersFromPsd(pixelBombFixture, options))
    .rejects.toThrow(/pixel/i);
});

it('preserves offsets, opacity, blend mode, visibility, and hierarchy', async () => {
  const result = await extractEditableLayersFromPsd(minimalPsd, options);
  expect(result.layers[0]).toMatchObject({
    parentId: 'group-1', offsetX: 24, offsetY: 18, opacity: 0.65,
    blendMode: 'multiply', visible: true, source: 'pear-psd',
  });
});
```

- [ ] **Step 2: Verify RED**

Run: `pnpm vitest run src/__tests__/lib/layer-source-image.test.ts src/__tests__/lib/pear-psd-extractor.test.ts`

Expected: FAIL because source/extractor modules and fixtures are absent.

- [ ] **Step 3: Extend safe downloader MIME policy without weakening image defaults**

Add `image/vnd.adobe.photoshop`, `application/x-photoshop`, and `application/octet-stream` to the internal safe asset set only. Keep the default allowed MIME list image-only. PSD callers must pass an explicit list and then verify the first four bytes equal `8BPS`.

- [ ] **Step 4: Implement controlled source reads and PSD extraction**

`resolveLayerSourceImage()` must:

1. Decode only `data:image/png|jpeg|webp;base64` after checking estimated and decoded size.
2. Resolve `/api/serve-upload/...` and `/uploads/...` with `normalizeLocalImagePath()` and a root containment check.
3. Use `downloadPublicImage()` for public HTTP(S) input.
4. Validate raster format and dimensions with `sharp(buffer, { limitInputPixels: 67_108_864 })`.

`extractEditableLayersFromPsd()` must initialize `ag-psd` with `@napi-rs/canvas`, call `readPsd()`, walk groups recursively with a depth counter, rasterize supported pixel layers to full-size transparent PNGs, persist them with `saveImageFile()`, and return the exact `EditableLayerAsset` contract. Unsupported smart objects/effects are rasterized from their composite canvas and receive a warning.

- [ ] **Step 5: Run extractor tests and check leaked temporary files**

Run: `pnpm vitest run src/__tests__/lib/layer-source-image.test.ts src/__tests__/lib/pear-psd-extractor.test.ts`

Expected: PASS; the failure tests leave no files under the test media root.

- [ ] **Step 6: Commit**

```bash
git add src/lib/safe-image-download.ts src/lib/layer-decomposition/source-image.ts src/lib/layer-decomposition/psd-extractor.ts src/__tests__/lib/layer-source-image.test.ts src/__tests__/lib/pear-psd-extractor.test.ts src/__tests__/fixtures/layered
git commit -m "feat(layering): safely extract editable Pear PSD layers"
```

### Task 5: Add refinement, quality gate, and enhanced CPU fallback

**Files:**
- Create: `src/lib/layer-decomposition/post-process.ts`
- Create: `src/lib/layer-decomposition/quality-gate.ts`
- Create: `src/lib/layer-decomposition/local-pipeline.ts`
- Test: `src/__tests__/lib/layer-post-process.test.ts`
- Test: `src/__tests__/lib/layer-quality-gate.test.ts`
- Test: `src/__tests__/lib/local-layer-pipeline.test.ts`
- Fixture: `src/__tests__/fixtures/layered/edge-halo.png`
- Fixture: `src/__tests__/fixtures/layered/product-scene.png`

**Interfaces:**
- Consumes: source image buffer and extracted `EditableLayerAsset[]`.
- Produces: `refineLayerAssets()`, `evaluateLayerQuality()`, and `runLocalLayerPipeline()`.

- [ ] **Step 1: Write failing deterministic image-quality tests**

```ts
it('reduces white edge contamination without deleting semi-transparent shadow', async () => {
  const result = await refineLayerAssets(edgeHaloLayers, limits);
  expect(result.metrics.edgeContamination).toBeLessThan(0.03);
  expect(result.layers.find(layer => layer.role === 'shadow')?.alphaCoverage)
    .toBeGreaterThan(0.01);
});

it('fails when recomposition differs materially from the source', async () => {
  const quality = await evaluateLayerQuality(source, missingSubjectLayers);
  expect(quality.status).toBe('fail');
  expect(quality.warnings).toContain('RECONSTRUCTION_ERROR_HIGH');
});

it('creates bounded background, subject, shadow, and decoration layers locally', async () => {
  const result = await runLocalLayerPipeline(productScene, options);
  expect(result.layers.length).toBeGreaterThanOrEqual(2);
  expect(result.layers.length).toBeLessThanOrEqual(12);
  expect(result.layers.every(layer => layer.source === 'local-enhanced')).toBe(true);
});
```

- [ ] **Step 2: Verify RED**

Run: `pnpm vitest run src/__tests__/lib/layer-post-process.test.ts src/__tests__/lib/layer-quality-gate.test.ts src/__tests__/lib/local-layer-pipeline.test.ts`

Expected: FAIL on missing modules.

- [ ] **Step 3: Implement bounded post-processing**

Use `sharp` raw RGBA buffers. Remove isolated alpha components below `max(16px, 0.002% of canvas)`, fill enclosed holes below `0.01%`, decontaminate only fringe pixels with alpha `1..250`, and keep soft shadow/glass layers out of binary morphology. Detect duplicate layers with a 32 x 32 alpha perceptual hash plus bounding-box overlap before deleting one.

- [ ] **Step 4: Implement quality scoring**

Composite visible layers in order and calculate normalized mean absolute RGB error over opaque source pixels, alpha coverage, duplicate ratio, empty ratio, out-of-bounds ratio, and decoded pixel budget. Use these fixed decisions:

```ts
if (fatalLimitViolation || layers.length === 0 || reconstructionMae > 0.22) return 'fail';
if (reconstructionMae > 0.12 || edgeContamination > 0.05 || warnings.length > 0) return 'warning';
return 'pass';
```

- [ ] **Step 5: Implement enhanced local segmentation**

Convert sRGB to CIE Lab, compute Sobel luminance gradient, seed background from four border bands, grow regions only when both Delta-E and gradient constraints pass, obtain a foreground alpha mask, derive a soft shadow candidate from low-saturation low-luminance pixels adjacent to the subject, and split only large interior regions with stable boundaries. Merge fragments under the size threshold. Name layers `背景`, `主体`, `阴影`, and `元素 N`; do not invent semantic product/person names.

- [ ] **Step 6: Run quality tests and a CPU performance bound**

Run: `pnpm vitest run src/__tests__/lib/layer-post-process.test.ts src/__tests__/lib/layer-quality-gate.test.ts src/__tests__/lib/local-layer-pipeline.test.ts`

Expected: PASS; the 2048 x 2048 fixture finishes under 15 seconds on the local test machine and stays below the configured pixel budget.

- [ ] **Step 7: Commit**

```bash
git add src/lib/layer-decomposition/post-process.ts src/lib/layer-decomposition/quality-gate.ts src/lib/layer-decomposition/local-pipeline.ts src/__tests__/lib/layer-post-process.test.ts src/__tests__/lib/layer-quality-gate.test.ts src/__tests__/lib/local-layer-pipeline.test.ts src/__tests__/fixtures/layered
git commit -m "feat(layering): improve local layer quality and validation"
```

### Task 6: Build the recoverable API state machine and atomic settlement

**Files:**
- Create: `src/lib/layer-decomposition/service.ts`
- Replace: `src/app/api/layered-decompose/route.ts`
- Modify: `src/app/api/segment-elements/route.ts`
- Test: `src/__tests__/api/layered-decompose.test.ts`
- Test: `src/__tests__/api/layered-decompose-concurrency.test.ts`
- Test: `src/__tests__/api/segment-elements-compatibility.test.ts`

**Interfaces:**
- Consumes: Tasks 1-5, `chargeCloudTaskCredits()`, `refundCloudTaskCredits()`, `completeCloudTask()`, `terminateCloudTaskAndRefund()`, `claimCloudTaskLease()`, and authenticated user identity.
- Produces: POST submit, GET status/progress, DELETE cancel, and compatibility responses.

- [ ] **Step 1: Write failing route tests for auth, replay, charging, fallback, and terminal races**

```ts
it('returns one task and charges once for concurrent duplicate submits', async () => {
  const responses = await Promise.all(Array.from({ length: 8 }, () => POST(layerRequest())));
  const bodies = await Promise.all(responses.map(response => response.json()));
  expect(new Set(bodies.map(body => body.taskId)).size).toBe(1);
  expect(chargeCloudTaskCredits).toHaveBeenCalledTimes(1);
  expect(submitPearLayerTask).toHaveBeenCalledTimes(1);
});

it('cannot complete after cancellation wins', async () => {
  await DELETE(cancelRequest(taskId));
  const status = await GET(statusRequest(taskId));
  expect((await status.json()).status).toBe('cancelled');
  expect(completeCloudTask).not.toHaveBeenCalled();
});

it('refunds Pear cost then completes with local output after smart quality failure', async () => {
  qualityMock.mockResolvedValue({ status: 'fail', score: 12, warnings: ['RECONSTRUCTION_ERROR_HIGH'] });
  const body = await driveTaskToTerminal('smart');
  expect(body.status).toBe('completed');
  expect(body.result.engine).toBe('local');
  expect(refundCloudTaskCredits).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Verify RED**

Run: `pnpm vitest run src/__tests__/api/layered-decompose.test.ts src/__tests__/api/layered-decompose-concurrency.test.ts src/__tests__/api/segment-elements-compatibility.test.ts`

Expected: FAIL against the legacy synchronous route.

- [ ] **Step 3: Implement POST submit**

POST must authenticate, read bounded JSON, validate `Idempotency-Key`, claim a task, replay an existing result when not owner, resolve exact provider/model for cloud-capable modes, atomically charge, persist phase `submitting-pear`, submit once, then persist `remoteTaskId` and phase `waiting-for-pear`. Local mode stores phase `running-local-fallback` and returns `202` without charging.

If the process finds a persisted task in `submitting-pear` with no remote task ID after the request that owned submission has ended, mark it `failed` with `LAYER_SUBMISSION_INDETERMINATE` and refund; never submit again.

- [ ] **Step 4: Implement GET status/resume**

GET authenticates ownership, returns terminal result immediately, and otherwise atomically claims a short lease. The lease owner polls Pear once or performs one local processing stage, persists phase/progress, and releases work by allowing the lease to expire. On Pear completion it safely downloads, extracts, refines, and quality-checks the PSD. `smart` uses local fallback after an explicit remote terminal failure or failed quality gate; `cloud` terminates and refunds. Status responses expose no API key or raw provider URL.

- [ ] **Step 5: Implement DELETE cancellation and compatibility route**

DELETE aborts active in-process work when available and always uses `terminateCloudTaskAndRefund(taskId, 'cancelled', ...)`. `/api/segment-elements` must stop calling `/chat/completions` and `/segment`; it delegates to the same service contract and returns `{ taskId, status, phase, progress }`. Keep its auth behavior and operation logging.

- [ ] **Step 6: Run route, PostgreSQL concurrency, and ownership tests**

Run: `pnpm vitest run src/__tests__/api/layered-decompose.test.ts src/__tests__/api/layered-decompose-concurrency.test.ts src/__tests__/api/segment-elements-compatibility.test.ts src/__tests__/api/high-risk-route-auth-contract.test.ts`

Expected: PASS, including a real PostgreSQL test that proves one task row, one consume transaction, and at most one refund transaction.

- [ ] **Step 7: Commit**

```bash
git add src/lib/layer-decomposition/service.ts src/app/api/layered-decompose/route.ts src/app/api/segment-elements/route.ts src/__tests__/api/layered-decompose.test.ts src/__tests__/api/layered-decompose-concurrency.test.ts src/__tests__/api/segment-elements-compatibility.test.ts
git commit -m "feat(layering): add recoverable hybrid decomposition tasks"
```

### Task 7: Integrate the PSD editor and shared export adapter

**Files:**
- Create: `src/lib/layer-decomposition-client.ts`
- Create: `src/lib/editable-layer-adapter.ts`
- Modify: `src/components/psd-editor/PsdLayerEditor.tsx`
- Modify: `src/lib/psd-export.ts`
- Test: `src/__tests__/components/psd-layer-editor.test.tsx`
- Test: `src/__tests__/lib/editable-layer-adapter.test.ts`

**Interfaces:**
- Consumes: Task 6 API and `EditableLayerAsset`.
- Produces: editor mode UX, progress/cancel/retry, and `editableLayerAssetsToDesignLayers()`.

- [ ] **Step 1: Write failing adapter and editor tests**

```ts
it('maps persisted layer geometry without forcing every layer to full canvas', () => {
  const [layer] = editableLayerAssetsToDesignLayers([asset], 1600, 900);
  expect(layer.offsetX).toBe(120);
  expect(layer.offsetY).toBe(75);
  expect(layer.boundingBox).toEqual({ x: 120, y: 75, width: 640, height: 480 });
  expect(layer.blendMode).toBe('multiply');
});

it('shows all three modes and provider progress phases', async () => {
  render(<PsdLayerEditor imageUrl="/source.png" onClose={vi.fn()} />);
  expect(screen.getByRole('button', { name: '智能' })).toBeVisible();
  expect(screen.getByRole('button', { name: '云端' })).toBeVisible();
  expect(screen.getByRole('button', { name: '本地' })).toBeVisible();
  expect(await screen.findByText('Pear 正在生成 PSD')).toBeVisible();
});
```

- [ ] **Step 2: Verify RED**

Run: `pnpm vitest run src/__tests__/components/psd-layer-editor.test.tsx src/__tests__/lib/editable-layer-adapter.test.ts`

Expected: FAIL because the editor still calls `buildV4Scene()` directly.

- [ ] **Step 3: Implement the client state machine**

Generate one idempotency key per user click, POST once, then poll GET based on response state with 800 ms to 2000 ms bounded backoff. Wait on terminal status or explicit phase changes; do not use a fixed long sleep. Abort polling on unmount and call DELETE when the user presses cancel.

Map phases to the approved seven progress labels. Display precise error codes for provider missing, model forbidden, source inaccessible, upstream rejected, timeout, invalid PSD, quality failure, and local fallback failure.

- [ ] **Step 4: Update editor and export consumption**

Keep the current centered draggable window and existing layer editing controls. Add a compact segmented mode control in the title/loading area. On completion, convert persisted assets to `DesignLayer[]`, preserving name, parent, offset, opacity, blend mode, visibility, source, and quality warnings. In `psd-export.ts`, add a function that builds `SceneBuildResult` from the same asset adapter; retain the current browser-local builder only as the explicit legacy/local fallback.

- [ ] **Step 5: Run component regression and type checks**

Run: `pnpm vitest run src/__tests__/components/psd-layer-editor.test.tsx src/__tests__/lib/editable-layer-adapter.test.ts src/__tests__/components/canvas-toolbar-floating-windows.test.ts && pnpm ts-check`

Expected: PASS; the existing toolbar still has one `编辑元素` entry and TypeScript exits `0`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/layer-decomposition-client.ts src/lib/editable-layer-adapter.ts src/components/psd-editor/PsdLayerEditor.tsx src/lib/psd-export.ts src/__tests__/components/psd-layer-editor.test.tsx src/__tests__/lib/editable-layer-adapter.test.ts
git commit -m "feat(layering): connect hybrid tasks to the PSD editor"
```

### Task 8: Integrate workflow node mode without changing provider selection

**Files:**
- Modify: `src/lib/workflow-engine.ts`
- Modify: `src/app/api/workflow/execute/route.ts`
- Test: `src/__tests__/components/node-editor-layering-wiring.test.ts`
- Test: `src/__tests__/api/workflow-layer-task.test.ts`

**Interfaces:**
- Consumes: layered submit/status API from Task 6.
- Produces: an `ai-segment` node result containing `layers`, `psdUrl`, `quality`, and preview `imageUrl` where available.

- [ ] **Step 1: Write failing workflow wiring tests**

```ts
it('sends the precise layer provider, model, and engine', () => {
  const request = buildNodeExecutionRequest(segmentNode, { imageUrl: '/source.png' });
  expect(request).toMatchObject({
    endpoint: '/api/layered-decompose',
    body: { providerId: 'pear', modelId: 'Image-Layered', engine: 'smart' },
  });
});

it('polls layered status instead of the generic image poll route', async () => {
  await executeLayerNode();
  expect(fetchMock).toHaveBeenCalledWith(
    expect.stringContaining('/api/layered-decompose?taskId='),
    expect.objectContaining({ method: 'GET' }),
  );
  expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining('/api/poll-task'), expect.anything());
});
```

- [ ] **Step 2: Verify RED**

Run: `pnpm vitest run src/__tests__/components/node-editor-layering-wiring.test.ts src/__tests__/api/workflow-layer-task.test.ts`

Expected: FAIL because `ai-segment` still targets `/api/segment-elements` and the generic poller.

- [ ] **Step 3: Update node fields and request building**

Add an engine select with `smart`, `cloud`, and `local`. Keep the current `modelFilter: 'layer'`. Send `modelId` and `providerId` separately, and omit both only in local mode. Derive an idempotency key from `workflow executionId + nodeId + attemptCount` so retry is a new intentional operation while repeated transport calls replay the same task.

- [ ] **Step 4: Add layered task polling to the workflow executor**

Add `/api/layered-decompose` to the async endpoint set, but branch its poll logic to authenticated GET status rather than `/api/poll-task`. Propagate phase/progress into the node execution result while running. Preserve `layers`, `psdUrl`, `quality`, and `engine` in the completed output; do not pass layer PNGs through `/api/save-image` again because they are already persisted.

- [ ] **Step 5: Run workflow regression tests**

Run: `pnpm vitest run src/__tests__/components/node-editor-layering-wiring.test.ts src/__tests__/api/workflow-layer-task.test.ts src/__tests__/components/workflow-model-filter-wiring.test.ts src/__tests__/components/node-editor-execution-wiring.test.ts`

Expected: PASS; non-layer workflow nodes retain their prior request and polling behavior.

- [ ] **Step 6: Commit**

```bash
git add src/lib/workflow-engine.ts src/app/api/workflow/execute/route.ts src/__tests__/components/node-editor-layering-wiring.test.ts src/__tests__/api/workflow-layer-task.test.ts
git commit -m "feat(layering): support hybrid decomposition in node mode"
```

### Task 9: Run real-browser verification and release gates

**Files:**
- Create: `tests/e2e/layer-editing.spec.ts`
- Modify: `docs/testing/BUG_REGISTER.md`
- Modify: `docs/testing/REGRESSION_REPORT.md`
- Modify: `docs/testing/RELEASE_READINESS_REPORT.md`
- Modify: `docs/testing/UNVERIFIED_ITEMS.md`

**Interfaces:**
- Consumes: deployed authenticated preview, a real Pear-enabled test account, a real image, and Playwright evidence helpers.
- Produces: screenshots, video, trace, console log, network log, and release decision.

- [ ] **Step 1: Write the browser test before deployment**

```ts
test('image toolbar opens hybrid layer editor and completes Pear decomposition', async ({ page }, testInfo) => {
  const evidence = collectBrowserEvidence(page);
  await loginWithConfiguredAccount(page);
  await uploadFixtureToCanvas(page, 'tests/fixtures/product-scene.png');
  await page.getByRole('button', { name: '编辑元素' }).click();
  await page.getByRole('button', { name: '智能' }).click();
  await expect(page.getByText('Pear 正在生成 PSD')).toBeVisible();
  await expect(page.getByText(/个图层/)).toBeVisible({ timeout: 300_000 });
  await page.getByRole('button', { name: /隐藏图层/ }).first().click();
  await saveBrowserEvidence(page, testInfo, evidence, 'pear-layer-editor-completed');
  expect(evidence.console.filter(item => item.type === 'error')).toEqual([]);
});
```

Also cover local mode, smart fallback through an authorized controlled provider failure, editor move/hide/lock/rename/reorder, PSD export, refresh/reopen, node-mode execution, cancellation, and duplicate click idempotency.

- [ ] **Step 2: Run local automated gates**

Run:

```bash
pnpm lint
pnpm ts-check
pnpm test
pnpm build
```

Expected: all new tests PASS. Existing unrelated failures must be listed verbatim and may not be relabeled as passing.

- [ ] **Step 3: Run real Chromium verification against the deployed preview**

Run:

```bash
E2E_BASE_URL=<authorized-preview-url> pnpm playwright test tests/e2e/layer-editing.spec.ts --project=chromium --trace=on --video=on
pnpm test:artifacts
```

Expected: the real Pear request reaches `/v1/images/edits`, returns a task ID, completes with a PSD, opens two or more editable layers, and stores screenshot/video/trace/console/network evidence.

- [ ] **Step 4: Run cross-browser non-billable UI regression**

Run:

```bash
LAYER_E2E_SKIP_PROVIDER_CALL=1 pnpm playwright test tests/e2e/layer-editing.spec.ts --project=firefox --project=webkit
```

Expected: editor entry, mode control, local mode, cancellation UI, and node configuration PASS in Firefox and WebKit without spending provider credits.

- [ ] **Step 5: Update quality records**

Record each reproduced defect and fix in `BUG_REGISTER.md`, including commit, request ID, task ID, provider/model, evidence paths, root cause, and regression tests. Mark the real Pear call unverified if no authorized key or provider quota is available; never replace it with a mock result. Set the final release decision to `通过`, `有条件通过`, or `不通过` using the existing release criteria.

- [ ] **Step 6: Commit verification assets and reports, excluding generated binary evidence from Git unless repository policy requires it**

```bash
git add tests/e2e/layer-editing.spec.ts docs/testing/BUG_REGISTER.md docs/testing/REGRESSION_REPORT.md docs/testing/RELEASE_READINESS_REPORT.md docs/testing/UNVERIFIED_ITEMS.md
git commit -m "test(layering): verify Pear hybrid editing workflow"
```

---

## Final Verification Checklist

- [ ] `smart`, `cloud`, and `local` produce the documented behavior.
- [ ] A single click and ten concurrent duplicate submissions create one cloud task and one consume transaction.
- [ ] Same idempotency key with a different image returns `409`.
- [ ] Pear fallback to `generations` occurs only after explicit pre-task endpoint rejection.
- [ ] Ambiguous submission never triggers a second provider request.
- [ ] Cancel/timeout/failure cannot later become completed.
- [ ] Refund is based on persisted terminal/credit state and occurs at most once.
- [ ] Remote image and PSD SSRF, redirect, MIME, size, timeout, and DNS-rebinding tests pass.
- [ ] PSD offsets, hierarchy, opacity, blend mode, visibility, and names survive extraction and export.
- [ ] Local mode remains CPU-only and improves the checked fixture metrics over the legacy RGB connected-component path.
- [ ] Image toolbar, PSD editor/export, and `ai-segment` node mode consume the same layer contract.
- [ ] Existing 302 changes remain intact and outside Pear commits.
- [ ] `pnpm lint`, `pnpm ts-check`, focused Vitest suites, build, and real-browser evidence have recorded results.


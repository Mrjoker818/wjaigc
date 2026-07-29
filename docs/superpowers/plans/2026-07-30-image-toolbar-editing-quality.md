# Image Toolbar Editing Quality Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make remove-background, erase, mask edit, and color adjustment produce verifiably correct image results without changing unrelated canvas behavior.

**Architecture:** Move image-quality rules and pixel composition out of the large API/UI files into small deterministic libraries. The API routes remain orchestration layers, while focused unit tests prove alpha preservation, explicit mode routing, mask-boundary preservation, and color parameter consistency.

**Tech Stack:** Next.js 16, React 19, TypeScript 5, Sharp, Vitest, Playwright/Chrome

## Global Constraints

- Every production change starts with a failing regression test.
- The final remove-background image is a real RGBA PNG; never flatten it onto white.
- Subject RGB comes from the source image and the model supplies the alpha mask.
- Erase and mask routing uses `editMode`, never prompt emptiness.
- Pixels outside an edit mask remain unchanged in lossless output.
- Color adjustment remains local and consumes no model credits.
- Preserve unrelated work and do not commit `.playwright-cli/` or `output/`.
- Do not claim cloud success without inspecting downloaded output files.

---

## File Structure

- Create `src/lib/image-tools/remove-bg-quality.ts`: decode and evaluate transparent PNG output.
- Create `src/lib/image-tools/edit-request-mode.ts`: validate explicit erase/mask routing.
- Create `src/lib/image-tools/masked-composite.ts`: composite provider output only inside a mask.
- Create `src/lib/image-tools/color-adjust-params.ts`: shared parameter normalization and preview mapping.
- Modify `src/lib/remove-bg-postprocess.ts`: persist RGBA and enforce quality checks.
- Modify `src/app/api/image-edit/route.ts`: use explicit edit mode and masked composition.
- Modify `src/app/api/image/color-adjust/route.ts`: use shared color parameters.
- Modify `src/components/infinite-canvas.tsx`: send correct requests, create non-destructive results, and expose optional mask output.
- Add focused tests under `src/__tests__/lib`, `src/__tests__/api`, and `src/__tests__/components`.

### Task 1: Establish Remove-Background Quality Metrics

**Files:**
- Create: `src/lib/image-tools/remove-bg-quality.ts`
- Test: `src/__tests__/lib/remove-bg-quality.test.ts`

**Interfaces:**
- Consumes: source image `Buffer` and candidate RGBA PNG `Buffer`.
- Produces:

```ts
export interface RemoveBgQualityMetrics {
  width: number;
  height: number;
  foregroundRatio: number;
  transparentRatio: number;
  partialAlphaRatio: number;
  edgeHaloRatio: number;
}

export interface RemoveBgQualityResult {
  ok: boolean;
  code?: 'DIMENSION_MISMATCH' | 'ALPHA_MISSING' | 'EMPTY_FOREGROUND'
    | 'NO_BACKGROUND_REMOVED' | 'EDGE_HALO_HIGH';
  metrics: RemoveBgQualityMetrics;
}

export async function evaluateRemoveBgOutput(
  sourceBuffer: Buffer,
  candidateBuffer: Buffer,
): Promise<RemoveBgQualityResult>;
```

- [ ] **Step 1: Write the failing quality tests**

```ts
it('accepts a same-size RGBA image containing foreground and transparent background', async () => {
  const result = await evaluateRemoveBgOutput(source, validRgba);
  expect(result.ok).toBe(true);
  expect(result.metrics.transparentRatio).toBeGreaterThan(0);
});

it('rejects a white-flattened opaque result', async () => {
  const result = await evaluateRemoveBgOutput(source, whiteFlattened);
  expect(result).toMatchObject({ ok: false, code: 'NO_BACKGROUND_REMOVED' });
});

it('rejects a fully transparent result', async () => {
  const result = await evaluateRemoveBgOutput(source, emptyRgba);
  expect(result).toMatchObject({ ok: false, code: 'EMPTY_FOREGROUND' });
});
```

- [ ] **Step 2: Run the test and observe the expected RED state**

Run:

```bash
pnpm exec vitest run src/__tests__/lib/remove-bg-quality.test.ts
```

Expected: FAIL because `remove-bg-quality.ts` does not exist.

- [ ] **Step 3: Implement the bounded evaluator**

Decode both inputs with:

```ts
sharp(buffer, { failOn: 'error', limitInputPixels: 67_108_864 })
  .ensureAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });
```

Count alpha `0..15` as transparent, `16..239` as partial, and `240..255` as foreground. Reject dimension mismatch, `foregroundRatio < 0.005`, and `transparentRatio < 0.002`. Compute halo only on partial-alpha pixels by comparing candidate RGB with nearby opaque source RGB; return `EDGE_HALO_HIGH` when the contaminated partial-alpha share exceeds `0.12`.

- [ ] **Step 4: Run the focused test**

```bash
pnpm exec vitest run src/__tests__/lib/remove-bg-quality.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/image-tools/remove-bg-quality.ts src/__tests__/lib/remove-bg-quality.test.ts
git commit -m "test: define remove background quality gates"
```

### Task 2: Preserve RGBA During Remove-Background Persistence

**Files:**
- Modify: `src/lib/remove-bg-postprocess.ts:104-170`
- Test: `src/__tests__/lib/remove-bg-postprocess.test.ts`

**Interfaces:**
- Consumes: `rgbaBase64`, optional `maskBase64`, and source buffer for quality evaluation.
- Produces: persisted transparent `imageUrl`, optional `maskUrl`, and quality metrics.

```ts
export async function postProcessLocalRemoveBG(
  rgbaBase64: string,
  maskBase64?: string,
  sourceBuffer?: Buffer,
): Promise<RemoveBGResult | null>;
```

- [ ] **Step 1: Write a failing persistence test**

Mock `saveImageFile` to capture the first saved buffer, call `postProcessLocalRemoveBG`, decode the captured PNG, and assert:

```ts
expect(metadata.hasAlpha).toBe(true);
expect(raw.data[3]).toBe(0);
expect(result?.quality.ok).toBe(true);
```

Add a second assertion that no `sharp({ create: ... background: white })` result is persisted.

- [ ] **Step 2: Verify RED**

```bash
pnpm exec vitest run src/__tests__/lib/remove-bg-postprocess.test.ts
```

Expected: FAIL because the current code composites RGBA onto white.

- [ ] **Step 3: Remove white flattening and return quality**

Change the result contract to:

```ts
export interface RemoveBGResult {
  imageUrl: string;
  maskUrl: string;
  quality: RemoveBgQualityResult;
}
```

Persist the repaired RGBA buffer directly:

```ts
const quality = await evaluateRemoveBgOutput(sourceBuffer ?? rgbaBuffer, rgbaBuffer);
if (!quality.ok) return null;
const imageUrl = saveImageFile(rgbaBuffer, imageFilename, 'removebg');
```

Keep edge-color repair, but never replace the alpha channel or composite onto an opaque background.

- [ ] **Step 4: Verify GREEN and adjacent callers**

```bash
pnpm exec vitest run src/__tests__/lib/remove-bg-postprocess.test.ts src/__tests__/api/rembg-cpu-wiring.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/remove-bg-postprocess.ts src/__tests__/lib/remove-bg-postprocess.test.ts
git commit -m "fix: preserve transparent remove background output"
```

### Task 3: Enforce Remove-Background Fallback and UI Output Contract

**Files:**
- Modify: `src/app/api/image-edit/route.ts:2818-2970`
- Modify: `src/components/infinite-canvas.tsx:7134-7298`
- Test: `src/__tests__/api/remove-bg-quality-routing.test.ts`
- Test: `src/__tests__/components/remove-bg-output-contract.test.ts`

**Interfaces:**
- API success includes `imageUrl`, `maskUrl`, `quality`, `engine`, and `usedModel`.
- UI adds the mask to the canvas only when `addMaskToCanvas === true`.

- [ ] **Step 1: Write failing route and UI contract tests**

The route test must prove that a CPU result failing `evaluateRemoveBgOutput` continues to an authorized fallback instead of returning success. The UI contract test must assert:

```ts
expect(canvasSource).toContain('useState(false)');
expect(canvasSource).toContain('if (addRemoveBgMaskToCanvas && maskResultUrl');
```

- [ ] **Step 2: Verify RED**

```bash
pnpm exec vitest run src/__tests__/api/remove-bg-quality-routing.test.ts src/__tests__/components/remove-bg-output-contract.test.ts
```

Expected: FAIL because quality is not exposed and the mask is always appended.

- [ ] **Step 3: Wire the quality gate and optional mask**

Pass the original source buffer into local post-processing. Return a structured `REMOVE_BG_QUALITY_FAILED` error with metrics when all bounded fallbacks fail. Add:

```ts
const [addRemoveBgMaskToCanvas, setAddRemoveBgMaskToCanvas] = useState(false);
```

to the model picker and include an accessible checkbox labelled `同时将黑白蒙版加入画布`.

- [ ] **Step 4: Run focused tests**

```bash
pnpm exec vitest run src/__tests__/api/remove-bg-quality-routing.test.ts src/__tests__/components/remove-bg-output-contract.test.ts src/__tests__/api/rembg-cpu-wiring.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/image-edit/route.ts src/components/infinite-canvas.tsx src/__tests__/api/remove-bg-quality-routing.test.ts src/__tests__/components/remove-bg-output-contract.test.ts
git commit -m "fix: reject poor remove background results"
```

### Task 4: Route Erase and Mask by Explicit Mode

**Files:**
- Create: `src/lib/image-tools/edit-request-mode.ts`
- Modify: `src/app/api/image-edit/route.ts:2990-3060`
- Modify: `src/components/infinite-canvas.tsx:8445-8500`
- Test: `src/__tests__/lib/edit-request-mode.test.ts`
- Test: `src/__tests__/components/image-edit-request-mode.test.ts`

**Interfaces:**

```ts
export type RegionEditMode = 'erase' | 'mask';

export function resolveRegionEditMode(
  value: unknown,
  prompt: unknown,
): RegionEditMode;
```

`resolveRegionEditMode` accepts only explicit `erase` or `mask`; legacy requests without `editMode` may infer mode once for compatibility and emit a warning.

- [ ] **Step 1: Write failing routing tests**

```ts
expect(resolveRegionEditMode('erase', 'internal erase instruction')).toBe('erase');
expect(resolveRegionEditMode('mask', 'replace shirt with blue fabric')).toBe('mask');
expect(() => resolveRegionEditMode('mask', '')).toThrow('MASK_PROMPT_REQUIRED');
```

The component test must assert that erase submits `prompt: ''` and `editMode: 'erase'`.

- [ ] **Step 2: Verify RED**

```bash
pnpm exec vitest run src/__tests__/lib/edit-request-mode.test.ts src/__tests__/components/image-edit-request-mode.test.ts
```

Expected: FAIL because mode currently depends on prompt emptiness.

- [ ] **Step 3: Implement and wire explicit routing**

Replace:

```ts
const isErase = !prompt || !prompt.trim();
```

with:

```ts
const regionEditMode = resolveRegionEditMode(editMode, prompt);
const isErase = regionEditMode === 'erase';
```

Keep provider-specific erase instructions inside the erase branch after routing.

- [ ] **Step 4: Verify focused API behavior**

```bash
pnpm exec vitest run src/__tests__/lib/edit-request-mode.test.ts src/__tests__/components/image-edit-request-mode.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/image-tools/edit-request-mode.ts src/app/api/image-edit/route.ts src/components/infinite-canvas.tsx src/__tests__/lib/edit-request-mode.test.ts src/__tests__/components/image-edit-request-mode.test.ts
git commit -m "fix: route erase and mask by explicit mode"
```

### Task 5: Preserve Pixels Outside the Mask

**Files:**
- Create: `src/lib/image-tools/masked-composite.ts`
- Modify: `src/app/api/image-edit/route.ts:3470-3545`
- Modify: mask completion code in `src/app/api/poll-task/route.ts`
- Test: `src/__tests__/lib/masked-composite.test.ts`
- Test: `src/__tests__/api/mask-edit-composition.test.ts`

**Interfaces:**

```ts
export interface MaskedCompositeInput {
  source: Buffer;
  generated: Buffer;
  mask: Buffer;
  width: number;
  height: number;
}

export async function compositeInsideMask(input: MaskedCompositeInput): Promise<Buffer>;
```

- [ ] **Step 1: Write a failing 4x4 pixel test**

Use a mask with one white pixel. Assert the white pixel takes generated RGB while all 15 black-mask pixels remain byte-identical to the source, including alpha.

- [ ] **Step 2: Verify RED**

```bash
pnpm exec vitest run src/__tests__/lib/masked-composite.test.ts src/__tests__/api/mask-edit-composition.test.ts
```

Expected: FAIL because the current route overwrites the whole crop rectangle.

- [ ] **Step 3: Implement exact masked composition**

Normalize source, generated, and mask to RGBA buffers of identical size. For each pixel:

```ts
const coverage = maskGray / 255;
out[channel] = Math.round(source[channel] * (1 - coverage) + generated[channel] * coverage);
out[alpha] = source[alpha];
```

Use this helper in both synchronous and asynchronous completion paths. Persist PNG rather than converting the result to JPEG.

- [ ] **Step 4: Verify GREEN**

```bash
pnpm exec vitest run src/__tests__/lib/masked-composite.test.ts src/__tests__/api/mask-edit-composition.test.ts
```

Expected: PASS with byte-identical outside-mask assertions.

- [ ] **Step 5: Commit**

```bash
git add src/lib/image-tools/masked-composite.ts src/app/api/image-edit/route.ts src/app/api/poll-task/route.ts src/__tests__/lib/masked-composite.test.ts src/__tests__/api/mask-edit-composition.test.ts
git commit -m "fix: constrain mask edits to painted pixels"
```

### Task 6: Share Color Parameters and Create Non-Destructive Results

**Files:**
- Create: `src/lib/image-tools/color-adjust-params.ts`
- Modify: `src/app/api/image/color-adjust/route.ts`
- Modify: `src/components/infinite-canvas.tsx:8104-8155,12303-12415`
- Test: `src/__tests__/lib/color-adjust-params.test.ts`
- Test: `src/__tests__/api/color-adjust-pixels.test.ts`
- Test: `src/__tests__/components/color-adjust-result.test.ts`

**Interfaces:**

```ts
export interface NormalizedColorAdjustParams {
  brightness: number;
  contrast: number;
  saturation: number;
  temperature: number;
  hue: number;
  highlights: number;
  shadows: number;
}

export function normalizeColorAdjustParams(value: unknown): NormalizedColorAdjustParams;
export function colorAdjustPreviewFilter(params: NormalizedColorAdjustParams): string;
```

- [ ] **Step 1: Write failing parameter and pixel tests**

Assert hue clamps to `-180..180`, neutral parameters preserve pixels, positive brightness raises mean luminance, negative saturation lowers chroma, and PNG alpha remains byte-identical.

- [ ] **Step 2: Verify RED**

```bash
pnpm exec vitest run src/__tests__/lib/color-adjust-params.test.ts src/__tests__/api/color-adjust-pixels.test.ts src/__tests__/components/color-adjust-result.test.ts
```

Expected: FAIL because parameter normalization is route-local and the UI replaces the source image.

- [ ] **Step 3: Use the shared contract and create a new canvas result**

Change the hue slider to `min={-180}` and `max={180}`. Replace source mutation:

```ts
onImagesChange(images.map(i => i.id === img.id ? { ...i, url: data.url } : i));
```

with a processing frame followed by:

```ts
completeProcessingFrame(placeholderId, data.url, img.width, img.height, {
  originalWidth: img.originalWidth || Math.round(img.width),
  originalHeight: img.originalHeight || Math.round(img.height),
  modifyPrompt: '参数调色',
}, 'edit');
```

Label the CSS preview `近似预览`; final output is authoritative.

- [ ] **Step 4: Verify focused tests**

```bash
pnpm exec vitest run src/__tests__/lib/color-adjust-params.test.ts src/__tests__/api/color-adjust-pixels.test.ts src/__tests__/components/color-adjust-result.test.ts src/__tests__/api/color-adjust-storage-wiring.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/image-tools/color-adjust-params.ts src/app/api/image/color-adjust/route.ts src/components/infinite-canvas.tsx src/__tests__/lib/color-adjust-params.test.ts src/__tests__/api/color-adjust-pixels.test.ts src/__tests__/components/color-adjust-result.test.ts
git commit -m "fix: align color adjustment preview and output"
```

### Task 7: Run Toolbar Regression and Real Output Inspection

**Files:**
- Create: `tests/e2e/image-toolbar-editing.spec.ts`
- Update: `docs/testing/BUG_REGISTER.md`
- Update: `docs/testing/REGRESSION_REPORT.md`
- Evidence: `test-results/screenshots/image-toolbar/`
- Evidence: `test-results/traces/image-toolbar/`

**Interfaces:**
- Consumes a logged-in cloud preview and controlled image fixtures.
- Produces screenshots, traces, request/task IDs, downloaded PNGs, and pixel inspection results.

- [ ] **Step 1: Add the E2E cases**

Cover:

```ts
test('remove background downloads a PNG with real transparency', ...);
test('erase removes painted content and preserves the exterior', ...);
test('mask edit changes only the painted region', ...);
test('color adjustment creates a separate persistent result', ...);
```

Capture console errors and request bodies. Wait on task state or result-frame changes, never a fixed long sleep.

- [ ] **Step 2: Run the local focused suite**

```bash
pnpm exec vitest run src/__tests__/lib/remove-bg-quality.test.ts src/__tests__/lib/remove-bg-postprocess.test.ts src/__tests__/lib/edit-request-mode.test.ts src/__tests__/lib/masked-composite.test.ts src/__tests__/lib/color-adjust-params.test.ts src/__tests__/api/remove-bg-quality-routing.test.ts src/__tests__/api/mask-edit-composition.test.ts src/__tests__/api/color-adjust-pixels.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run the widening verification ladder**

```bash
pnpm ts-check
pnpm lint
pnpm test
pnpm build
```

Expected: zero command failures; historical lint warnings are recorded rather than hidden.

- [ ] **Step 4: Execute the cloud Chrome cases**

Run the four tools against the deployed commit. Download each result and inspect with Sharp:

```ts
const metadata = await sharp(downloaded).metadata();
expect(metadata.hasAlpha).toBe(true);
```

Record any environment block as unverified, not passed.

- [ ] **Step 5: Update reports and commit**

```bash
git add tests/e2e/image-toolbar-editing.spec.ts docs/testing/BUG_REGISTER.md docs/testing/REGRESSION_REPORT.md
git commit -m "test: verify image toolbar editing workflows"
```

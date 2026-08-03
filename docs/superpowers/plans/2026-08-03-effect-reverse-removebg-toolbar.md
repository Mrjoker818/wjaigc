# Effect Reverse Engineering, AI Remove Background, and Toolbar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a functional Effect Reverse Engineering Pro floating workspace, provider-compatible AI background removal, and collision-safe canvas toolbars without removing or changing existing image and bottom-toolbar actions.

**Architecture:** Build reverse engineering as a small isolated client/server module that freezes the selected source image, validates manual regions, performs deterministic perspective correction, and reports real task states through the existing task registry. Extend the existing `removebg` provider type through structured advanced parameters and a server-only multipart adapter. Keep `infinite-canvas.tsx` as an integration shell: it opens the new panel and consumes reusable action/position helpers rather than growing new business logic.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5, Vitest, Playwright, Sharp, JSZip, pdf-lib, lucide-react, Tailwind CSS 4.

## Global Constraints

- Preserve every existing bottom-toolbar and selected-image-toolbar action, callback, keyboard shortcut, and saved image-toolbar preference.
- Do not expose provider API keys, signed source URLs, source bytes, or user credentials to the browser.
- All server image reads use `loadSafeImageInput()` or the existing trusted managed-media path; do not introduce raw `fetch(imageUrl)`.
- All Sharp input goes through `safeSharp()` or an equivalent helper with a pixel limit.
- Use test-driven development: every behavior change begins with a focused failing test observed in Vitest.
- Do not use simulated analysis, fake exports, or HTTP status alone as successful business output.
- Do not alter login, project restoration, generation polling, billing, or existing canvas pointer routing except through narrowly tested integration points.
- Retain the existing local RemoveBG path as an explicit local/offline fallback.
- Use ASCII in new source and documentation files.

---

## File Structure

| Path | Role |
| --- | --- |
| `src/lib/effect-reverse-engineering/types.ts` | Shared source snapshot, region, task, export, and result contracts. |
| `src/lib/effect-reverse-engineering/validation.ts` | Request, region, calibration, and normalized-coordinate validation. |
| `src/lib/effect-reverse-engineering/perspective.ts` | Deterministic four-point perspective math and raw RGBA warp. |
| `src/lib/effect-reverse-engineering/service.ts` | Authenticated source freeze, task dispatch, cancellation, export packaging, and task result retrieval. |
| `src/app/api/effect-reverse-engineering/route.ts` | Bounded authenticated HTTP surface for create/correct/analyze/export/status/cancel. |
| `src/components/effect-reverse-engineering-panel.tsx` | Draggable/resizable floating UI with manual regions, calibration, progress, and exports. |
| `src/lib/remove-bg-provider.ts` | Profile parsing, multipart provider request, ZIP color/alpha processing, and alpha quality enforcement. |
| `src/lib/image-toolbar-position.ts` | Add available-canvas/right-panel-aware toolbar and popover placement. |
| `src/lib/canvas-toolbar-layout.ts` | Pure bottom-drawer placement and action grouping helpers. |
| `src/components/dashboard/dashboard-view.tsx` | Structured administrator fields for `removebg-multipart` configuration. |
| `src/app/api/image-edit/route.ts` | Route dedicated RemoveBG models to the multipart adapter before generic image-generation fallback. |
| `src/components/infinite-canvas.tsx` | Integrate the new panel and replace horizontal toolbar expansion with bounded drawer/popover behavior. |
| `src/__tests__/lib/effect-reverse-*.test.ts` | Pure validation, source, perspective, and service regression tests. |
| `src/__tests__/api/effect-reverse-engineering.test.ts` | Route authorization, limits, and task state tests. |
| `src/__tests__/lib/remove-bg-provider.test.ts` | Multipart, direct image, ZIP, alpha, and error classification tests. |
| `src/__tests__/components/canvas-toolbar-layout.test.ts` | Action reachability and occupied-panel layout regressions. |
| `tests/e2e/effect-reverse-removebg-toolbar.spec.ts` | Browser verification with saved trace, video, screenshot, console, and network evidence. |

## Task 1: Reverse-Engineering Contracts, Validation, and Perspective Math

**Files:**
- Create: `src/lib/effect-reverse-engineering/types.ts`
- Create: `src/lib/effect-reverse-engineering/validation.ts`
- Create: `src/lib/effect-reverse-engineering/perspective.ts`
- Test: `src/__tests__/lib/effect-reverse-validation.test.ts`
- Test: `src/__tests__/lib/effect-reverse-perspective.test.ts`

**Interfaces:**
- Produces `EffectReverseSessionInput`, `EffectReverseRegion`, `EffectReverseTaskStatus`, `validateEffectReverseSessionInput()`, `normalizePerspectivePoints()`, and `warpPerspectiveRgba()`.
- Consumed by `service.ts`, the API route, and the React panel.

- [ ] **Step 1: Write the failing validation tests**

```ts
it('accepts one frozen managed source and normalized quadrilateral', () => {
  expect(() => validateEffectReverseSessionInput({
    projectId: 'project-1',
    sourceImageId: 'image-1',
    sourceVersionId: 'version-1',
    imageUrl: '/api/serve-upload/uploads/source.png',
    perspective: [
      { x: 0.05, y: 0.05 },
      { x: 0.95, y: 0.05 },
      { x: 0.95, y: 0.95 },
      { x: 0.05, y: 0.95 },
    ],
    regions: [],
  })).not.toThrow();
});

it.each([
  { points: [{ x: 0, y: 0 }, { x: 1, y: 0 }], message: 'four points' },
  { points: [{ x: -0.01, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }], message: 'normalized' },
])('rejects invalid perspective geometry: $message', ({ points }) => {
  expect(() => validateEffectReverseSessionInput({
    projectId: 'project-1',
    sourceImageId: 'image-1',
    sourceVersionId: 'version-1',
    imageUrl: '/uploads/source.png',
    perspective: points,
    regions: [],
  })).toThrow();
});

it('rejects a region with more than 128 points', () => {
  expect(() => validateEffectReverseSessionInput({
    projectId: 'project-1',
    sourceImageId: 'image-1',
    sourceVersionId: 'version-1',
    imageUrl: '/uploads/source.png',
    perspective: validPerspective,
    regions: [{ id: 'r1', kind: 'wall', label: 'Wall', visible: true, locked: false, inferred: false,
      points: Array.from({ length: 129 }, () => ({ x: 0.5, y: 0.5 })) }],
  })).toThrow(/128/);
});
```

- [ ] **Step 2: Run the validation test to verify it fails**

Run:

```bash
pnpm exec vitest run src/__tests__/lib/effect-reverse-validation.test.ts
```

Expected: FAIL because `effect-reverse-engineering/validation` does not exist.

- [ ] **Step 3: Write the minimal contracts and validation implementation**

```ts
export type EffectReverseTaskStatus =
  | 'queued' | 'analyzing' | 'correcting' | 'exporting'
  | 'completed' | 'failed' | 'cancelled' | 'timeout';

export interface NormalizedPoint { x: number; y: number; }

export interface EffectReverseRegion {
  id: string;
  kind: 'wall' | 'floor' | 'ceiling' | 'object' | 'text' | 'material' | 'custom';
  label: string;
  points: NormalizedPoint[];
  visible: boolean;
  locked: boolean;
  inferred: boolean;
}

export function assertNormalizedPoint(point: NormalizedPoint): void {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y) ||
      point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1) {
    throw new EffectReverseValidationError('EFFECT_REVERSE_POINT_INVALID', 'Point must be normalized');
  }
}
```

Implement explicit 12-source, 80-region, 3-to-128-point, 120-character label, 4,000-character instruction, and 256 KiB JSON bounds. Reject data URLs and any source path that is not subsequently normalized through the route.

- [ ] **Step 4: Write failing perspective tests**

```ts
it('keeps an identity quadrilateral byte-identical', () => {
  const source = Buffer.from([
    255, 0, 0, 255, 0, 255, 0, 255,
    0, 0, 255, 255, 255, 255, 255, 255,
  ]);
  expect(warpPerspectiveRgba(source, 2, 2, identityQuad, 2, 2)).toEqual(source);
});

it('maps a normalized trapezoid into requested output dimensions', () => {
  const result = warpPerspectiveRgba(sourcePixels, 4, 4, trapezoid, 8, 6);
  expect(result.byteLength).toBe(8 * 6 * 4);
});
```

- [ ] **Step 5: Run the perspective test to verify it fails**

Run:

```bash
pnpm exec vitest run src/__tests__/lib/effect-reverse-perspective.test.ts
```

Expected: FAIL because `warpPerspectiveRgba` does not exist.

- [ ] **Step 6: Implement deterministic perspective correction**

Implement `solveProjectiveTransform()` by solving the eight homography coefficients from the four source and target point pairs. Implement inverse mapping with bilinear RGBA sampling:

```ts
export function warpPerspectiveRgba(
  source: Buffer,
  sourceWidth: number,
  sourceHeight: number,
  sourceQuad: [NormalizedPoint, NormalizedPoint, NormalizedPoint, NormalizedPoint],
  outputWidth: number,
  outputHeight: number,
): Buffer {
  const inverse = solveInverseHomography(sourceQuad, outputWidth, outputHeight);
  const output = Buffer.alloc(outputWidth * outputHeight * 4);
  for (let y = 0; y < outputHeight; y += 1) {
    for (let x = 0; x < outputWidth; x += 1) {
      const point = project(inverse, x, y);
      sampleBilinearRgba(source, sourceWidth, sourceHeight, point.x, point.y, output, x, y, outputWidth);
    }
  }
  return output;
}
```

Reject singular quadrilaterals and output dimensions above the safe pixel limit.

- [ ] **Step 7: Run focused tests and commit**

Run:

```bash
pnpm exec vitest run src/__tests__/lib/effect-reverse-validation.test.ts src/__tests__/lib/effect-reverse-perspective.test.ts
```

Expected: PASS.

Commit:

```bash
git add src/lib/effect-reverse-engineering src/__tests__/lib/effect-reverse-validation.test.ts src/__tests__/lib/effect-reverse-perspective.test.ts
git commit -m "feat: add reverse engineering geometry contracts"
```

## Task 2: Secure Reverse-Engineering Service and API Route

**Files:**
- Create: `src/lib/effect-reverse-engineering/service.ts`
- Create: `src/app/api/effect-reverse-engineering/route.ts`
- Test: `src/__tests__/api/effect-reverse-engineering.test.ts`

**Interfaces:**
- Consumes `validateEffectReverseSessionInput()`, `loadSafeImageInput()`, `safeSharp()`, `saveImageFile()`, `registerTask()`, `updateTaskProgress()`, and `isTaskCancelled()`.
- Produces `submitEffectReverseTask()`, `getEffectReverseTask()`, `cancelEffectReverseTask()`, and authenticated `POST`, `GET`, `DELETE` route actions.

- [ ] **Step 1: Write failing route tests**

```ts
it('rejects an unauthenticated reverse-engineering request', async () => {
  const response = await POST(new NextRequest('http://localhost/api/effect-reverse-engineering', {
    method: 'POST',
    body: JSON.stringify(validBody),
  }));
  expect(response.status).toBe(401);
});

it('rejects a source that does not belong to the project', async () => {
  mockOwnedSource.mockResolvedValue(null);
  const response = await POST(authenticatedRequest(validBody));
  expect(response.status).toBe(404);
  await expect(response.json()).resolves.toMatchObject({
    success: false,
    code: 'EFFECT_REVERSE_SOURCE_NOT_FOUND',
  });
});

it('returns an application task id before asynchronous correction runs', async () => {
  const response = await POST(authenticatedRequest({ ...validBody, action: 'correct' }));
  expect(response.status).toBe(202);
  await expect(response.json()).resolves.toMatchObject({
    success: true,
    taskId: expect.stringMatching(/^effect-reverse-/),
  });
});
```

- [ ] **Step 2: Run the route test to verify it fails**

Run:

```bash
pnpm exec vitest run src/__tests__/api/effect-reverse-engineering.test.ts
```

Expected: FAIL because the route does not exist.

- [ ] **Step 3: Implement bounded request parsing and source freeze**

Use `requireApiAuthOrReject()` and `findOwnedAnnotationSource()` as the authorization pattern. Read request bodies through a byte-counting reader capped at 256 KiB. Normalize the submitted image with `normalizeTrustedManagedMediaInput()`, then require exact equality with the owned image URL and source version.

```ts
const source = await loadSafeImageInput(owned.imageUrl, {
  maxBytes: 25 * 1024 * 1024,
  maxPixels: 40_000_000,
  signal,
});
const metadata = await safeSharp(source.buffer, { signal }).metadata();
const snapshot = {
  projectId: input.projectId,
  sourceImageId: input.sourceImageId,
  canonicalImageUrl: owned.imageUrl,
  sourceHash: createHash('sha256').update(source.buffer).digest('hex'),
  width: metadata.width!,
  height: metadata.height!,
  mimeType: source.mimeType,
};
```

- [ ] **Step 4: Implement task dispatch, cancellation, and terminal state guarding**

Create a server-side task record keyed by task ID. Register it before beginning work and update task progress through deterministic phases:

```ts
registerTask(taskId, 'display-decompose', 'Effect Reverse Engineering', userId);
updateTaskProgress(taskId, { status: 'processing', progress: 5, label: 'Freezing source image' });
```

Run source correction in a detached async function. Before each phase and before writing output, call `isTaskCancelled(taskId)`. Only set `completed` if the current record remains `processing`; cancelled, failed, and timeout states must not be overwritten by late work. Persist corrected PNG using `saveImageFile(resultBuffer, filename, 'effect-reverse')`.

- [ ] **Step 5: Implement real export actions**

Support:

- `correct`: corrected PNG only;
- `export-png`: corrected PNG;
- `export-svg`: SVG containing the source and manual region overlays only when the existing SVG exporter accepts the source;
- `export-pdf`: PDF with source/corrected pages, regions, calibration, and inferred-risk notice;
- `export-zip`: ZIP containing the actual PNG, available SVG/PDF, and `session.json`.

When an export cannot be built from the current session, return `EFFECT_REVERSE_EXPORT_UNAVAILABLE` with `retryable: false`; never return a placeholder file.

- [ ] **Step 6: Run focused API tests and commit**

Run:

```bash
pnpm exec vitest run src/__tests__/api/effect-reverse-engineering.test.ts src/__tests__/lib/effect-reverse-validation.test.ts src/__tests__/lib/effect-reverse-perspective.test.ts
```

Expected: PASS.

Commit:

```bash
git add src/lib/effect-reverse-engineering/service.ts src/app/api/effect-reverse-engineering/route.ts src/__tests__/api/effect-reverse-engineering.test.ts
git commit -m "feat: add reverse engineering task API"
```

## Task 3: Reverse-Engineering Floating Workspace

**Files:**
- Create: `src/components/effect-reverse-engineering-panel.tsx`
- Test: `src/__tests__/components/effect-reverse-engineering-panel.test.tsx`

**Interfaces:**
- Consumes `EffectReverseSessionInput`, `EffectReverseRegion`, and `/api/effect-reverse-engineering`.
- Produces `EffectReverseEngineeringPanel` with `initialSource`, `isMonochrome`, `onClose`, and `onCanvasResult` props.

- [ ] **Step 1: Write failing component contract tests**

```ts
it('renders manual mode instead of claiming AI analysis when no analyzer is configured', () => {
  render(<EffectReverseEngineeringPanel initialSource={source} analyzerOptions={[]} {...handlers} />);
  expect(screen.getByText('Manual structure mode')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Run AI analysis' })).not.toBeInTheDocument();
});

it('disables correction until the four points form a valid quadrilateral', async () => {
  render(<EffectReverseEngineeringPanel initialSource={source} {...handlers} />);
  await userEvent.click(screen.getByRole('button', { name: 'Correct perspective' }));
  expect(fetchMock).not.toHaveBeenCalled();
  expect(screen.getByText('Set four valid perspective points first')).toBeInTheDocument();
});

it('marks AI-created regions as inferred', async () => {
  render(<EffectReverseEngineeringPanel initialSource={source} analyzerOptions={[analyzer]} {...handlers} />);
  await userEvent.click(screen.getByRole('button', { name: 'Run AI analysis' }));
  expect(await screen.findByText('Inferred')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the component test to verify it fails**

Run:

```bash
pnpm exec vitest run src/__tests__/components/effect-reverse-engineering-panel.test.tsx
```

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement a real floating panel**

Implement a `fixed` panel rendered above the canvas, with:

```tsx
<section
  data-popup="effect-reverse-engineering"
  className="fixed left-1/2 top-1/2 z-[220] flex h-[min(900px,calc(100vh-48px))] w-[min(1440px,calc(100vw-48px))] -translate-x-1/2 -translate-y-1/2 overflow-hidden border shadow-2xl"
  onPointerDown={(event) => event.stopPropagation()}
  onWheel={(event) => event.stopPropagation()}
>
```

Use a title bar with minimize, maximize/restore, and close. Persist only the user-selected panel geometry in local storage under `wujie.effect-reverse.window.v1`; validate all restored dimensions before use. Use a full-screen responsive presentation when viewport width is below 960 pixels.

- [ ] **Step 4: Implement source, region, perspective, and export interactions**

- Seed from `initialSource`; provide upload only through the existing image upload/save flow.
- Allow manual polygon creation, selection, visible/locked toggles, and region labels.
- Use a canvas overlay for four draggable perspective points and a deterministic corrected preview generated from the route result.
- Poll task status using the existing task event client with poll-task fallback.
- Add corrected results to the infinite canvas through `onCanvasResult`; never overwrite the source.
- Disable unavailable AI analysis and unsupported exports with a concrete visible reason.

- [ ] **Step 5: Run component tests and commit**

Run:

```bash
pnpm exec vitest run src/__tests__/components/effect-reverse-engineering-panel.test.tsx
```

Expected: PASS.

Commit:

```bash
git add src/components/effect-reverse-engineering-panel.tsx src/__tests__/components/effect-reverse-engineering-panel.test.tsx
git commit -m "feat: add reverse engineering floating workspace"
```

## Task 4: Integrate Effect Reverse Engineering into the Canvas

**Files:**
- Modify: `src/components/infinite-canvas.tsx`
- Modify: `src/lib/task-registry.ts`
- Test: `src/__tests__/components/canvas-toolbar-floating-windows.test.ts`
- Test: `src/__tests__/components/effect-reverse-canvas-wiring.test.ts`

**Interfaces:**
- Consumes `EffectReverseEngineeringPanel`.
- Produces one new bottom-toolbar action positioned immediately after the `3D Display Pro` action and a canvas result insertion callback.

- [ ] **Step 1: Write failing wiring tests**

```ts
it('registers Effect Reverse Engineering immediately after 3D Display Pro', () => {
  const source = readCanvasSource();
  expect(source.indexOf('title="3D Display Pro"')).toBeLessThan(
    source.indexOf('title="Effect Reverse Engineering Pro"'),
  );
});

it('renders the new panel as a fixed popup outside transformed canvas content', () => {
  const source = readCanvasSource();
  expect(source).toContain('<EffectReverseEngineeringPanel');
  expect(source).toContain('data-popup="effect-reverse-engineering"');
  expect(source).toContain('onCanvasResult=');
});

it('preserves old image action labels and callbacks after adding the new workspace', () => {
  const source = readCanvasSource();
  for (const label of ['Upscale', 'Remove background', 'SVG trace', 'Erase', 'Mask', 'Color adjust', 'Download']) {
    expect(source).toContain(label);
  }
});
```

- [ ] **Step 2: Run wiring tests to verify they fail**

Run:

```bash
pnpm exec vitest run src/__tests__/components/effect-reverse-canvas-wiring.test.ts src/__tests__/components/canvas-toolbar-floating-windows.test.ts
```

Expected: FAIL because no reverse-engineering action or panel exists in `infinite-canvas.tsx`.

- [ ] **Step 3: Implement state and action integration**

Add:

```ts
const [showEffectReverseEngineering, setShowEffectReverseEngineering] = useState(false);
const [effectReverseSource, setEffectReverseSource] = useState<CanvasImage | null>(null);

const openEffectReverseEngineering = () => {
  setEffectReverseSource(selectedImageData || selectedImage || null);
  setShowEffectReverseEngineering(true);
};
```

Place the button directly after the `3D Display Pro` button in the existing collapsible feature section. Use a lucide icon already imported for a structurally related tool or add one explicit lucide import; do not draw a custom SVG.

- [ ] **Step 4: Insert results without mutating the selected source**

```ts
onCanvasResult={(result) => {
  const source = effectReverseSource;
  const newImage = createCanvasImageFromResult(result, {
    x: (source?.x ?? 0) + (source?.width ?? 360) + 48,
    y: source?.y ?? 0,
  });
  applyImageChanges([...images, newImage]);
}}
```

Use the existing image creation/persistence helpers in the component. Close only the reverse-engineering panel on its close callback; do not call a global close routine that can close unrelated panels.

- [ ] **Step 5: Run focused canvas tests and commit**

Run:

```bash
pnpm exec vitest run src/__tests__/components/effect-reverse-canvas-wiring.test.ts src/__tests__/components/canvas-toolbar-floating-windows.test.ts
```

Expected: PASS.

Commit:

```bash
git add src/components/infinite-canvas.tsx src/lib/task-registry.ts src/__tests__/components/effect-reverse-canvas-wiring.test.ts src/__tests__/components/canvas-toolbar-floating-windows.test.ts
git commit -m "feat: wire reverse engineering into canvas toolbar"
```

## Task 5: Dedicated Provider-Backed RemoveBG Adapter

**Files:**
- Create: `src/lib/remove-bg-provider.ts`
- Modify: `src/lib/universal-api-types.ts`
- Modify: `src/lib/server-api-config.ts`
- Test: `src/__tests__/lib/remove-bg-provider.test.ts`
- Test: `src/__tests__/lib/server-api-config-removebg-profile.test.ts`

**Interfaces:**
- Produces `parseRemoveBgProviderOptions()`, `submitDedicatedRemoveBg()`, `decodeDedicatedRemoveBgResponse()`, and `RemoveBgProviderError`.
- Consumes `ApiProvider.advancedParams`, `loadSafeImageInput()`, `safeSharp()`, `evaluateRemoveBgOutput()`, and `saveImageFile()`.

- [ ] **Step 1: Write failing adapter tests**

```ts
it('sends source bytes to a removebg-multipart provider without exposing the key to callers', async () => {
  await submitDedicatedRemoveBg(provider, '/uploads/source.png', { signal });
  expect(fetchMock).toHaveBeenCalledWith(
    'https://api.remove.example/v1.0/removebg',
    expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ 'X-Api-Key': 'server-secret' }),
      body: expect.any(FormData),
    }),
  );
  expect(fetchMock.mock.calls[0][1].body.get('image_file')).toBeInstanceOf(File);
});

it('rejects an all-opaque response when transparent output is required', async () => {
  fetchMock.mockResolvedValue(imageResponse(opaquePng));
  await expect(submitDedicatedRemoveBg(provider, '/uploads/source.png')).rejects.toMatchObject({
    code: 'REMOVE_BG_OUTPUT_INVALID',
  });
});

it('composes a ZIP color image and alpha image into a real RGBA PNG', async () => {
  fetchMock.mockResolvedValue(zipResponse(await createColorAlphaZip()));
  const result = await submitDedicatedRemoveBg(zipProvider, '/uploads/source.png');
  expect(result.mimeType).toBe('image/png');
  expect(await hasMeaningfulAlpha(result.buffer)).toBe(true);
});

it('rejects ZIP traversal and dimension mismatch before persistence', async () => {
  await expect(decodeDedicatedRemoveBgResponse(zipWith('../secret.png'))).rejects.toMatchObject({
    code: 'REMOVE_BG_OUTPUT_INVALID',
  });
});
```

- [ ] **Step 2: Run adapter tests to verify they fail**

Run:

```bash
pnpm exec vitest run src/__tests__/lib/remove-bg-provider.test.ts src/__tests__/lib/server-api-config-removebg-profile.test.ts
```

Expected: FAIL because the dedicated adapter and profile parser do not exist.

- [ ] **Step 3: Define structured profile parameters**

Retain the `removebg` model type and add an advanced-parameter parser:

```ts
export interface RemoveBgProviderOptions {
  requestProfile: 'removebg-multipart' | 'images-generations';
  imageInput: 'file' | 'url';
  responseMode: 'png' | 'webp' | 'zip';
  endpointPath: string;
  apiKeyHeader: 'X-Api-Key' | 'Authorization';
  transparentOutputRequired: boolean;
  maxInputMegapixels: number;
}

export function parseRemoveBgProviderOptions(
  advancedParams: Record<string, string> | undefined,
): RemoveBgProviderOptions {
  return {
    requestProfile: advancedParams?.removeBgRequestProfile === 'removebg-multipart'
      ? 'removebg-multipart' : 'images-generations',
    imageInput: advancedParams?.removeBgImageInput === 'url' ? 'url' : 'file',
    responseMode: parseResponseMode(advancedParams?.removeBgResponseMode),
    endpointPath: normalizeEndpointPath(advancedParams?.removeBgEndpointPath || '/v1.0/removebg'),
    apiKeyHeader: advancedParams?.removeBgApiKeyHeader === 'Authorization'
      ? 'Authorization' : 'X-Api-Key',
    transparentOutputRequired: advancedParams?.removeBgTransparentOutput !== 'false',
    maxInputMegapixels: parseBoundedPositiveInt(advancedParams?.removeBgMaxInputMegapixels, 10, 1, 40),
  };
}
```

- [ ] **Step 4: Implement secure form submission and ZIP decode**

Load source bytes with:

```ts
const source = await loadSafeImageInput(sourceUrl, {
  maxBytes: 25 * 1024 * 1024,
  maxPixels: 40_000_000,
  signal,
});
```

For file input, construct `FormData` with a `File` created from safe source bytes. For URL input, permit only normalized, configured, public source URLs and send the field name specified by the profile. Use an `AbortController` tied to a bounded timeout.

For ZIP responses, accept only `application/zip` and `application/x-zip-compressed` through the explicit safe allowlist. Limit archive entries to 8, reject traversal/duplicate paths, cap decompressed bytes, choose exact configured `color` and `alpha` candidates, validate dimensions with `safeSharp()`, and compose alpha over original RGB using Sharp.

- [ ] **Step 5: Run focused tests and commit**

Run:

```bash
pnpm exec vitest run src/__tests__/lib/remove-bg-provider.test.ts src/__tests__/lib/server-api-config-removebg-profile.test.ts src/__tests__/lib/remove-bg-quality.test.ts src/__tests__/lib/safe-image-download.test.ts
```

Expected: PASS.

Commit:

```bash
git add src/lib/remove-bg-provider.ts src/lib/universal-api-types.ts src/lib/server-api-config.ts src/__tests__/lib/remove-bg-provider.test.ts src/__tests__/lib/server-api-config-removebg-profile.test.ts
git commit -m "feat: add dedicated provider removebg adapter"
```

## Task 6: Connect Dedicated RemoveBG to Admin Configuration and Image Editing

**Files:**
- Modify: `src/components/dashboard/dashboard-view.tsx`
- Modify: `src/app/api/image-edit/route.ts`
- Modify: `src/components/infinite-canvas.tsx`
- Test: `src/__tests__/api/remove-bg-quality-routing.test.ts`
- Test: `src/__tests__/components/remove-bg-output-contract.test.ts`
- Test: `src/__tests__/components/remove-bg-provider-picker.test.ts`

**Interfaces:**
- Consumes `parseRemoveBgProviderOptions()` and `submitDedicatedRemoveBg()`.
- Produces an administrator-configurable dedicated RemoveBG provider and a picker that shows actual configured model names and engines.

- [ ] **Step 1: Write failing routing and picker tests**

```ts
it('uses the dedicated multipart adapter before generic image generation', () => {
  expect(routeSource.indexOf('submitDedicatedRemoveBg')).toBeLessThan(
    routeSource.indexOf('autoTrySubmitImageTask'),
  );
});

it('returns a verified transparent result with the actual provider and model', () => {
  expect(routeSource).toContain("engine: 'removebg-multipart'");
  expect(routeSource).toContain('usedProviderId: dedicatedResult.providerId');
  expect(routeSource).toContain('usedModel: dedicatedResult.modelId');
});

it('renders configured removebg provider model names instead of only fixed CPU names', () => {
  expect(canvasSource).toContain('configuredRemoveBgModels');
  expect(canvasSource).toContain('removeBgRequestProfile');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
pnpm exec vitest run src/__tests__/api/remove-bg-quality-routing.test.ts src/__tests__/components/remove-bg-output-contract.test.ts src/__tests__/components/remove-bg-provider-picker.test.ts
```

Expected: FAIL because the route and picker do not know the dedicated profile.

- [ ] **Step 3: Add structured administrator controls**

When `apiKind === 'removebg'`, render selectable fields for:

- request profile: Generic images API / Dedicated multipart RemoveBG;
- input mode: secure file upload / configured URL input;
- response: PNG / WebP / ZIP color plus alpha;
- endpoint path;
- key header;
- maximum input megapixels;
- transparent output required.

Persist values as named `advancedParams` keys from Task 5. Preserve existing providers with no new keys by using parser defaults. Do not store or render the API key in a browser-visible provider response.

- [ ] **Step 4: Route dedicated models before generic fallback**

In the `removebg` branch of `image-edit/route.ts`, identify the selected provider/model pair and parse provider options. If its profile is `removebg-multipart`, call the dedicated adapter before CPU or generic image generation:

```ts
const dedicatedResult = await submitDedicatedRemoveBg({
  provider,
  modelId: selectedModel,
  sourceUrl: imageUrl,
  signal: taskAbortController.signal,
});

return NextResponse.json({
  success: true,
  imageUrl: dedicatedResult.imageUrl,
  maskUrl: dedicatedResult.maskUrl,
  action,
  engine: 'removebg-multipart',
  usedProviderId: provider.id,
  usedModel: selectedModel,
  quality: dedicatedResult.quality,
});
```

Classify provider rejection, timeout, invalid output, cancellation, and no configured model distinctly. Do not run the local fallback when the user explicitly selects the AI-only engine.

- [ ] **Step 5: Update the picker without hiding current choices**

Fetch permitted `removebg` provider/model pairs through the existing model configuration endpoint. Display:

- local CPU models;
- auto mode;
- each authorized configured provider/model with the provider display name;
- the selected profile's expected output type.

Keep the current local choices and existing `removeBgEngine` semantics. The UI must show the actual engine used after completion, including a local fallback.

- [ ] **Step 6: Run focused tests and commit**

Run:

```bash
pnpm exec vitest run src/__tests__/api/remove-bg-quality-routing.test.ts src/__tests__/components/remove-bg-output-contract.test.ts src/__tests__/components/remove-bg-provider-picker.test.ts
```

Expected: PASS.

Commit:

```bash
git add src/components/dashboard/dashboard-view.tsx src/app/api/image-edit/route.ts src/components/infinite-canvas.tsx src/__tests__/api/remove-bg-quality-routing.test.ts src/__tests__/components/remove-bg-output-contract.test.ts src/__tests__/components/remove-bg-provider-picker.test.ts
git commit -m "feat: expose dedicated removebg provider settings"
```

## Task 7: Collision-Safe Bottom and Selected-Image Toolbars

**Files:**
- Create: `src/lib/canvas-toolbar-layout.ts`
- Modify: `src/lib/image-toolbar-position.ts`
- Modify: `src/components/infinite-canvas.tsx`
- Test: `src/__tests__/lib/canvas-toolbar-layout.test.ts`
- Test: `src/__tests__/lib/image-toolbar-position.test.ts`
- Test: `src/__tests__/lib/image-toolbar-preferences.test.ts`
- Test: `src/__tests__/components/canvas-toolbar-floating-windows.test.ts`

**Interfaces:**
- Produces `getBottomToolbarDrawerPlacement()` and extended `getConstrainedImageToolbarPosition()` inputs accepting `occupiedRight`.
- Consumes existing image-toolbar order/hidden preferences unchanged.

- [ ] **Step 1: Write failing layout tests**

```ts
it('opens a bottom drawer left of an occupied right panel', () => {
  expect(getBottomToolbarDrawerPlacement({
    trigger: { left: 940, top: 740, width: 36, height: 36 },
    viewport: { width: 1280, height: 800 },
    drawer: { width: 420, height: 360 },
    occupiedRight: 400,
  })).toMatchObject({ side: 'left', top: 364 });
});

it('constrains the selected-image popover inside the available canvas width', () => {
  const result = getConstrainedImageToolbarPosition({
    image: { x: 820, y: 240, width: 320, height: 240 },
    zoom: 1,
    offset: { x: 0, y: 0 },
    toolbar: { width: 380, height: 300 },
    viewport: { width: 1280, height: 800 },
    occupiedRight: 400,
  });
  expect(result.left).toBeLessThanOrEqual(864);
});

it('keeps every saved action visible in order after preference normalization', () => {
  const value = normalizeImageToolbarPreferences(['Download', 'Upscale'], []);
  expect(value.order).toContain('Remove background');
  expect(value.order).toContain('Edit elements');
});
```

- [ ] **Step 2: Run layout tests to verify they fail**

Run:

```bash
pnpm exec vitest run src/__tests__/lib/canvas-toolbar-layout.test.ts src/__tests__/lib/image-toolbar-position.test.ts src/__tests__/lib/image-toolbar-preferences.test.ts
```

Expected: FAIL because occupied-right and drawer placement are not implemented.

- [ ] **Step 3: Implement pure placement helpers**

Extend image placement input:

```ts
occupiedRight?: number;
```

Calculate `availableRight = viewport.width - Math.max(0, occupiedRight ?? 0) - margin`; clamp toolbar/popover anchors to `availableRight`. Return a placement whose transform never places content below the image if it would exceed viewport height; choose the maximum visible area among top, bottom, left, and right.

For bottom tools:

```ts
export function getBottomToolbarDrawerPlacement(input: DrawerPlacementInput): DrawerPlacement {
  const availableRight = input.viewport.width - input.occupiedRight - input.margin;
  const leftCandidate = input.trigger.left + input.trigger.width - input.drawer.width;
  const left = clamp(leftCandidate, input.margin, Math.max(input.margin, availableRight - input.drawer.width));
  const top = clamp(input.trigger.top - input.drawer.height - input.gap, input.margin, input.viewport.height - input.drawer.height - input.margin);
  return { left, top, side: 'left' };
}
```

- [ ] **Step 4: Replace horizontal expansion with bounded, categorized surfaces**

Keep first five selected-image actions visible. Replace full-row `toolbarExpanded` rendering with a `+N` popover that:

- uses the same `visibleImageActions` array and callbacks;
- groups by an explicit `category` field added to each action descriptor;
- has `max-h-[min(60vh,420px)] overflow-y-auto`;
- stops pointer, mouse, and wheel propagation;
- uses the new occupied-right-aware placement;
- keeps the customization popup intact.

For the bottom toolbar, retain core controls and the current hover behavior but replace uncontrolled extended horizontal width with an "all tools" drawer. The drawer is internally scrollable, searchable, categorized, and uses the same action descriptors as direct buttons. It must not use browser-level horizontal scrolling.

- [ ] **Step 5: Add non-regression source tests**

Extend `canvas-toolbar-floating-windows.test.ts` to assert:

```ts
expect(canvasSource).toContain('data-popup="bottom-toolbar-drawer"');
expect(canvasSource).toContain('data-popup="image-action-overflow"');
expect(canvasSource).toContain('getBottomToolbarDrawerPlacement');
expect(canvasSource).toContain('occupiedRight');
expect(canvasSource).toContain('onPointerDown={(e) => e.stopPropagation()}');
```

Also assert that legacy labels/callbacks for all current actions remain in the source and `DEFAULT_IMAGE_TOOLBAR_ITEM_ORDER` remains additive.

- [ ] **Step 6: Run focused tests and commit**

Run:

```bash
pnpm exec vitest run src/__tests__/lib/canvas-toolbar-layout.test.ts src/__tests__/lib/image-toolbar-position.test.ts src/__tests__/lib/image-toolbar-preferences.test.ts src/__tests__/components/canvas-toolbar-floating-windows.test.ts
```

Expected: PASS.

Commit:

```bash
git add src/lib/canvas-toolbar-layout.ts src/lib/image-toolbar-position.ts src/components/infinite-canvas.tsx src/__tests__/lib/canvas-toolbar-layout.test.ts src/__tests__/lib/image-toolbar-position.test.ts src/__tests__/lib/image-toolbar-preferences.test.ts src/__tests__/components/canvas-toolbar-floating-windows.test.ts
git commit -m "feat: constrain canvas toolbar overflow"
```

## Task 8: Browser Evidence, Regression Documentation, and Release Gate

**Files:**
- Create: `tests/e2e/effect-reverse-removebg-toolbar.spec.ts`
- Modify: `docs/testing/BUG_REGISTER.md`
- Modify: `docs/testing/REGRESSION_REPORT.md`
- Modify: `docs/testing/UNVERIFIED_ITEMS.md`

**Interfaces:**
- Consumes deployed authenticated browser session, Playwright artifacts, and all outputs from Tasks 1-7.
- Produces reproducible browser evidence and a truthful release status.

- [ ] **Step 1: Write the failing Playwright specification**

```ts
test('opens reverse engineering from the bottom toolbar and inserts a corrected result', async ({ page }) => {
  await openKnownProjectWithImage(page);
  await selectCanvasImage(page);
  await page.getByRole('button', { name: 'Effect Reverse Engineering Pro' }).click();
  await expect(page.getByTestId('effect-reverse-engineering-panel')).toBeVisible();
  await setPerspectivePoints(page, validPerspective);
  await page.getByRole('button', { name: 'Correct perspective' }).click();
  await expect(page.getByText('Completed')).toBeVisible({ timeout: 60_000 });
  await expect(canvasImageCount(page)).resolves.toBeGreaterThan(1);
});

test('uses configured dedicated removebg and produces a PNG with alpha', async ({ page, request }) => {
  await openKnownProjectWithImage(page);
  await selectCanvasImage(page);
  await page.getByRole('button', { name: 'Remove background' }).click();
  await page.getByRole('option', { name: /Dedicated RemoveBG/ }).click();
  await page.getByRole('button', { name: 'Remove background now' }).click();
  const outputUrl = await waitForRemoveBgResult(page);
  const bytes = await request.get(outputUrl).then((response) => response.body());
  expect(await pngHasMeaningfulAlpha(bytes)).toBe(true);
});
```

- [ ] **Step 2: Run the E2E specification to verify it fails**

Run:

```bash
pnpm exec playwright test tests/e2e/effect-reverse-removebg-toolbar.spec.ts
```

Expected: FAIL before the implementation exists. Preserve screenshot, trace, video, console, and network artifacts under `test-results/`.

- [ ] **Step 3: Implement resilient browser helpers and run against the deployed environment**

Use explicit state waits, request/task IDs, visible output checks, and downloaded-file inspection. Do not use fixed long sleeps. Test both toolbar surfaces with the right panel open at desktop width and at one mobile viewport.

Classify unavailable provider keys/models as `UNVERIFIED_PROVIDER_ENVIRONMENT`, not application pass or application failure. Record the exact provider/model, deployment URL, Git commit, date, browser, request ID, task ID, and observed output.

- [ ] **Step 4: Run the full required verification**

Run:

```bash
pnpm exec vitest run src/__tests__/lib/effect-reverse-validation.test.ts src/__tests__/lib/effect-reverse-perspective.test.ts src/__tests__/api/effect-reverse-engineering.test.ts src/__tests__/lib/remove-bg-provider.test.ts src/__tests__/lib/canvas-toolbar-layout.test.ts
pnpm ts-check
pnpm lint
pnpm test
pnpm build
pnpm exec playwright test tests/e2e/effect-reverse-removebg-toolbar.spec.ts
```

Expected: Focused tests, type check, lint, full test suite, build, and browser flow pass. Any pre-existing failure must be named in `UNVERIFIED_ITEMS.md` with the baseline commit and must not be silently ignored.

- [ ] **Step 5: Update quality documentation and commit**

Document each discovered issue with stable reproduction evidence, root cause, repaired files, regression test, and browser artifact paths. Record:

- verified dedicated provider output with alpha;
- verified local fallback;
- unverified provider credentials or environment-only blockers;
- toolbar action reachability result;
- reverse-engineering source/result task IDs;
- any P0/P1 release blocker.

Commit:

```bash
git add tests/e2e/effect-reverse-removebg-toolbar.spec.ts docs/testing/BUG_REGISTER.md docs/testing/REGRESSION_REPORT.md docs/testing/UNVERIFIED_ITEMS.md test-results
git commit -m "test: verify reverse engineering and removebg workflows"
```

## Plan Self-Review

### Spec Coverage

- Functional V1 reverse-engineering source, manual regions, perspective, calibration, exports, real analyzer state, and task progress: Tasks 1-4.
- Dedicated Multipart RemoveBG, generic compatibility preservation, transparent output, ZIP handling, local fallback, and administrator settings: Tasks 5-6.
- Bottom and image toolbar right-panel collision prevention without action loss: Task 7.
- TDD, browser evidence, alpha verification, documentation, and release gate: Task 8.

### Placeholder Scan

The plan has no `TODO`, `TBD`, "implement later", or undefined action steps. Unsupported output modes are explicitly required to return an unavailable state instead of a placeholder result.

### Type Consistency

`EffectReverseSessionInput`, `EffectReverseRegion`, `EffectReverseTaskStatus`, `RemoveBgProviderOptions`, `submitDedicatedRemoveBg()`, `getBottomToolbarDrawerPlacement()`, and `getConstrainedImageToolbarPosition()` are defined before their consuming tasks. Existing `removebg` provider type is preserved rather than introducing an unconnected model type.


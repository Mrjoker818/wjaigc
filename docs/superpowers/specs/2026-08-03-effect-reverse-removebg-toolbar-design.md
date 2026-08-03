# Effect Reverse Engineering Pro, AI Remove Background, and Toolbar Design

**Date:** 2026-08-03  
**Status:** Approved design awaiting written-spec review  
**Scope:** Add one functional reverse-engineering workspace, harden provider-backed background removal, and make existing canvas toolbars usable beside right-side panels without removing existing actions.

## 1. Goal

Deliver three coordinated improvements without replacing the infinite canvas, the selected-image toolbar, the existing display-decomposition flow, or the administrator model configuration system:

1. Add **Effect Reverse Engineering Pro** beside **3D Display Pro** in the bottom canvas toolbar.
2. Add a server-side, provider-compatible background-removal path while retaining local CPU removal as an offline fallback.
3. Prevent the bottom toolbar and selected-image toolbar from being obscured by the right-side workspace while preserving every current tool registration, callback, keyboard shortcut, and customization preference.

The V1 deliverable is a real editable reverse-engineering workspace. It must not present simulated AI analysis, fake exports, or unsupported reconstruction claims as completed work.

## 2. Scope and Delivery Boundary

### 2.1 Functional V1

Effect Reverse Engineering Pro supports:

- using a currently selected canvas image or a newly uploaded image;
- one or more image sources in one workspace session;
- manual structural-region annotations;
- four-point perspective correction;
- base-dimension calibration;
- editable region visibility and locking;
- side-by-side source and corrected previews;
- export of corrected PNG plus the currently supported SVG, PDF, and ZIP outputs;
- an explicit analysis state for real, authorized OCR or visual-analysis models;
- a visible "manual-only" state when no authorized analysis model is configured.

The initial V1 does not promise automatic CAD/DXF, engineering quantities, multi-view generation, semantic architectural recognition, or generative geometric reconstruction. Those remain later phases from the supplied product document and are not silently represented as available.

### 2.2 Out of Scope

- Replacing the existing display decomposition board or editable-layer decomposition system.
- Refactoring the whole `infinite-canvas.tsx` component.
- Client-side storage or display of provider API keys.
- A new billing subsystem.
- An unrestricted remote image fetch path.
- Changing the existing toolbar's action semantics, hotkeys, or order without preserving saved preferences.

## 3. Architecture

### 3.1 New Reverse-Engineering Workspace

Create a focused component boundary for the floating workspace rather than adding another large inline block to `src/components/infinite-canvas.tsx`.

Proposed units:

| Unit | Responsibility |
| --- | --- |
| `src/components/effect-reverse-engineering-panel.tsx` | Draggable/resizable floating UI, source selection, region editing, perspective calibration, export controls, task progress display. |
| `src/lib/effect-reverse-engineering/types.ts` | Shared client/server session, region, perspective, calibration, and export contracts. |
| `src/lib/effect-reverse-engineering/validation.ts` | Bounds, point-count, text-length, and session input validation. |
| `src/app/api/effect-reverse-engineering/route.ts` | Authenticated session actions: create, analyze, correct, export, cancel, and status. |
| `src/__tests__/...effect-reverse...` | Contract, validation, task-state, and UI positioning regressions. |

`infinite-canvas.tsx` remains the integration point only:

- add the bottom-toolbar entry immediately after `3D Display Pro`;
- open the floating workspace through existing modal/window conventions;
- pass a frozen selected-image snapshot when one is available;
- add the exported corrected image to the canvas as a new item rather than destructively replacing its source.

The workspace is rendered outside transformed canvas content and uses the existing `data-toolbar`, `data-modal`, and popup containment conventions. This prevents its pointer and wheel events from becoming canvas pan/zoom events.

### 3.2 Source Integrity

Every operation freezes a source descriptor before it starts:

```ts
interface EffectReverseSourceSnapshot {
  projectId: string;
  sourceImageId?: string;
  canonicalImageUrl: string;
  sourceHash: string;
  width: number;
  height: number;
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
}
```

The server verifies project ownership and normalizes the source using the existing trusted managed-media path. A later canvas selection cannot change an in-flight task's input.

### 3.3 Reverse-Engineering Session Contract

```ts
type EffectReverseTaskStatus =
  | 'queued'
  | 'analyzing'
  | 'correcting'
  | 'exporting'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'timeout';

interface EffectReverseRegion {
  id: string;
  kind: 'wall' | 'floor' | 'ceiling' | 'object' | 'text' | 'material' | 'custom';
  label: string;
  points: Array<{ x: number; y: number }>;
  visible: boolean;
  locked: boolean;
  inferred: boolean;
}

interface EffectReverseSession {
  id: string;
  source: EffectReverseSourceSnapshot;
  regions: EffectReverseRegion[];
  perspective: [
    { x: number; y: number },
    { x: number; y: number },
    { x: number; y: number },
    { x: number; y: number },
  ];
  baseDimension?: { value: number; unit: 'mm' | 'cm' | 'm' };
  analysis: {
    providerId?: string;
    modelId?: string;
    status: EffectReverseTaskStatus;
    notes: string[];
  };
}
```

Validation limits are part of the API contract:

- at most 12 source images per session;
- at most 80 regions per source;
- polygon regions have 3 to 128 points;
- labels are 1 to 120 characters;
- analysis instructions are at most 4,000 characters;
- raw data URLs are rejected by the route;
- request JSON is capped at 256 KiB;
- coordinates must be finite normalized values within `0..1`.

Any AI-generated region is marked `inferred: true` and shows a visible confidence/risk notice. It cannot be presented as a verified construction or engineering drawing.

### 3.4 Analysis and Export

Analysis is optional and only runs when the selected provider/model is both:

1. configured by an administrator for the appropriate visual-analysis capability; and
2. authorized for the current user.

Otherwise the workspace remains usable in manual mode and states that automatic analysis is not configured. It never fabricates regions.

Perspective correction and bitmap export run deterministically from the approved four-point geometry. Existing server-side image processing and existing SVG/PDF/ZIP export utilities are reused where their output contract matches. Unsupported export modes are shown as unavailable, not as successful placeholders.

Long-running analysis/export work uses the existing task registry and task event conventions. Cancellation actively aborts current work where the underlying operation supports it, then persists a terminal `cancelled` state. A terminal result cannot later be overwritten by a stale completion callback.

## 4. AI Background Removal

### 4.1 Provider Model Contract

Keep `removebg` as the administrator-visible model type. Add a `removebg-multipart` request profile for services that implement the common dedicated background-removal form contract:

```http
POST /v1.0/removebg
X-Api-Key: <server-side secret>
Content-Type: multipart/form-data

image_file=<trusted source bytes>
size=auto
format=png
```

The profile also supports a configured URL-input field only when the provider is explicitly configured for URL input. The default is server-side source-byte upload so the application does not expose signed URLs or depend on provider access to private media.

Model metadata includes:

```ts
interface RemoveBgProviderOptions {
  requestProfile: 'removebg-multipart' | 'images-generations';
  imageInput: 'file' | 'url';
  responseMode: 'png' | 'webp' | 'zip';
  maxInputMegapixels?: number;
  transparentOutputRequired: boolean;
}
```

The administrator UI accepts this metadata through structured fields rather than a free-form endpoint-only convention. Existing `removebg` models using the generic image-generation path remain supported.

### 4.2 Response Handling and Quality Gate

The backend alone calls providers. It validates response headers, byte limits, decoded image format, dimensions, and alpha before persistence.

- PNG and WebP output must decode successfully.
- A direct result must contain meaningful alpha when `transparentOutputRequired` is true.
- A ZIP response is handled only for the configured profile:
  - maximum 8 files;
  - no absolute, traversal, or duplicate paths;
  - bounded decompressed size;
  - only the documented color image and alpha mask candidates are accepted;
  - the two images must share dimensions;
  - alpha is composed with original color pixels to produce a real RGBA PNG.
- A baked checkerboard, all-opaque result, all-transparent result, mismatched dimensions, or untrusted MIME is a failed quality gate, never a successful removal.

The existing local IOPaint/RemoveBG chain remains the offline fallback. It is selected only by explicit engine choice or the existing bounded fallback policy. The final UI identifies the actual engine used.

### 4.3 Error and Billing Semantics

Provider/configuration failures are classified before showing the user an error:

- `REMOVE_BG_MODEL_UNAVAILABLE`
- `REMOVE_BG_PROVIDER_REJECTED`
- `REMOVE_BG_OUTPUT_INVALID`
- `REMOVE_BG_TIMEOUT`
- `REMOVE_BG_CANCELLED`

The route persists task state and provider/model identity before dispatch. Retry, cancellation, and refund behavior follow the existing image-task terminal-state rules. A request does not become successful merely because an upstream HTTP request returned a response.

## 5. Toolbar Interaction Design

### 5.1 Bottom Toolbar

The bottom toolbar remains a fixed, compact command rail. It retains every existing button and action registration.

- Core commands remain directly visible.
- Extended commands open a categorized, internally scrollable drawer above and to the left of the triggering control.
- The drawer is constrained to the available viewport rectangle after accounting for the right-side panel.
- If there is insufficient horizontal room, it opens upward/leftward; it never expands underneath the right-side panel.
- The toolbar itself has no horizontal browser scrollbar.
- Search filters action labels and aliases but does not change their underlying callbacks.
- Keyboard accessibility uses focus trapping only while the drawer is open and restores focus to the trigger when closed.

The new `Effect Reverse Engineering Pro` action appears beside `3D Display Pro` in both the visible rail and the categorized drawer. It uses the same action descriptor, so there is one source of truth for label, icon, permission, and callback.

### 5.2 Selected-Image Toolbar

The selected-image toolbar keeps the current first visible actions and user-configurable action ordering.

- The existing `+N` affordance becomes a bounded popover grouped by action category.
- Its placement is calculated from the selected image bounding rectangle, viewport, zoom, and right-side-panel occupied bounds.
- It chooses top/bottom/left/right placement by available area, then clamps inside the remaining canvas viewport.
- It has an internal maximum height and scrolls internally.
- Opening the popover cannot start a canvas drag, box select, or zoom operation.
- Existing actions including upscale, remove background, SVG trace, erase, mask, edit elements, extend, img2img, crop, download, and customized actions remain registered and reachable.

### 5.3 Persistence and Regression Protection

Toolbar customization storage is extended only with additive optional fields. Existing saved preferences remain valid. The implementation must not reset ordering, hide actions, or mutate a user's existing preference record just because the new drawer/popover UI is introduced.

## 6. UI Details

The reverse-engineering workspace follows the supplied prototype's functional layout without copying its simulated-state behavior:

- initial floating size: `min(1440px, calc(100vw - 48px))` by `min(900px, calc(100vh - 48px))`;
- minimum size: `960 x 620` desktop, with a responsive full-screen modal on smaller viewports;
- title bar: icon, title, session status, minimize, maximize/restore, close;
- left panel: source list, manual/AI analysis selector, region controls, perspective/calibration controls;
- center: source/corrected/regions tabbed workspace;
- right panel: layer/region hierarchy, inference notices, export state;
- status bar: source dimensions, measured scale, active tool, task state.

Every compact control uses established icons and tooltips where available. Buttons without real server support are disabled with a concrete reason. The panel must fit desktop and mobile width without text overlap.

## 7. Security and Reliability Requirements

- All source-image reads use the trusted managed-media/safe downloader path; no newly introduced raw `fetch(imageUrl)` is allowed.
- Provider keys stay in server-side provider configuration and never enter browser requests, browser logs, or task metadata.
- Provider/model authorization is checked before task creation.
- Inputs enforce size, MIME, normalized coordinate, text-length, point-count, and request-size limits.
- Image decoders enforce pixel limits before Sharp processing.
- Temporary files and object URLs are cleaned on success, failure, timeout, and cancellation.
- Logs include request ID, task ID, session ID, provider, model, duration, and terminal state, but omit credentials and raw source image bytes.
- The new UI must not alter login routing, workspace entry routing, project restoration, generation polling, or existing canvas event handling.

## 8. Testing Strategy

Implementation follows test-driven development. Each behavioral change begins with a focused failing test, followed by the smallest code change required to pass it.

### 8.1 Automated Tests

Required test coverage:

- reverse-engineering request validation, ownership, source snapshot mismatch, bounds, and task-state transitions;
- perspective four-point normalization and deterministic corrected-output dimensions;
- manual-only state when no authorized analyzer exists;
- provider/model authorization rejection before task dispatch;
- removebg multipart request construction, server-only API-key header, URL/file input profile selection, response MIME and alpha gate;
- ZIP color-plus-alpha composition, path traversal rejection, decompressed-size rejection, dimension mismatch, and checkerboard rejection;
- local fallback selection and actual engine reporting;
- toolbar position calculation beside an occupied right panel;
- bottom drawer internal scroll/placement behavior;
- existing action descriptor reachability and preference migration;
- no pointer/wheel event leakage from floating panels into the canvas.

### 8.2 Browser Verification

Before release, use a logged-in browser session on the deployed environment and retain screenshots, console logs, network evidence, and task IDs for:

1. opening Effect Reverse Engineering Pro from the bottom toolbar with a selected image;
2. perspective correction, region toggling, corrected export, and canvas insertion;
3. manual-only analyzer state and configured-analyzer request state;
4. dedicated AI background removal with a real transparent downloaded PNG;
5. configured generic removebg model fallback;
6. local fallback behavior when provider is intentionally unavailable;
7. bottom toolbar drawer and selected-image `+N` popover with the right panel open;
8. existing image-toolbar actions still opening and submitting their original routes.

No browser flow is passed solely by an HTTP 200 response. A provider failure must be classified as a provider/model availability failure before it is attributed to application logic.

## 9. Release Criteria

This feature set is ready only when:

- all focused tests and relevant existing regression tests pass;
- `pnpm ts-check`, `pnpm lint`, `pnpm test`, and `pnpm build` pass or retain only documented pre-existing failures;
- every existing bottom-toolbar and selected-image action remains reachable after the toolbar update;
- the reverse-engineering workspace creates real corrected/exported output, or explicitly reports unavailable dependencies;
- dedicated provider-backed removebg produces a downloaded image with verified alpha;
- local fallback behavior is observable and not silently substituted for provider output;
- no new authentication, startup, canvas selection, task polling, billing, or project-persistence regression appears;
- known environment-only limitations are recorded as unverified, not passed.

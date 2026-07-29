# Image Tools and Dual Decomposition Quality Design

**Date:** 2026-07-30  
**Status:** Approved for implementation planning  
**Scope:** Image toolbar remove-background, erase, mask, color adjustment, display decomposition, and editable layer decomposition

## 1. Goal

Upgrade the image toolbar so that:

1. Remove-background produces a real transparent PNG with preserved subject pixels and verified alpha quality.
2. Erase, mask, and color adjustment use the intended backend path and are proven through real output validation.
3. Element decomposition produces both:
   - a Cloud Leopard-style element presentation board; and
   - an editable layer document with a measured reconstruction result.
4. Every branch remains tied to the exact source image selected when the task starts.
5. Success is based on output quality and state consistency, not only an HTTP success response.

## 2. Confirmed Current Problems

### 2.1 Remove-background destroys transparency

`postProcessLocalRemoveBG()` receives an RGBA PNG but composites it onto white before persistence. This destroys the alpha channel even when the upstream segmentation result is valid.

### 2.2 Erase can enter the mask-edit path

The client submits a non-empty default prompt for erase. The server currently infers erase versus mask from whether the prompt is empty, so an erase request can be processed as a generative mask edit.

### 2.3 Color preview and final output use different mappings

The UI maps the hue slider to a wider CSS range than the value sent to the Sharp backend. Temperature is also approximated differently in the preview and final pipeline.

### 2.4 Two different features are presented as one concept

The Cloud Leopard reference generates one flat element presentation board. Pear `Image-Layered` returns an editable PSD artifact. A presentation board does not prove editable reconstruction, and an editable PSD does not guarantee a polished presentation board.

## 3. Product Behavior

### 3.1 Remove-background

The default result is one transparent PNG placed to the right of the source image.

- The source RGB values remain authoritative.
- A model supplies or improves only the alpha mask.
- The final persisted image remains RGBA.
- A black-and-white mask is stored as task metadata.
- The UI offers an optional "also add mask to canvas" control, disabled by default.
- A failed quality gate is reported as a failure or triggers a bounded fallback. It is never returned as a low-quality success.

The model selection policy is:

- portrait model for people and hair;
- general model for ordinary products and mixed scenes;
- massive/complex model for fine structures or multiple overlapping subjects;
- configured AI fallback only when local CPU output fails a quality gate.

### 3.2 Erase

Erase is selected explicitly with `editMode: "erase"`.

- It requires a non-empty painted region.
- It prefers the configured local erase model.
- A bounded provider fallback may be used when the local engine is unavailable.
- The result is composited so pixels outside the mask remain unchanged.
- An internal erase instruction may be supplied to a provider, but it must not change request routing.

### 3.3 Mask edit

Mask edit is selected explicitly with `editMode: "mask"`.

- It requires a non-empty painted region and a non-empty edit instruction.
- The provider result is composited only inside the normalized mask.
- Pixels outside the mask remain byte-identical where the image format permits lossless comparison.
- Unsupported provider/model combinations fail with a clear message before charging.

### 3.4 Color adjustment

Color adjustment remains a deterministic local Sharp operation and does not consume model credits.

- Hue uses one `-180..180` degree contract in the UI and backend.
- Brightness, contrast, saturation, temperature, and hue share one parameter normalization contract.
- Transparent PNG input remains transparent PNG.
- Applying an adjustment creates a new canvas result rather than destructively replacing the source.
- The operation participates in undo/redo and project persistence.
- The UI preview is labelled approximate unless it uses the same pixel transform as the final output.

## 4. Dual Element Decomposition

### 4.1 Source snapshot

At submission time the client and server freeze:

- `sourceImageId`
- canonical `sourceImageUrl`
- `sourceImageHash` using SHA-256
- width and height
- user and project ownership
- source version, when available

Selection changes after submission cannot change either decomposition branch.

### 4.2 Branch A: element presentation board

This branch follows the observed Cloud Leopard behavior:

- identify all major subjects, accessories, text marks, patterns, decorative elements, background structures, and reusable visual materials;
- show each element separately with no overlap or occlusion;
- use a corrected front-facing presentation;
- retain the source palette, material character, and style;
- use either a minimal light-gray background or verified real transparency;
- avoid checkerboard pixels, watermarks, invented elements, and cropped elements.

This branch produces a single presentation image and a structured task report.

### 4.3 Branch B: editable layers

This branch uses the Pear asynchronous layer flow or the authorized local fallback.

- Pear must run asynchronously.
- A ZIP artifact is downloaded through the safe downloader.
- Archive path traversal, excessive entries, decompression limits, MIME, PSD signature, and ambiguous primary PSD files are rejected.
- The primary PSD is selected while `_depth.psd` is retained only as optional auxiliary metadata.
- PSD layers are parsed into the editable layer model and opened in the existing layer editor.

### 4.4 Reconstruction verification

The server renders the parsed editable layers and compares the result with the frozen source.

The report includes:

- dimension and orientation match;
- alpha-channel match;
- mean absolute pixel error;
- maximum channel error;
- mismatched-pixel ratio;
- SSIM or an equivalent structural similarity score;
- layer count and visible-layer count.

Two quality values are reported:

1. **Native reconstruction quality:** the provider layers before correction.
2. **Corrected reconstruction quality:** the final document after a reconstruction correction layer is applied.

If the native layers miss pixels, the document receives a clearly named `reconstruction/correction` layer. For transparent sources that cannot be reconstructed exactly with ordinary over-compositing, the document also contains a clearly named `reconstruction/pixel-perfect-reference` snapshot layer. The editable semantic group remains separate. The UI and report must not describe a corrected result as native model accuracy.

The default PSD view must match the original image. Users can independently enable the editable semantic group for layer editing.

## 5. Task State and Billing

The parent task contains independent branch states:

- `queued`
- `processing`
- `completed`
- `failed`
- `cancelled`
- `timeout`

The parent result may be:

- completed;
- partially completed; or
- failed.

Each branch has an idempotency key bound to:

`userId + sourceImageHash + branch + normalized request digest`

Retrying one failed branch does not resubmit or recharge a completed branch. Refund settlement follows the persisted terminal state and is applied once.

## 6. Quality Gates

### 6.1 Remove-background gates

- output dimensions equal source dimensions;
- output is a decodable PNG with alpha;
- alpha contains both foreground and background unless the source is legitimately all-foreground;
- foreground occupancy is within a defensible range;
- output is not fully opaque, fully transparent, or a rendered checkerboard;
- subject RGB is sampled from the source rather than a regenerated image;
- edge-alpha statistics do not indicate a broad white or dark halo.

### 6.2 Erase and mask gates

- mask dimensions normalize to source dimensions;
- empty masks are rejected;
- erase changes pixels inside the target region;
- mask edit follows the supplied instruction;
- outside-mask pixels remain unchanged after lossless composition;
- timeout, provider failure, and cancellation reach a terminal state.

### 6.3 Color gates

- output dimensions are unchanged;
- neutral parameters produce an equivalent output;
- positive and negative values change pixels in the expected direction;
- transparent alpha remains unchanged;
- repeated application and project reload preserve the generated result.

### 6.4 Element presentation board gates

- all major source elements are represented;
- elements do not overlap or clip;
- the board does not reproduce the original scene composition;
- no checkerboard is baked into pixels;
- the selected background mode is honored;
- source image identity matches the frozen hash.

### 6.5 Editable layer gates

- artifact and PSD safety validation pass;
- at least two usable layers are available for a decomposable image;
- parsed canvas size matches the source;
- the reconstruction report is generated;
- the default final reconstruction matches the source after disclosed correction;
- no failed branch is represented as fully completed.

## 7. UI Contract

The existing image toolbar entry remains unchanged.

The element decomposition panel adds an output mode:

- Presentation board
- Editable layers
- Both (default)

The processing frame shows separate progress labels for:

- freezing source;
- generating presentation board;
- waiting for Pear;
- downloading artifact;
- extracting PSD;
- parsing layers;
- verifying reconstruction;
- preparing results.

On partial success, the result panel displays the successful output and a retry action for only the failed branch.

## 8. Testing Strategy

### 8.1 Test-driven implementation

Every behavior change starts with a failing regression test. Production changes are made only after the expected failure is observed.

Focused tests cover:

- RGBA persistence without white flattening;
- alpha quality validation and fallback;
- explicit erase/mask routing;
- mask-outside pixel preservation;
- shared color parameter normalization;
- frozen source identity;
- branch idempotency;
- ZIP/PSD extraction and parsing;
- native and corrected reconstruction metrics;
- partial completion and branch retry.

### 8.2 Real browser verification

Use the logged-in cloud preview in Chrome and retain evidence for one controlled source image.

For each tool:

- capture the selected source ID and URL;
- capture the request body and task ID;
- verify progress and terminal state;
- inspect console and network errors;
- download the result;
- inspect PNG alpha or PSD layers outside the browser;
- save before/after screenshots.

HTTP 200 alone is not a pass.

### 8.3 Required reference cases

Use at least:

- one portrait with hair;
- one product with text and fine edges;
- one complex display/poster image representative of the Cloud Leopard reference;
- one transparent PNG.

The complex display image is used for both board completeness review and editable reconstruction measurement.

## 9. Error Handling

- Invalid or stale source references fail before provider submission.
- Provider/model authorization is checked before task creation.
- Safe download failures return a specific, retryable error where appropriate.
- Quality-gate failures include the failed metric and selected engine.
- Cancellation aborts active network, extraction, and parsing work.
- Temporary files are removed on success, failure, timeout, and cancellation.
- Logs include request, task, source hash, provider, model, duration, and terminal state without exposing secrets or image content.

## 10. Non-goals

- Do not replace the infinite canvas or layer editor.
- Do not merge the presentation board and editable PSD into one ambiguous output.
- Do not claim that a correction layer represents native provider quality.
- Do not add broad image-generation refactors unrelated to these tools.
- Do not silently fall back to a visibly poor result.

## 11. Release Criteria

This scope is ready only when:

- the focused automated regression suite passes;
- TypeScript, lint, full tests, and production build pass;
- Chrome cloud verification succeeds for all five tool areas;
- transparent PNG alpha is verified from the downloaded file;
- Pear ZIP extraction and PSD editing are exercised in the cloud environment;
- reconstruction metrics and evidence are saved;
- no new authentication, startup, canvas-selection, billing, or project-persistence regression is introduced;
- unresolved environment limitations are listed as unverified rather than passed.

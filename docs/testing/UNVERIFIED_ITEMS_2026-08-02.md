# Unverified Items - 2026-08-02

## Definition

An item is listed here when source-level or local automated evidence exists but no current deployed, real-browser result proves the user-visible behavior. These items are not passing results.

| ID | Priority | Required deployed verification | Why local evidence is insufficient |
| --- | --- | --- | --- |
| UV-20260802-01 | P1 | Paste/upload, move, resize, refresh, reopen and reset view keep a real image visible | The fix changes persisted canvas state and needs the deployed database/project serializer |
| UV-20260802-02 | P1 | Select an image model, observe a real provider fallback, then inspect canvas, task monitor, refresh and project reopen | Needs actual provider routing and cloud task persistence |
| UV-20260802-03 | P1 | Confirm the toolbar displays only the two configured 302 models and two configured Pear models; submit `302 Upscale V6`, `302 Super-Upscale V2`, and Pear `Real-ESRGAN`; test a documented rejection with no native browser dialog | Must prove exact provider-model routing, original provider HTTP/code, one readable terminal card, no raw JSON dialog, and exactly one charge/refund. `SeedVR2-Upscaler` must reject before any charge until its protocol is verified |
| UV-20260802-04 | P1 | Submit Pear `Image-Layered` against a normal raster image | Requires Pear task completion, ZIP MIME delivery, safe download, primary PSD extraction and PSD editor layer visibility |
| UV-20260802-05 | P1 | Cancel and fail a billable cloud image-edit/layered task under PostgreSQL | Requires database atomic terminal transition and billing records unavailable locally |
| UV-20260802-06 | P2 | Remove background, erase, mask and color adjustment each complete or end in a visible structured failure | Local contracts cannot judge real provider quality or cloud upload behavior |
| UV-20260802-07 | P2 | Element decomposition uses the selected raster source and recomposes to the original image | Needs visual quality comparison against the deployed service output |
| UV-20260802-08 | P2 | Native file chooser upload of a local image | Chrome automation bridge blocked local-file handoff; use manual Chrome or a Playwright environment with file permission |
| UV-20260802-09 | P2 | Download an image and verify a real file is written | Client-side Blob download does not expose a file artifact through the current browser bridge |
| UV-20260802-10 | P2 | P0 authentication flow in Chromium, Firefox and WebKit | Earlier evidence is Chrome-only; cross-browser session and deployment validation is still required |

## Execution Rule

For every item above, retain a screenshot, console log, network response, task/request ID, and (when the flow is billable) the administrator billing record. A provider outage can be classified as provider-blocked only after the platform displays a durable terminal state with the correct retry/refund outcome.

## Deployment Blocker Observed On 2026-08-02

The authenticated deployed page at `https://wjaigc.coze.site/` did not expose the code in GitHub `main` commit `05f809652e35fbb1032042af747c7a46b0c9d7b6`. Its upscale dialog showed four hard-coded 302 options and omitted both configured Pear upscalers, while the administrator page reported one enabled 302 upscaler and two enabled Pear upscalers.

Do not close or execute `UV-20260802-03` against that stale build. Re-deploy the exact GitHub commit first, reload the page, and record the dynamic catalog before starting any billable job.

## 方案 B Deployment Verification Items - 2026-08-04

| ID | Priority | Required deployed verification | Current status |
| --- | --- | --- | --- |
| UV-20260804-01 | P1 | Open Effect Reverse Engineering Pro from the selected-image toolbar and verify Chinese title, source column, workspace tabs, layer column, calibration notice, and real task status | Unverified; local component and build checks passed |
| UV-20260804-02 | P2 | Open the bottom feature drawer with the right panel open, verify it is fully visible, bounded, internally scrollable, and does not capture canvas events | Unverified; pure layout and source-contract checks passed |
| UV-20260804-03 | P2 | Verify the selected-image toolbar keeps the first five actions visible and exposes every remaining action through `+N`; invoke an overflow action and verify custom order/hidden preferences | Unverified; layout, preference, and wiring checks passed |
| UV-20260804-04 | P2 | Verify narrow viewport clamping and absence of horizontal overflow, then inspect console errors, browser dialogs, and network failures | Unverified; requires deployed browser evidence |

### 2026-08-04 Status Update

- `UV-20260804-01`: Partially verified on deployed commit `51d8016`; Chinese three-column UI and manual interactions passed. Real analyzer/provider task execution remains unverified.
- `UV-20260804-02`: Failed on deployed commit `51d8016`; the drawer rendered below the viewport because it was nested inside a translated containing block. A local Portal fix is awaiting deployment.
- `UV-20260804-03`: Verified on deployed commit `51d8016`; five primary actions, 14 overflow actions and the `参数调色` callback path worked.
- `UV-20260804-04`: Desktop console inspection passed with no application warnings/errors. Narrow viewport behavior remains unverified.

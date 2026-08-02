# Unverified Items - 2026-08-02

## Definition

An item is listed here when source-level or local automated evidence exists but no current deployed, real-browser result proves the user-visible behavior. These items are not passing results.

| ID | Priority | Required deployed verification | Why local evidence is insufficient |
| --- | --- | --- | --- |
| UV-20260802-01 | P1 | Paste/upload, move, resize, refresh, reopen and reset view keep a real image visible | The fix changes persisted canvas state and needs the deployed database/project serializer |
| UV-20260802-02 | P1 | Select an image model, observe a real provider fallback, then inspect canvas, task monitor, refresh and project reopen | Needs actual provider routing and cloud task persistence |
| UV-20260802-03 | P1 | Submit `302 Upscale V6` and `302 Super-Upscale V2`; test a success and a documented rejection | Must prove original provider HTTP/code, one terminal card, and exactly one charge/refund |
| UV-20260802-04 | P1 | Submit Pear `Image-Layered` against a normal raster image | Requires Pear task completion, ZIP MIME delivery, safe download, primary PSD extraction and PSD editor layer visibility |
| UV-20260802-05 | P1 | Cancel and fail a billable cloud image-edit/layered task under PostgreSQL | Requires database atomic terminal transition and billing records unavailable locally |
| UV-20260802-06 | P2 | Remove background, erase, mask and color adjustment each complete or end in a visible structured failure | Local contracts cannot judge real provider quality or cloud upload behavior |
| UV-20260802-07 | P2 | Element decomposition uses the selected raster source and recomposes to the original image | Needs visual quality comparison against the deployed service output |
| UV-20260802-08 | P2 | Native file chooser upload of a local image | Chrome automation bridge blocked local-file handoff; use manual Chrome or a Playwright environment with file permission |
| UV-20260802-09 | P2 | Download an image and verify a real file is written | Client-side Blob download does not expose a file artifact through the current browser bridge |
| UV-20260802-10 | P2 | P0 authentication flow in Chromium, Firefox and WebKit | Earlier evidence is Chrome-only; cross-browser session and deployment validation is still required |

## Execution Rule

For every item above, retain a screenshot, console log, network response, task/request ID, and (when the flow is billable) the administrator billing record. A provider outage can be classified as provider-blocked only after the platform displays a durable terminal state with the correct retry/refund outcome.

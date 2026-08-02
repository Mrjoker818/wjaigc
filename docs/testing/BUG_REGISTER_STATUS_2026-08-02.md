# Bug Register Status Addendum - 2026-08-02

This addendum preserves the original browser evidence in `BUG_REGISTER_2026-08-02.md` and records the current local remediation state without changing historical observations.

| Bug ID | Previous status | Current local status | Closure condition |
| --- | --- | --- | --- |
| `AUD-20260802-001` | Open: requested/actual provider route was not auditable | Fixed locally with `GenerationRouteAudit`; deployment verification pending | Real fallback task keeps requested route, actual route and fallback reason in task monitor, canvas and reopened project |
| `AUD-20260802-002` | Open: Quick Create state may outlive a project switch | Pending targeted reproduction | Add a stable project-switch regression before source change |
| `AUD-20260802-003` | Open: reopened canvas can be blank with persisted offscreen node | Fixed locally with persisted normalized view state and fit-to-content reset; deployment verification pending | Paste/upload -> move -> resize -> reload -> reopen -> reset keeps the image visible |
| `AUD-20260802-004` | New: explicit 302 upscale failure hid supplier semantics and risked ambiguous fallback after billing | Fixed locally with typed provider failure, durable settlement/refund and AI-only exact-302 mode; deployment verification pending | Validate success and rejection paths for both configured 302 models, including one charge/refund only |
| `AUD-20260802-005` | New: documented 302 nested review rejection leaked raw JSON through a native browser dialog and left the canvas card at 8% | Fixed locally with nested error-code parsing, user-safe rejection normalization, shared failed-card handling, and browser-dialog evidence gating | Reproduce a `-10021` rejection on the deployed build: no native dialog, a readable failed card, one terminal task, and one refund conclusion |
| `AUD-20260802-006` | New: AI upscale toolbar used a hard-coded 302 catalog and could submit a selected model through the unrelated image-generation provider | Fixed locally with configured upscaler discovery, provider-model pair routing, pre-charge provider ownership checks, and a bounded Pear `Real-ESRGAN` path | Deployed toolbar shows exactly the configured 302 and Pear models; Real-ESRGAN completes or reaches a readable terminal state; SeedVR2 rejects before charge |
| `AUD-20260729-PEAR-ZIP` | Existing: Pear layer model returned ZIP rather than a directly usable PSD | Fixed locally with async request mode and bounded ZIP-to-primary-PSD extraction; deployment verification pending | Pear task reaches editable PSD canvas with visible real layers and no duplicate charge |

## Evidence Files

- Source and regression changes: current Git worktree.
- Local gate evidence: `REGRESSION_REPORT_2026-08-02.md`.
- Required cloud evidence: `UNVERIFIED_ITEMS_2026-08-02.md`.
- Release decision: `RELEASE_READINESS_REPORT_2026-08-02.md`.

## AUD-20260802-005 Evidence

- Environment: authenticated Chrome session at `https://wjaigc.coze.site/`, normal project with a visible 800 × 800 raster image.
- Action: image toolbar → HD upscale → AI only → `302 | Super-Upscale V2 (AI超分)` → 4K → start.
- Upstream response: 302.AI returned HTTP `422`, `error.err_code = -10021`, with a content-checker rejection.
- Actual application result before this repair: a native browser alert exposed the complete nested provider JSON. After dismissing it, the canvas frame remained at `放大中 — 8%`.
- Local regression evidence: `image-processing-state.test.ts`, `upscale-provider-error.test.ts`, `upscale-terminal-state-contract.test.ts`, `browser-dialog-evidence-contract.test.ts`, and `p0-core.spec.ts`.

## AUD-20260802-006 Evidence

- Root cause: the toolbar rendered the static 302 catalog, while the API call used the currently selected image-generation provider rather than the selected upscale provider.
- Repair: `GET /api/models?type=upscaler` is now the source of truth for the toolbar; the request sends the selected `providerId` and `modelId` together.
- Safety boundary: backend ownership validation occurs before credit consumption. `SeedVR2-Upscaler` remains visible only as an unavailable option until its current Pear protocol has been verified.
- Local regression evidence: `302-upscale-models.test.ts`, `302-upscale-toolbar-wiring.test.ts`, and `configured-upscale-provider-routing.test.ts`.

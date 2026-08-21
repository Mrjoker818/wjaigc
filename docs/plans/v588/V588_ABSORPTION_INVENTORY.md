# V5.8.8 Selective Absorption Inventory

## Decision

Continue the current GitHub `main` line and selectively absorb proven V5.8.8 improvements. Do not migrate the current product onto the V5.8.8 tree and do not copy either tree wholesale into the other.

The current line owns the accepted task/accounting, asset/version, Agent runtime, React Flow v2 and Stage 4 cloud evidence. V5.8.8 is a read-only donor for specific UI, admin, provider, mobile, media-gateway and collaboration improvements.

## Comparison Baseline

| Metric | Current `main@8490fc1` | V5.8.8 donor |
|---|---:|---:|
| Package version | `4.0.0` | `5.8.8` |
| `src` files | 1161 | 1126 |
| Identical same-path files | 7 | 7 |
| Changed same-path files | 936 | 936 |
| Tree-only files | 218 | 183 |
| `infinite-canvas.tsx` lines | 18189 | 10822 |
| `canvas-*.tsx` leaf components | 1 | 24 |
| API routes | 197 | 192 |
| Admin API routes | 24 | 24 |
| Runtime dependencies | 93 | 93 |

V5.8.8 adds `wujie-media-gateway` and `yjs`, while the current line adds `@xyflow/react` and `server-only`. V5.8.8 uses older `next`, `sharp`, `svgo`, and `eslint-config-next` versions. Dependency downgrades are prohibited.

## Batch A: UI, Admin API, Provider Adaptation

These are the only authorized first absorption targets. Every row remains unimplemented until its RED test exists in the current worktree.

| ID | Donor capability | Current evidence | Absorption decision | First RED gate | Risk |
|---|---|---|---|---|---|
| V588-UI-001 | Leaf Canvas components: image toolbar, context menus, download popup, edit panels, generation groups, image layer, connection layer, zoom cluster and tool drawer | Current Canvas is 18189 lines but contains newer Stage 3/4 persistence, performance and task fixes | **ABSORB INCREMENTALLY.** Extract one pure rendering responsibility at a time; retain current controllers, refs, event ordering and domain state | Source-boundary test plus existing Canvas behavior matrix must fail until the selected responsibility is routed through the new leaf | High |
| V588-UI-002 | `canvas-command-palette.tsx` | No current command-palette surface; current command executor exists | **ABSORB BEHAVIOR, REIMPLEMENT ON CURRENT COMMAND API.** Do not import donor Canvas state | Keyboard/open/search/execute/escape tests, input-focus protection, cloud Chrome action proof | Medium |
| V588-UI-003 | `canvas-minimap.tsx` | Current Canvas has viewport/controller and spatial-index infrastructure but no leaf minimap | **ABSORB AFTER UI-001.** Bind to current viewport projection, not donor transforms | 100/300-node viewport mapping, click navigation, resize, hidden/empty state and performance budget | Medium |
| V588-UI-004 | Empty-state, zoom, overflow-safe toolbar and editing-panel layout components | Current toolbar behavior is protected but remains embedded | **ABSORB AS PRESENTATION-ONLY EXTRACTIONS.** No entry, label, handler or feature may disappear | Desktop/mobile visual contract, every existing toolbar action callable, no clipping/overlap, reduced-motion contract | Medium |
| V588-ADMIN-001 | `admin-dashboard-projection.ts`: no fabricated model/provider usage data | Current route fabricates zero-call provider rows and `99%` model success when database metrics are absent | **ABSORBED / CLOUD VERIFIED.** Real positive-call rows only; missing rates are nullable and coverage is explicit | Local RED/GREEN and full gates passed; authenticated Chrome and cloud API proved empty states, no fabricated `99%`, and zero fresh Console errors on `1ba98f7` | Low |
| V588-ADMIN-002 | Repository-wide admin-route authorization contract | Current 24 admin routes use both `requireAdminUser` and explicit `getRequestUser + role` patterns; donor test recognizes only one manual exception | **ABSORBED / CLOUD VERIFIED.** The current architecture is retained; an exact 24-route manifest accepts only the reviewed shared and explicit guard forms | Local RED/GREEN and full gates passed; exact-candidate Coze returned unauthenticated 401 and authenticated Chrome refreshed the administrator dashboard with zero fresh Console errors/warnings | Medium |
| V588-ADMIN-003 | Thumbnail backfill endpoint and idempotent worker | Current asset recovery/health subsystem is newer; donor route is absent | **REVIEW AFTER ADMIN-001/002.** Reuse current asset ownership and media-health services; no parallel media truth | Dry-run, admin authorization, idempotency, lease/restart, storage failure and no duplicate variant tests | Medium |
| V588-PROVIDER-001 | New display mappings such as Nano Banana Lite, GPT Image 2 2K/4K, FLUX 2 Klein, Grok Imagine video/image, HappyHorse, Gemini Omni and Seedance/Seedream variants | Current map already contains several newer Pear/Seedance entries; blind copy would duplicate or reorder wildcard matches | **ABSORB ONLY MISSING EXACT PATTERNS.** Preserve current longest/specific-first matching and administrator display-name priority | Table-driven RED cases for each missing model and collision tests for generic patterns | Low |
| V588-PROVIDER-002 | Explicit `providerId::modelId` catalog and ambiguous legacy-ID rejection | Current `task-core/model-catalog` is more advanced and already includes authorization migration, effective type and configured-provider snapshots | **AUDIT AND BACKFILL TESTS ONLY.** Do not replace current catalog or `/api/models` route | Duplicate model IDs across providers, disabled provider, unauthorized model, ordinary-user visibility and persisted legacy selection migration | High |
| V588-PROVIDER-003 | Route export cleanup into `result-store.ts` / `constants.ts` | Donor extracted non-route exports for Next route-module compatibility | **ABSORB WHERE CURRENT ROUTES STILL EXPORT NON-HTTP SYMBOLS.** Pure mechanical extraction with unchanged imports | Route manifest/build contract must identify exact illegal exports before any move | Low |
| V588-PROVIDER-004 | Unified generation tool metadata and document-tool execution | Donor executor uses localhost fetches, an internal user header, process-memory source edges and a separate poll lifecycle; current task/asset/accounting runtime is authoritative | **DO NOT ABSORB THE EXECUTOR.** Consider only declarative tool metadata after a current-runtime adapter design | Security/identity, idempotency, cancellation, task ownership, billing and asset projection contracts | Critical |

## Batch B: Mobile, Media Gateway, Collaboration

These remain deferred until every accepted Batch A item has focused regression, full regression and cloud evidence.

| ID | Donor capability | Decision | Required boundary |
|---|---|---|---|
| V588-MOBILE-001 | Single-finger pan, pinch zoom and long-press context menu | Reimplement on current pointer/viewport controller; preserve mouse, Space-pan, box selection, annotation and editing modes | 375px Chromium plus Firefox/WebKit where available; no accidental image move or page scroll |
| V588-MOBILE-002 | Mobile toolbar, image action toolbar and `/simple-create` | Absorb responsive interaction patterns after desktop toolbar extraction; keep all existing entries | Touch target, clipping, drawer, model/ratio/quality/count, result persistence and return-navigation tests |
| V588-MOBILE-003 | Reduced-motion contracts and motion tokens | Absorb semantic tokens and opt-out behavior, not scattered class copies | CSS contract plus desktop/mobile browser assertions |
| V588-MEDIA-001 | `packages/wujie-media-gateway` | Review as a package boundary around current provider compatibility code; do not move current adapters until import parity is proven | API compatibility parity, provider fixtures, package build and zero behavior-diff tests |
| V588-MEDIA-002 | `/api/gateway/v1/[media]`, gateway keys, quota and ledger tags | Deferred behind default-off feature flag; integrate with current request identity and task accounting | Bearer auth, hashed key storage, rate/daily quota, idempotent charge/refund and SSRF/input gates |
| V588-MEDIA-003 | Thumbnail variants and historical backfill | Integrate with current media health/recovery, never create a second source of truth | Variant uniqueness, alpha/orientation, idempotent backfill, storage failure and cleanup tests |
| V588-COLLAB-001 | Read-only Canvas share | Absorb before live collaboration; use sanitized immutable projection and explicit revocation | Owner authorization, public token entropy, no API key/prompt leakage, revoke and expired-link tests |
| V588-COLLAB-002 | WebSocket presence | Feature-flagged and stateless; no document writes | Auth, project isolation, heartbeat cleanup, reconnect, rate/size limits and cloud proxy proof |
| V588-COLLAB-003 | Yjs document collaboration | Last donor capability to consider; requires current asset/version and persistence adapters | Convergence, permissions, late join, reconnect, conflict, 300-node performance and rollback tests |
| V588-COLLAB-004 | Sketch-to-code | Independent optional business feature; only after collaboration/media gates | Sanitized HTML, sandboxed preview, provider failure, persistence and download tests |

## Explicitly Rejected or Superseded

1. Whole-tree replacement or migration onto V5.8.8.
2. Whole-file replacement of `infinite-canvas.tsx`, `canvas-workspace.tsx`, `user-manager.ts`, `cloud-task-storage.ts`, `poll-task`, `generate`, `agent-edit`, or task/accounting modules.
3. Replacing current `task-core/model-catalog` and `/api/models` with donor `model-core/model-catalog`; the donor path would remove current authorization migration and effective-type logic.
4. Donor `generation-execution-contract.ts` as a runtime owner. Its localhost polling, process-memory source-edge log and internal identity forwarding conflict with current durable task and asset boundaries.
5. Removing `@xyflow/react` or overwriting React Flow v2 Stage 4 work because the donor package does not contain that dependency.
6. Downgrading Next.js, Sharp, SVGO or ESLint configuration to donor versions.
7. Copying donor environment files, runtime data, generated reports, build output or credentials.
8. Any change to `stable@52f7c601ed150769e15d06fb435c6e360e28c9e7`.

## Per-Item Execution Contract

For every accepted inventory ID:

1. Recompute the V5.8.8 baseline and prove the donor is unchanged.
2. Write a failing current-line test that captures the missing user behavior or contract.
3. Integrate the minimum donor idea into current architecture; do not copy unrelated code.
4. Run focused tests and affected workspace regression.
5. Run full Vitest, isolated PostgreSQL gates when the change touches persistence/accounting, TypeScript, ESLint, production build and protected-feature contracts.
6. Push only to GitHub `main`.
7. Pull the exact candidate into Coze and perform authenticated Google Chrome verification, including Console and network evidence.
8. Record the result in this inventory and the testing reports before starting the next ID.

No item is “absorbed” merely because its source file exists or a unit test passes.

## Execution Log

### V588-ADMIN-001 — 2026-08-21

- Donor remained read-only; no donor file has a write time after the captured baseline, and the lock digest still equals `cc9e5e848bdb4cec6aeb394b086f8fe3015be9888787d350815c8b06b62f00e0`.
- RED evidence: three API contract failures plus one UI contract failure reproduced fabricated/invalid rows and non-nullable rate rendering.
- Minimal integration: added a current-architecture projection helper, removed provider/model synthesis from the dashboard route, and rendered unavailable rates as `—`.
- Local gates: focused `4/4`, related admin `8/8`, full Vitest `465 files / 2866 tests` with `15 files / 70 PostgreSQL-only tests` explicitly skipped, TypeScript pass, ESLint `0 errors / 988 historical warnings`, production build `114/114`.
- PostgreSQL was not rerun for this item because it changes neither persistence nor accounting.
- Authenticated cloud API evidence on exact `main@1ba98f776b0c19141a9f05343ce7bb23d0c50fb2` passed: HTTP 200, both coverage objects present, model/provider coverage `unavailable`, and both projected row counts `0`. Evidence: `docs/testing/evidence/v588-admin-001-cloud-api-2026-08-21.json`.
- Authenticated Google Chrome reused only the two existing tabs. The Coze project page showed no sandbox-disconnect dialog; the existing preview tab was hard-refreshed and opened the administrator operations dashboard.
- Cloud UI assertions passed: `暂无模型调用数据` count `1`, `暂无提供商数据` count `1`, fabricated `99%` count `0`, and fresh Console Error/Warning count `0`. Screenshot: `docs/testing/evidence/v588-admin-001-cloud-ui-2026-08-21.png`.
- `V588-ADMIN-001` is absorbed. The nullable-rate `—` branch remains permanently covered by the focused UI contract; cloud data exposed the unavailable empty state rather than a valid unknown-rate row, so no test data was fabricated merely to render that branch.

### V588-ADMIN-002 — 2026-08-21

- The V5.8.8 donor remained read-only. Its `pnpm-lock.yaml` SHA-256 still equals `cc9e5e848bdb4cec6aeb394b086f8fe3015be9888787d350815c8b06b62f00e0`; `stable` remains `52f7c601ed150769e15d06fb435c6e360e28c9e7`.
- RED evidence: the donor authorization contract failed on `api/admin/assets/orphans/route.ts` because it recognized `requireAdminUser` and one `getSessionUser` exception, but not the current reviewed `getRequestUser + role` guard.
- Minimal integration changed tests only. The new contract freezes the exact 24-route administrator manifest and permits only the reviewed shared guard or the two explicitly audited manual guards. The existing orphan-scan API suite now also proves unauthenticated `401`; its existing non-admin case proves `403`, and neither rejection invokes the media-health service.
- Focused regression passed `2 files / 6 tests`; the related administrator suite passed `8 files / 26 tests`.
- Full Vitest passed `466 files / 2868 tests`; `15 files / 70` PostgreSQL-only tests were explicitly skipped because `POSTGRES_TEST_DATABASE_URL` is absent. TypeScript passed, ESLint exited 0 with `0 errors / 988 historical warnings`, and the production build completed `114/114` routes.
- PostgreSQL was not rerun because this item changes neither runtime production code, persistence nor accounting.
- Coze pulled exact `main@d220479214a88b45fcd3a9520d220b864d19cb28`; the workspace was clean, port 5000 remained HTTP 200, no rebuild/restart occurred, and `stable` remained unchanged.
- A credential-free `GET /api/admin/assets/orphans` returned HTTP `401` with `{"error":"Authentication required"}`. In the two existing Chrome tabs, the authenticated administrator refreshed the operations dashboard; user metrics and both empty-state projections rendered, with zero fresh Console errors/warnings.
- Evidence: `docs/testing/evidence/v588-admin-002-cloud-api-2026-08-21.json` and `docs/testing/evidence/v588-admin-002-cloud-ui-2026-08-21.png`.
- `V588-ADMIN-002` is absorbed. The next authorized item is `V588-ADMIN-003`; it must begin with a new RED contract and reuse the current asset/media-health subsystem.

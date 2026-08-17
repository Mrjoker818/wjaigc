# Stage 4 Task 3 Report: Workflow Domain/Renderer Boundary and React Flow Shadow

Date: 2026-08-18
Branch: `codex/wj-stable-s4`
Controller bookkeeping head: `341365cf671178c41f3a617617b00a18862ec379`
Task 2 evidence anchor: `1f6219e8666c565864dc3d8005f4010149f4fd84`

## Scope

- Added pure workflow render projections, command application, and shadow parity comparison.
- Added `@xyflow/react` at exactly `12.11.2`; lockfile changes are only its official transitive dependencies.
- Kept the legacy renderer authoritative. Server delivery accepts only `legacy` and `shadow`; a requested `react-flow-v2` is downgraded to `legacy` in `/api/user-data/sync`.
- Added an inert, hidden shadow probe that compares the exact legacy and React Flow models supplied by the host. It performs no fetch, persistence, billing, task, asset, save, or execute operation.
- Added a controlled React Flow surface and custom port/label card. Its move/connect callbacks emit workflow commands; it does not use `useNodesState`, `useEdgesState`, or persist state.
- Added a real `workflow`-named Stage 4 E2E scenario using the existing 100-node performance instrumentation. It obtains the rollout mode only from the isolated server environment (`E2E_STAGE4_EXPECTED_WORKFLOW_RENDERER_MODE`); no client storage override exists.

## TDD Evidence

RED before implementation:

```powershell
pnpm exec vitest run src/__tests__/lib/workflow-render-view-model.test.ts src/__tests__/lib/workflow-render-commands.test.ts src/__tests__/lib/workflow-render-shadow.test.ts src/__tests__/components/workflow-react-flow-surface.test.tsx
```

Result: 4 failed suites because `view-model`, `commands`, `shadow`, and the React Flow surface did not exist.

Correction RED before tightening the boundary:

```powershell
pnpm exec vitest run src/__tests__/components/workflow-react-flow-surface.test.tsx
```

Result: 3 failures: legacy did not invoke a model/command render boundary; shadow projected a fixed viewport instead of supplied models; React Flow had no command translator.

GREEN:

```powershell
pnpm exec vitest run src/__tests__/lib/workflow-render-view-model.test.ts src/__tests__/lib/workflow-render-commands.test.ts src/__tests__/lib/workflow-render-shadow.test.ts src/__tests__/components/workflow-react-flow-surface.test.tsx src/__tests__/components/node-editor-ui-regression.test.ts src/__tests__/components/node-editor-history-baseline-contract.test.ts src/__tests__/components/node-editor-execution-wiring.test.ts
```

Result: 7 files / 19 tests passed.

## E2E Evidence

```powershell
$env:E2E_STAGE4_EXPECTED_AGENT_MODE='shadow'
$env:E2E_STAGE4_EXPECTED_WORKFLOW_RENDERER_MODE='legacy'
pnpm exec playwright test tests/e2e/stage-4-node-chat-agent.spec.ts --grep "workflow"
```

The exact command discovered and scheduled the new scenario for Chromium, Chromium 1080p, Firefox, WebKit, and mobile Chromium. Each stopped before product interaction because `E2E_STAGE4_DATABASE_URL` is absent. This is BLOCKED/UNVERIFIED, not a pass; a configured isolated database and server launched with `WUJIE_WORKFLOW_RENDERER_MODE=legacy` and then `shadow` are required to complete the 100-node >=55 FPS, P95 <=50 ms, zero-loss, and zero-unclickable evidence.

## Verification

- `pnpm ts-check` passed after aligning the React Flow node generic with the package's `NodeProps<Node>` contract.
- `pnpm test` ran once: 454 files / 2,750 tests passed; 14 PostgreSQL-backed files / 68 tests were skipped because `POSTGRES_TEST_DATABASE_URL` is not configured.
- `pnpm lint` completed without diagnostics.
- `pnpm build` completed and generated `.next/BUILD_ID` at 00:42:27 local time.
- `git diff --check` passed (line-ending notices only).
- The protected-baseline allowlist gained only exact Task 3 paths: the Stage 4 report, `pnpm-lock.yaml`, `src/components/canvas-workspace.tsx`, workflow route/mode plumbing, legacy/node surfaces, workflow engine, and user manager. The re-run passed every baseline/evidence check but remains blocked solely by the controller-owned `.superpowers/sdd/task-3-brief.md`, which was neither edited, staged, nor added to the allowlist.

## Self-review

- Domain workflow remains the only workflow state authority; React Flow receives controlled projections and no state hook.
- Invalid port creation is rejected by `isWorkflowConnectionValid` before a history entry.
- Drag commands produce one command history record per transaction; server hydration produces none.
- Shadow is hidden/read-only and has no direct action, persistence, billing, execution, Task Core, or Asset Graph dependency.
- Existing legacy node DOM, roles, labels, keyboard handlers, save path, and execute path remain in place.

## Follow-up: Physical Legacy Ownership Extraction

The planned physical extraction is complete. `WorkflowLegacySurface.tsx` now owns the legacy SVG edge layer and visible-node map, while `WorkflowLegacyNodeCard.tsx` owns the original full node card DOM and node-type controls. `node-editor.tsx` supplies workflow-domain data and host callbacks only. The surface dispatches destructive connection mutations through `onCommand`; node mutations retain the same host callbacks and domain update path, without React Flow state or duplicate history.

RED before follow-up production edits:

```powershell
pnpm exec vitest run src/__tests__/components/workflow-react-flow-surface.test.tsx
```

Result: failed with `children is not a function`, proving `WorkflowLegacySurface` still required the render-prop wrapper instead of owning the SVG/node DOM.

Second RED, after the physical move exposed renderer-side effects:

```powershell
pnpm exec vitest run src/__tests__/components/workflow-react-flow-surface.test.tsx
```

Result: failed because `WorkflowLegacyNodeCard.tsx` contained `fetch('/api/save-image')`; the companion assertion also rejects `localStorage` in renderer modules.

GREEN:

```powershell
pnpm exec vitest run src/__tests__/lib/workflow-render-view-model.test.ts src/__tests__/lib/workflow-render-commands.test.ts src/__tests__/lib/workflow-render-shadow.test.ts src/__tests__/components/workflow-react-flow-surface.test.tsx src/__tests__/components/node-editor-ui-regression.test.ts src/__tests__/components/node-editor-history-baseline-contract.test.ts src/__tests__/components/node-editor-execution-wiring.test.ts src/__tests__/components/node-editor-drag-throttle-wiring.test.ts src/__tests__/components/node-editor-layering-wiring.test.ts
pnpm ts-check
```

Result: 9 files / 26 tests passed; `pnpm ts-check` passed. The contract covers legacy edge/node ownership, `data-node-id`, port identifiers, collapse accessible name, host-only renderer side effects, command dispatch, culling handoff, history, execution, and UI regression wiring.

Changed follow-up files:

- `src/components/node-editor.tsx`
- `src/components/workflow/WorkflowLegacySurface.tsx`
- `src/components/workflow/WorkflowLegacyNodeCard.tsx`
- `src/__tests__/components/workflow-react-flow-surface.test.tsx`
- `src/__tests__/components/node-editor-drag-throttle-wiring.test.ts`
- `.superpowers/sdd/stage-4-task-3-report.md`

## R1 Rejection Fix Wave

All 2 Critical, 4 Important, and 2 Minor findings were addressed together after independent R1 rejection.

### R1 RED

The controlled regression command before product corrections was:

```powershell
pnpm exec vitest run src/__tests__/lib/workflow-render-view-model.test.ts src/__tests__/lib/workflow-render-shadow.test.ts src/__tests__/lib/workflow-render-commands.test.ts src/__tests__/components/workflow-react-flow-surface.test.tsx src/__tests__/components/node-editor-history-baseline-contract.test.ts src/__tests__/lib/stage-4-modes.test.ts src/__tests__/api/user-data-sync-asset-graph.test.ts src/__tests__/scripts/stage-4-e2e-fixtures.test.ts tests/unit/protected-baseline-gate.spec.ts
```

Result: exit 1, 8 failed / 1 passed files and 28 failed / 57 passed tests. The failures covered render-time storage access, incomplete React Flow product markup, aliased projections and omitted parity fields, discarded command history, missing virtualization helpers, the broad protected component prefix, and the missing delivery-mode clamp helper. The route matrix itself already passed once exercised.

Additional controlled RED evidence:

- Transitive renderer boundary: `pnpm exec vitest run src/__tests__/components/workflow-react-flow-surface.test.tsx` failed because the new pure `src/lib/workflow-renderer/presentation.ts` boundary did not exist. Runtime workflow-engine imports were then replaced with type-only imports plus pure renderer metadata.
- Fixed port oracle mutation: temporarily changing the expected `any` row to `['any', 'image']` made `src/__tests__/lib/workflow-render-view-model.test.ts` fail 1 / pass 3 with the exact matrix diff. The mutation was restored before GREEN.
- The expanded node-editor group initially failed its old direct-final-position source assertion. That assertion was corrected to require RAF preview plus one final `nodes.move` dispatcher transaction, rather than restoring the rejected parallel write/history path.

### R1 Corrections

- Renderer purity: prompt templates load in `node-editor.tsx`, plain template data is passed to both surfaces, filtering is pure, and renderer runtime imports no longer traverse `workflow-engine` into fetch-capable modules. A real render-time `localStorage` spy remains at zero calls.
- Adapter parity: legacy and React Flow projections are separate implementations that clone complete workflow nodes/connections. Shadow comparison covers node type, label, full node data, ports, edge endpoints/type/full data, selection, position, size, and viewport; injected drift covers each class.
- History: one command-history cursor now drives undo/redo. Prop and broadcast hydration add no user entry; legacy drag previews are unrecorded and mouseup commits one transaction; keyboard/context copy and delete plus connection creation use the dispatcher.
- React Flow: the controlled surface wraps the complete legacy product card, carries status/config/control/accessibility props, uses custom typed/status edges and official CSS, and conditionally enables movement/selection/connection. It has no independent workflow state hook.
- Delivery: server modes resolve as `legacy -> legacy`, `shadow -> shadow`, and `react-flow-v2 -> legacy`; users still cannot receive React Flow v2.
- E2E: the 100-node domain set is asserted separately from the explicit production-culling mounted set. Performance monitors only the non-empty expected mounted set while retaining >=55 FPS, P95 <=50 ms, zero-loss, and zero-unclickable thresholds.
- Baseline and ports: the workflow component allow-prefix was replaced by five exact component files; port expectations are a fixed literal matrix tested across every output/input pair.

### R1 GREEN And Verification

```powershell
pnpm exec vitest run src/__tests__/components/node-editor-ui-regression.test.ts src/__tests__/components/node-editor-provider-capabilities.test.ts src/__tests__/components/node-editor-layering-wiring.test.ts src/__tests__/components/node-editor-history-baseline-contract.test.ts src/__tests__/components/node-editor-execution-wiring.test.ts src/__tests__/components/node-editor-drag-throttle-wiring.test.ts src/__tests__/components/node-editor-asset-reference.test.ts src/__tests__/components/workflow-react-flow-surface.test.tsx src/__tests__/lib/workflow-render-view-model.test.ts src/__tests__/lib/workflow-render-shadow.test.ts src/__tests__/lib/workflow-render-commands.test.ts src/__tests__/lib/stage-4-modes.test.ts src/__tests__/api/user-data-sync-asset-graph.test.ts src/__tests__/scripts/stage-4-e2e-fixtures.test.ts src/__tests__/helpers/stage-4-e2e.test.ts tests/unit/protected-baseline-gate.spec.ts
```

Result: 16 files / 105 tests passed.

- `pnpm ts-check`: passed.
- Targeted ESLint over every changed TS/TSX file: exit 0, 0 errors; 13 existing `node-editor.tsx` warnings remain.
- `pnpm check:protected-baseline`: passed all checks with 0 warnings.
- `git diff --check`: passed; Git emitted line-ending notices only.
- Playwright contract loading with both expected rollout modes set and `--grep "workflow renderer" --list`: passed and enumerated the workflow scenario for all 5 browser projects.
- The live isolated-database browser run remains UNVERIFIED because `E2E_STAGE4_DATABASE_URL=UNSET`; no performance threshold was weakened or claimed as measured.
- The final full suite was intentionally not run; controller re-review owns it.

### R1 Files Changed

- `.superpowers/sdd/stage-4-task-3-report.md`
- `package.json`
- `src/app/api/user-data/sync/route.ts`
- `src/components/node-editor.tsx`
- `src/components/workflow/WorkflowLegacyNodeCard.tsx`
- `src/components/workflow/WorkflowLegacySurface.tsx`
- `src/components/workflow/WorkflowNodeCard.tsx`
- `src/components/workflow/WorkflowReactFlowSurface.tsx`
- `src/components/workflow/WorkflowShadowProbe.tsx`
- `src/lib/workflow-renderer/commands.ts`
- `src/lib/workflow-renderer/mode.ts`
- `src/lib/workflow-renderer/presentation.ts`
- `src/lib/workflow-renderer/shadow.ts`
- `src/lib/workflow-renderer/view-model.ts`
- `src/__tests__/api/user-data-sync-asset-graph.test.ts`
- `src/__tests__/components/node-editor-drag-throttle-wiring.test.ts`
- `src/__tests__/components/node-editor-history-baseline-contract.test.ts`
- `src/__tests__/components/workflow-react-flow-surface.test.tsx`
- `src/__tests__/lib/stage-4-modes.test.ts`
- `src/__tests__/lib/workflow-render-commands.test.ts`
- `src/__tests__/lib/workflow-render-shadow.test.ts`
- `src/__tests__/lib/workflow-render-view-model.test.ts`
- `src/__tests__/scripts/stage-4-e2e-fixtures.test.ts`
- `tests/e2e/stage-4-node-chat-agent.spec.ts`
- `tests/helpers/stage-4-e2e.ts`
- `tests/helpers/workflow-performance.ts`
- `tests/unit/protected-baseline-gate.spec.ts`

Controller-owned `.superpowers/sdd/task-1-brief.md` and `.superpowers/sdd/task-2-brief.md` remained untouched and are excluded from staging and the follow-up commit.

## R2 Independent Review Fix Wave

All six R2 findings were fixed in one bounded follow-up based on `e8fb814`.

### R2 RED

Before product corrections, the controlled regression command was:

```powershell
pnpm exec vitest run src/__tests__/components/workflow-react-flow-surface.test.tsx src/__tests__/lib/workflow-render-commands.test.ts src/__tests__/components/node-editor-history-baseline-contract.test.ts src/__tests__/components/node-editor-drag-throttle-wiring.test.ts src/__tests__/scripts/stage-4-e2e-fixtures.test.ts tests/unit/protected-baseline-gate.spec.ts
```

Result: exit 1; 6 failed files and 17 failed / 47 passed tests. Failures proved that the legacy surface still required raw node arrays, projected drift did not control the actual DOM, React Flow Ctrl selection collapsed to one node, visible product ports were not the real Handles, size measurement was not forwarded, the editor lacked one atomic workflow/history reducer, clipboard paste re-read live sources, short RAF bursts inflated FPS, missing input samples passed, and the renderer library allow-prefix remained broad.

### R2 Corrections

- Legacy DOM now consumes only the legacy render model plus an explicit visible-node ID set. Node identity/type/label/data/ports/position/size and edge identity/endpoints/type/data are reconstructed from the projection, so omitted or drifted projected data changes the real legacy DOM and cannot produce a false shadow-sync result.
- Workflow plus history now transition through `reduceWorkflowEditorState`. User updates and commands atomically record one transaction, hydration clears history, system drag previews and `node.measure` record none, and broadcast runs from a revision effect outside the reducer.
- React Flow computes Ctrl/Cmd selection from the projected selected set, uses each visible product port as its one actual Handle, forwards card size measurement as `node.measure`, and remains fully controlled by the host workflow.
- FPS uses the complete `startedAt..endedAt` interval. Invalid or fewer-than-two frame samples and empty input-latency evidence fail closed; the shared assertion retains >=55 FPS, P95 <=50ms, zero loss, and zero unclickable duration.
- The protected baseline enumerates exactly `mode.ts`, `view-model.ts`, `commands.ts`, `shadow.ts`, and `presentation.ts`; tests reject both broad component and broad renderer-library prefixes.
- Clipboard copy captures a deep node/internal-edge snapshot. `clipboard.paste` clones only that snapshot, including after source deletion or source mutation.

### R2 GREEN And Verification

Focused R2 regression GREEN:

```powershell
pnpm exec vitest run src/__tests__/components/workflow-react-flow-surface.test.tsx src/__tests__/lib/workflow-render-commands.test.ts src/__tests__/components/node-editor-history-baseline-contract.test.ts src/__tests__/components/node-editor-drag-throttle-wiring.test.ts src/__tests__/scripts/stage-4-e2e-fixtures.test.ts tests/unit/protected-baseline-gate.spec.ts
```

Result: 6 files / 64 tests passed.

Full Task 3/node-editor/route/helper focused command:

```powershell
pnpm exec vitest run src/__tests__/components/node-editor-ui-regression.test.ts src/__tests__/components/node-editor-provider-capabilities.test.ts src/__tests__/components/node-editor-layering-wiring.test.ts src/__tests__/components/node-editor-history-baseline-contract.test.ts src/__tests__/components/node-editor-execution-wiring.test.ts src/__tests__/components/node-editor-drag-throttle-wiring.test.ts src/__tests__/components/node-editor-asset-reference.test.ts src/__tests__/components/workflow-react-flow-surface.test.tsx src/__tests__/lib/workflow-render-view-model.test.ts src/__tests__/lib/workflow-render-shadow.test.ts src/__tests__/lib/workflow-render-commands.test.ts src/__tests__/lib/stage-4-modes.test.ts src/__tests__/api/user-data-sync-asset-graph.test.ts src/__tests__/scripts/stage-4-e2e-fixtures.test.ts src/__tests__/helpers/stage-4-e2e.test.ts tests/unit/protected-baseline-gate.spec.ts
```

Result: 16 files / 115 tests passed.

- `pnpm ts-check`: first run RED on the optional React mouse event (`TS18048` at `WorkflowReactFlowSurface.tsx:130`); after optional chaining, the rerun passed.
- Targeted ESLint over all changed TS/TSX files: exit 0, 0 errors; the same 13 existing `node-editor.tsx` warnings remain.
- `pnpm check:protected-baseline`: passed all checks with 0 warnings.
- `git diff --check`: passed; Git emitted line-ending notices only.
- Live database E2E was not run, as required; controller owns that evidence.
- The final full suite was intentionally not run; controller re-review owns it.

### R2 Files Changed

- `.superpowers/sdd/stage-4-task-3-report.md`
- `package.json`
- `src/components/node-editor.tsx`
- `src/components/workflow/WorkflowLegacyNodeCard.tsx`
- `src/components/workflow/WorkflowLegacySurface.tsx`
- `src/components/workflow/WorkflowNodeCard.tsx`
- `src/components/workflow/WorkflowReactFlowSurface.tsx`
- `src/lib/workflow-renderer/commands.ts`
- `src/__tests__/components/node-editor-drag-throttle-wiring.test.ts`
- `src/__tests__/components/node-editor-history-baseline-contract.test.ts`
- `src/__tests__/components/workflow-react-flow-surface.test.tsx`
- `src/__tests__/lib/workflow-render-commands.test.ts`
- `src/__tests__/scripts/stage-4-e2e-fixtures.test.ts`
- `tests/e2e/stage-4-node-chat-agent.spec.ts`
- `tests/helpers/workflow-performance.ts`
- `tests/unit/protected-baseline-gate.spec.ts`

Controller-owned `.superpowers/sdd/task-1-brief.md` and `.superpowers/sdd/task-2-brief.md` were not edited by this fix wave and remain excluded from staging and commit.

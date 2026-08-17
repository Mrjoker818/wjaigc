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

## R3 Independent Review Fix Wave

The four R3 runtime/state findings were fixed in one minimal follow-up based on `c421467`.

### R3 RED

Behavioral regressions were added before product changes and run with:

```powershell
pnpm exec vitest run src/__tests__/lib/workflow-render-commands.test.ts src/__tests__/components/workflow-react-flow-surface.test.tsx src/__tests__/components/node-editor-drag-throttle-wiring.test.ts src/__tests__/components/node-editor-history-baseline-contract.test.ts
```

Result: exit 1; 4 failed files and 6 failed / 28 passed tests. The failures were `transition.update is not a function` for the desired deterministic reducer payload, missing `nodes.drag.commit`, missing two-node `commitNodeDrag`, missing viewport host callback, stale `nodeDragStartWorkflowRef` wiring, and `createConnection` still executing inside workflow updater callbacks.

### R3 Corrections

- Added deterministic `nodes.drag.commit` with initial and final absolute positions. It applies final positions to the reducer's current workflow, and constructs the undo snapshot by replacing only positions on that same current workflow. Concurrent config, image, size, connection, and other node changes therefore survive commit and undo.
- Legacy drag now stores only initial positions. Mouseup submits the final position without passing or restoring a stale workflow snapshot.
- React Flow consumes the full selected-node array from `OnNodeDrag`, emitting one group drag transaction with every selected final position and projected initial position.
- Controlled React Flow viewport changes call the host's `setViewport`; the next host projection supplies the updated viewport. Viewport changes do not enter workflow history and React Flow remains non-authoritative.
- User and system reducer transitions now carry precomputed workflow values instead of updater functions. Command payloads are deterministic; connection IDs and other nondeterministic values in modified updater paths are generated before dispatch. Replaying the same action from the same state produces an equal result.
- Runtime-sensitive tests exercise the reducer race plus undo, two selected React Flow nodes, viewport host-model updates, and deterministic replay. Existing source contracts remain as supplemental wiring checks.

### R3 GREEN And Verification

Focused R3 regression GREEN:

```powershell
pnpm exec vitest run src/__tests__/lib/workflow-render-commands.test.ts src/__tests__/components/workflow-react-flow-surface.test.tsx src/__tests__/components/node-editor-drag-throttle-wiring.test.ts src/__tests__/components/node-editor-history-baseline-contract.test.ts
```

Result: 4 files / 34 tests passed.

Full Task 3/node-editor/route/helper focused command:

```powershell
pnpm exec vitest run src/__tests__/components/node-editor-ui-regression.test.ts src/__tests__/components/node-editor-provider-capabilities.test.ts src/__tests__/components/node-editor-layering-wiring.test.ts src/__tests__/components/node-editor-history-baseline-contract.test.ts src/__tests__/components/node-editor-execution-wiring.test.ts src/__tests__/components/node-editor-drag-throttle-wiring.test.ts src/__tests__/components/node-editor-asset-reference.test.ts src/__tests__/components/workflow-react-flow-surface.test.tsx src/__tests__/lib/workflow-render-view-model.test.ts src/__tests__/lib/workflow-render-shadow.test.ts src/__tests__/lib/workflow-render-commands.test.ts src/__tests__/lib/stage-4-modes.test.ts src/__tests__/api/user-data-sync-asset-graph.test.ts src/__tests__/scripts/stage-4-e2e-fixtures.test.ts src/__tests__/helpers/stage-4-e2e.test.ts tests/unit/protected-baseline-gate.spec.ts
```

Result: 16 files / 118 tests passed.

- `pnpm ts-check`: passed.
- Targeted ESLint over all R3 changed TS/TSX files: exit 0, 0 errors; the same 13 existing `node-editor.tsx` warnings remain.
- `pnpm check:protected-baseline`: passed all checks with 0 warnings.
- `git diff --check`: passed; Git emitted line-ending notices only.
- Live database E2E and the final full suite were not run, as required; controller owns those runs.

### R3 Files Changed

- `.superpowers/sdd/stage-4-task-3-report.md`
- `src/components/node-editor.tsx`
- `src/components/workflow/WorkflowReactFlowSurface.tsx`
- `src/lib/workflow-renderer/commands.ts`
- `src/__tests__/components/node-editor-drag-throttle-wiring.test.ts`
- `src/__tests__/components/node-editor-history-baseline-contract.test.ts`
- `src/__tests__/components/workflow-react-flow-surface.test.tsx`
- `src/__tests__/lib/workflow-render-commands.test.ts`

Controller-owned `.superpowers/sdd/task-1-brief.md` and `.superpowers/sdd/task-2-brief.md` remain unstaged and excluded from the R3 commit.

## R4 Independent Review Fix Wave

The six R4 history, drag synchronization, controlled-preview, clipboard-selection, and full-suite findings were fixed in one bounded follow-up based on `e166d95`.

### R4 RED

The initial controlled regression command was:

```powershell
pnpm exec vitest run src/__tests__/lib/workflow-render-commands.test.ts src/__tests__/components/workflow-react-flow-controlled-behavior.test.tsx src/__tests__/components/node-editor-drag-throttle-wiring.test.ts src/__tests__/components/node-annotation-wiring.test.ts
```

Result: exit 1; 4 failed files and 8 failed / 28 passed tests. Failures proved that history entries still lacked inverse operations, drag undo removed late config/image/size updates, structural undo clobbered unrelated state, deferred external-workflow merging was absent, paste did not return its suffixed IDs, React Flow had no controlled position-preview callback, and the annotation wiring assertion was stale.

A second lifecycle regression required the actual React Flow surface to expose drag-start and retain the selected group's initial positions before controlled previews. Before that correction, the one-file run failed 1 / 1 because `onNodeDragStart` was undefined.

### R4 Corrections

- Workflow history now stores deterministic forward and inverse operations rather than whole-workflow snapshots. Undo and redo apply node, connection, and field operations to the current workflow, so a drag reverses only dragged positions while late config, image, and measured-size changes survive. Delete, copy/paste, and connect restore or remove only their own entities and preserve unrelated concurrent state.
- Drag history keeps initial positions only. Final positions apply atomically to the current workflow; same-transaction operations coalesce in forward order and inverse order without creating a parallel history authority.
- The editor caches the latest external workflow received during legacy drag. Drag end commits one user transaction, then applies the cached external workflow as a no-history system update with final dragged positions overlaid, preserving both the external update and drag history.
- The controlled React Flow surface forwards position changes through `onNodesChange` to a host-owned no-history preview. Drag start captures all selected initial positions, drag stop commits all selected final positions once, and viewport changes remain host-owned.
- Behavioral surface coverage renders the real adapter, invokes its selected-group drag, preview, and viewport callbacks, then applies a post-commit config/image/size update and verifies undo/redo preserve that update.
- Paste and copy commands return the actual generated node IDs. Keyboard paste, context paste, and duplicate select those returned IDs, including collision suffixes.
- The stale annotation wiring test now asserts the intended branch-specific existing-bundle flow and optional-chain node lookup.

### R4 GREEN And Verification

Controlled R4 regression GREEN:

```powershell
pnpm exec vitest run src/__tests__/lib/workflow-render-commands.test.ts src/__tests__/components/workflow-react-flow-controlled-behavior.test.tsx src/__tests__/components/node-editor-drag-throttle-wiring.test.ts src/__tests__/components/node-annotation-wiring.test.ts
```

Result: 4 files / 36 tests passed.

Full Task 3/node-editor/route/helper focused command:

```powershell
pnpm exec vitest run src/__tests__/components/node-editor-ui-regression.test.ts src/__tests__/components/node-editor-provider-capabilities.test.ts src/__tests__/components/node-editor-layering-wiring.test.ts src/__tests__/components/node-editor-history-baseline-contract.test.ts src/__tests__/components/node-editor-execution-wiring.test.ts src/__tests__/components/node-editor-drag-throttle-wiring.test.ts src/__tests__/components/node-editor-asset-reference.test.ts src/__tests__/components/workflow-react-flow-surface.test.tsx src/__tests__/components/workflow-react-flow-controlled-behavior.test.tsx src/__tests__/components/node-annotation-wiring.test.ts src/__tests__/lib/workflow-render-view-model.test.ts src/__tests__/lib/workflow-render-shadow.test.ts src/__tests__/lib/workflow-render-commands.test.ts src/__tests__/lib/stage-4-modes.test.ts src/__tests__/api/user-data-sync-asset-graph.test.ts src/__tests__/scripts/stage-4-e2e-fixtures.test.ts src/__tests__/helpers/stage-4-e2e.test.ts tests/unit/protected-baseline-gate.spec.ts
```

Result: 18 files / 138 tests passed.

- `pnpm test`: exit 0; 455 files / 2800 tests passed. Fourteen PostgreSQL integration files / 68 tests were honestly skipped because `POSTGRES_TEST_DATABASE_URL` is not configured.
- `pnpm ts-check`: passed.
- Targeted ESLint over every R4 changed TS/TSX file with `--quiet`: exit 0.
- `pnpm check:protected-baseline`: passed all checks with 0 warnings.
- `git diff --check`: passed; Git emitted line-ending notices only.
- Live database E2E was not run, as required.

### R4 Files Changed

- `.superpowers/sdd/stage-4-task-3-report.md`
- `src/components/node-editor.tsx`
- `src/components/workflow/WorkflowReactFlowSurface.tsx`
- `src/lib/workflow-renderer/commands.ts`
- `src/__tests__/components/node-annotation-wiring.test.ts`
- `src/__tests__/components/node-editor-drag-throttle-wiring.test.ts`
- `src/__tests__/components/workflow-react-flow-controlled-behavior.test.tsx`
- `src/__tests__/lib/workflow-render-commands.test.ts`

Controller-owned `.superpowers/sdd/task-1-brief.md` and `.superpowers/sdd/task-2-brief.md` were not edited by this fix wave and remain excluded from staging and commit.

## R5 Independent Review Fix Wave

The three R5 graph-replay, React Flow drag-lifecycle, and real-integration-test findings were fixed in one bounded follow-up based on `af4bdd8`.

### R5 RED

The structural history regressions were added first and run with:

```powershell
pnpm exec vitest run src/__tests__/lib/workflow-render-commands.test.ts
```

Result: exit 1; 3 failed / 16 passed tests. The failures proved that delete redo left a late concurrent incident edge dangling, connection redo restored an edge after its source node disappeared, and clipboard undo left a late edge incident to the removed pasted node.

The host drag-lifecycle and DOM integration regressions were then run with:

```powershell
pnpm exec vitest run src/__tests__/components/workflow-react-flow-controlled-behavior.test.tsx src/__tests__/components/node-editor-drag-throttle-wiring.test.ts
```

Result: exit 1; 2 failed / 5 passed tests. The failures proved that the React Flow surface had no shared host drag synchronization path and NodeEditor did not wire React Flow drag start/end into the external-hydration guard.

### R5 Corrections

- Structural patch replay is graph-safe against current concurrent state. Replaying `node.remove` removes every current incident edge, including late edges, while retaining unrelated nodes, edges, config, and image state. Clipboard inverse removal receives the same protection.
- Replaying `connection.add` validates current endpoint nodes, port existence, input/output direction, and data-type compatibility before insertion. Invalid redo safely becomes a no-op while the history cursor advances consistently, so undo/redo cannot create dangling or incompatible edges.
- Node/connection add, remove, and set replay paths revalidate affected graph structure. Behavioral tests cover delete redo with a late edge, connect redo after source disappearance, clipboard undo with a late pasted-node edge, unrelated concurrent-state survival, and valid history cursor movement.
- `WorkflowReactFlowSurface` now exposes explicit drag-start and drag-end lifecycle callbacks. NodeEditor routes legacy and React Flow through the same host-owned drag guard and latest-external-workflow queue; preview remains a no-history system update, the selected group commits once, and queued hydration is merged after drag with final positions retained.
- The React Flow controlled behavior suite now uses jsdom and React Testing Library with a non-null DOM interaction harness. Mouse gestures exercise the real surface and product host synchronization hook, including two-node group preview/commit, an external prop update during drag, deferred replay, and a host-owned viewport callback. Test-only `jsdom` and `@testing-library/react` dependencies support this mounted coverage.

### R5 GREEN And Verification

Focused R5 regression GREEN:

```powershell
pnpm exec vitest run src/__tests__/components/workflow-react-flow-controlled-behavior.test.tsx src/__tests__/components/node-editor-drag-throttle-wiring.test.ts src/__tests__/lib/workflow-render-commands.test.ts
```

Result: 3 files / 26 tests passed.

Full Task 3/node-editor/route/helper focused command:

```powershell
pnpm exec vitest run src/__tests__/components/node-editor-ui-regression.test.ts src/__tests__/components/node-editor-provider-capabilities.test.ts src/__tests__/components/node-editor-layering-wiring.test.ts src/__tests__/components/node-editor-history-baseline-contract.test.ts src/__tests__/components/node-editor-execution-wiring.test.ts src/__tests__/components/node-editor-drag-throttle-wiring.test.ts src/__tests__/components/node-editor-asset-reference.test.ts src/__tests__/components/workflow-react-flow-surface.test.tsx src/__tests__/components/workflow-react-flow-controlled-behavior.test.tsx src/__tests__/components/node-annotation-wiring.test.ts src/__tests__/lib/workflow-render-view-model.test.ts src/__tests__/lib/workflow-render-shadow.test.ts src/__tests__/lib/workflow-render-commands.test.ts src/__tests__/lib/stage-4-modes.test.ts src/__tests__/api/user-data-sync-asset-graph.test.ts src/__tests__/scripts/stage-4-e2e-fixtures.test.ts src/__tests__/helpers/stage-4-e2e.test.ts tests/unit/protected-baseline-gate.spec.ts
```

Result: 18 files / 142 tests passed.

- `pnpm test`: exit 0; 455 files / 2804 tests passed. Fourteen PostgreSQL integration files / 68 tests were honestly skipped because `POSTGRES_TEST_DATABASE_URL` is not configured.
- `pnpm ts-check`: passed.
- Targeted ESLint over every R5 changed TS/TSX file: exit 0.
- `pnpm check:protected-baseline`: passed all checks with 0 warnings.
- `git diff --check`: passed; Git emitted line-ending notices only.
- Live database E2E was not run, as required.

### R5 Files Changed

- `.superpowers/sdd/stage-4-task-3-report.md`
- `package.json`
- `pnpm-lock.yaml`
- `src/components/node-editor.tsx`
- `src/components/workflow/WorkflowReactFlowSurface.tsx`
- `src/lib/workflow-renderer/commands.ts`
- `src/__tests__/components/node-editor-drag-throttle-wiring.test.ts`
- `src/__tests__/components/workflow-react-flow-controlled-behavior.test.tsx`
- `src/__tests__/lib/workflow-render-commands.test.ts`

Controller-owned `.superpowers/sdd/task-1-brief.md` and `.superpowers/sdd/task-2-brief.md` were not edited by this fix wave and remain excluded from staging and commit.

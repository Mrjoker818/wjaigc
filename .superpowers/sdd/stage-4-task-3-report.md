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

## Remaining Concern

`WorkflowLegacySurface` now carries the actual projection and command dispatch through a tested render boundary, and visual node/edge mutation paths dispatch commands. However, to avoid changing the 5,135-line legacy DOM in this task, the product node/edge JSX is still physically located in `src/components/node-editor.tsx` and supplied through that boundary. This is not a complete physical JSX extraction into `WorkflowLegacySurface.tsx`; do not describe Task 3 as fully extracted until that follow-up is performed with DOM/accessibility regression evidence.

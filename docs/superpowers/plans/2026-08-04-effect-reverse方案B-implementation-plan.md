# Effect Reverse Engineering Pro 方案 B Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the approved Effect Reverse Engineering Pro product shape, real Chinese UI, three-area workspace, and collision-safe canvas toolbars without removing existing actions.

**Architecture:** Keep the existing canvas entry point and authenticated task API, but split the reverse-engineering UI into source, workspace, and layer-panel responsibilities. Add pure layout helpers for both toolbars so placement is testable without rendering the entire canvas. Keep unsupported capabilities explicit and never represent simulated analysis as a completed AI result.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5, Tailwind CSS 4, lucide-react, Vitest, Playwright.

## Global Constraints

- Preserve every existing bottom-toolbar and selected-image-toolbar action, callback, shortcut, and preference.
- All new labels, status text, error text, tooltips, and buttons are Chinese; provider/model names may remain as configured display names.
- Do not introduce a raw remote image fetch path; use the existing trusted media and safe-download helpers.
- Do not claim AI analysis, OCR, CAD/DXF, or semantic reconstruction unless a real server result exists.
- Do not alter login, project restoration, generation polling, billing, or canvas pointer routing outside narrowly tested integration points.
- Each behavior starts with a focused failing test and ends with focused regression tests.

## File Map

| Path | Responsibility |
| --- | --- |
| `src/components/effect-reverse-engineering/source-panel.tsx` | Source list, selected-image snapshot, upload entry, source metadata. |
| `src/components/effect-reverse-engineering/workspace.tsx` | Original/corrected/flat/vector tabs, perspective points, calibration, correction actions. |
| `src/components/effect-reverse-engineering/layer-panel.tsx` | Layer tree, visibility, lock, rename, delete, reorder, inferred-risk state. |
| `src/components/effect-reverse-engineering/i18n.ts` | Chinese UI copy and stable action labels. |
| `src/components/effect-reverse-engineering-panel.tsx` | Floating shell and composition of the three regions. |
| `src/lib/canvas-toolbar-layout.ts` | Pure bottom-toolbar drawer placement and available-viewport calculations. |
| `src/lib/image-toolbar-position.ts` | Selected-image toolbar/popover placement with occupied right-panel bounds. |
| `src/components/infinite-canvas.tsx` | Existing action descriptors, toolbar integration, and result insertion only. |
| `src/__tests__/components/effect-reverse-engineering-*.test.tsx` | UI contracts and layer interactions. |
| `src/__tests__/lib/canvas-toolbar-layout.test.ts` | Pure bottom drawer layout regressions. |
| `src/__tests__/lib/image-toolbar-position.test.ts` | Right-panel-aware selected-image placement. |
| `src/__tests__/components/canvas-toolbar-floating-windows.test.ts` | Existing action reachability and event isolation. |
| `tests/e2e/effect-reverse-removebg-toolbar.spec.ts` | Deployed browser evidence for the new UI and toolbars. |

## Task 1: Chinese Copy and Three-Area Contracts

**Files:**
- Create: `src/components/effect-reverse-engineering/i18n.ts`
- Create: `src/components/effect-reverse-engineering/source-panel.tsx`
- Create: `src/components/effect-reverse-engineering/workspace.tsx`
- Create: `src/components/effect-reverse-engineering/layer-panel.tsx`
- Test: `src/__tests__/components/effect-reverse-engineering-layout.test.tsx`

**Interfaces:**
- `REVERSE_COPY` provides all visible Chinese labels.
- `EffectReverseSourcePanel` accepts the frozen source and emits source selection.
- `EffectReverseWorkspace` accepts perspective/regions/task state and emits point/action changes.
- `EffectReverseLayerPanel` accepts regions and emits visibility, lock, rename, remove, and reorder changes.

- [ ] Write a failing test asserting the panel exposes Chinese title, source, workspace tabs, structure layers, calibration, and status labels.
- [ ] Run `pnpm exec vitest run src/__tests__/components/effect-reverse-engineering-layout.test.tsx` and capture the expected missing-module failure.
- [ ] Add the copy dictionary and presentational components with real callbacks, no simulated AI result.
- [ ] Add layer interaction tests for toggle visibility, toggle lock, rename, delete, and reorder.
- [ ] Run the focused component tests and commit `feat: split reverse engineering workspace regions`.

## Task 2: Replace the Monolithic Floating Panel

**Files:**
- Modify: `src/components/effect-reverse-engineering-panel.tsx`
- Test: `src/__tests__/components/effect-reverse-engineering-panel.test.ts`

**Interfaces:**
- Preserve `EffectReverseEngineeringPanel` props and existing API task contract.
- Compose source panel, workspace, and layer panel inside the current draggable/resizable shell.

- [ ] Add a failing source contract test proving the three regions render and unsupported capabilities show as unavailable in Chinese.
- [ ] Run the focused test and record the failure before implementation.
- [ ] Move only presentation and local region state into the new components; retain task polling, cancellation, and result insertion semantics.
- [ ] Add visible tabs for `原图`, `透视校正`, `平面拆图`, and `矢量结果`; only show a result tab after a real task result exists.
- [ ] Verify the panel at desktop and narrow widths, then commit `refactor: compose reverse engineering floating workspace`.

## Task 3: Real Layer Operations and Explicit Analysis State

**Files:**
- Modify: `src/components/effect-reverse-engineering/layer-panel.tsx`
- Modify: `src/components/effect-reverse-engineering-panel.tsx`
- Modify: `src/lib/effect-reverse-engineering/types.ts`
- Test: `src/__tests__/components/effect-reverse-engineering-layers.test.tsx`

- [ ] Write failing tests for deterministic layer operations and for the no-analyzer state.
- [ ] Run the tests to prove the current implementation does not meet them.
- [ ] Add stable layer IDs, ordered updates, visibility/lock state, and an inferred-risk banner. `运行 AI 分析` remains disabled unless an authorized analyzer is actually provided.
- [ ] Add calibration fields for value/unit with bounded numeric input and a visible `仅作比例参考` notice until a real calibration result exists.
- [ ] Run the focused layer tests and commit `feat: add reverse engineering layer controls`.

## Task 4: Collision-Safe Bottom Toolbar Drawer

**Files:**
- Create: `src/lib/canvas-toolbar-layout.ts`
- Modify: `src/components/infinite-canvas.tsx`
- Test: `src/__tests__/lib/canvas-toolbar-layout.test.ts`
- Test: `src/__tests__/components/canvas-toolbar-floating-windows.test.ts`

**Interfaces:**
- `getBottomToolbarDrawerPlacement(input)` returns `{ left, top, side }` and clamps to the viewport excluding the right panel.
- Existing button callbacks remain the single source of truth.

- [ ] Write failing tests for a drawer opening above/left of a right panel, narrow viewport clamping, and pointer-event isolation.
- [ ] Run focused tests and capture the expected missing-helper failure.
- [ ] Implement placement using trigger rectangle, viewport, drawer size, occupied right width, margin, and gap.
- [ ] Replace uncontrolled horizontal feature expansion with a categorized, internally scrollable drawer. Keep the current collapsed behavior and all existing actions.
- [ ] Verify no browser-level horizontal scrollbar is introduced and commit `feat: add bounded canvas toolbar drawer`.

## Task 5: Selected-Image Overflow Popover

**Files:**
- Modify: `src/lib/image-toolbar-position.ts`
- Modify: `src/components/infinite-canvas.tsx`
- Test: `src/__tests__/lib/image-toolbar-position.test.ts`
- Test: `src/__tests__/lib/image-toolbar-preferences.test.ts`

- [ ] Write failing tests for occupied-right placement, vertical fallback, and additive preference normalization.
- [ ] Run the tests before implementation.
- [ ] Extend placement with `occupiedRight` and available-canvas bounds; keep the first visible actions and move remaining actions into a bounded `+N` popover.
- [ ] Group the popover by existing action metadata, stop pointer/wheel propagation, and preserve custom ordering and hidden preferences.
- [ ] Run layout, preference, and source regression tests and commit `feat: constrain selected image toolbar overflow`.

## Task 6: Real Browser Regression Evidence

**Files:**
- Create: `tests/e2e/effect-reverse-removebg-toolbar.spec.ts`
- Modify: `docs/testing/BUG_REGISTER.md`
- Modify: `docs/testing/REGRESSION_REPORT.md`
- Modify: `docs/testing/UNVERIFIED_ITEMS.md`

- [ ] Add browser tests for opening the reverse-engineering panel, switching tabs, editing a layer, and opening both toolbar surfaces with a right panel visible.
- [ ] Run against the authenticated deployed environment with screenshot, video, trace, console, and network capture enabled.
- [ ] Record unavailable provider/model capabilities as unverified, not passed; record task IDs and actual output URLs for completed tasks.
- [ ] Run `pnpm ts-check`, focused Vitest suites, `pnpm lint`, and `pnpm build`; document baseline failures separately.
- [ ] Commit the evidence and quality documents only after verifying the artifacts exist.

## Self-Review

- Chinese copy, three-area composition, layer editing, calibration, explicit analyzer state, toolbar drawers, preference preservation, and browser evidence each have a dedicated task.
- No task claims OCR, CAD/DXF, or automatic semantic reconstruction as complete without a real service contract.
- All later task interfaces use the names defined above.
- The plan is intentionally limited to recovering the approved design and reliable integration; unrelated platform refactors are excluded.

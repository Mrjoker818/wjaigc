# Recraft Vector Design Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the AI vector design panel into a capability-aware Recraft workspace with production-oriented presets, native generation controls, reference-based creation, exploration, and reliable editable SVG persistence.

**Architecture:** Keep Recraft-specific capability and preset metadata in focused library modules, while the panel consumes a normalized capability model instead of hard-coding options. Extend `/api/vector-design` with explicit actions and a shared result parser that persists every returned SVG. Preserve exact provider/model authorization and keep unsupported controls hidden rather than sending parameters that Recraft may ignore.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5, Vitest, Tailwind CSS 4, Sharp, Recraft REST API.

## Global Constraints

- Do not change login, project routing, infinite canvas, annotation, video, 3D, or payment behavior.
- Continue requiring an authenticated user and exact `providerId + modelId` authorization.
- Only accept genuine editable SVG; reject raster wrappers and unsafe SVG content.
- Recraft V4/V4.1 style presets are prompt fragments, not `style` API values.
- Recraft V2/V3-only parameters must be disabled for incompatible models.
- Generated result count must be 1-6 and credits must be charged per requested output.
- Remote SVG downloads must use the existing safe downloader and have explicit byte/time limits.
- UI must retain the existing dark neutral and gold accent system, avoid nested cards, and remain usable in the current side panel width.

---

### Task 1: Preset Taxonomy And Capability Matrix

**Files:**
- Modify: `src/lib/vector-design.ts`
- Modify: `src/__tests__/lib/vector-design.test.ts`

**Interfaces:**
- Produces: `getVectorModelCapabilities(modelId)`, `normalizeVectorSelections(selection)`, `VECTOR_PRESET_GROUPS`, `VECTOR_ASPECT_RATIOS`.
- Consumes: Recraft model IDs already recognized by `isRecraftVectorModel`.

- [x] **Step 1: Write failing tests for preset counts, exclusive groups, conflicts, model capabilities, and full aspect ratios.**
- [x] **Step 2: Run `pnpm exec vitest run src/__tests__/lib/vector-design.test.ts` and verify the new assertions fail.**
- [x] **Step 3: Implement typed preset metadata, compatibility flags, conflict resolution, model family labels, and all 14 official aspect ratios.**
- [x] **Step 4: Build prompts in the order subject, category, design construction, visual style, composition, palette, output constraints.**
- [x] **Step 5: Re-run the test and verify it passes.**

### Task 2: Recraft Response And Request Contracts

**Files:**
- Modify: `src/app/api/vector-design/route.ts`
- Modify: `src/__tests__/api/vector-design-contract.test.ts`

**Interfaces:**
- Produces: action-specific validation and an `assets[]` response for all generation actions.
- Consumes: capability metadata from Task 1 and existing provider authorization.

- [x] **Step 1: Write failing contract tests for `n`, `random_seed`, `controls.colors`, `background_color`, multi-result parsing, and safe SVG URL downloads.**
- [x] **Step 2: Run `pnpm exec vitest run src/__tests__/api/vector-design-contract.test.ts` and verify failure.**
- [x] **Step 3: Replace the single-result parser with a parser that accepts direct SVG, base64 SVG, and URL results for every item in `data`.**
- [x] **Step 4: Validate count, prompt length, ratios, RGB values, seed, strength, request size, response size, and action-specific required fields.**
- [x] **Step 5: Send one Recraft request with `n=1-6`, validate the complete batch, persist every SVG transactionally, and return both `asset` and `assets` for compatibility.**
- [x] **Step 6: Re-run the API contract test.**

### Task 3: Native Recraft Creation Modes

**Files:**
- Modify: `src/app/api/vector-design/route.ts`
- Modify: `src/__tests__/api/vector-design-contract.test.ts`

**Interfaces:**
- Produces actions `enhance`, `image-to-image`, `explore`, `explore-similar`, and `create-style`.
- Consumes: authenticated provider, selected model, managed image input, and capability matrix.

- [x] **Step 1: Add failing tests for endpoint selection, compatibility guards, reference limits, and enhanced prompt responses.**
- [x] **Step 2: Implement `/prompts/enhance`, `/images/imageToImage`, `/images/explore`, `/images/explore/similar`, and `/styles` requests.**
- [x] **Step 3: Keep vectorization separate from reference-based creation and require an Explore source ID for similar exploration.**
- [x] **Step 4: Gate API-created custom styles to Recraft V3 Vector and reject unsupported V4/V4.1 style parameters.**
- [x] **Step 5: Re-run API tests.**

### Task 4: Vector Panel Product UI

**Files:**
- Modify: `src/components/vector-design/vector-design-panel.tsx`
- Create: `src/__tests__/components/vector-design-panel-contract.test.ts`

**Interfaces:**
- Consumes: preset groups, capability matrix, normalized API `assets[]`.
- Produces: text generation, vectorization, reference creation, exploration, prompt enhancement, palette controls, seed control, and result actions.

- [x] **Step 1: Write a failing source-contract test for the four semantic groups, mode separation, palette controls, seed, 14 ratios, native count 1-6, and capability hints.**
- [x] **Step 2: Replace the flat chip wall with compact single-select category/design/style sections and multi-select output constraints.**
- [x] **Step 3: Add model intent labels, color swatches, background control, transparent-output conflict prevention, seed, and prompt enhancement.**
- [x] **Step 4: Separate `文生矢量`, `位图矢量化`, `参考图创作`, and `方向探索` modes.**
- [x] **Step 5: Add loading, empty, disabled, compatibility, complete-batch validation, and error states without introducing modal-heavy flow.**
- [x] **Step 6: Re-run component tests.**

### Task 5: Regression And Release Verification

**Files:**
- Modify: `docs/superpowers/plans/2026-07-28-recraft-vector-design-upgrade.md`

**Interfaces:**
- Consumes: all completed tasks.
- Produces: verified branch ready to merge.

- [x] **Step 1: Run vector unit, API, and component suites.**
- [x] **Step 2: Run `pnpm ts-check`.**
- [x] **Step 3: Run targeted ESLint with zero errors.**
- [x] **Step 4: Run `pnpm build`.**
- [ ] **Step 5: Start the local application and use a real browser to verify panel layout, mode switching, conflicts, responsive width, and disabled capability states.**
- [x] **Step 6: Review the diff for unrelated changes and mark this plan's completed checkboxes.**
- [ ] **Step 7: Merge the feature branch into `main`, push the exact tested commit, and verify local and remote heads match.**

## Verification Record

- Vector, route-runtime, authorization, SSRF, task-state, and component tests: 78 passed.
- Targeted ESLint: 0 errors, 0 warnings.
- Full `pnpm lint:build`: 14 pre-existing errors in admin credits pricing, brand IP, brand packaging, display 3D, simple-chat model comparison, and AI PSD; none are in this feature's changed files.
- `pnpm ts-check`: passed.
- `pnpm build`: passed; `/api/vector-design` included in the production route manifest.
- Real Chrome production smoke test: landing and login UI rendered without console-visible white screen. The vector panel itself remains pending cloud verification because the local checkout has no `DATABASE_URL` and therefore cannot authenticate.
- Full historical cloud-task persistence suite still has 2 unrelated assertion failures caused by exact nested-result matching; no files involved in those failures were changed by this feature.
- Recraft protocol source: current official Endpoints and Styles documentation, verified 2026-07-28.

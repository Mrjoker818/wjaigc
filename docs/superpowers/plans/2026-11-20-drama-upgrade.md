# Drama Workbench Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Deliver the approved existing-script-to-film upgrade while retaining authorization, billing, persistence and completed media.

**Architecture:** Extend the existing drama document and workbench. Pure source parsing and change detection feed authenticated APIs and existing generation jobs; no second application or imported competitor implementation.

**Tech Stack:** Next.js 16, React 19, TypeScript, PostgreSQL, existing mammoth/JSZip, Vitest, existing media/task framework.

**Spec:** `docs/superpowers/specs/2026-11-20-drama-upgrade-design.md`

## Global Constraints

- Baseline 83a19b79; branch codex/drama-upgrade-20261120; keep original branches, running processes and desktop profile untouched.
- No business databases, destructive migrations, forced pushes, stable edits or unreviewed deployment.
- Do not copy huobao code/prompts/assets; independently implement the approved flow.
- Tests use a newly owned loopback PostgreSQL profile and four matching dedicated test database aliases; preserve all existing database protections.
- Preserve raw source, author-controlled dialogue, old projects and completed media histories.

## Tasks and checkpoints

### 1. Source import and provenance
- [ ] Add failing pure tests for multiple scenes/episodes, repeated names, exact dialogue preservation, CRLF and unsupported/oversized files.
- [ ] Implement `src/lib/drama/source-script.ts`: `parseSourceScript(text, options) -> SourceScriptPreview` with `{doc,warnings,stats}`; metadata follows the design.
- [ ] Implement bounded TXT/DOCX extraction and authenticated `/api/drama/import-script` preview API; no project writes during preview.
- [ ] Extend drama document types/schema for optional source metadata and validate offsets/references.
- [ ] Run targeted tests and independent review.

### 2. Existing-script UI and body/scene linkage
- [ ] Add component tests before UI changes.
- [ ] Add `DramaSourceForm` to the start page, preview original text/parsed counts/warnings, then create via existing API.
- [ ] Add script-step structural refresh and impacted-scene preview while preserving previous IDs/takes where matched.
- [ ] Update planner context to consume the current scene's source text and block obsolete structured source.
- [ ] Test old project compatibility, imports, cancellation and long/narrow-screen content.

### 3. Input versions, model choice and quote validity
- [ ] Add failing tests for dialogue/speaker/voice/reference/model changes and unchanged-input reuse.
- [ ] Implement dependency snapshots and stale-production indicators; keep previous takes and block obsolete film readiness.
- [ ] Bind planning to exact authorized `providerId + model`; add visible project-level planning selection.
- [ ] Bind quote validity to complete generation configuration and source versions.
- [ ] Review authority, billing and concurrency boundaries independently.

### 4. Durable runs and delivery recovery
- [ ] Map existing task persistence and stable operation IDs; write failure/reopen tests before changes.
- [ ] Persist per-run stage checkpoints; recover original submissions and result delivery without creating a new paid operation.
- [ ] Show generation, result retrieval, storage and rendering states distinctly; preserve stop/timeout/lease guards.
- [ ] Verify controlled restart, receipt-loss and duplicate-click behavior using isolated services.

### 5. Review and complete archives
- [ ] Improve production review navigation and current/obsolete status within the incumbent design.
- [ ] Add whole-project archive and explicit selected/history modes, file/reference manifest checks and import round-trip tests.
- [ ] Retain existing subtitle/music/trim/transitions and test representative real-media output.

### 6. Integration and delivery
- [ ] Run affected regression, type/lint/build and both release checks; review the full branch.
- [ ] Record baselines, exact test evidence and remaining external prerequisites in the ledger.
- [ ] Check upstream/ZCode changes before serial integration; synchronize only approved related files.
- [ ] Verify matching Coze source/build and use an independent preview page for UI acceptance; do not claim paid supplier acceptance from synthetic tests.

## Execution ledger

- 2026-11-20: user approved the preceding analysis and implementation. Existing isolated checkout was clean and had no referencing Node/Electron processes; switched to a new branch from origin/main, preserving the prior release branch. No extra worktree created.
- Design direction: retain the current dark/gold operate UI; add focused source import/review rather than a new application shell. Existing PRODUCT.md/DESIGN.md loaded.

### Implementation checkpoint

Tasks 1–5 are implemented in the upgrade branch. Integrated drama regression: 394 tests across 44 files passed in the dedicated owned PostgreSQL environment (`output/drama-upgrade/tests-CIJTcX`). Subsequent review fixes were verified with targeted source, archive, existing-workbench and receipt tests. Global TypeScript and changed-file ESLint checks passed; the UI detector returned no findings. Production build, built-package checks and standalone Edge acceptance follow after sealing the candidate commit.

Independent review corrections cover predecessor frame/continuity dependencies, dirty source offsets, bounded version records, original receipt identity in legacy and async entry, stop during save, quote frame counts, unknown upstream results, deleted source-role references, manual scene metadata and complete dialogue coverage. Snapshots use a pinned, existing graph dependency rather than embedding long source copies. Historical archive imports rebind only outputs that were current before media URL remapping.

User guide: `docs/drama-existing-script-workflow.md`. Detailed transient execution evidence and final build/preview results are kept in this plan's isolated ledger under `.superpowers/sdd/2026-11-20-drama-upgrade/`.

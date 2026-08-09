# 无界共享稳定内核阶段 0 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans or superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** 在不修改业务行为的前提下，固定 `origin/main` 的发布基线，建立覆盖七个产品表面的受保护功能目录、界面证据、旧项目样本和发布阻断门禁。

**Architecture:** 阶段 0 采用“静态发现 + 人工契约 + Git 基线比较”三层模型。静态发现扫描路由、页面、组件、工具栏动作、节点类型和 Agent 工具；人工契约补充无法由命名推断的仪表盘、公开页面、桌面端、连接器和数据能力；发布门禁比较当前候选与已验证基线，任何受保护入口减少或动作解绑都阻断发布。

**Tech Stack:** Node.js 运行脚本、TypeScript/Next.js 源码扫描、JSON 基线、Markdown 报告、Playwright 证据目录、Git SHA。

## Global Constraints

- 唯一代码基线是 `origin/main`，当前远端 SHA 为 `69ba94ef6bde041293ad9609ec76285d3e287a7f`。
- 本阶段不修改供应商调用、任务状态、积分、登录、画布、节点、聊天或任何业务链路。
- 现有功能、入口、路由、节点类型、Agent 工具、仪表盘和公开页面不得减少或被无声隐藏。
- 未经真实浏览器、数据库和云端验证的条目只能标记为“未验证”或“阻塞”。
- 参考仓库、Playwright 缓存和本地临时文件不得进入发布提交。
- 所有证据必须记录 Git SHA、部署地址、浏览器、视口和采集时间。

---

### Task 1: 固定版本与工作区边界

**Files:**
- Create: `docs/testing/baselines/2026-08-08-baseline.json`
- Create: `docs/testing/baselines/README.md`
- Modify: `docs/superpowers/specs/2026-08-08-wujie-stable-core-upgrade-design.md` only if the self-review finds a contradiction

**Interfaces:**
- Produces a machine-readable baseline consumed by the inventory and release-gate scripts.
- Baseline fields: `remote`, `branch`, `commit`, `packageVersion`, `generatedAt`, `worktreePolicy`, `excludedPaths`.

- [ ] **Step 1: Record the remote baseline**

Run:

```powershell
git fetch origin main
git rev-parse origin/main
git status --short --branch
```

Expected: the recorded SHA equals `69ba94ef6bde041293ad9609ec76285d3e287a7f`; any local worktree differences are listed separately and are not silently discarded.

- [ ] **Step 2: Write the baseline metadata**

Use the discovered SHA and package version from `package.json`. Keep `.playwright-cli/`, `_refs-*` and local test output outside the protected source set.

- [ ] **Step 3: Verify the baseline is reproducible**

Run:

```powershell
git diff --exit-code origin/main -- src package.json pnpm-lock.yaml
```

Expected: exit code `0` for business source; documentation-only local changes must not be treated as source drift.

- [ ] **Step 4: Commit the baseline documents**

```powershell
git add docs/testing/baselines/2026-08-08-baseline.json docs/testing/baselines/README.md
git commit -m "test: record stable-core baseline"
```

### Task 2: Build the protected feature inventory

**Files:**
- Create: `docs/testing/baselines/protected-features.json`
- Create: `docs/testing/PROTECTED_FEATURES.md`
- Modify: `scripts/generate-function-inventory.mjs`
- Test: `src/__tests__/scripts/function-inventory.test.ts`

**Interfaces:**
- `protected-features.json` is the source of truth for stable `featureId` values.
- Each entry contains `featureId`, `surface`, `workspace`, `name`, `entrances`, `routes`, `components`, `actions`, `resultKinds`, `preservesOriginal`, `risk`, and `status`.
- Inventory generation must merge discovered entries with explicit contract entries and fail on duplicate `featureId` values.

- [ ] **Step 1: Add a failing inventory contract test**

The test must assert that the generated baseline contains all seven surfaces: `identity`, `creator-dashboard`, `admin-dashboard`, `workspaces`, `public-delivery`, `desktop-connectors`, and `support-operations`; it must also assert the three workspaces `canvas`, `workflow`, and `chat`.

- [ ] **Step 2: Replace corrupted hand-written display text**

Rewrite the inventory generator source strings as UTF-8 Chinese or stable ASCII identifiers. Do not change runtime code. The generator must scan:

```text
src/app/**/page.tsx
src/app/**/route.ts
src/components/**
src/lib/agent-engine.ts
src/lib/workflow-engine.ts
```

It must report routes, pages, components, NodeType literals, registered Agent tools, toolbar action identifiers, and explicit protected contract entries.

- [ ] **Step 3: Implement duplicate and deletion checks**

The generator must exit non-zero when an entry has no `featureId`, when a `featureId` is duplicated, or when the current candidate removes an entry from the checked-in protected baseline without an explicit `removalApproved` record.

- [ ] **Step 4: Run the inventory test and generator**

```powershell
pnpm exec vitest run src/__tests__/scripts/function-inventory.test.ts
pnpm test:inventory
```

Expected: the test passes, `docs/testing/FUNCTION_INVENTORY.md` is regenerated with the current commit, and the report states that static discovery is not equivalent to real browser success.

- [ ] **Step 5: Commit the protected inventory**

```powershell
git add scripts/generate-function-inventory.mjs src/__tests__/scripts/function-inventory.test.ts docs/testing/PROTECTED_FEATURES.md docs/testing/baselines/protected-features.json docs/testing/FUNCTION_INVENTORY.md
git commit -m "test: add protected feature inventory baseline"
```

### Task 3: Add evidence and sample-project manifest

**Files:**
- Create: `docs/testing/baselines/compatibility-samples.json`
- Create: `docs/testing/evidence/README.md`
- Create: `tests/helpers/evidence-manifest.ts`
- Test: `tests/unit/evidence-manifest.spec.ts`

**Interfaces:**
- Compatibility sample records identify the sample type, required artifacts, expected persistence behavior, and verification status.
- `writeEvidenceManifest(input)` writes JSON containing `commit`, `deploymentUrl`, `browser`, `viewport`, `capturedAt`, `featureId`, `artifactPaths`, `requestIds`, and `status`.

- [ ] **Step 1: Define fixed compatibility samples**

Include at least: single image, transparent PNG, 100-node canvas, image group, reference-image group, fusion group, annotation, video task, 3D task, PSD/layered task, node workflow, chat history, failed task, cancelled task, and a project with invalid media.

- [ ] **Step 2: Write the manifest test first**

Assert that a manifest refuses missing `commit`, `deploymentUrl`, `featureId`, or evidence paths, and accepts a completed record only when screenshot, console, network, and task evidence paths are present.

- [ ] **Step 3: Implement deterministic evidence directories**

Use:

```text
test-results/evidence/<commit>/<featureId>/<browser>/<timestamp>/
```

Store screenshots, videos, traces, console logs, network logs, and server/request metadata without secrets or private image bytes.

- [ ] **Step 4: Run the evidence test**

```powershell
pnpm exec vitest run tests/unit/evidence-manifest.spec.ts
```

Expected: invalid manifests fail with actionable messages; valid manifests pass without any fixed sleep requirement.

- [ ] **Step 5: Commit the evidence contract**

```powershell
git add docs/testing/baselines/compatibility-samples.json docs/testing/evidence/README.md tests/helpers/evidence-manifest.ts tests/unit/evidence-manifest.spec.ts
git commit -m "test: define compatibility samples and evidence manifests"
```

### Task 4: Add the stage-0 release gate

**Files:**
- Create: `scripts/check-protected-baseline.mjs`
- Modify: `package.json`
- Test: `tests/unit/protected-baseline-gate.spec.ts`
- Create: `.github/workflows/stage-0-quality.yml`

**Interfaces:**
- CLI: `pnpm check:protected-baseline [--base <sha>] [--candidate <sha>]`.
- Output categories: `PASS`, `WARN`, `BLOCK`.
- A removed protected feature, missing evidence contract, unconfirmed commit, or source drift outside the approved scope must produce exit code `1`.

- [ ] **Step 1: Write gate tests**

Cover: identical baseline passes; added feature warns but passes; removed feature blocks; duplicate IDs block; untracked protected source changes block; documentation-only changes remain allowed.

- [ ] **Step 2: Implement the gate**

Compare the JSON baseline, source file list, and protected feature IDs. Never compare generated timestamps. Ignore only paths explicitly listed in `excludedPaths`; do not ignore business source directories.

- [ ] **Step 3: Add the package command**

Add:

```json
"check:protected-baseline": "node scripts/check-protected-baseline.mjs"
```

- [ ] **Step 4: Add CI execution**

The workflow must run on pushes and pull requests, install with the repository lockfile, run the baseline gate, and upload the generated inventory and evidence manifests. It must not claim that real provider, PostgreSQL, or cloud tests passed when credentials are absent.

- [ ] **Step 5: Run the gate locally**

```powershell
pnpm check:protected-baseline -- --base origin/main --candidate HEAD
```

Expected: the current documentation-only worktree is reported as allowed; any business source drift is listed explicitly.

- [ ] **Step 6: Commit the gate**

```powershell
git add scripts/check-protected-baseline.mjs package.json tests/unit/protected-baseline-gate.spec.ts .github/workflows/stage-0-quality.yml
git commit -m "ci: block protected feature regressions"
```

### Task 5: Establish browser evidence capture without claiming business success

**Files:**
- Modify: `playwright.config.ts`
- Modify: `tests/e2e/p0-core.spec.ts`
- Create: `tests/e2e/stage-0-evidence.spec.ts`
- Modify: `docs/testing/TEST_PLAN.md`
- Create: `docs/testing/UNVERIFIED_ITEMS_STAGE_0.md`

**Interfaces:**
- Every stage-0 browser test records commit, deployment URL, browser project, viewport, console, network, screenshot, video, and trace.
- Cloud provider, PostgreSQL concurrency, payment, and authenticated production flows remain `UNVERIFIED` until real credentials and deployment evidence are supplied.

- [ ] **Step 1: Configure artifact retention**

Use Playwright `trace: 'retain-on-failure'`, `video: 'retain-on-failure'`, and screenshot capture on failed tests. Console and network logs must be written through test fixtures, not through arbitrary sleeps.

- [ ] **Step 2: Add the stage-0 evidence smoke**

The smoke must only verify page reachability, route identity, and absence of immediate uncaught browser errors. It must not label image generation, billing, or provider behavior as passed.

- [ ] **Step 3: Run the evidence smoke**

```powershell
pnpm exec playwright test tests/e2e/stage-0-evidence.spec.ts --project=chromium
```

Expected: artifacts are written under `test-results/evidence/`; unavailable cloud URLs are recorded as blocked rather than retried indefinitely.

- [ ] **Step 4: Update the unverified report**

List every feature without real browser evidence, provider credentials, isolated PostgreSQL, object storage, or payment sandbox evidence. Do not convert static discovery into a pass.

- [ ] **Step 5: Commit stage-0 evidence wiring**

```powershell
git add playwright.config.ts tests/e2e/p0-core.spec.ts tests/e2e/stage-0-evidence.spec.ts docs/testing/TEST_PLAN.md docs/testing/UNVERIFIED_ITEMS_STAGE_0.md
git commit -m "test: establish stage-0 browser evidence capture"
```

### Checkpoint: Stage 0 release gate

- [ ] `origin/main` SHA, local candidate SHA, and cloud runtime SHA are recorded and distinguishable.
- [ ] Protected feature inventory covers seven product surfaces and three workspaces.
- [ ] Generator is UTF-8 and reports static discovery separately from real verification.
- [ ] Compatibility samples and evidence manifests exist.
- [ ] Protected baseline gate passes on documentation-only changes and blocks feature removal.
- [ ] Playwright evidence smoke produces artifacts or a clear `BLOCKED` record.
- [ ] `UNVERIFIED_ITEMS_STAGE_0.md` contains no implicit passes.

## Risks and Mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Existing inventory script contains corrupted display strings | High | Rewrite only the generator/reporting layer and add UTF-8 tests before using its output as evidence. |
| Manual feature contract misses an entry | High | Combine static discovery with the contract and fail on unregistered routes, tools, node types, and toolbar actions. |
| GitHub, local and cloud commits diverge | High | Record all three SHAs and block release when the runtime SHA cannot be confirmed. |
| Existing browser artifacts are stale | Medium | Add commit and timestamp to every evidence manifest; never reuse old artifacts as current evidence. |
| Stage-0 tooling changes business source accidentally | High | Run the protected source diff gate after every task and keep business files outside the stage-0 write set. |

## Open Questions Resolved for This Stage

- The first implementation target is stage 0, not the stable-core runtime. This is required because the protected feature baseline does not yet exist.
- The seven product surfaces are identity/permissions, creator dashboard, admin dashboard, three workspaces, public delivery, desktop/connectors, and support/operations.
- Existing features are preserved by default; removal requires an explicit reviewed baseline change and cannot happen through a UI cleanup.

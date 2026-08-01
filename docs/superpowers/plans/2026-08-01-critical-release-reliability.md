# Critical Release Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the confirmed administrator credential-autofill risk, prevent Coze cold-start work from exceeding the runtime startup budget, and keep multi-image creation usable when its optional prompt compiler is unavailable.

**Architecture:** The administrator drawer remains a controlled React form but gains explicit creation-form autocomplete semantics and one reset function shared by opening, closing, and successful submission. Coze installation/build/doctor work remains in the build phase, while the runtime script only performs a constant-time artifact preflight and starts Next. Quick Create continues to prefer the authorized chat compiler; if that compiler cannot provide a valid plan, its API returns a clearly marked deterministic fallback plan that preserves the user-selected image parameters so the existing generation path can proceed.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Vitest, Zod, pnpm, Coze FaaS.

## Global Constraints

- Follow TDD: every production change must have a focused test that was observed failing first.
- Do not log, persist, screenshot, or expose passwords, API keys, access tokens, or provider upstream errors.
- Do not add client-side delays to mask cloud startup failures.
- Keep existing image-provider authorization, requested `outputCount`, aspect ratio, and quality unchanged in compiler fallback.
- Do not change unrelated canvas, authentication, billing, or provider routing behavior.

---

### Task 1: Prevent administrator credential autofill in the new-user form

**Files:**
- Modify: `src/components/dashboard/admin-tabs.tsx:267-271,834,1226-1246`
- Create: `src/__tests__/components/admin-user-create-form-contract.test.ts`

**Interfaces:**
- Produces `resetNewUserForm(): void`, used by the new-user drawer open, close, overlay close, and successful create paths.
- The three text fields remain controlled by `newUserName`, `newUserPassword`, and `newUserEmail`.

- [ ] **Step 1: Write the failing test**

```ts
it('uses empty creation-form state and password-manager-safe autocomplete values', () => {
  expect(source).toContain("const resetNewUserForm = useCallback(() => {");
  expect(source).toContain("setNewUserName('');");
  expect(source).toContain("setNewUserPassword('');");
  expect(source).toContain("autoComplete=\"new-username\"");
  expect(source).toContain("autoComplete=\"new-password\"");
  expect(source).toContain("onClick={openUserAddDrawer}");
  expect(source).toContain("onClick={closeUserAddDrawer}");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/__tests__/components/admin-user-create-form-contract.test.ts`

Expected: FAIL because the current drawer has no reset helper and no creation-form autocomplete values.

- [ ] **Step 3: Write minimal implementation**

```ts
const resetNewUserForm = useCallback((): void => {
  setNewUserName('');
  setNewUserPassword('');
  setNewUserEmail('');
  setNewUserGroupId('');
}, []);

const openUserAddDrawer = useCallback((): void => {
  resetNewUserForm();
  setShowUserAddDrawer(true);
}, [resetNewUserForm]);

const closeUserAddDrawer = useCallback((): void => {
  resetNewUserForm();
  setShowUserAddDrawer(false);
}, [resetNewUserForm]);
```

Wrap the new-user inputs in `<form autoComplete="off">`, use `autoComplete="new-username"` for the username, `autoComplete="new-password"` for the password, and `autoComplete="email"` for email. Use `closeUserAddDrawer` on each closing path. Keep the create operation unchanged except replace manual clearing with `closeUserAddDrawer()`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/__tests__/components/admin-user-create-form-contract.test.ts src/__tests__/components/admin-user-batch-delete-contract.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/dashboard/admin-tabs.tsx src/__tests__/components/admin-user-create-form-contract.test.ts
git commit -m "fix: prevent admin credential autofill in user creation"
```

### Task 2: Keep Coze runtime startup within the FaaS startup budget

**Files:**
- Modify: `scripts/coze-start.sh`
- Modify: `src/__tests__/scripts/coze-start-production-contract.test.ts`
- Modify: `src/__tests__/scripts/coze-production-preview-contract.test.ts`

**Interfaces:**
- `scripts/coze-preview-build.sh` remains responsible for installing dependencies and building Next.
- `scripts/coze-start.sh` exits quickly with an actionable stderr message when `.next/BUILD_ID` or `node_modules/.bin/next` is absent, otherwise executes the production server.

- [ ] **Step 1: Write the failing test**

```ts
it('starts only an already-built production server and keeps install/build/doctor out of runtime startup', () => {
  expect(source).toContain('if [ ! -s ".next/BUILD_ID" ]; then');
  expect(source).toContain('if [ ! -x "node_modules/.bin/next" ]; then');
  expect(source).toContain('exec ./node_modules/.bin/next start -p 5000 -H 0.0.0.0');
  expect(source).not.toContain('pnpm install');
  expect(source).not.toContain('pnpm run build');
  expect(source).not.toContain('pnpm run doctor');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/__tests__/scripts/coze-start-production-contract.test.ts src/__tests__/scripts/coze-production-preview-contract.test.ts`

Expected: FAIL because the runtime script currently runs install/build/doctor before calling `pnpm run start`.

- [ ] **Step 3: Write minimal implementation**

```bash
if [ ! -s ".next/BUILD_ID" ]; then
  echo "[coze-start] Missing production build. The Coze build phase must complete before runtime startup." >&2
  exit 1
fi

if [ ! -x "node_modules/.bin/next" ]; then
  echo "[coze-start] Missing production dependencies. The Coze build phase must install dependencies before runtime startup." >&2
  exit 1
fi

exec ./node_modules/.bin/next start -p "${PORT:-5000}" -H 0.0.0.0
```

Update the tests so the preview build contract still requires dependency installation and `pnpm run build`, while the runtime contract asserts that no expensive preparation command is present.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/__tests__/scripts/coze-start-production-contract.test.ts src/__tests__/scripts/coze-production-preview-contract.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/coze-start.sh src/__tests__/scripts/coze-start-production-contract.test.ts src/__tests__/scripts/coze-production-preview-contract.test.ts
git commit -m "fix: keep Coze runtime startup build-free"
```

### Task 3: Degrade Quick Create compilation safely to the raw user request

**Files:**
- Modify: `src/lib/quick-create-compile.ts`
- Modify: `src/app/api/quick-create/compile/route.ts`
- Modify: `src/components/quick-create-panel.tsx`
- Modify: `src/__tests__/api/quick-create-compile.test.ts`
- Modify: `src/__tests__/lib/quick-create-compile.test.ts`

**Interfaces:**
- Add `mode: 'compiled' | 'fallback'` to `QuickCreateCompileResult`.
- Add `createQuickCreateFallbackResult(request, metadata)` that returns a valid plan preserving `prompt`, `aspectRatio`, `quality`, and `outputCount`.
- The API emits a regular `result` SSE event with `mode: 'fallback'` after compiler failure, followed by `done`.
- The panel presents the fallback state as a warning and still invokes the existing image-generation request.

- [x] **Step 1: Write the failing tests**

```ts
it('returns a fallback plan that preserves all user-selected generation parameters', () => {
  expect(createQuickCreateFallbackResult(request, metadata)).toMatchObject({
    mode: 'fallback',
    positivePrompt: request.prompt,
    aspectRatio: request.aspectRatio,
    quality: request.quality,
    outputCount: request.outputCount,
  });
});

it('emits a fallback result instead of an error when the authorized compiler stream fails', async () => {
  mocks.stream.mockImplementation(() => {
    throw new Error('upstream network failure');
  });

  const events = await readSse(await POST(request({ outputCount: 3 })));

  expect(events).toContainEqual(expect.objectContaining({
    type: 'result',
    result: expect.objectContaining({ mode: 'fallback', outputCount: 3 }),
  }));
  expect(events).not.toContainEqual(expect.objectContaining({ type: 'error' }));
});
```

- [x] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run src/__tests__/lib/quick-create-compile.test.ts src/__tests__/api/quick-create-compile.test.ts`

Expected: FAIL because the result has no mode/fallback helper and the API currently emits `COMPILE_FAILED`.

- [x] **Step 3: Write minimal implementation**

```ts
export function createQuickCreateFallbackResult(
  request: QuickCreateCompileRequest,
  metadata: Pick<QuickCreateCompileResult, 'model' | 'providerId' | 'providerName' | 'modelSource'>,
): QuickCreateCompileResult {
  return {
    summary: '已按原始创作需求提交生成。',
    strategy: '专业提示词编译暂不可用，保留用户的原始提示词和已选生成参数。',
    directions: [{ title: '原始需求', description: request.prompt, visualKeywords: ['原始提示词'] }],
    positivePrompt: request.prompt,
    negativePrompt: '',
    aspectRatio: request.aspectRatio,
    quality: request.quality,
    outputCount: request.outputCount,
    ...metadata,
    mode: 'fallback',
  };
}
```

Return this result only after authentication, authorization, input validation, and image parameter validation have already succeeded. Preserve compiler failures in server logs with redacted context; do not send upstream details to the client. A valid LLM result uses `mode: 'compiled'`. The UI warning must state that the original request is being submitted without professional compilation.

- [x] **Step 4: Run tests to verify they pass**

Run: `pnpm exec vitest run src/__tests__/lib/quick-create-compile.test.ts src/__tests__/api/quick-create-compile.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/quick-create-compile.ts src/app/api/quick-create/compile/route.ts src/components/quick-create-panel.tsx src/__tests__/api/quick-create-compile.test.ts src/__tests__/lib/quick-create-compile.test.ts
git commit -m "fix: submit quick creation when prompt compiler is unavailable"
```

### Task 4: Verify, document, release, and run deployed regression

**Files:**
- Modify: `docs/testing/BUG_REGISTER_2026-08-01.md`
- Modify: `docs/testing/REGRESSION_REPORT_2026-08-01.md`
- Modify: `docs/testing/RELEASE_READINESS_REPORT_2026-08-01.md`
- Modify: `docs/testing/UNVERIFIED_ITEMS_2026-08-01.md`

- [x] **Step 1: Run focused test suite**

Run:

```bash
pnpm exec vitest run \
  src/__tests__/components/admin-user-create-form-contract.test.ts \
  src/__tests__/components/admin-user-batch-delete-contract.test.ts \
  src/__tests__/scripts/coze-start-production-contract.test.ts \
  src/__tests__/scripts/coze-production-preview-contract.test.ts \
  src/__tests__/lib/quick-create-compile.test.ts \
  src/__tests__/api/quick-create-compile.test.ts
```

Expected: PASS with no failures.

- [x] **Step 2: Run project verification**

Run:

```bash
pnpm ts-check
pnpm lint --quiet
pnpm test
pnpm build
```

Expected: record all failures precisely. Do not claim repository-wide lint cleanliness unless the command returns zero errors.

- [x] **Step 3: Update release evidence**

Record the commit, commands, results, known inherited test/lint debt, deployment preconditions, and browser regression steps. Mark `AUD-20260801-041`, `AUD-20260801-044`, and `AUD-20260801-045` as code-fixed only after focused tests pass; leave them pending deployed browser validation until the cloud instance runs the pushed commit.

- [ ] **Step 4: Commit and push verified source**

```bash
git add scripts/coze-start.sh src/components/dashboard/admin-tabs.tsx \
  src/lib/quick-create-compile.ts src/app/api/quick-create/compile/route.ts \
  src/components/quick-create-panel.tsx src/__tests__ docs/superpowers/plans \
  docs/testing/BUG_REGISTER_2026-08-01.md docs/testing/REGRESSION_REPORT_2026-08-01.md \
  docs/testing/RELEASE_READINESS_REPORT_2026-08-01.md docs/testing/UNVERIFIED_ITEMS_2026-08-01.md
git commit -m "fix: harden release-critical user and startup flows"
git push origin main
```

- [ ] **Step 5: Run cloud browser regression after Coze deployment**

Verify with the already-authenticated browser:

1. Open Administrator → User Management → Add User; verify all creation fields are blank, then close without submitting.
2. Open Dashboard → New Chat twice, including one cold attempt; verify the page reaches the input area without raw function JSON.
3. Select an authorized image model, choose count `3`, submit the known non-sensitive cube prompt, and verify either compiled or explicitly fallback state is followed by creation of an application task. Verify final image/task count and billing ledger after the provider completes.

Save screenshots, console logs, and network evidence under `test-results/` and update the three defect records with deployed evidence.

## Self-Review

- Spec coverage: Task 1 covers the P0 credential-autofill defect. Task 2 covers the confirmed Coze cold-start boundary. Task 3 covers the stable Quick Create compiler failure and preserves multi-image parameters. Task 4 records verification and deployment evidence.
- Placeholder scan: no TODO/TBD or generic error-handling steps are present.
- Type consistency: Task 3 defines `mode` and `createQuickCreateFallbackResult` before the route and panel consume them.

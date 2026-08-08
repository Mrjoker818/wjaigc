# S1 Task 4 Report: Atomic Idempotency and One-Time Billing

## Scope

- Worktree: `J:\无界本地版\projects\_upstream-wjaigc-restore\.worktrees\wj-stable-s1`
- Branch: `codex/wj-stable-s1`
- Required starting commit: `00ec56f6ce84f2c3c515e79d5132e169cb5b1b55`
- Review-fix base commit: `f54b7ec62a1d4d61053999d76d32f27b0080f5bb`
- Date: 2026-08-08
- Task boundary: Task 4 only. Tasks 5-7 were not entered.

## Original RED Evidence

Initial command:

```powershell
pnpm exec vitest run src/__tests__/lib/task-billing.test.ts tests/integration/task-billing-concurrency.test.ts
```

Observed RED:

- `src/__tests__/lib/task-billing.test.ts` failed because
  `@/lib/task-core/billing-service` did not exist.
- The authoritative PostgreSQL suite did not claim success. It explicitly
  reported:

```text
BLOCKED: POSTGRES_TEST_DATABASE_URL is not configured; authoritative task billing PostgreSQL tests skipped.
```

A second focused RED was captured for terminal projection:

```powershell
pnpm exec vitest run src/__tests__/lib/task-billing.test.ts
```

The cancellation test failed because the database `cancelled` winner was
projected to the legacy registry as `failed`. The minimal implementation now
preserves `cancelled`; `timeout` remains projected as `failed` because the
legacy registry has no `timeout` status.

## Independent Review RED

After the first Task 4 commit, the review identified two unsafe boundaries:

1. `ensureCoreTables()` and `ensureCloudTaskTables()` could execute their DDL
   concurrently during a 20-request cold start.
2. A legacy task with neither `request_digest` nor `result.requestHash` could
   be silently bound to a new request and reused without a verifiable charge
   relationship.

The review tests were added before the fix and run with:

```powershell
pnpm exec vitest run src/__tests__/lib/task-billing.test.ts tests/integration/task-billing-concurrency.test.ts
```

Observed RED:

- Core table initialization executed 20 times instead of once.
- Cloud task table initialization executed 20 times instead of once.
- Legacy empty-digest reuse attempted `UPDATE request_digest` instead of
  raising an idempotency conflict.
- Result: `3 failed`, `7 passed`, `1 skipped`.
- The skipped real PostgreSQL test explicitly reported `BLOCKED`.

## Implementation

### Idempotency

- Added validated `userId`, `idempotencyKey`, and `requestDigest` identities.
- Added `IdempotencyConflictError` with
  `code=IDEMPOTENCY_CONFLICT` and HTTP-mappable status `409`.
- Serialized same-user, same-key creation through a PostgreSQL transaction
  advisory lock.
- Reuses the existing task only for the same verifiable digest.
- Rejects the same key with a different digest.
- Preserves compatibility with legacy tasks whose verifiable digest was stored
  as `result.requestHash`.
- Fails closed when both legacy digest locations are empty. The request raises
  `IdempotencyConflictError` with `existingDigest=legacy-unknown`; it does not
  mutate or silently reuse the old task.

### Concurrent Initialization

- `ensureCoreTables()` and `ensureCloudTaskTables()` each use a module-level
  shared initialization `Promise`.
- Concurrent callers await the same initialization operation instead of
  running duplicate DDL.
- A rejected initialization clears the shared promise, allowing the next call
  to retry.
- Unit tests cover 20 concurrent callers, shared rejection, and successful
  retry for both initialization paths.

### Atomic Task Creation and Charge

- Added `createBillableTask(...)` and its PostgreSQL storage operation.
- Task insertion, credit row lock, balance deduction, and ledger insertion
  occur inside one explicit `BEGIN` / `COMMIT` transaction.
- Insufficient balance rolls the transaction back and exposes an HTTP-mappable
  `INSUFFICIENT_CREDITS` error.
- Charge transaction IDs are deterministic per task.

### One-Time Terminal Settlement and Refund

- Added `settleFailedTask(...)` for `failed`, `cancelled`, and `timeout`.
- Locks the task row before evaluating terminal transitions.
- Only the first legal non-terminal to failure-terminal transition wins.
- Credit row lock, refund, refund ledger record, and terminal task update share
  one transaction.
- Refund transaction IDs are deterministic per task.
- Only the database winner is projected into the legacy in-memory registry.

### Additive Database Compatibility

- Added `cloud_tasks.request_digest`.
- Added `cloud_tasks.charged_transaction_id`.
- Added `cloud_tasks.refunded_transaction_id`.
- Added partial unique indexes for charge/refund transaction references.
- Added `wujie_credit_transactions.task_id` through the existing additive
  migration list.
- Added a partial unique ledger index restricted to new Task 4 deterministic
  transaction IDs, so historical rows do not block deployment.
- No legacy column or route was removed.

## Verification

### Focused and Related Regression

Command:

```powershell
pnpm exec vitest run src/__tests__/lib/task-billing.test.ts tests/integration/task-billing-concurrency.test.ts src/__tests__/lib/cloud-task-storage.test.ts src/__tests__/lib/task-state.test.ts src/__tests__/lib/db-storage-credit-schema.test.ts tests/integration/task-state-postgres.test.ts
```

Result:

- `163 passed`
- `2 skipped`
- Both skips explicitly report missing `POSTGRES_TEST_DATABASE_URL`.

The Task 4 PostgreSQL test now covers these scenarios when
`POSTGRES_TEST_DATABASE_URL` is available:

- Empty-schema cold start with 20 concurrent submissions.
- Same-key and same-digest 20-request reuse with one task and one charge.
- Same-key and different-digest conflict.
- Insufficient balance transaction rollback.
- Task primary-key conflict transaction rollback.
- Zero-credit task creation without a ledger entry.
- Completed task rejecting a later failure/refund.
- Legacy empty-digest task rejecting reuse.
- Forced ledger insertion failure rolling back task and balance changes.
- Concurrent `failed` / `cancelled` / `timeout` allowing one terminal winner
  and one refund.

### TypeScript

```powershell
pnpm ts-check
```

Result: passed.

### Changed-File ESLint

```powershell
pnpm exec eslint src/lib/task-core/idempotency.ts src/lib/task-core/billing-service.ts src/lib/cloud-task-storage.ts src/lib/credits.ts src/lib/db-storage.ts src/__tests__/lib/task-billing.test.ts tests/integration/task-billing-concurrency.test.ts
```

Result:

- `0 errors`
- `6 warnings`
- The warnings are pre-existing unused-variable warnings in `credits.ts` and
  `db-storage.ts`; Task 4 did not expand into unrelated cleanup.

### Diff Check

```powershell
git diff --check
```

Result: passed. Git emitted only working-copy line-ending notices.

### Protected Baseline

Command:

```powershell
pnpm check:protected-baseline -- --base e5867f0 --candidate HEAD <exact S1 Task 1-4 allow-path arguments>
```

The gate evaluates committed changes plus the current staged/working-tree
changes. Result:

- All 38 baseline feature IDs remain present.
- No unapproved source drift was detected.
- All literal protected component paths are present.
- All required evidence contracts are present.
- Base and candidate Git refs are confirmed.
- Release gate completed with `0 warning(s)`.

## Blockers

### BLOCKED: Authoritative PostgreSQL Concurrency

`POSTGRES_TEST_DATABASE_URL` is not configured. Therefore this task cannot
claim real PostgreSQL proof for:

- Empty-schema 20-request initialization.
- 20 concurrent same-key submissions reusing one task.
- Exactly one balance deduction and one charge ledger row.
- Same-key, different-digest conflict under real concurrency.
- Concurrent `failed` / `cancelled` / `timeout` producing one terminal and one
  refund.
- Insufficient-balance, task-key-conflict, and ledger-insertion rollback.
- Zero-credit behavior, completed-task refund rejection, and legacy
  empty-digest conflict.

The integration test exists and explicitly skips with a `BLOCKED` message
instead of using a mock as evidence.

## Remaining Risk

- Unit and mocked transaction tests prove the review fixes, but authoritative
  PostgreSQL concurrency and rollback evidence remains blocked.
- The previous full repository run had seven unrelated failures outside Task
  4's permitted files. They were not hidden, deleted, skipped, or modified.
- No Task 5-7 route migration has been performed; callers must opt into the new
  service in later tasks.

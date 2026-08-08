# S1 Task 4 Report: Atomic Idempotency and One-Time Billing

## Scope

- Worktree: `J:\无界本地版\projects\_upstream-wjaigc-restore\.worktrees\wj-stable-s1`
- Branch: `codex/wj-stable-s1`
- Required starting commit: `00ec56f6ce84f2c3c515e79d5132e169cb5b1b55`
- Date: 2026-08-08
- Task boundary: Task 4 only. Tasks 5-7 were not entered.

## RED Evidence

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

The new cancellation test failed because the database `cancelled` winner was
projected to the legacy registry as `failed`. The minimal implementation now
preserves `cancelled`; `timeout` remains projected as `failed` because the
legacy registry has no `timeout` status.

## Implementation

### Idempotency

- Added validated `userId`, `idempotencyKey`, and `requestDigest` identities.
- Added `IdempotencyConflictError` with
  `code=IDEMPOTENCY_CONFLICT` and HTTP-mappable status `409`.
- Serialized same-user, same-key creation through a PostgreSQL transaction
  advisory lock.
- Reuses the existing task for the same digest.
- Rejects the same key with a different digest.
- Preserves compatibility with legacy tasks whose digest was stored as
  `result.requestHash`, and binds previously empty digests on first reuse.

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

- `160 passed`
- `2 skipped`
- Both skips explicitly report missing `POSTGRES_TEST_DATABASE_URL`.

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

### Full Test Suite

```powershell
pnpm test
```

Result:

- `1685 passed`
- `7 failed`
- `7 skipped`

The seven failures are outside Task 4's permitted files and their source files
are unchanged from the required starting commit. They cover:

1. API compatibility provider profile expectation.
2. Effect reverse cancellation expectation.
3. Pear layer adapter request-body expectation.
4. Vector design source contract expectation.
5. Image tool request integrity source contract.
6. Upscale ONNX thread-count expectation.
7. Pear video duration parsing expectation.

They remain release blockers for their owning tasks and were not hidden,
deleted, skipped, or modified here.

### Protected Baseline

Run after creating the Task 4 commit:

```powershell
pnpm check:protected-baseline -- --base e5867f0 --candidate HEAD
```

Final result is recorded below after commit verification.

## Blockers

### BLOCKED: Authoritative PostgreSQL Concurrency

`POSTGRES_TEST_DATABASE_URL` is not configured. Therefore this task cannot
claim real PostgreSQL proof for:

- 20 concurrent same-key submissions reusing one task.
- Exactly one balance deduction and one charge ledger row.
- Same-key, different-digest conflict under real concurrency.
- Concurrent `failed` / `cancelled` / `timeout` producing one terminal and one
  refund.

The integration test exists and explicitly skips with a `BLOCKED` message
instead of using a mock as evidence.

## Remaining Risk

- The implementation is covered by unit/source-contract tests and related
  regressions, but the decisive database concurrency test remains blocked.
- The full repository suite has seven unrelated failures, so the repository as
  a whole is not release-ready based on this Task 4 run.
- No Task 5-7 route migration has been performed; callers must opt into the new
  service in later tasks.

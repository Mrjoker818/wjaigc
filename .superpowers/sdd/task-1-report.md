# WJ-STABLE Stage 4 Task 1 Report

## Status

DONE LOCALLY / INDEPENDENT REVIEW PENDING

Implementation base: `255a8b6fe20924ae30ab8fd99a98393f2bcd1a52`

## Delivered

- Added the additive, checksum-managed `wujie_agent_events` PostgreSQL migration.
- Added shared Agent request, event, projection, context and tool authorization contracts.
- Added a deterministic ordered-event reducer with first-terminal-wins behavior,
  duplicate rejection, gap reporting and recursive credential rejection.
- Added PostgreSQL event append and current-user stream listing. Event append locks
  the owned `cloud_tasks` row before assigning `max(sequence)+1`.
- Added exact provider/model authorization, Asset Graph context authorization and
  existing durable task billing/cancel/refund integration.
- Added authenticated Agent run create/list/get/cancel and incremental event APIs.
- Added Doctor and migration-runner verification for the exact migration checksum,
  schema contract, concurrent runners and rollback behavior.
- Kept `stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` unchanged.

## TDD Evidence

The original implementer created the reducer, authorization and PostgreSQL tests
before completing their modules, but the stalled implementer session did not retain
its exact RED console output. This report does not invent that missing output.

The controller identified one remaining plan-level gap: the root Agent route did
not list current-user runs. Tests were added before that implementation.

RED command:

```powershell
pnpm exec vitest run src/__tests__/api/agent-runs.test.ts --reporter=verbose
```

Observed RED: `2 failed / 16 passed`. The failures were exactly the missing service
`listRuns` function and missing exported `listCurrentUserAgentRuns` function.

GREEN command:

```powershell
$env:POSTGRES_TEST_DATABASE_URL='postgresql://postgres@127.0.0.1:55433/postgres'
pnpm exec vitest run src/__tests__/lib/agent-runtime-state.test.ts src/__tests__/lib/agent-runtime-tools.test.ts src/__tests__/api/agent-runs.test.ts tests/integration/stage-4-agent-events-postgres.test.ts --reporter=verbose
```

Observed GREEN: `4 files / 53 tests passed`, including eleven real PostgreSQL
migration, ownership, ordering, idempotency, terminal-race and billing tests with
zero Task 1 skips.

## Verification

- `pnpm ts-check`: exit 0.
- `pnpm lint -- --quiet`: exit 0, zero ESLint errors.
- PostgreSQL-enabled `pnpm test`: `446 files / 2608 tests passed`, zero failures.
  Four tests in three unrelated suites remained explicitly skipped because they
  require their own layer/annotation database environment variables; they are not
  counted as passes.
- `pnpm build`: exit 0; Next.js generated `113/113` pages and included all three
  `/api/agent-runs` routes.
- `pnpm check:protected-baseline`: `38/38`, zero warnings.
- `git diff --check`: exit 0.

## Safety Notes

- Client API keys, tokens, passwords, cookies and credential-shaped values are
  rejected before model resolution or event persistence.
- Provider/model selection is exact and never falls back to another paid provider.
- Cross-user/project reads return no event facts and unowned appends return the same
  generic not-found contract.
- Cancellation uses the existing abort and failure-settlement service. The real
  PostgreSQL race test proves one consume, one refund, restored balance and no late
  result or Asset Graph version.
- Root run listing is bounded to 1-100 and selects only the authenticated owner's
  `agent-run` tasks before reducing their persisted event streams.

## Remaining Evidence

- Cloud exact-SHA deployment and real browser integration belong to later Stage 4
  tasks and remain unverified here.
- The four unrelated specialized PostgreSQL tests skipped by the full command remain
  visible and are not represented as Task 1 passes.

## Commit

Pending independent task review. Intended subject:
`feat: add durable shared agent runtime`.

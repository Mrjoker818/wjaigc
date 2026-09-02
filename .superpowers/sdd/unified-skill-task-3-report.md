# Unified Skill Runtime Task 3 Report

## Status

Implemented versioned, owner-scoped user Skill persistence on the existing
`wujie_user_data` account/data model. No new account system or database table was
introduced.

## Implementation

- Added `skill_catalog_v1` envelopes with schema version, atomic revision,
  user-owned Skill definitions, and `migratedLegacyIds`.
- Added a minimal PostgreSQL CAS helper on the existing
  `(user_id, data_key)` primary key. Existing rows use a revision-qualified
  `UPDATE`; missing revision-zero rows use `INSERT ... ON CONFLICT DO NOTHING`.
- Added an in-memory adapter with serialized compare-and-set semantics for unit
  tests.
- Added deterministic owner/source copy IDs, owner checks, version increments,
  enable/disable persistence, and immutable inherited surface permissions.
- Kept all built-in Skills read-only. The 21 canvas/workflow and 16 simple-chat
  presets are merged at read time and never stored in a user envelope.
- Added idempotent migration from `chat_skills`. Only non-built-in owner-authored
  entries migrate; migrated legacy IDs prevent duplicate copies.
- Added authenticated GET/POST/PATCH routes using `requireApiAuthOrReject`, exact
  three-value surface validation, strict JSON media/body parsing, field
  allowlists, bounded strings, and stable 400/404/409/415/500 errors.
- Cross-user updates return the same generic `SKILL_NOT_FOUND` response as an
  absent Skill and do not reveal existence.

## TDD Evidence

Initial focused run failed because the Task 3 storage and route modules did not
exist. After the minimum implementation, focused tests passed. A later RED test
reproduced a deterministic-ID collision for long owner IDs; replacing truncated
base64 encoding with an owner/source SHA-256 digest made the regression green.

## Verification

- Task 3 focused: 13 tests passed.
- Task 1/2 compatibility plus Task 3: 57 tests passed.
- TypeScript: `pnpm ts-check` passed.
- Limited ESLint: no errors. Five pre-existing unused-variable warnings remain in
  `src/lib/db-storage.ts` outside the Task 3 change.
- `git diff --check`: passed.
- PostgreSQL integration: explicitly skipped because
  `POSTGRES_TEST_DATABASE_URL` was not configured. The test does not use ambient
  `DATABASE_URL` or `PGDATABASE_URL` as a substitute.

## Database Follow-up

Real PostgreSQL contention behavior remains unverified in this environment. Run
the isolated integration test with `POSTGRES_TEST_DATABASE_URL` before release to
confirm that exactly one concurrent writer can claim revision zero.

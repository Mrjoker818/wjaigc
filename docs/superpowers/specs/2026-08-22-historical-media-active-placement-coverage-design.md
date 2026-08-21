# Historical Media Active Placement Coverage Design

**Date:** 2026-08-22
**Status:** Approved design amendment; implementation not started
**Scope:** Stage 4 `S4-BUG-014` remediation/readiness coverage only
**Parent design:** `docs/superpowers/specs/2026-08-21-historical-media-safe-archive-design.md`
**Runtime candidate:** `main@8b1293fff077b6dc0086ac305e0195af9454f2d9`
**Protected baseline:** `stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` remains untouched
**Donor rule:** V5.8.8 remains read-only

## Problem Statement

The approved archive design discovers only broken AssetVersions that are also the current version of an active Asset. Coze Task 7 read-only evidence exposed a wider readiness boundary:

- remediation discovery is stable at three versions and three active placements;
- production readiness reports two missing active placements and two false-ready active placements;
- the approved baseline expected three versions and four active placements.

The readiness query counts every active placement referencing a bad version, while remediation discovery joins through `asset.current_version_id`. An active placement referencing a non-current bad version can therefore block `asset-v3` without appearing in the administrator remediation set. Archiving the visible three candidates would leave an unexplained blocker and cannot be authorized.

## Decision

Extend historical-media discovery and archive locking to every eligible broken AssetVersion that still has an active placement, whether or not that version is the Asset's current version.

The archive operation remains version-and-placement scoped:

- a broken current version follows the existing behavior;
- a broken non-current version has only its own active placements soft-trashed and its own availability changed to `unrecoverable`;
- a healthy current version, its placements, the Asset's `current_version_id`, and the active Asset are preserved;
- the Asset is soft-trashed only when no active placement remains after the selected archive.

Readiness is not weakened and no blocker is hidden.

## Candidate Contract

A candidate is eligible only when all of the following are true:

1. Asset, AssetVersion and placement share owner, project and asset identity.
2. The Asset is active.
3. The AssetVersion has at least one active placement.
4. The version URL is empty or begins with `/v1/images/proxy/`.
5. Both `storage_key` and `recovery_source_url` are absent after trimming.
6. Availability is `ready`, `missing`, or `unrecoverable`.
7. Placement count is within the existing bounded limit.

Discovery returns one candidate per eligible AssetVersion. It must not collapse different bad versions of the same Asset.

Each candidate adds:

```ts
isCurrentVersion: boolean;
```

`candidateDigest` covers owner, project, asset, version, `isCurrentVersion`, availability, URL class and sorted active placement facts. A current-version promotion or demotion therefore invalidates a previously reviewed candidate.

## Atomic Archive Behavior

For each explicitly selected candidate, the transaction:

1. Resolves and locks the Asset and selected AssetVersion.
2. Locks every active placement referencing that exact version.
3. Recomputes eligibility, `isCurrentVersion`, placement facts and digest.
4. Rejects stale data with `HISTORICAL_MEDIA_CANDIDATE_STALE` before any mutation.
5. Marks only the selected broken version `unrecoverable`.
6. Soft-trashes only placements referencing that selected version.
7. Updates legacy Canvas snapshots for selected Canvas placements through the existing revision lock.
8. Preserves `current_version_id` unconditionally.
9. Soft-trashes the Asset only if no active placement remains across any version.
10. Writes the existing immutable remediation ledger and redacted administrator audit in the same transaction.

No physical deletion, media regeneration, provider request, credit operation, replacement URL or direct production SQL is introduced.

## Coverage Reconciliation

Discovery must report enough aggregate information to fail closed before archive:

```json
{
  "counts": {
    "versions": 4,
    "activePlacements": 5,
    "currentVersions": 3,
    "nonCurrentVersions": 1
  },
  "coverage": {
    "eligibleBlockingPlacements": 5,
    "candidatePlacements": 5,
    "uncoveredBlockingPlacements": 0,
    "complete": true
  }
}
```

The numbers above illustrate the response shape and must always be database-derived. The implementation must not hardcode current cloud counts.

Archive POST is rejected with `HISTORICAL_MEDIA_COVERAGE_INCOMPLETE` when discovery cannot account for every active placement matched by the shared non-ready/non-durable predicates. The API must expose aggregate counts only for uncovered records; it must not expose cross-owner identifiers.

Readiness remains authoritative for release authorization. A successful archive is not sufficient by itself: a fresh readiness result must remove the selected blockers and retain migration/shadow consistency.

## Error and Idempotency Rules

- Existing authentication, administrator authorization, body limits, idempotency ledger and request-digest behavior remain unchanged.
- Same idempotency key and same normalized request returns the original result.
- Same key and a changed candidate, `isCurrentVersion` fact or placement set returns conflict.
- A durable source appearing before lock, a changed URL class, no active placement, or Asset status change returns stale conflict.
- Any snapshot, version, placement, ledger or audit failure rolls back the whole request.
- Restore of an archived unrecoverable placement remains forbidden.

## TDD Contract

Implementation begins with PostgreSQL RED tests that prove the current mismatch:

1. Seed a healthy current version plus a non-current ephemeral bad version with an active placement.
2. Prove existing remediation discovery omits that placement while readiness counts it.
3. Require discovery to return both current and non-current eligible candidates and zero uncovered blockers.
4. Archive the non-current candidate and prove the healthy current version, `current_version_id`, active Asset and healthy placements are byte-for-byte unchanged.
5. Prove only the bad placement is soft-trashed and only the selected bad version becomes `unrecoverable`.
6. Prove Canvas snapshot revision, immutable ledger, redacted audit, idempotent retry and same-key conflict behavior.
7. Prove current-version identity changes invalidate the digest.
8. Prove transaction rollback for snapshot and audit failures.
9. Prove readiness blocker counts reconcile after archive without weakening the doctor predicates.
10. Run focused, affected and full PostgreSQL suites, TypeScript, ESLint, production build, protected-feature gate and whitespace checks.

## Cloud Acceptance

1. Push only `main`; prove `stable` and the V5.8.8 donor are unchanged.
2. Coze pulls and builds the exact new `main` SHA in `shadow` mode.
3. Read remediation and readiness twice in an authenticated administrator session.
4. Require stable candidate IDs/digests and `coverage.complete=true` with zero uncovered placements.
5. Display the exact selected versions, placements, digests and effects, then obtain fresh action-time confirmation.
6. Execute one bounded archive POST and one byte-identical retry.
7. Prove one remediation ID, no duplicate audit, no physical purge and no credit event.
8. Prove healthy current media and projects remain available after refresh.
9. Prove readiness no longer reports the selected active blockers and shadow comparison remains `6/6`.
10. Retain API JSON, request IDs, remediation ID, aggregate database evidence, Chrome screenshot and clean Console evidence.

`asset-v3` remains forbidden until this acceptance passes and doctor independently sets `switchAuthorized=true`.

## Safety Invariants

- `stable` is never modified, merged, rebased or pushed.
- V5.8.8 remains a read-only donor.
- The healthy current version is never replaced, demoted or detached by non-current remediation.
- No candidate is archived implicitly or by archive-all behavior.
- No stale administrator view can archive changed placement facts.
- No write occurs when coverage is incomplete.
- No physical deletion, regeneration, provider call, billing or refund occurs.
- Failed requests leave Asset Graph, legacy snapshots, revision, ledger and audit unchanged.

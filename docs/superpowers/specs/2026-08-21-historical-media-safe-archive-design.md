# Historical Media Safe Archive Design

**Date:** 2026-08-21  
**Status:** Approved design; implementation not started  
**Scope:** Stage 4 historical broken-media remediation only  
**Runtime baseline:** `main@acd288487c4e44c9f6c6f41328c9a97ea169ab01`  
**Protected baseline:** `stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` remains untouched  
**Donor rule:** V5.8.8 remains read-only and is not a source for this remediation

## Decision

Use explicit administrator-approved **safe archive**. Do not regenerate, replace, physically delete, or silently relabel historical content.

The current cloud evidence contains three broken current AssetVersions and four active placements:

1. One chat placeholder with an empty URL and no durable source.
2. One Canvas chat bridge whose expired `/v1/images/proxy/...` URL returns 404 and has no durable source.
3. One version incorrectly marked `ready` on the same expired proxy URL. It is referenced by two active placements and has no durable source.

The related historical task preserves a prompt, provider and model, but it preserves no recoverable bytes. A new generation would be a different creative result and therefore cannot be represented as recovery.

## Goals

- Remove broken active references without fabricating media.
- Preserve task, prompt, provider, model, lineage and remediation evidence.
- Keep every action administrator-explicit, bounded, idempotent and atomic.
- Synchronize Asset Graph state and legacy Canvas snapshots in one transaction.
- Prevent an unrecoverable placement from being restored into another blank frame.
- Clear only the readiness blockers proven to result from the explicitly selected records.
- Keep physical media deletion disabled.

## Non-Goals

- No automatic regeneration or credit charge.
- No replacement image generation.
- No direct one-off SQL containing production record IDs.
- No scan-and-archive-all command.
- No V5.8.8 code copy, media gateway adoption or `asset-v3` promotion in this change.
- No mutation of unrelated historical projects, tasks, user data or audit rows.

## Architecture

### 1. Candidate discovery

Add an administrator-only read surface that reuses the current durability predicates. It returns only aggregate-safe facts and explicit candidate records that meet all of these conditions:

- the Asset and placement belong to the same owner and project;
- the AssetVersion is the current version of an active Asset;
- at least one placement is active;
- the URL is empty or uses the known ephemeral `/v1/images/proxy/...` form;
- `storage_key` is absent;
- `recovery_source_url` is absent;
- the version is `missing`, `unrecoverable`, or false-ready according to the current doctor predicate.

Each candidate includes a deterministic `candidateDigest` over the normalized owner, project, asset, version, availability, URL class and sorted active placement identities. The digest is a stale-data guard, not a secret.

Discovery is read-only. It never probes remote URLs, changes availability, creates recovery attempts or modifies snapshots.

### 2. Explicit archive command

Add an administrator-only command accepting:

```json
{
  "action": "archive-unrecoverable",
  "idempotencyKey": "admin-generated-key",
  "reason": "Historical media bytes are unavailable",
  "candidates": [
    {
      "assetId": "...",
      "assetVersionId": "...",
      "projectId": "...",
      "candidateDigest": "..."
    }
  ]
}
```

Constraints:

- 1 to 20 candidates per request.
- Bounded string lengths and a bounded JSON body.
- Duplicate candidate identities are rejected.
- The command never accepts a replacement URL or regeneration prompt.
- The caller must be an authenticated administrator.

### 3. Durable idempotency and audit

Create a checksum-managed migration for an immutable remediation ledger. A unique key binds `actor_user_id + idempotency_key`; the row stores a normalized request digest, action, reason, before-state summary, result summary and timestamps.

- Same key and same request returns the original terminal result.
- Same key and different request returns HTTP 409.
- The ledger is committed in the same database transaction as the archive.
- The existing administrator audit log receives a redacted summary that references the remediation ledger ID; the immutable ledger remains authoritative.
- No prompt text, API key, image bytes or complete remote URL is written to the general audit log.

### 4. Atomic archive transaction

For each approved candidate, in deterministic order:

1. Acquire an advisory lock scoped to administrator and idempotency key.
2. Lock the Asset, current AssetVersion and all active placements.
3. Recompute the candidate facts and digest from locked rows.
4. Reject with HTTP 409 if the digest changed, a durable source appeared, the version is no longer current, or the candidate is no longer broken.
5. Change the version availability to `unrecoverable` only from an allowed broken state.
6. Soft-trash every active placement referencing that version.
7. For Canvas image placements, update the legacy project snapshot using the current revision/locking path.
8. Trash the Asset only when it has no remaining active placements.
9. Insert the immutable remediation result and administrator audit summary.
10. Commit once. Any snapshot, audit or constraint failure rolls back the entire request.

No row is physically deleted. Existing retention and GC protection remain in force.

### 5. Restore behavior

`restorePlacement` must reject a placement whose selected AssetVersion is `unrecoverable`, returning a stable conflict error such as `ASSET_MEDIA_UNRECOVERABLE`. This prevents a soft-deleted blank frame from returning before an explicit future replacement workflow exists.

A future replacement workflow may create a new AssetVersion or new Asset with explicit `replacementOf` provenance. It is outside this design and must never rewrite the historical version as recovered.

## API Responses

Successful dry discovery:

```json
{
  "success": true,
  "candidates": [],
  "counts": {
    "versions": 0,
    "activePlacements": 0
  }
}
```

Successful archive:

```json
{
  "success": true,
  "remediationId": "...",
  "reused": false,
  "archivedVersionCount": 3,
  "archivedPlacementCount": 4
}
```

The response counts are derived from the transaction. The implementation must not hardcode the current cloud counts.

Error behavior:

- `400`: malformed or over-limit request.
- `401`: unauthenticated.
- `403`: non-administrator.
- `404`: selected owner/project/asset/version is not visible to the actor.
- `409`: stale candidate digest, idempotency conflict, recovered source appeared, invalid terminal state, or archive no longer applies.
- `500`: generic request failure with request ID; internal details remain server-side.

## Testing Contract

Implementation starts with failing tests and proceeds in this order:

1. Pure candidate classification and digest tests.
2. API authentication, authorization, input and error-shape tests.
3. PostgreSQL tests for multi-placement atomic archive, Canvas snapshot revision, immutable ledger and asset trash rules.
4. Concurrent duplicate-request tests proving one remediation result and no partial archive.
5. Same-key/different-request conflict test.
6. Transaction rollback tests for snapshot and audit failures.
7. Restore rejection for unrecoverable media.
8. Doctor/readiness regression proving unrelated blockers are unchanged.
9. Full Vitest with isolated PostgreSQL, TypeScript, zero-error ESLint, production build and protected-feature gate.

## Cloud Acceptance

Cloud execution is a separate controlled step after local regression:

1. Pull the exact `main` candidate into Coze; confirm `stable` is unchanged.
2. Keep `WUJIE_ASSET_GRAPH_MODE=shadow`.
3. Authenticate in the existing Google Chrome tab.
4. Call candidate discovery and compare identities/digests with the existing evidence.
5. Capture a fresh readiness baseline.
6. Execute one explicit archive command containing only the approved candidates.
7. Prove an identical retry returns the same remediation result.
8. Prove the project reloads, no blank active frames remain for those candidates, and fresh application Console errors/warnings are zero.
9. Prove readiness reports zero missing/false-ready active references for the archived candidates and no new blocker.
10. Preserve JSON, screenshot, request ID, remediation ID and PostgreSQL aggregate evidence.

Only after this acceptance may the controlled `asset-v3` thumbnail/reload/original-fallback/S3-recovery verification begin. The runtime must return to the approved mode after that verification.

## Safety Invariants

- `stable` is never checked out, rebased, merged into or pushed by this work.
- V5.8.8 remains read-only.
- No automatic archive occurs during startup, doctor, migration or readiness collection.
- No physical deletion occurs.
- No regeneration or credit operation occurs.
- A stale administrator screen cannot archive a changed candidate.
- Cross-user and cross-project identifiers fail closed.
- A failed request leaves Asset Graph and legacy snapshots unchanged.

# Asset Readiness Durability Gate Design

**Date:** 2026-08-21  
**Issue:** V588-BUG-005  
**Scope:** Release-readiness diagnosis only; no historical media mutation.

## Problem

The asset doctor currently groups current versions by the persisted `availability` value. A historical internal proxy URL can therefore remain `ready` after its physical payload expires. In the verified cloud dataset, one current version uses `/v1/images/proxy/...`, has no `storage_key` or `recovery_source_url`, returns HTTP 404, and is still counted as ready.

## Chosen Approach

Add a deterministic database durability gate to the existing doctor fact collection. A current version is reported as false-ready when all of these conditions hold:

1. Its persisted availability is `ready`.
2. Its URL is empty or belongs to a known internal ephemeral namespace such as `/v1/images/proxy/`.
3. It has neither a non-empty `storage_key` nor a non-empty `recovery_source_url`.

Count both affected current assets and affected active placements. Expose only aggregate counts through the production-readiness API. Any non-zero count adds a dedicated `non-durable-ready-media` blocker and prevents `asset-v3` promotion.

This gate deliberately does not perform live network requests. External provider URLs are not classified as broken solely because they are external, and managed `/api/serve-upload/` media remains governed by the existing storage and recovery checks.

## Rejected Approaches

- **Live HEAD/GET checks during doctor:** susceptible to provider latency, authentication, transient network failures, SSRF risk and request-time amplification.
- **New background media crawler:** useful later, but adds scheduling, persistence and operational policy beyond the minimal release-safety correction.

## Data Flow

`collectAssetGraphDoctorFacts()` performs two additional aggregate read-only queries, one for active current versions and one for active placements. `summarizeAssetGraphDoctor()` includes the counts in `media`, adds the blocker, and calculates `releaseReady=false`. `projectAssetGraphReleaseReadiness()` forwards only the aggregate counts.

## Safety Boundaries

- No database writes, URL rewrites, deletion, regeneration or availability mutation.
- No user identifiers, URLs, prompts or credentials in the readiness response.
- The historical records remain visible until an administrator explicitly chooses replace, regenerate or archive.
- `stable` and the V5.8.8 donor remain untouched.

## Verification

- Unit RED/GREEN: false-ready internal proxy current asset and placement block promotion.
- Query contract: the collector SQL checks `ready`, known ephemeral path, empty durable metadata and active ownership.
- Existing healthy managed media remains release-ready.
- API response exposes aggregate counts only.
- Full Vitest, PostgreSQL suite, TypeScript, ESLint, validation and production build.
- Coze Chrome regression after exact `main` deployment: readiness reports the additional false-ready counts and keeps `asset-v3` unauthorized without changing project/image totals.

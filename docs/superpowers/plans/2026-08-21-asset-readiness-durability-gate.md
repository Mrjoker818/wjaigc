# Asset Readiness Durability Gate Implementation Plan

**Design:** `docs/superpowers/specs/2026-08-21-asset-readiness-durability-gate-design.md`

## Tasks

- [x] Add failing doctor-summary tests for false-ready current versions and placements.
- [x] Add a failing collector query-contract test that requires deterministic ephemeral-media counts.
- [x] Run the focused test and confirm the failure is caused by missing durability facts.
- [x] Extend `collectAssetGraphDoctorFacts()` with read-only aggregate queries.
- [x] Extend the media summary and blocker calculation with aggregate false-ready counts.
- [x] Extend the public readiness projection types without exposing record details.
- [x] Run focused tests and confirm GREEN.
- [x] Run the real PostgreSQL asset suite and all repository gates.
- [ ] Commit and push only the verified files to `main`; verify `stable` is unchanged.
- [ ] Deploy the exact commit to Coze and use the existing Google Chrome preview tab for regression.
- [x] Update BUG_REGISTER, REGRESSION_REPORT, RELEASE_READINESS_REPORT and UNVERIFIED_ITEMS; Obsidian is updated before push.

## Acceptance Criteria

- The verified cloud false-ready proxy record is no longer counted as release-safe.
- `releaseReady=false` and `switchAuthorized=false` remain fail-closed until explicit historical remediation.
- No network fetch is added to doctor execution.
- No historical media row is modified by this change.
- Existing managed media and shadow parity behavior do not regress.

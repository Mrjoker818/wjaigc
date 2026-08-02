# Release Readiness Report - 2026-08-02

## Decision

**Current decision: not approved for production release.**

The remediation worktree contains concrete source and regression-test repairs, but it has not yet been deployed and therefore has not satisfied the required real-browser/provider/billing evidence gates.

## What Is Ready for Commit Verification

- Canvas view state restoration and fit-to-content reset.
- Requested-vs-actual generation route audit persistence and canvas disclosure.
- Typed 302 upscale provider failures with durable terminal/refund handling.
- Explicit 302 selections constrained to AI-only execution after a billing boundary.
- Dynamic configured-upscaler discovery, exact provider-model routing, and pre-charge model ownership checks.
- Pear asynchronous layered task submission and secure ZIP/PSD extraction.
- Image toolbar failure-card preservation for long-running image/video/3D/decomposition operations.
- Transparent subject alpha quality gate.
- Regression tests and CI paid-generation authorization contract.

## Release Blockers

1. PostgreSQL-backed concurrent terminal/refund tests cannot run without a database environment.
2. Deployed Pear ZIP-to-PSD editor flow has not been re-executed after the asynchronous/extraction changes.
3. Deployed 302 rejection behavior has not proven HTTP/code preservation and exactly-once refund.
4. Canvas persistence, routing audit, file upload/download and toolbar behavior require current deployment evidence.
5. Firefox and WebKit core P0 browser checks remain outstanding.
6. The release still requires deployed browser/provider evidence despite the completed local production build.

## Non-Blocking Technical Debt

- ESLint warnings remain in legacy code. They must not be hidden or auto-deleted in a broad batch. They are tracked as a separate code-health remediation because their current count does not by itself prove a user-visible failure.
- A Node local-storage command-line warning during build needs environment cleanup, but it does not fail the build.

## Required Next Gate

1. Commit only the verified source, regression tests, CI gate and current evidence documents.
2. Push the commit to GitHub.
3. Deploy that exact commit through the Coze deployment tab.
4. Re-run `UV-20260802-01` through `UV-20260802-10`.
5. Attach evidence and only then close the matching bug records.

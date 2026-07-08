---
name: program-repair-auditor
description: Whole-program software inspection, debugging, repair, and verification workflow. Use when an agent is asked to make a project work, fix bugs, repair failing tests/builds/CI, diagnose runtime or integration failures, perform end-to-end project checks, or confirm that code changes are truly complete. Combines full-program assessment, systematic root-cause debugging, controlled repair, and fresh evidence-based verification before completion claims.
---

# Program Repair Auditor

Use this skill to treat a repository as a working product, not as isolated files. Move from broad discovery to reproducible failures, root-cause diagnosis, controlled fixes, and fresh verification evidence.

## Non-Negotiable Rules

1. No fixes without root-cause investigation first.
2. No completion claims without fresh verification evidence.
3. Do not hide failures by skipping checks, weakening assertions, suppressing errors, or deleting tests.
4. Preserve unrelated user changes and existing project conventions.
5. Prefer the project's own package manager, scripts, test framework, and architecture.

## Workflow

### 1. Establish Scope

Inspect the repository before editing:

- Read project instructions, README files, manifests, lockfiles, entry points, configuration, routes, tests, and current VCS state.
- Infer primary user journeys from docs, commands, tests, routes, UI, APIs, and scripts.
- Define "working" as observable acceptance criteria: install/build succeeds, configured checks pass, primary flows work, and known limitations are documented.
- State material assumptions when the repo does not define them.

Do not introduce new frameworks, package managers, or broad abstractions unless the existing system clearly requires them.

### 2. Build a Baseline

Run the cheapest broad checks first, then deepen:

1. Verify dependencies and environment prerequisites without exposing secrets.
2. Run configured formatting, lint, static analysis, and type checks.
3. Run unit and integration tests.
4. Build or package the full program.
5. Start the application when relevant and exercise primary flows.
6. Capture exact failing commands, logs, stack traces, affected flows, and determinism.

If configured checks are absent or weak, create focused checks around important behavior and reproduced defects. Avoid low-value tests written only to increase test count.

### 3. Diagnose Before Editing

For every failure, complete root-cause investigation before proposing or applying a fix:

- Read the full error output, stack trace, codes, line numbers, and warnings.
- Reproduce consistently with the smallest reliable command or interaction.
- Check recent changes, diffs, dependency changes, config changes, and environment differences.
- Trace data flow backward from symptom to source. Find where the bad value, state, timing, or assumption originates.
- In multi-component systems, add temporary diagnostic instrumentation at component boundaries to prove where the failure appears.
- Compare broken code with similar working examples in the same codebase.
- Form one concrete hypothesis: "I think X is the root cause because Y."
- Identify evidence that would disprove the hypothesis.

If a failure is not reproducible, gather more evidence rather than guessing. If three fix attempts fail and each reveals new coupling or shared-state problems, stop and question the architecture before attempting another patch.

### 4. Repair in Controlled Slices

Make the smallest coherent fix at the correct abstraction boundary:

- Add or strengthen a failing regression test when practical.
- Change one root cause at a time.
- Preserve public behavior unless the user requested a behavior change.
- Cover relevant empty states, invalid input, cleanup, concurrency, platform differences, and error paths.
- Avoid unrelated refactors while the baseline is unstable.
- After each repair slice, rerun the narrow reproduction before broader checks.

If one failure masks another, repeat the baseline-diagnose-repair loop until no in-scope failure remains or an external blocker is proven.

### 5. Verify With a Widening Ladder

Before claiming success, run fresh verification in the current session:

1. Exact reproduction or regression test for the original symptom.
2. Tests for touched modules and direct dependents.
3. Full configured test suite when feasible.
4. Lint, type check, and build/package checks.
5. Runtime smoke test.
6. End-to-end primary user journeys, including at least one meaningful failure path when relevant.

Read the full output and exit codes. A previous run, partial run, passing lint, or "looks correct" is not enough.

### 6. Inspect the Final State

Before final reporting or handoff:

- Review the diff for accidental changes, debug output, hard-coded secrets, disabled checks, brittle waits, and weakened assertions.
- Confirm no unrelated user changes were overwritten.
- Confirm generated files, snapshots, and lockfiles are intentional.
- Document any command that could not run, why it could not run, and the residual risk.

## Completion Report

Lead with the actual outcome, then report evidence:

- Root causes found.
- Fixes made.
- Tests added or strengthened.
- Verification commands and flows that passed.
- Checks that failed or could not run.
- Remaining limitations, blockers, or risks.

Never say the work is complete unless the verification evidence supports that exact claim.

## Red Flags

Stop and return to diagnosis if the agent is about to say or think:

- "This should work."
- "It is probably fixed."
- "Just try this quick change."
- "Skip the test for now."
- "The build should pass because lint passed."
- "The previous agent said it succeeded."
- "One more patch" after multiple unproven attempts.

Evidence comes before confidence.

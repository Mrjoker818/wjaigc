# V5.8.8 Read-Only Donor Baseline

## Purpose

`J:\无界云端0820` is a comparison and selective-absorption donor only. It is not the active repository, is not a replacement source tree, and must never receive edits, formatting, dependency installation, build output, generated reports, or Git initialization from this upgrade plan.

All product changes continue on GitHub `main`. The protected branch remains fixed at `stable@52f7c601ed150769e15d06fb435c6e360e28c9e7`.

## Captured Baseline

| Field | Value |
|---|---|
| Captured at | `2026-08-21T07:24:06.4469470+08:00` |
| Donor path | `J:\无界云端0820` |
| Package name | `projects` |
| Package version | `5.8.8` |
| Git repository | No; exported source snapshot |
| Manifest scope | `src`, `packages`, `scripts`, `public`, `tests`, root package/lock/config files |
| File count | `1894` |
| Total bytes | `44220062` |
| Source tree SHA-256 | `f1fd534b245ddd87f6b6bfa3ca5cf4714ade1373bc244d1e6202f6ef392c3d38` |
| `pnpm-lock.yaml` SHA-256 | `cc9e5e848bdb4cec6aeb394b086f8fe3015be9888787d350815c8b06b62f00e0` |

The manifest excludes generated output, reports, runtime data, `node_modules`, `.next`, and environment files. Environment-file contents are never copied into the active repository or included in comparison reports.

## Non-Negotiable Rules

1. Never edit, delete, rename, format, install into, build inside, or initialize Git inside `J:\无界云端0820`.
2. Read donor files only to identify behavior, contracts, UI patterns, APIs, tests, and migrations worth absorbing.
3. Do not copy a directory or whole file merely because it is newer. Each absorption item starts with a failing compatibility test in the active `main` worktree.
4. Apply the smallest integration that preserves current Canvas, node mode, standalone chat, user/admin dashboards, providers, billing, and protected feature contracts.
5. Run focused tests, full regression, TypeScript, ESLint, production build, and the required cloud check before marking any item absorbed.
6. Recompute this baseline before and after every absorption batch. Any donor digest change stops the batch and requires a new explicitly reviewed baseline.
7. Never write to `stable`; all accepted changes are pushed to `main` only.

## Baseline Verification

The donor is considered unchanged only when both recorded SHA-256 values, source file count, and source byte count still match this document. A directory timestamp or successful build is not sufficient evidence.

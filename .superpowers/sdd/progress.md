# WJ-STABLE-001 Stage 2 Progress

Baseline: `origin/main@ffe810939a446bbf7288d177b95040b36a05484c`  
Branch: `codex/wj-stable-s2`  
Plan: `docs/superpowers/plans/2026-08-10-wujie-stable-asset-version-graph-stage-2.md`  
Protected branch baseline: `stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` (user-confirmed read-only stable tip)
Governance confirmation 2026-08-11: the user intentionally updated `stable` from `a53da24` to `52f7c60`; this Stage 2 branch did not write it and will keep it untouched

| Task | Status | RED evidence | GREEN evidence | Review | Commit | Cloud SHA | Unverified |
|---|---|---|---|---|---|---|---|
| 0 Baseline and ledger | completed | Full Vitest: 1 failed / 1806 passed / 8 skipped; indentation-sensitive recovery settlement assertion | Focused recovery lease contract: 13/13; full Vitest: 356 files / 1807 tests passed, 8 env-gated skipped, 0 failed | self-review passed | `dd20b84` | plan-only checkpoint, no cloud deploy required | `stable@a53da24` reverified unchanged |
| 1 Domain and migration | completed | Initial domain module absent; review RED reproduced four failures: missing TLS normalizer export, invalid runtime pair handling, DB accepted `canvas/chat-result`, concurrent runners hit a duplicate-key race | Real PostgreSQL: 3 files / 8 tests passed; concurrent runners both exit 0; SHA-256 happy/mismatch verified; `ts-check`, targeted ESLint, full `pnpm test`, and production build passed | independent R2 review `APPROVED`, 0 findings | `dd20b84..38e578b` | Checkpoint A is after Task 3; not deployed early | Cloud migration and exact runtime SHA remain unverified until Checkpoint A; coverage plugin is not installed |
| 2 Atomic storage and transfer | completed | Initial modules absent; review waves reproduced cross-project rejection, placement lifecycle races, version-idempotency 23505, weak lineage/index proof, authorization short-circuit, cleanup deadlock risk and fixed-sleep race amplification | Real PostgreSQL: 8 integration + 7 unit tests passed; 20-way cross-project transfer creates one target graph; exact lineage/index, owner/project auth, trash/restore races and failure-safe barriers verified; `ts-check`, targeted ESLint, full Vitest and production build passed | fifth independent review `APPROVED`, 0 findings | task commits `7ee6f76`, `80c59dd`, `c3861af`, `0d7ee9e`, `24df8df` | Checkpoint A push pending | Cloud migration and runtime transfer remain unverified until Checkpoint A deployment |
| 3 Legacy readers and copy-on-write | completed_local | Initial modules absent; review regressions then failed 3 cases for text corruption, unstable retry mappings, and key-order-sensitive comparison | Real PostgreSQL 19/19; login protection 18/18; `ts-check`, `lint:build`, full `pnpm test`, 112-page production build, and 38/38 protected-function gate passed | independent R2 review `APPROVED`, 0 findings | `8b73b68`, `b1fc8f4` | Checkpoint A push pending | Exact cloud SHA and Coze `legacy`/`shadow` startup |
| 4 Canvas shadow and broken media | pending | pending | pending | pending | pending | pending | Canvas reopen and missing media UI |
| 5 Canvas/chat/workflow transfer | pending | pending | pending | pending | pending | pending | Server-authorized cross-workspace flow |
| 6 Standalone chat transfer | pending | pending | pending | pending | pending | pending | Legacy bridge compatibility |
| 7 Task result projection | pending | pending | pending | pending | pending | pending | Completed-only projection and late-result isolation |
| 8 Trash/recovery/orphan media | pending | pending | pending | pending | pending | pending | Physical purge remains disabled until final gate |
| 9 E2E and rollout | pending | pending | pending | pending | pending | pending | Chromium/Firefox/WebKit and cloud rollback |

## Scope Guard

- In scope: Asset, AssetVersion, WorkspacePlacement, lineage, transfers, trash, orphan media, broken media, legacy compatibility.
- Out of scope: Stage 3 canvas kernel, Stage 4 node/Agent redesign, Stage 5 business tool quality work, BUG-053 unless it blocks Stage 2.
- Rollback: switch `WUJIE_ASSET_GRAPH_MODE` to `legacy`; do not drop tables or delete versions.

## Stable Branch Governance

- Read-only `git ls-remote` observed `stable` move from `a53da24` to `52f7c60` while `main` remained `dd20b84`.
- The user confirmed on 2026-08-11 that `52f7c60` is an intentional stable update.
- `52f7c60` is now the accepted protected stable baseline for Stage 2; this worktree performed no write to it and will not revert, merge into, or overwrite it.
- Tasks 1-3 and all local Checkpoint A technical gates are complete. The governance blocker is closed; Checkpoint A may be pushed to `main` after a fresh remote-ref and protected-baseline check.

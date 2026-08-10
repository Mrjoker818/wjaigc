# WJ-STABLE-001 Stage 2 Progress

Baseline: `origin/main@ffe810939a446bbf7288d177b95040b36a05484c`  
Branch: `codex/wj-stable-s2`  
Plan: `docs/superpowers/plans/2026-08-10-wujie-stable-asset-version-graph-stage-2.md`  
Protected branch: `stable@a53da24aa9f3813aae24f697dfb90d0b67f0a455` (read-only)

| Task | Status | RED evidence | GREEN evidence | Review | Commit | Cloud SHA | Unverified |
|---|---|---|---|---|---|---|---|
| 0 Baseline and ledger | completed | Full Vitest: 1 failed / 1806 passed / 8 skipped; indentation-sensitive recovery settlement assertion | Focused recovery lease contract: 13/13; full Vitest: 356 files / 1807 tests passed, 8 env-gated skipped, 0 failed | self-review passed | `dd20b84` | plan-only checkpoint, no cloud deploy required | `stable@a53da24` reverified unchanged |
| 1 Domain and migration | completed | Initial domain module absent; review RED reproduced four failures: missing TLS normalizer export, invalid runtime pair handling, DB accepted `canvas/chat-result`, concurrent runners hit a duplicate-key race | Real PostgreSQL: 3 files / 8 tests passed; concurrent runners both exit 0; SHA-256 happy/mismatch verified; `ts-check`, targeted ESLint, full `pnpm test`, and production build passed | independent R2 review `APPROVED`, 0 findings | `dd20b84..38e578b` | Checkpoint A is after Task 3; not deployed early | Cloud migration and exact runtime SHA remain unverified until Checkpoint A; coverage plugin is not installed |
| 2 Atomic storage and transfer | in_progress | pending | pending | pending | pending | pending | PostgreSQL 20-way concurrency, ownership and lifecycle |
| 3 Legacy readers and copy-on-write | pending | pending | pending | pending | pending | pending | Eight committed fixtures |
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

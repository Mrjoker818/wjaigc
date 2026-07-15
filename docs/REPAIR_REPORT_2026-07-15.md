# Cloud Recovery Repair Report

Date: 2026-07-15

## Scope

This recovery repairs the broken `main` commit `5b1d4d3`. That commit contained committed Git conflict markers and removed canvas helper modules while keeping their imports. It also replaced the cross-platform install hook with a Windows-incompatible shell command.

## Completed Repairs

- Restored the nine conflict-corrupted application, API, canvas, node-editor, provider-config, and workflow-test files from the previously verified `41e7dd0` implementation.
- Restored `src/lib/canvas-pan-virtualization.ts` and `src/lib/canvas-generation-results.ts`.
- Restored the requested features that disappeared after the cloud pull: Display Decompose, 302 Super-Upscale V2 / Upscale V6, CPU rembg background removal, and Human Repair Ultimate.
- Replaced the `postinstall` Bash-only command with `scripts/prepare-tools.mjs`. Windows skips optional Linux SVG tooling; Linux still invokes the existing optional script.
- Fixed duplicate workflow switch branches so `video-trim` receives its upstream video and keeps the configured duration.
- Added source-integrity regression coverage for conflict markers, required canvas helpers, and the cross-platform postinstall hook.

## Verification Evidence

| Command or check | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` | Passed |
| `pnpm ts-check` | Passed |
| `pnpm test` | Passed: 61 files, 325 tests |
| `pnpm build` | Passed; generated routes include Display Decompose, Human Repair, Image Edit, and Image-to-3D APIs |
| Feature wiring tests | Passed: 12 tests covering Display Decompose, 302 upscale, CPU rembg, and Human Repair |
| Merge-marker source scan | Passed: zero TypeScript markers |

## Known Non-blocking Debt

- `pnpm lint --quiet` still reports 386 pre-existing errors, mostly `@typescript-eslint/no-explicit-any`. Merge-marker parse errors have been eliminated. These errors do not block type-checking, tests, production build, or server startup; they need a separate incremental type-safety cleanup and must not be hidden by disabling lint rules.
- CPU local upscale needs ONNX weights in `/space/onnx-models` on the deployment volume. The large runtime assets are intentionally not restored to the Git source tree.

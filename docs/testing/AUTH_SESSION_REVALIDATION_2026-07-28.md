# Auth Session Revalidation Regression

- Date: 2026-07-28
- Scope: cloud vector-design refresh recovery
- Severity: P1
- Affected flow: authenticated workspace -> redundant `/api/session` probe -> dashboard

## Reproduction Evidence

1. An authenticated administrator generated and edited a Recraft SVG in the cloud preview.
2. The edited SVG was saved successfully to the canvas and project sync returned HTTP 200.
3. On page refresh, the workspace's second `/api/session` request received a transient HTTP 500 while the initial page session had already authenticated the user.
4. The workspace treated that failure as logout, set the user to `null`, and `DashboardView` then read `user.role`, producing `TypeError: Cannot read properties of null (reading 'role')`.

## Root Cause

`CanvasWorkspace` did not distinguish an explicit unauthenticated response (`success: true, user: null`) from a transient session-service failure (`success: false`, malformed response, or thrown request). Both paths cleared the authenticated user.

## Fix

- Added `resolveSessionUser` in `src/lib/auth-session.ts` with authenticated, unauthenticated, and indeterminate results.
- The redundant workspace probe now preserves the already authenticated `initialUser` for indeterminate results.
- Only an explicit unauthenticated result triggers logout and returns to the entry page.
- Removed the unsafe path that rendered the dashboard with a null user.

## Automated Verification

| Command | Result |
| --- | --- |
| `pnpm exec vitest run src/__tests__/lib/auth-session.test.ts src/__tests__/lib/auth-bootstrap-project-sync-contract.test.ts src/__tests__/components/canvas-workspace-session-revalidation-contract.test.ts src/__tests__/components/login-panel-native-form-contract.test.ts src/__tests__/components/dashboard-logout-return-contract.test.ts src/__tests__/components/simple-chat-workspace-return-contract.test.ts` | PASS, 18/18 |
| `pnpm ts-check` | PASS |
| `pnpm build` | PASS |
| Targeted ESLint | PASS, 0 errors; 5 pre-existing warnings in `canvas-workspace.tsx` |

## Cloud Follow-up

Cloud refresh recovery remains unverified until this commit is deployed. The next browser run must confirm the edited vector node remains present after refresh and no `user.role` error appears.

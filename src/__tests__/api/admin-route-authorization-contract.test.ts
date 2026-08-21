import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const adminRoot = path.join(process.cwd(), 'src/app/api/admin');
const expectedRoutes = [
  'api-balance/route.ts',
  'apis/route.ts',
  'assets/orphans/route.ts',
  'assets/remediation/route.ts',
  'audit/route.ts',
  'backfill-thumbnails/route.ts',
  'backups/[id]/download/route.ts',
  'backups/[id]/route.ts',
  'backups/route.ts',
  'cloud-tasks/route.ts',
  'credits/overview/route.ts',
  'credits/pricing/route.ts',
  'credits/recharge/route.ts',
  'dashboard-stats/route.ts',
  'desktop-devices/route.ts',
  'desktop-update/route.ts',
  'groups/route.ts',
  'local-generation-records/route.ts',
  'op-log/route.ts',
  'production-readiness/route.ts',
  'resources/route.ts',
  'settings/route.ts',
  'test-all-providers/route.ts',
  'user-folder/route.ts',
  'user-images/route.ts',
  'users/route.ts',
] as const;

const manualGuardContracts = new Map<string, readonly string[]>([
  ['api-balance/route.ts', ['getSessionUser(', "user.role !== 'admin'", 'status: 401']],
  ['assets/orphans/route.ts', ['getRequestUser(', "auth.user.role !== 'admin'", 'status: 401', 'status: 403']],
  ['assets/remediation/route.ts', ['getRequestUser(', "auth.user.role !== 'admin'", 'errorResponse(401', 'errorResponse(403']],
]);

function relativeRoutePath(routePath: string): string {
  return path.relative(adminRoot, routePath).replaceAll('\\', '/');
}

function collectRouteFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && entry.name === 'route.ts')
    .map((entry) => path.join(entry.parentPath, entry.name));
}

describe('admin route authorization contract', () => {
  it('requires an explicit administrator guard on every admin route', () => {
    const routes = collectRouteFiles(adminRoot).sort((left, right) => (
      relativeRoutePath(left).localeCompare(relativeRoutePath(right))
    ));
    expect(routes.map(relativeRoutePath)).toEqual(expectedRoutes);

    const unguarded = routes.filter((routePath: string) => {
      const source = readFileSync(routePath, 'utf8');
      if (source.includes('requireAdminUser(')) return false;
      const manualContract = manualGuardContracts.get(relativeRoutePath(routePath));
      return !manualContract?.every((token) => source.includes(token));
    });

    expect(unguarded.map(relativeRoutePath)).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const dashboardSource = readFileSync(
  resolve(process.cwd(), 'src/components/dashboard/dashboard-view.tsx'),
  'utf8',
);
const userManagerSource = readFileSync(
  resolve(process.cwd(), 'src/lib/user-manager.ts'),
  'utf8',
);

describe('dashboard project deletion contract', () => {
  it('updates projects in place and supports one real batch operation', () => {
    expect(dashboardSource).not.toContain('window.location.reload()');
    expect(dashboardSource).toContain('const [selectedProjectIds, setSelectedProjectIds] = useState<Set<string>>');
    expect(dashboardSource).toContain('const handleBatchDeleteProjects = useCallback');
    expect(dashboardSource).toContain('await mgr.deleteProjects(Array.from(selectedProjectIds))');
    expect(dashboardSource).toContain('toggleProjectSelection(project.id)');

    expect(userManagerSource).toContain('async deleteProjects(projectIds: string[])');
    expect(userManagerSource).toContain('void this.syncToServer(true)');
    expect(userManagerSource).toContain('signal: AbortSignal.timeout(PROJECT_SYNC_TIMEOUT_MS)');
    expect(userManagerSource).toContain('const result = await this.deleteProjects([projectId])');
  });
});

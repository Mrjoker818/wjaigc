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

describe('dashboard project rename contract', () => {
  it('refreshes the project list after rename', () => {
    // 确认重命名处理器存在，且成功后必须触发 projectRevision 刷新 projects memo
    expect(dashboardSource).toContain('const handleConfirmRename = useCallback');
    expect(dashboardSource).toContain('mgr.updateProject(renamingProjectId, { name: nextName })');
    expect(dashboardSource).toContain('setProjectRevision(revision => revision + 1)');
    // projects memo 必须依赖 projectRevision，否则任何原地更新都不会反映到 UI
    expect(dashboardSource).toContain(
      'const projects = useMemo(() => mgr.getProjects(), [mgr, projectRevision]);',
    );
  });

  it('notifies subscribers when a project is updated', () => {
    // updateProject 与新增/删除一致，写库后必须通知订阅者
    const updateProjectBody = userManagerSource.match(
      /updateProject\(projectId: string, updates: Partial<Project>\): Project \| null \{[\s\S]*?\n  \}/,
    );
    expect(updateProjectBody).toBeTruthy();
    expect(updateProjectBody?.[0]).toContain('this.notifyProjectsChanged()');
  });
});

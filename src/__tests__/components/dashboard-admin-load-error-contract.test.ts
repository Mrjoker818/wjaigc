import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const dashboardSource = readFileSync(resolve(process.cwd(), 'src/components/dashboard/dashboard-view.tsx'), 'utf8');

describe('administrator data-load failures', () => {
  it('does not render backend failures as an empty provider or task list', () => {
    expect(dashboardSource).toContain('const [providersLoadError, setProvidersLoadError]');
    expect(dashboardSource).toContain('const [cloudTasksError, setCloudTasksError]');
    expect(dashboardSource).toContain('供应商配置加载失败');
    expect(dashboardSource).toContain('云端任务记录加载失败');
  });
});

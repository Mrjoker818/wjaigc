import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const dashboardSource = readFileSync(
  resolve(process.cwd(), 'src/components/dashboard/dashboard-view.tsx'),
  'utf8',
);

describe('dashboard media gateway contract', () => {
  it('adds the media gateway to the existing administrator navigation', () => {
    expect(dashboardSource).toContain("import MediaGatewayAdmin from './media-gateway-admin'");
    expect(dashboardSource).toContain("'media-gateway'");
    expect(dashboardSource).toContain("key: 'media-gateway' as TabType");
    expect(dashboardSource).toContain("label: '媒体网关'");
    expect(dashboardSource).toContain('icon: KeyRound');
  });

  it('renders the isolated admin surface without changing AdminTabs ownership', () => {
    expect(dashboardSource).toContain("activeTab === 'media-gateway' && isAdmin");
    expect(dashboardSource).toContain('<MediaGatewayAdmin />');
    expect(dashboardSource).toContain("['overview', 'audit', 'users', 'groups', 'credits', 'settings'].includes(activeTab)");
  });
});

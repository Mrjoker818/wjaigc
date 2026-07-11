import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  requireAdminUser: vi.fn(),
  getServerDataRoot: vi.fn(),
}));

vi.mock('@/lib/server-auth', () => ({ requireAdminUser: mocks.requireAdminUser }));
vi.mock('@/lib/server-data-root', () => ({ getServerDataRoot: mocks.getServerDataRoot }));

import { GET as storageDiagnostics } from '@/app/api/diag/storage/route';
import { GET as exportDiagnostics } from '@/app/api/diagnostics/export/route';

describe('admin diagnostics endpoints', () => {
  beforeEach(() => {
    mocks.requireAdminUser.mockReset();
    mocks.getServerDataRoot.mockReset();
  });

  it('rejects an unauthenticated storage diagnostic before reading server paths', async () => {
    mocks.requireAdminUser.mockResolvedValue(null);

    const response = await storageDiagnostics(new NextRequest('http://localhost/api/diag/storage'));

    expect(response.status).toBe(403);
    expect(mocks.getServerDataRoot).not.toHaveBeenCalled();
  });

  it('rejects an unauthenticated diagnostic export before reading logs or files', async () => {
    mocks.requireAdminUser.mockResolvedValue(null);

    const response = await exportDiagnostics(new NextRequest('http://localhost/api/diagnostics/export'));

    expect(response.status).toBe(403);
  });
});

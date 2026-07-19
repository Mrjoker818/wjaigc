import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getInternalRequestHeaders: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/api-auth', () => ({
  getInternalRequestHeaders: mocks.getInternalRequestHeaders,
}));

import { persistResultImage } from '@/lib/persist-result-image';

describe('server result image persistence', () => {
  beforeEach(() => {
    mocks.getInternalRequestHeaders.mockReset();
    mocks.getInternalRequestHeaders.mockResolvedValue({
      'x-internal-request': 'true',
      'x-wujie-internal-secret': 'signed-test-secret',
    });
    delete process.env.DEPLOY_RUN_PORT;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('signs persistence of a server-generated data URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ url: '/api/serve-upload/uploads/persisted.png' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(persistResultImage('data:image/png;base64,AA==')).resolves.toBe('/api/serve-upload/uploads/persisted.png');
    expect(mocks.getInternalRequestHeaders).toHaveBeenCalledWith('system-save-image', 'admin');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:5000/api/save-image',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          'x-internal-request': 'true',
          'x-wujie-internal-secret': 'signed-test-secret',
        }),
      }),
    );
  });

  it('downloads a remote result and signs the subsequent persistence request', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'image/jpeg' },
        arrayBuffer: async () => Uint8Array.from([0, 1, 2]).buffer,
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ url: '/api/serve-upload/uploads/persisted.jpg' }),
      });
    vi.stubGlobal('fetch', fetchMock);

    await expect(persistResultImage('https://provider.example/result.jpg')).resolves.toBe('/api/serve-upload/uploads/persisted.jpg');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'http://localhost:5000/api/save-image',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'x-internal-request': 'true',
          'x-wujie-internal-secret': 'signed-test-secret',
        }),
      }),
    );
  });
});

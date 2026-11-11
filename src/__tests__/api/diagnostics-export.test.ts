import { NextRequest } from 'next/server';
import JSZip from 'jszip';
import { describe, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({ open: vi.fn(), readFile: vi.fn() }));
vi.mock('@/lib/server-auth', () => ({ requireAdminUser: async () => ({ id: 'test-admin' }) }));
vi.mock('fs', () => ({
  existsSync: (file: string) => file.endsWith('app.log'),
  readdirSync: () => [],
}));
vi.mock('fs/promises', () => mock);

import { GET } from '@/app/api/diagnostics/export/route';

describe('diagnostic archive', () => {
  it('includes only bounded severity counts from logs', async () => {
    const sampleBytes = 256 * 1024;
    const fixture = Buffer.from(
      'continuation-of-old-line\n[WARN] synthetic account diagnostic marker\n' +
      '2026-11-11T12:00:00.000Z ERROR test-only private diagnostic marker\n' +
      'arbitrary multiline detail\n',
    );
    const close = vi.fn();
    const read = vi.fn(async (buffer: Buffer) => ({ bytesRead: fixture.copy(buffer) }));
    mock.readFile.mockResolvedValue(fixture.toString('utf8'));
    mock.open.mockImplementation(async (file: string) => {
      if (!file.endsWith('app.log')) throw new Error('fixture file absent');
      return { stat: async () => ({ size: sampleBytes * 2, isFile: () => true }), read, close };
    });

    const response = await GET(new NextRequest('http://localhost/api/diagnostics/export'));
    expect(response.status).toBe(200);
    const zip = await JSZip.loadAsync(await response.arrayBuffer());
    expect(zip.file('logs/app.log')).toBeNull();
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(JSON.parse((await zip.file('logs/summary.json')?.async('string')) ?? '')).toEqual({
      'app.log': { sampledLines: 3, error: 1, warn: 1, info: 0, debug: 0, other: 1 },
    });
    expect(read).toHaveBeenCalledExactlyOnceWith(expect.any(Buffer), 0, sampleBytes, sampleBytes);
    expect(close).toHaveBeenCalledOnce();
  });
});

import { describe, expect, it, vi } from 'vitest';

import { loadBrowserImageBlob } from '@/lib/browser-image-blob';

describe('loadBrowserImageBlob', () => {
  it('decodes base64 data URLs without issuing a network request', async () => {
    const fetcher = vi.fn();

    const blob = await loadBrowserImageBlob(
      'data:image/png;base64,iVBORw0KGgo=',
      fetcher,
    );

    expect(fetcher).not.toHaveBeenCalled();
    expect(blob.type).toBe('image/png');
    expect(blob.size).toBeGreaterThan(0);
  });

  it('uses fetch for server and remote URLs', async () => {
    const fetcher = vi.fn(async () => new Response('image', {
      status: 200,
      headers: { 'Content-Type': 'image/png' },
    }));

    const blob = await loadBrowserImageBlob('/api/serve-upload/uploads/example.png', fetcher);

    expect(fetcher).toHaveBeenCalledWith('/api/serve-upload/uploads/example.png');
    expect(blob.type).toBe('image/png');
  });
});

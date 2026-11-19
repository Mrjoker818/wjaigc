import { readFile } from 'node:fs/promises';
import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';

const { getServerDataRoot } = vi.hoisted(() => ({ getServerDataRoot: vi.fn<() => string>() }));
vi.mock('@/lib/server-data-root', () => ({ getServerDataRoot }));
vi.mock('@/lib/api-auth', () => ({
  requireApiAuthOrReject: vi.fn().mockResolvedValue({ userId: 'synthetic-local-media-user' }),
}));

import { GET as getGalleryImage } from '@/app/api/font-design/gallery-image/route';
import { POST as extractText } from '@/app/api/knowledge/extract-text/route';

function jsonRequest(route: string, body: object): NextRequest {
  return new NextRequest(`http://localhost/api/${route}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('packaged media acceptance regressions', () => {
  it('serves an original JPEG using the site-relative gallery path stored in the index', async () => {
    const expected = await readFile('public/gallery/cat-0/g1.jpg');
    const response = await getGalleryImage(new NextRequest('http://localhost/api/font-design/gallery-image?id=g1'));

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/jpeg');
    expect(Buffer.from(await response.arrayBuffer())).toEqual(expected);
  });

  it('reads only the selected UTF-8 document bytes when extracting a short note', async () => {
    const text = '无界知识库\n第二行。\n';
    const response = await extractText(jsonRequest('knowledge/extract-text', {
      fileUrl: `data:text/plain;base64,${Buffer.from(text).toString('base64')}`,
      fileType: 'txt',
    }));

    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.text === text).toBe(true);
  });

});

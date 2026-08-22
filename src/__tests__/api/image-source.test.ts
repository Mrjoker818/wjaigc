import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { NextRequest, NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireApiAuthOrReject: vi.fn(),
  downloadPublicImage: vi.fn(),
}));

vi.mock('@/lib/api-auth', () => ({
  requireApiAuthOrReject: mocks.requireApiAuthOrReject,
}));

vi.mock('@/lib/safe-image-download', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/safe-image-download')>();
  return {
    ...original,
    downloadPublicImage: mocks.downloadPublicImage,
  };
});

const routePath = resolve(process.cwd(), 'src/app/api/image/source/route.ts');

async function loadGet() {
  if (!existsSync(routePath)) return null;
  return (await import('@/app/api/image/source/route')).GET;
}

function requestFor(source?: string): NextRequest {
  const url = new URL('http://localhost/api/image/source');
  if (source !== undefined) url.searchParams.set('url', source);
  return new NextRequest(url);
}

describe('GET /api/image/source', () => {
  beforeEach(() => {
    mocks.requireApiAuthOrReject.mockReset();
    mocks.downloadPublicImage.mockReset();
    mocks.requireApiAuthOrReject.mockResolvedValue({
      authenticated: true,
      userId: 'user-1',
      userRole: 'user',
    });
  });

  it('提供受保护的同源图片读取路由', () => {
    expect(existsSync(routePath), '缺少 /api/image/source 路由').toBe(true);
  });

  it('未登录时拒绝读取远程图片', async () => {
    const GET = await loadGet();
    if (!GET) return;
    mocks.requireApiAuthOrReject.mockResolvedValue(
      NextResponse.json({ error: 'Authentication required' }, { status: 401 }),
    );

    const response = await GET(requestFor('https://cdn.example.test/image.png'));

    expect(response.status).toBe(401);
    expect(mocks.downloadPublicImage).not.toHaveBeenCalled();
  });

  it('通过现有安全下载器读取图片并返回正确 MIME', async () => {
    const GET = await loadGet();
    if (!GET) return;
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    mocks.downloadPublicImage.mockResolvedValue({ buffer: png, mimeType: 'image/png' });

    const response = await GET(requestFor('https://cdn.pearapi.ai/image.png'));

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(response.headers.get('cache-control')).toContain('private');
    expect(Buffer.from(await response.arrayBuffer())).toEqual(png);
    expect(mocks.downloadPublicImage).toHaveBeenCalledWith(
      'https://cdn.pearapi.ai/image.png',
      expect.objectContaining({ maxBytes: 25 * 1024 * 1024 }),
    );
  });

  it('拒绝缺失地址、非 HTTP 协议和过长地址', async () => {
    const GET = await loadGet();
    if (!GET) return;

    await expect(GET(requestFor())).resolves.toMatchObject({ status: 400 });
    await expect(GET(requestFor('file:///etc/passwd'))).resolves.toMatchObject({ status: 400 });
    await expect(GET(requestFor(`https://example.test/${'a'.repeat(4096)}`))).resolves.toMatchObject({ status: 400 });
    expect(mocks.downloadPublicImage).not.toHaveBeenCalled();
  });

  it('安全下载拒绝时不泄漏内部错误栈', async () => {
    const GET = await loadGet();
    if (!GET) return;
    mocks.downloadPublicImage.mockRejectedValue(new Error('private address 10.0.0.1'));

    const response = await GET(requestFor('https://blocked.example.test/image.png'));

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: 'REMOTE_IMAGE_UNAVAILABLE' });
  });
});

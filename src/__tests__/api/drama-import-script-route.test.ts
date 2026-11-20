import { NextRequest, NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ authenticated: true, productType: 'video' }));
vi.mock('@/lib/api-auth', () => ({ requireApiAuthOrReject: async () => state.authenticated
  ? { userId: 'u', user: { role: 'user', productType: state.productType } }
  : NextResponse.json({ error: 'Authentication required' }, { status: 401 }) }));
// Any attempt to persist a preview or invoke a paid planner is a test failure.
vi.mock('@/lib/drama/store', () => ({ createDramaProject: () => { throw new Error('PREVIEW_WRITE'); } }));
vi.mock('@/lib/drama/planner', () => ({ callDramaLlm: () => { throw new Error('PAID_CALL'); } }));
import { POST } from '@/app/api/drama/import-script/route';
const json = (body: unknown) => new NextRequest('http://localhost/api/drama/import-script', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
beforeEach(() => { state.authenticated = true; state.productType = 'video'; });

describe('script import preview', () => {
  it('returns exact source, stats and warnings without writing a project or invoking AI', async () => {
    const response = await POST(json({ text: 'Scene 1\r\n甲：你好😀', title: '原稿', format: 'text', aspectRatio: '16:9', style: 'anime' }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, doc: { title: '原稿', style: 'anime', aspectRatio: '16:9', sourceScript: { originalText: 'Scene 1\r\n甲：你好😀' } }, stats: { episodes: 1, scenes: 1, characters: 1, dialogues: 1 } });
  });
  it('accepts multipart UTF8 files and settings', async () => {
    const form = new FormData(); form.set('file', new File(['甲：你好\r\n'], '原稿.txt')); form.set('title', '标题'); form.set('style', 'anime'); form.set('aspectRatio', '1:1');
    const response = await POST(new NextRequest('http://localhost/api/drama/import-script', { method: 'POST', body: form }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ doc: { title: '标题', style: 'anime', aspectRatio: '1:1', sourceScript: { originalText: '甲：你好\r\n', fileName: '原稿.txt', format: 'txt' } } });
  });
  it('checks authentication and video access before reading the request', async () => {
    state.authenticated = false; expect((await POST(json({ text: '甲：你好' }))).status).toBe(401);
    state.authenticated = true; state.productType = 'canvas'; expect((await POST(json({ text: '甲：你好' }))).status).toBe(403);
  });
  it.each([null, [], { text: ' ' }, { text: 42 }, { text: 'x', format: 'pdf' }, { text: 'x', style: 'bogus' }, { text: 'x', aspectRatio: 'bogus' }])('rejects malformed import %j', async body => {
    expect((await POST(json(body))).status).toBe(400);
  });
  it('limits request bodies even with no Content-Length', async () => {
    const request = new NextRequest('http://localhost/api/drama/import-script', { method: 'POST', body: JSON.stringify({ text: 'x'.repeat(6 * 1024 * 1024) }), headers: { 'content-type': 'application/json' } });
    expect((await POST(request)).status).toBe(413);
  });
});

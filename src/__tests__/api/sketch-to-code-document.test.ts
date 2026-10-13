import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
vi.mock('server-only', () => ({}));
const mocks = vi.hoisted(() => ({ auth: vi.fn(), read: vi.fn() }));
vi.mock('@/lib/api-auth', () => ({ requireApiAuthOrReject: mocks.auth }));
vi.mock('@/lib/sketch-to-code/document', () => ({ readSketchDocument: mocks.read }));
import { GET } from '@/app/api/sketch-to-code/[taskId]/document/route';
const html = '<!doctype html><html><body>安全中文&lt;&amp;</body></html>';
const context = (): { params: Promise<{ taskId: string }> } => ({ params: Promise.resolve({ taskId: 'original-task' }) });
beforeEach(() => { vi.resetAllMocks(); mocks.auth.mockResolvedValue({ user: { id: 'current-editor' } }); mocks.read.mockResolvedValue({ html, bytes: Buffer.from(html) }); });
describe('current-authorized sketch attachment HTTP port', () => {
  it('authenticates before awaiting route params or reading content', async () => {
    mocks.auth.mockResolvedValue(NextResponse.json({}, { status: 401 })); const then = vi.fn();
    const response = await GET(new NextRequest('http://localhost/api/sketch-to-code/x/document?projectId=p'), { params: { then } as unknown as Promise<{ taskId: string }> });
    expect(response.status).toBe(401); expect(then).not.toHaveBeenCalled(); expect(mocks.read).not.toHaveBeenCalled();
  });
  it('returns identical authorized bytes with fixed network/script/form isolation headers', async () => {
    const response = await GET(new NextRequest('http://localhost/api/sketch-to-code/original-task/document?projectId=project-a'), context());
    expect(response.status).toBe(200); expect(Buffer.from(await response.arrayBuffer())).toEqual(Buffer.from(html));
    expect(mocks.read).toHaveBeenCalledWith(expect.objectContaining({ actorUserId: 'current-editor', projectId: 'project-a', taskId: 'original-task' }));
    expect(response.headers.get('content-disposition')).toBe('attachment; filename="sketch-code.html"');
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8'); expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('content-security-policy')).toMatch(/default-src 'none'/); expect(response.headers.get('content-security-policy')).toMatch(/sandbox/); expect(response.headers.get('content-security-policy')).toMatch(/form-action 'none'/);
  });
  it.each(['', '?projectId=p&projectId=p', '?projectId=p&userId=other', '?projectId=%0D%0Aheader'])('rejects malformed query %s without reading', async query => {
    expect((await GET(new NextRequest(`http://localhost/api/sketch-to-code/x/document${query}`), context())).status).toBe(400); expect(mocks.read).not.toHaveBeenCalled();
  });
  it.each(['revoked', 'viewer', 'stranger', 'tampered', 'unknown-commit'])('fails closed on reader %s with no content leakage', async reason => {
    mocks.read.mockRejectedValue(new Error(`SQL secret ${reason}`)); const response = await GET(new NextRequest('http://localhost/api/sketch-to-code/x/document?projectId=p'), context());
    expect(response.status).toBe(404); expect(await response.text()).not.toMatch(/SQL|secret|安全中文/);
  });
});

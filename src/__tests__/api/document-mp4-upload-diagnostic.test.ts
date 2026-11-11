import childProcess, { type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import { NextRequest } from 'next/server';
import { expect, it, vi } from 'vitest';
import { POST } from '@/app/api/collaboration/document-assets/upload/route';
import { validateAssetBinaryFormat } from '@/lib/asset-core/binary-persistence';
import { consumeMediaBody, parseUploadHeaders, readMediaBody } from '@/lib/collaboration/document-media-request';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/server-auth', () => ({ getSessionUser: async () => ({ id: 'qa-actor' }) }));
vi.mock('@/lib/server-data-root', () => ({}));
vi.mock('@/lib/s3-storage', () => ({}));
vi.mock('@/lib/asset-core/cleanup-outbox', () => ({}));
vi.mock('@/lib/safe-image-input', () => ({}));
vi.mock('@/lib/collaboration/document-media-import', () => ({
  importDocumentUpload: async (_actor: string, request: NextRequest) => {
    const { mimeType } = parseUploadHeaders(request.headers);
    const body = consumeMediaBody(await readMediaBody(request, 4096, request.signal));
    await validateAssetBinaryFormat(body.bytes!, mimeType, request.signal);
    return { placementId: 'qa-placement', assetVersionId: 'qa-version', documentSequence: 1 };
  },
}));

const endpoint = 'http://localhost/api/collaboration/document-assets/upload';
const metadata = Buffer.from(JSON.stringify({
  projectId: 'qa-project',
  idempotencyKey: 'qa-key',
  filename: 'qa.mp4',
  command: { action: 'attach', transform: { x: 0, y: 0, width: 2, height: 2, rotation: 0, zIndex: 0 } },
})).toString('base64url');

function upload(bytes: Uint8Array<ArrayBuffer>, headers: Record<string, string> = {}): Promise<Response> {
  return POST(new NextRequest(endpoint, { method: 'POST', body: bytes, headers: {
    origin: 'http://localhost', 'content-type': 'video/mp4', 'x-wujie-asset-import': metadata, ...headers,
  } }));
}

it.each([
  ['request_admission', { 'x-wujie-asset-import': '' }],
  ['request_admission', { 'content-length': '1' }],
  ['mp4_structure', {}],
] as const)('identifies %s without starting a probe', async (phase, headers) => {
  const execFile = vi.spyOn(childProcess, 'execFile');
  try {
    const response = await upload(new Uint8Array([1, 2, 3]), headers);
    expect(response.status).toBe(400);
    expect(response.headers.get('x-wujie-mp4-phase')).toBe(phase);
    expect(response.headers.has('x-wujie-mp4-probe-error')).toBe(false);
    expect(await response.json()).toEqual({ success: false, code: 'DOCUMENT_MEDIA_INVALID' });
    expect(execFile).not.toHaveBeenCalled();
  } finally {
    execFile.mockRestore();
  }
});

it.each([
  ['ENOENT', 'launch_not_found', null, 503, 'DOCUMENT_VIDEO_VALIDATOR_UNAVAILABLE'],
  [1, 'exit_nonzero', '1', 400, 'DOCUMENT_MEDIA_INVALID'],
  [0, 'result_rejected', null, 400, 'DOCUMENT_MEDIA_INVALID'],
] as const)('reports probe outcome %s using only bounded response fields', async (code, reason, exitCode, status, publicCode) => {
  const fixture = await readFile('tests/fixtures/yjs-task8b1-tiny-valid.mp4.base64', 'utf8');
  const child = Object.assign(new EventEmitter(), { pid: code === 'ENOENT' ? undefined : 123 }) as ChildProcess;
  const detail = 'private-file private-user private-provider';
  const error = Object.assign(new Error(detail), { code });
  const execFile = vi.spyOn(childProcess, 'execFile').mockImplementationOnce((_file, _args, _options, callback) => {
    queueMicrotask(() => {
      callback?.(code === 0 ? null : error, '', detail);
      if (code === 'ENOENT') child.emit('error', error);
      child.emit('close', typeof code === 'number' ? code : -1, null);
    });
    return child;
  });

  try {
    const response = await upload(Uint8Array.from(Buffer.from(fixture, 'base64')));
    expect(response.status).toBe(status);
    expect(response.headers.get('x-wujie-mp4-phase')).toBe('ffprobe');
    expect(response.headers.get('x-wujie-mp4-probe-error')).toBe(reason);
    expect(response.headers.get('x-wujie-mp4-probe-exit-code')).toBe(exitCode);
    expect(JSON.stringify([...response.headers])).not.toContain('private-file');
    expect(await response.json()).toEqual({ success: false, code: publicCode });
    expect(execFile).toHaveBeenCalledTimes(1);
  } finally {
    execFile.mockRestore();
  }
});

it('keeps the phase out of other media and foreign-origin responses', async () => {
  const bytes = new Uint8Array([1, 2, 3]);
  const other = await upload(bytes, { 'content-type': 'image/png' });
  const foreign = await upload(bytes, { origin: 'https://foreign.example' });
  expect(other.status).toBe(400);
  expect(foreign.status).toBe(403);
  expect(other.headers.has('x-wujie-mp4-phase')).toBe(false);
  expect(foreign.headers.has('x-wujie-mp4-phase')).toBe(false);
});

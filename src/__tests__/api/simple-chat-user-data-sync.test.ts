import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { project } from '@/__tests__/fixtures/simple-chat-sync';
import { SIMPLE_CHAT_SYNC_MAX_REQUEST_BYTES } from '@/lib/simple-chat-project-sync';

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  dbGetUserData: vi.fn(),
  dbSetUserData: vi.fn(),
  readSimpleChatSnapshot: vi.fn(),
  compareAndSetSimpleChatSnapshot: vi.fn(),
  logOperation: vi.fn(),
  SimpleChatSyncConflictError: class SimpleChatSyncConflictError extends Error {
    readonly code = 'CHAT_SYNC_CONFLICT';
    constructor(readonly currentRevision: number) {
      super('智能对话数据已在其他位置更新');
    }
  },
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/server-auth', () => ({ getSessionUser: mocks.getSessionUser }));
vi.mock('@/lib/db-storage', () => ({
  dbGetUserData: mocks.dbGetUserData,
  dbSetUserData: mocks.dbSetUserData,
}));
vi.mock('@/lib/simple-chat-sync-server', () => ({
  readSimpleChatSnapshot: mocks.readSimpleChatSnapshot,
  compareAndSetSimpleChatSnapshot: mocks.compareAndSetSimpleChatSnapshot,
  SimpleChatSyncConflictError: mocks.SimpleChatSyncConflictError,
}));
vi.mock('@/lib/op-log', () => ({ logOperation: mocks.logOperation }));

import { GET, POST } from '@/app/api/user-data/sync/route';

const CHAT_KEY = 'chat_simple_projects';
const validProjects = [project('project-a')];

function getRequest(headers?: HeadersInit): NextRequest {
  return new NextRequest(`http://localhost/api/user-data/sync?key=${CHAT_KEY}`, { headers });
}

function postJson(body: unknown, headers?: HeadersInit): NextRequest {
  return new NextRequest('http://localhost/api/user-data/sync', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function postText(body: string): NextRequest {
  return new NextRequest('http://localhost/api/user-data/sync', {
    method: 'POST',
    body,
    headers: { 'content-type': 'application/json' },
  });
}

function exactSizeChatBody(size: number): string {
  const prefix = `{"key":"${CHAT_KEY}","value":[],"expectedRevision":0,"padding":"`;
  const suffix = '"}';
  return prefix + 'x'.repeat(size - prefix.length - suffix.length) + suffix;
}

function streamingRequest(
  chunks: Uint8Array[],
  options?: {
    cancel?: ReturnType<typeof vi.fn>;
    contentLength?: string;
    errorAfter?: number;
    highWaterMark?: number;
    onPull?: (index: number) => void;
  },
): NextRequest {
  let index = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      options?.onPull?.(index);
      if (options?.errorAfter === index) {
        controller.error(new Error('stream exploded'));
        return;
      }
      const chunk = chunks[index++];
      if (chunk) controller.enqueue(chunk);
      else controller.close();
    },
    cancel: options?.cancel,
  }, options?.highWaterMark === undefined ? undefined : { highWaterMark: options.highWaterMark });
  return new NextRequest('http://localhost/api/user-data/sync', {
    method: 'POST',
    body: stream,
    headers: {
      'content-type': 'application/json',
      ...(options?.contentLength ? { 'content-length': options.contentLength } : {}),
    },
  });
}

describe('simple chat user data sync route', () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => {
      if ('mockReset' in mock) mock.mockReset();
    });
    mocks.getSessionUser.mockResolvedValue({ id: 'user-1', name: 'User One' });
    mocks.readSimpleChatSnapshot.mockResolvedValue({ schemaVersion: 1, revision: 7, projects: validProjects });
    mocks.compareAndSetSimpleChatSnapshot.mockResolvedValue({
      schemaVersion: 1,
      revision: 8,
      projects: validProjects,
    });
  });

  it('returns the server snapshot and sync revision for only the fixed chat key', async () => {
    const response = await GET(getRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      success: true,
      key: CHAT_KEY,
      value: validProjects,
      syncRevision: 7,
    });
    expect(mocks.readSimpleChatSnapshot).toHaveBeenCalledWith('user-1');
    expect(mocks.dbGetUserData).not.toHaveBeenCalled();
  });

  it('returns a stable audited error when the chat snapshot read fails', async () => {
    mocks.readSimpleChatSnapshot.mockRejectedValue(new Error('postgres password leaked'));
    const response = await GET(getRequest({ 'x-request-id': 'req_read_failure' }));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(response.headers.get('x-request-id')).toBe('req_read_failure');
    expect(body).toMatchObject({
      success: false,
      code: 'CHAT_SYNC_READ_FAILED',
      message: 'Failed to read simple chat projects',
      requestId: 'req_read_failure',
      retryable: false,
    });
    expect(JSON.stringify(body)).not.toContain('postgres password leaked');
    expect(mocks.logOperation).toHaveBeenCalledWith(expect.objectContaining({
      action: 'simple_chat_sync_read',
      responseStatus: 500,
      requestData: {
        revision: 0,
        operationCount: 0,
        status: 'error',
        errorCode: 'CHAT_SYNC_READ_FAILED',
      },
    }));
    expect(JSON.stringify(mocks.logOperation.mock.calls)).not.toContain('postgres password leaked');
  });

  it('writes with CAS and returns only the server revision contract', async () => {
    const response = await POST(postJson({
      key: CHAT_KEY,
      value: validProjects,
      expectedRevision: 7,
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ success: true, key: CHAT_KEY, syncRevision: 8 });
    expect(body).not.toHaveProperty('projectRevision');
    expect(mocks.compareAndSetSimpleChatSnapshot).toHaveBeenCalledWith({
      userId: 'user-1',
      projects: validProjects,
      expectedRevision: 7,
    });
    expect(mocks.dbSetUserData).not.toHaveBeenCalled();
  });

  it('returns a stable audited error when the chat snapshot write fails', async () => {
    mocks.compareAndSetSimpleChatSnapshot.mockRejectedValue(new Error('database host leaked'));
    const response = await POST(postJson(
      { key: CHAT_KEY, value: validProjects, expectedRevision: 7 },
      { 'x-request-id': 'req_write_failure' },
    ));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(response.headers.get('x-request-id')).toBe('req_write_failure');
    expect(body).toMatchObject({
      success: false,
      code: 'CHAT_SYNC_WRITE_FAILED',
      message: 'Failed to write simple chat projects',
      requestId: 'req_write_failure',
      retryable: false,
    });
    expect(JSON.stringify(body)).not.toContain('database host leaked');
    expect(mocks.logOperation).toHaveBeenCalledWith(expect.objectContaining({
      action: 'simple_chat_sync_write',
      responseStatus: 500,
      requestData: {
        revision: 7,
        operationCount: 1,
        status: 'error',
        errorCode: 'CHAT_SYNC_WRITE_FAILED',
      },
    }));
    expect(JSON.stringify(mocks.logOperation.mock.calls)).not.toContain('database host leaked');
    expect(mocks.dbSetUserData).not.toHaveBeenCalled();
  });

  it('returns a structured conflict with the bounded request id and no legacy write', async () => {
    mocks.compareAndSetSimpleChatSnapshot.mockRejectedValue(new mocks.SimpleChatSyncConflictError(8));
    const response = await POST(postJson(
      { key: CHAT_KEY, value: [], expectedRevision: 7 },
      { 'x-request-id': 'req_sync_test' },
    ));

    expect(response.status).toBe(409);
    expect(response.headers.get('x-request-id')).toBe('req_sync_test');
    expect(await response.json()).toMatchObject({
      success: false,
      code: 'CHAT_SYNC_CONFLICT',
      currentRevision: 8,
      retryable: true,
      requestId: 'req_sync_test',
    });
    expect(mocks.dbSetUserData).not.toHaveBeenCalled();
  });

  it.each([
    ['missing', undefined],
    ['negative', -1],
    ['fractional', 1.5],
    ['string', '7'],
    ['unsafe', Number.MAX_SAFE_INTEGER],
  ])('rejects a %s expectedRevision before CAS', async (_label, expectedRevision) => {
    const body = expectedRevision === undefined
      ? { key: CHAT_KEY, value: [] }
      : { key: CHAT_KEY, value: [], expectedRevision };
    const response = await POST(postJson(body));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ success: false, retryable: false });
    expect(mocks.compareAndSetSimpleChatSnapshot).not.toHaveBeenCalled();
  });

  it.each([
    ['non-array projects', {}],
    ['invalid project schema', [{}]],
  ])('rejects %s before CAS', async (_label, value) => {
    const response = await POST(postJson({ key: CHAT_KEY, value, expectedRevision: 0 }));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ success: false });
    expect(mocks.compareAndSetSimpleChatSnapshot).not.toHaveBeenCalled();
  });

  it.each([
    ['malformed JSON', '{'],
    ['empty body', ''],
  ])('returns stable 400 for %s without CAS', async (_label, body) => {
    const response = await POST(postText(body));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ success: false, retryable: false });
    expect(mocks.compareAndSetSimpleChatSnapshot).not.toHaveBeenCalled();
  });

  it('returns stable 400 for a missing body stream without CAS', async () => {
    const response = await POST(new NextRequest('http://localhost/api/user-data/sync', {
      method: 'POST',
    }));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ success: false, retryable: false });
    expect(mocks.compareAndSetSimpleChatSnapshot).not.toHaveBeenCalled();
  });

  it('returns stable 400 when the request stream errors without CAS', async () => {
    const response = await POST(streamingRequest(
      [new TextEncoder().encode('{"key":"chat_simple_projects"')],
      { errorAfter: 1 },
    ));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ success: false, retryable: false });
    expect(mocks.compareAndSetSimpleChatSnapshot).not.toHaveBeenCalled();
  });

  it('accepts an exact 20 MiB streamed body even when Content-Length is larger', async () => {
    const body = exactSizeChatBody(SIMPLE_CHAT_SYNC_MAX_REQUEST_BYTES);
    const response = await POST(streamingRequest(
      [new TextEncoder().encode(body)],
      { contentLength: String(SIMPLE_CHAT_SYNC_MAX_REQUEST_BYTES + 1) },
    ));

    expect(response.status).toBe(200);
    expect(mocks.compareAndSetSimpleChatSnapshot).toHaveBeenCalledOnce();
  });

  it('recognizes the chat key when it is not the first top-level field', async () => {
    const response = await POST(postText(JSON.stringify({
      metadata: { source: 'client' },
      value: [],
      key: CHAT_KEY,
      expectedRevision: 7,
    })));

    expect(response.status).toBe(200);
    expect(mocks.compareAndSetSimpleChatSnapshot).toHaveBeenCalledOnce();
    expect(mocks.dbSetUserData).not.toHaveBeenCalled();
  });

  it('recognizes escaped chat key names and values', async () => {
    const response = await POST(postText(
      String.raw`{"\u006bey":"chat_simple_project\u0073","value":[],"expectedRevision":7}`,
    ));

    expect(response.status).toBe(200);
    expect(mocks.compareAndSetSimpleChatSnapshot).toHaveBeenCalledOnce();
    expect(mocks.dbSetUserData).not.toHaveBeenCalled();
  });

  it('recognizes the chat key across stream chunk boundaries', async () => {
    const body = JSON.stringify({ key: CHAT_KEY, value: [], expectedRevision: 7 });
    const chunks = [...new TextEncoder().encode(body)].map(byte => new Uint8Array([byte]));
    const response = await POST(streamingRequest(chunks));

    expect(response.status).toBe(200);
    expect(mocks.compareAndSetSimpleChatSnapshot).toHaveBeenCalledOnce();
    expect(mocks.dbSetUserData).not.toHaveBeenCalled();
  });

  it('rejects a duplicate legacy-then-chat key without bypassing the chat size boundary', async () => {
    const body = `{"key":"settings_x","key":"${CHAT_KEY}","value":[],"expectedRevision":7,"padding":"${
      'x'.repeat(SIMPLE_CHAT_SYNC_MAX_REQUEST_BYTES)
    }"}`;
    const response = await POST(postText(body));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ success: false, error: 'Duplicate key parameter' });
    expect(mocks.compareAndSetSimpleChatSnapshot).not.toHaveBeenCalled();
    expect(mocks.dbSetUserData).not.toHaveBeenCalled();
  });

  it('applies the chat size boundary to a UTF-8 BOM split across stream chunks', async () => {
    const body = new TextEncoder().encode(exactSizeChatBody(SIMPLE_CHAT_SYNC_MAX_REQUEST_BYTES));
    const response = await POST(streamingRequest(
      [new Uint8Array([0xef]), new Uint8Array([0xbb]), new Uint8Array([0xbf]), body],
    ));

    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({
      success: false,
      code: 'CHAT_SYNC_PAYLOAD_TOO_LARGE',
      retryable: false,
    });
    expect(mocks.compareAndSetSimpleChatSnapshot).not.toHaveBeenCalled();
    expect(mocks.dbSetUserData).not.toHaveBeenCalled();
  });

  it('cancels immediately after a streamed body exceeds 20 MiB regardless of Content-Length', async () => {
    const cancel = vi.fn();
    const first = new TextEncoder().encode(exactSizeChatBody(SIMPLE_CHAT_SYNC_MAX_REQUEST_BYTES));
    const response = await POST(streamingRequest(
      [first, new Uint8Array([1]), new Uint8Array([2])],
      { cancel, contentLength: '1' },
    ));

    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({
      success: false,
      code: 'CHAT_SYNC_PAYLOAD_TOO_LARGE',
      retryable: false,
    });
    expect(cancel).toHaveBeenCalledOnce();
    expect(mocks.compareAndSetSimpleChatSnapshot).not.toHaveBeenCalled();
  });

  it('cancels an open chat root at the byte that crosses 20 MiB without reading its trailing chunk', async () => {
    const cancel = vi.fn();
    const onPull = vi.fn();
    const openRoot = new TextEncoder().encode(`{"key":"${CHAT_KEY}",`);
    const paddingPrefix = new TextEncoder().encode('"padding":"');
    const toLimit = new Uint8Array(
      SIMPLE_CHAT_SYNC_MAX_REQUEST_BYTES - openRoot.byteLength - paddingPrefix.byteLength,
    ).fill(0x78);
    const response = await POST(streamingRequest(
      [
        openRoot,
        paddingPrefix,
        toLimit,
        new Uint8Array([0x78]),
        new TextEncoder().encode('","value":[],"expectedRevision":0}'),
      ],
      { cancel, highWaterMark: 0, onPull },
    ));

    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({
      success: false,
      code: 'CHAT_SYNC_PAYLOAD_TOO_LARGE',
      retryable: false,
    });
    expect(cancel).toHaveBeenCalledOnce();
    expect(onPull.mock.calls.map(([index]) => index)).toEqual([0, 1, 2, 3]);
    expect(mocks.compareAndSetSimpleChatSnapshot).not.toHaveBeenCalled();
    expect(mocks.dbSetUserData).not.toHaveBeenCalled();
  });

  it('cancels an open BOM-prefixed chat root at the byte that crosses 20 MiB without reading its trailing chunk', async () => {
    const cancel = vi.fn();
    const onPull = vi.fn();
    const openRoot = new TextEncoder().encode(`{"key":"${CHAT_KEY}",`);
    const paddingPrefix = new TextEncoder().encode('"padding":"');
    const bomBytes = 3;
    const toLimit = new Uint8Array(
      SIMPLE_CHAT_SYNC_MAX_REQUEST_BYTES - bomBytes - openRoot.byteLength - paddingPrefix.byteLength,
    ).fill(0x78);
    const response = await POST(streamingRequest(
      [
        new Uint8Array([0xef]),
        new Uint8Array([0xbb]),
        new Uint8Array([0xbf]),
        openRoot,
        paddingPrefix,
        toLimit,
        new Uint8Array([0x78]),
        new TextEncoder().encode('","value":[],"expectedRevision":0}'),
      ],
      { cancel, highWaterMark: 0, onPull },
    ));

    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({
      success: false,
      code: 'CHAT_SYNC_PAYLOAD_TOO_LARGE',
      retryable: false,
    });
    expect(cancel).toHaveBeenCalledOnce();
    expect(onPull.mock.calls.map(([index]) => index)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(mocks.compareAndSetSimpleChatSnapshot).not.toHaveBeenCalled();
    expect(mocks.dbSetUserData).not.toHaveBeenCalled();
  });

  it('does not echo an overlong or malicious request id', async () => {
    mocks.compareAndSetSimpleChatSnapshot.mockRejectedValue(new mocks.SimpleChatSyncConflictError(3));
    const malicious = `bad value-${'x'.repeat(200)}`;
    const request = postJson(
      { key: CHAT_KEY, value: [], expectedRevision: 2 },
      { 'x-request-id': malicious },
    );
    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.requestId).toMatch(/^req_[a-f0-9]{16}$/);
    expect(body.requestId).not.toBe(malicious);
    expect(response.headers.get('x-request-id')).toBe(body.requestId);
  });

  it('audits read, write, and conflict using metadata only', async () => {
    await GET(getRequest({ 'x-request-id': 'req_read_test' }));
    await POST(postJson({ key: CHAT_KEY, value: validProjects, expectedRevision: 7 }));
    mocks.compareAndSetSimpleChatSnapshot.mockRejectedValueOnce(new mocks.SimpleChatSyncConflictError(9));
    await POST(postJson({ key: CHAT_KEY, value: validProjects, expectedRevision: 8 }));

    expect(mocks.logOperation).toHaveBeenCalledTimes(3);
    expect(mocks.logOperation).toHaveBeenNthCalledWith(1, expect.objectContaining({
      action: 'simple_chat_sync_read',
      responseStatus: 200,
      requestData: expect.objectContaining({ revision: 7, operationCount: 0, status: 'success' }),
    }));
    expect(mocks.logOperation).toHaveBeenNthCalledWith(2, expect.objectContaining({
      action: 'simple_chat_sync_write',
      responseStatus: 200,
      requestData: expect.objectContaining({ revision: 8, operationCount: 1, status: 'success' }),
    }));
    expect(mocks.logOperation).toHaveBeenNthCalledWith(3, expect.objectContaining({
      action: 'simple_chat_sync_conflict',
      responseStatus: 409,
      requestData: expect.objectContaining({
        revision: 9,
        operationCount: 1,
        status: 'conflict',
        errorCode: 'CHAT_SYNC_CONFLICT',
      }),
    }));
    expect(JSON.stringify(mocks.logOperation.mock.calls)).not.toContain('项目-project-a');
    expect(JSON.stringify(mocks.logOperation.mock.calls)).not.toContain('fixture knowledge');
  });

  it('keeps the successful business result when audit logging throws', async () => {
    mocks.logOperation.mockImplementation(() => { throw new Error('audit unavailable'); });

    const readResponse = await GET(getRequest());
    const writeResponse = await POST(postJson({ key: CHAT_KEY, value: [], expectedRevision: 7 }));

    expect(readResponse.status).toBe(200);
    expect(writeResponse.status).toBe(200);
  });
});

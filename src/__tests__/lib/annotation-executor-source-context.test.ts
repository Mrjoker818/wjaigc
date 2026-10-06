import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AnnotationProviderRequest } from '@/lib/annotation-provider-adapter';

vi.mock('@/lib/api-auth', () => ({ getInternalRequestHeaders: async () => ({ 'x-test-actor': 'editor' }) }));
vi.mock('@/lib/api-helpers', () => ({ getInternalApiUrl: () => 'http://localhost/api/edit' }));
import { submitAnnotationEdit } from '@/features/annotations/annotation-executor';

const VERSION = '11111111-1111-4111-8111-111111111111';
const IMAGE = '/api/serve-upload/images/source.png';
const OVERLAY = `data:image/png;base64,${readFileSync('tests/fixtures/annotation-source.png').toString('base64')}`;
const request: AnnotationProviderRequest = {
  image: IMAGE, prompt: 'change cup', referenceImages: [OVERLAY], model: 'gpt-image-2', providerId: 'provider-a',
  annotationIds: ['annotation-a'], idempotencyKey: 'annotation-request-a', requestId: 'request-a', size: '512x512', quality: 'high',
};
const privateInput = { request, userId: 'editor', userRole: 'user', source: {
  actorUserId: 'editor', projectId: 'private', imageId: 'image-a', imageUrl: IMAGE, versionId: 'legacy-v1',
} };
afterEach((): void => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('real annotation executor HTTP source context (8C next seam)', () => {
  it('keeps document project/parent/actor identity and separates compiled overlay from ordinary source assets', async () => {
    let body: Record<string, unknown> = {};
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit): Promise<Response> => {
      body = JSON.parse(String(init.body)) as Record<string, unknown>;
      return Response.json({ taskId: 'edit-local', mode: 'polling' }, { status: 202 });
    });
    // Additional properties remain structurally legal today; the test exercises the real existing executor,
    // not a compile/import failure. The missing forwarding is the RED behavior.
    const input = { request, userId: 'editor', userRole: 'user', source: {
      actorUserId: 'editor', projectId: 'shared', imageId: 'entity-a', imageUrl: IMAGE,
      versionId: `entity-a:asset:${VERSION}`, assetId: 'asset-a', assetVersionId: VERSION, placementId: 'placement-a',
      access: { kind: 'document' as const, actorUserId: 'editor', ownerId: 'owner', projectId: 'shared', grantGeneration: '3' },
    } };
    await submitAnnotationEdit(input);
    expect(body).toMatchObject({ projectId: 'shared', assetWorkspace: 'canvas', assetWorkspaceId: 'shared',
      assetParentVersionIds: [VERSION] });
    expect(body.referenceImages).toEqual([]);
    expect(body._annotationReferenceImage).toBe(OVERLAY);
  });

  it('does not quietly turn an owned private project edit into an unscoped task', async () => {
    let body: Record<string, unknown> = {};
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit): Promise<Response> => {
      body = JSON.parse(String(init.body)) as Record<string, unknown>;
      return Response.json({ taskId: 'edit-private', mode: 'polling' }, { status: 202 });
    });
    const input = { request, userId: 'editor', userRole: 'user', source: {
      actorUserId: 'editor', projectId: 'private', imageId: 'image-a', imageUrl: IMAGE, versionId: 'legacy-v1',
    } };
    await submitAnnotationEdit(input);
    expect(body.projectId).toBe('private');
  });
});

describe('annotation downstream rejection transport', () => {
  // Dropping downstream status/code makes permanent rejection look like retryable 502.
  it.each([
    { status: 404, code: 'ANNOTATION_PROJECT_NOT_FOUND', retryable: false },
    { status: 409, code: 'ANNOTATION_SOURCE_STALE', retryable: false },
    { status: 503, code: 'ANNOTATION_SOURCE_UNAVAILABLE', retryable: true },
    { status: 403, code: 'CANVAS_EDIT_SOURCE_FORBIDDEN', retryable: false },
    { status: 403, code: 'GENERATION_PROJECT_FORBIDDEN', retryable: false },
    { status: 402, code: 'INSUFFICIENT_CREDITS', retryable: false },
    { status: 409, code: 'IDEMPOTENCY_CONFLICT', retryable: false },
    { status: 409, code: 'ANNOTATION_IDEMPOTENCY_CONFLICT', retryable: false },
    { status: 400, code: 'ANNOTATION_EDIT_CONTEXT_INVALID', retryable: false },
    { status: 413, code: 'ANNOTATION_COMPLEXITY_INVALID', retryable: false },
  ])('preserves actionable $status/$code without forwarding internal details', async ({ status, code, retryable }) => {
    let calls = 0;
    vi.stubGlobal('fetch', async (): Promise<Response> => {
      calls++;
      return Response.json({ success: false, code, error: 'SELECT secret FROM private_table; postgres://internal',
        message: 'internal credential detail', retryable: !retryable }, { status });
    });
    const error = await submitAnnotationEdit(privateInput).catch((value: unknown): unknown => value);
    expect(error).toMatchObject({ status, code, retryable });
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toMatch(/SELECT|secret|private_table|postgres:|credential/);
    expect(calls).toBe(1);
  });

  it.each([
    { status: 403, code: 'SELECT_SECRET_FROM_USERS' },
    { status: 409, code: 'ANNOTATION_SOURCE_UNAVAILABLE' },
    { status: 429, code: null },
  ])('uses a local machine code for unknown or mismatched $status/$code', async ({ status, code }) => {
    vi.stubGlobal('fetch', async (): Promise<Response> => Response.json({ code, error: 'internal secret' }, { status }));
    await expect(submitAnnotationEdit(privateInput)).rejects.toMatchObject({ status,
      code: 'ANNOTATION_SUBMISSION_REJECTED', retryable: status === 429 });
  });

  it.each([500, 502])('sanitizes unclassified HTTP %s without retrying', async status => {
    vi.stubGlobal('fetch', async (): Promise<Response> => Response.json({ error: 'SELECT secret FROM task' }, { status }));
    await expect(submitAnnotationEdit(privateInput)).rejects.toMatchObject({ status: 502,
      code: 'ANNOTATION_SUBMISSION_FAILED', message: '批注修图提交暂不可用，请使用原请求重试', retryable: true });
  });

  it('preserves 503 for a non-JSON unavailable response without exposing its body', async () => {
    vi.stubGlobal('fetch', async (): Promise<Response> => new Response('postgres://internal secret', { status: 503 }));
    await expect(submitAnnotationEdit(privateInput)).rejects.toMatchObject({ status: 503,
      code: 'ANNOTATION_SUBMISSION_REJECTED', retryable: true });
  });

  it.each([null, { taskId: 123 }, { taskId: ' ' }, { taskId: 'task\nspoof' },
    { success: false, taskId: 'do-not-accept' }])('rejects invalid successful task payload %j', async payload => {
    vi.stubGlobal('fetch', async (): Promise<Response> => Response.json(payload, { status: 202 }));
    await expect(submitAnnotationEdit(privateInput)).rejects.toMatchObject({ status: 502,
      code: 'ANNOTATION_SUBMISSION_FAILED', retryable: true });
  });

  it('sanitizes a network rejection without issuing a second submission', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', async (): Promise<never> => { calls++; throw new Error('postgres://internal network secret'); });
    await expect(submitAnnotationEdit(privateInput)).rejects.toMatchObject({ status: 502,
      code: 'ANNOTATION_SUBMISSION_FAILED', message: '批注修图提交暂不可用，请使用原请求重试', retryable: true });
    expect(calls).toBe(1);
  });
});

import { Readable } from 'node:stream';
import sharp from 'sharp';
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/image-source-map', () => ({ saveImageDataMapping: async (): Promise<void> => undefined }));

import { acceptWorkflowEditResult, readWorkflowEditAcceptedResult } from '@/lib/collaboration/workflow-edit-acceptance';

const identity = {
  taskId: 'edit-accepted-42', actorId: 'actor-7', requestDigest: 'a'.repeat(64),
  providerId: 'provider-3', modelId: 'model-4',
};

function asDataUrl(bytes: Buffer): string {
  return `data:image/png;base64,${bytes.toString('base64')}`;
}

describe('workflow edit acceptance service', () => {
  let objects: Map<string, { bytes: Buffer; contentType: string }>;
  let rejectMedia: boolean;
  let rejectManifest: boolean;

  beforeEach(() => {
    vi.stubEnv('COZE_BUCKET_ENDPOINT_URL', 'http://127.0.0.1:1');
    vi.stubEnv('COZE_BUCKET_NAME', 'isolated-test');
    objects = new Map();
    rejectMedia = false;
    rejectManifest = false;
    vi.spyOn(S3Client.prototype, 'send').mockImplementation((async (command: unknown): Promise<unknown> => {
      const input = (command as { input: { Key: string; Body?: Uint8Array; ContentType?: string;
        IfNoneMatch?: string; IfMatch?: string; Range?: string } }).input;
      if (command instanceof PutObjectCommand) {
        if (rejectMedia && input.Key.startsWith('private/workflow-edit/media/')) throw new Error('S3_MEDIA_DOWN');
        if (rejectManifest && input.Key.startsWith('private/workflow-edit/accepted/')) throw new Error('S3_MANIFEST_DOWN');
        if (input.IfNoneMatch !== '*') throw new Error('mutable write');
        if (objects.has(input.Key)) throw Object.assign(new Error('exists'), { name: 'PreconditionFailed' });
        objects.set(input.Key, { bytes: Buffer.from(input.Body!), contentType: input.ContentType! });
        return {};
      }
      const stored = objects.get(input.Key);
      if (!stored) throw Object.assign(new Error('missing'), { name: 'NoSuchKey' });
      if (command instanceof HeadObjectCommand) return {
        ContentLength: stored.bytes.length, ContentType: stored.contentType,
        ETag: '"accepted"', VersionId: 'v1',
      };
      if (!(command instanceof GetObjectCommand)
        || input.IfMatch !== '"accepted"'
        || input.Range !== `bytes=0-${stored.bytes.length - 1}`) throw new Error('non-exact read');
      return {
        ContentLength: stored.bytes.length, ContentType: stored.contentType,
        ETag: '"accepted"', VersionId: 'v1',
        ContentRange: `bytes 0-${stored.bytes.length - 1}/${stored.bytes.length}`,
        Body: Readable.from([stored.bytes]),
      };
    }) as never);
  });

  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

  it('accepts every image into private media and a URL-free immutable task manifest', async () => {
    const first = await sharp({ create: { width: 2, height: 2, channels: 4,
      background: { r: 1, g: 2, b: 3, alpha: 1 } } }).png().toBuffer();
    const second = await sharp({ create: { width: 2, height: 2, channels: 4,
      background: { r: 4, g: 5, b: 6, alpha: 1 } } }).png().toBuffer();
    const result = { images: [{ url: asDataUrl(first) }, { url: asDataUrl(second) }], apiKey: 'never-store-this' };
    const accepted = await acceptWorkflowEditResult({ ...identity, result });
    expect(accepted).toMatchObject({ ...identity, images: [{ index: 0 }, { index: 1 }] });
    const manifest = objects.get('private/workflow-edit/accepted/edit-accepted-42.json')?.bytes;
    expect(manifest).toBeDefined();
    expect(JSON.parse(manifest!.toString('utf8'))).toMatchObject({
      taskId: identity.taskId, actorId: identity.actorId, requestDigest: identity.requestDigest,
      images: [{ index: 0 }, { index: 1 }],
    });
    expect(manifest!.toString('utf8')).not.toContain('data:image');
    expect(manifest!.toString('utf8')).not.toContain('never-store-this');
    expect([...objects.keys()].filter(key => key.startsWith('private/workflow-edit/media/'))).toHaveLength(2);
    const recovered = await readWorkflowEditAcceptedResult(identity);
    expect(recovered?.images).toEqual([first, second]);
    await expect(readWorkflowEditAcceptedResult({ ...identity, actorId: 'another-actor' }))
      .rejects.toThrow('WORKFLOW_EDIT_ACCEPTANCE_CONFLICT');
  });

  it('rejects a changed request identity without replacing the accepted manifest', async () => {
    const image = await sharp({ create: { width: 1, height: 1, channels: 4,
      background: { r: 1, g: 2, b: 3, alpha: 1 } } }).png().toBuffer();
    const input = { ...identity, result: { image: { url: asDataUrl(image) } } };
    await acceptWorkflowEditResult(input);
    const first = objects.get('private/workflow-edit/accepted/edit-accepted-42.json')?.bytes;
    await expect(acceptWorkflowEditResult({ ...input, requestDigest: 'b'.repeat(64) }))
      .rejects.toThrow('WORKFLOW_EDIT_ACCEPTANCE_CONFLICT');
    expect(objects.get('private/workflow-edit/accepted/edit-accepted-42.json')?.bytes).toEqual(first);
  });

  it('rejects a signed but undecodable image without creating a manifest', async () => {
    const fake = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);
    await expect(acceptWorkflowEditResult({ ...identity, result: { image: { url: asDataUrl(fake) } } }))
      .rejects.toThrow();
    expect(objects.has('private/workflow-edit/accepted/edit-accepted-42.json')).toBe(false);
  });

  it('does not claim acceptance when private media storage fails', async () => {
    const image = await sharp({ create: { width: 1, height: 1, channels: 4,
      background: { r: 1, g: 2, b: 3, alpha: 1 } } }).png().toBuffer();
    rejectMedia = true;
    await expect(acceptWorkflowEditResult({ ...identity, result: { image: { url: asDataUrl(image) } } }))
      .rejects.toThrow('S3_MEDIA_DOWN');
    expect(objects.has('private/workflow-edit/accepted/edit-accepted-42.json')).toBe(false);
  });

  it('does not claim acceptance when the final private manifest write fails', async () => {
    const image = await sharp({ create: { width: 1, height: 1, channels: 4,
      background: { r: 1, g: 2, b: 3, alpha: 1 } } }).png().toBuffer();
    rejectManifest = true;
    await expect(acceptWorkflowEditResult({ ...identity, result: { image: { url: asDataUrl(image) } } }))
      .rejects.toThrow('S3_MANIFEST_DOWN');
    expect(objects.has('private/workflow-edit/accepted/edit-accepted-42.json')).toBe(false);
  });

  it('refuses recovery if one accepted media object disappears', async () => {
    const first = await sharp({ create: { width: 1, height: 1, channels: 4,
      background: { r: 1, g: 2, b: 3, alpha: 1 } } }).png().toBuffer();
    const second = await sharp({ create: { width: 1, height: 1, channels: 4,
      background: { r: 4, g: 5, b: 6, alpha: 1 } } }).png().toBuffer();
    await acceptWorkflowEditResult({ ...identity,
      result: { images: [{ url: asDataUrl(first) }, { url: asDataUrl(second) }] } });
    const mediaKey = [...objects.keys()].find(key => key.startsWith('private/workflow-edit/media/edit-accepted-42/1-'))!;
    objects.delete(mediaKey);
    await expect(readWorkflowEditAcceptedResult(identity)).rejects.toThrow('WORKFLOW_EDIT_ACCEPTANCE_MEDIA_MISSING');
  });

  it('rejects a provider URL disguised as a frozen provider identifier before storage', async () => {
    const image = await sharp({ create: { width: 1, height: 1, channels: 4,
      background: { r: 1, g: 2, b: 3, alpha: 1 } } }).png().toBuffer();
    await expect(acceptWorkflowEditResult({ ...identity, providerId: 'https://provider.invalid/?key=secret',
      result: { image: { url: asDataUrl(image) } } })).rejects.toThrow('WORKFLOW_EDIT_ACCEPTANCE_IDENTITY_INVALID');
    expect(objects.size).toBe(0);
  });
});

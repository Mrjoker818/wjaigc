import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/image-source-map', () => ({ saveImageDataMapping: async (): Promise<void> => undefined }));

import { putWorkflowEditAcceptanceObject, readWorkflowEditAcceptanceObject,
  putWorkflowEditAcceptedMedia, readWorkflowEditAcceptedMedia,
  probeWorkflowEditAcceptanceStorage } from '@/lib/s3-storage';
import { GET as serveUpload } from '@/app/api/serve-upload/[...path]/route';

describe('private workflow edit acceptance transport', () => {
  let objects: Map<string, { bytes: Buffer; contentType: string }>;
  let commands: unknown[];
  let corruptResponse: 'none' | 'mime' | 'identity' | 'length';

  beforeEach(() => {
    vi.stubEnv('COZE_BUCKET_ENDPOINT_URL', 'http://127.0.0.1:1');
    vi.stubEnv('COZE_BUCKET_NAME', 'isolated-test');
    objects = new Map();
    commands = [];
    corruptResponse = 'none';
    vi.spyOn(S3Client.prototype, 'send').mockImplementation((async (command: unknown): Promise<unknown> => {
      commands.push(command);
      const input = (command as { input: { Key: string; Body?: Uint8Array; ContentType?: string;
        IfNoneMatch?: string; IfMatch?: string; Range?: string } }).input;
      if (command instanceof DeleteObjectCommand) {
        if (!input.Key.startsWith('private/workflow-edit/accepted/probe-')) {
          throw new Error('unsafe probe cleanup');
        }
        objects.delete(input.Key);
        return {};
      }
      if (command instanceof PutObjectCommand) {
        if (input.IfNoneMatch !== '*') throw new Error('acceptance object is not immutable');
        if (objects.has(input.Key)) throw Object.assign(new Error('exists'), { name: 'PreconditionFailed' });
        objects.set(input.Key, { bytes: Buffer.from(input.Body!), contentType: input.ContentType! });
        return {};
      }
      const stored = objects.get(input.Key);
      if (!stored) throw Object.assign(new Error('missing'), { name: 'NoSuchKey' });
      if (command instanceof HeadObjectCommand) return {
        ContentLength: corruptResponse === 'length' ? 40 * 1024 * 1024 : stored.bytes.length,
        ContentType: stored.contentType, ETag: '"accepted"', VersionId: 'v1',
      };
      if (!(command instanceof GetObjectCommand)) throw new Error('unexpected S3 command');
      if (input.IfMatch !== '"accepted"' || input.Range !== `bytes=0-${stored.bytes.length - 1}`) {
        throw new Error('read was not pinned to the exact object version and length');
      }
      return {
        ContentLength: stored.bytes.length,
        ContentType: corruptResponse === 'mime' ? 'text/html' : stored.contentType,
        ETag: corruptResponse === 'identity' ? '"changed"' : '"accepted"', VersionId: 'v1',
        ContentRange: `bytes 0-${stored.bytes.length - 1}/${stored.bytes.length}`,
        Body: Readable.from([stored.bytes]),
      };
    }) as never);
  });

  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

  it('creates one private task-keyed object and reads exactly that accepted content', async () => {
    const first = Buffer.from('{"accepted":"first"}');
    expect(await putWorkflowEditAcceptanceObject('edit-direct-outage', first)).toBe('created');
    expect(await putWorkflowEditAcceptanceObject('edit-direct-outage', Buffer.from('{"accepted":"second"}'))).toBe('existing');
    expect(await readWorkflowEditAcceptanceObject('edit-direct-outage')).toEqual(first);
    expect([...objects.keys()]).toEqual(['private/workflow-edit/accepted/edit-direct-outage.json']);
    expect(objects.get('private/workflow-edit/accepted/edit-direct-outage.json')?.contentType)
      .toBe('application/vnd.wujie.workflow-edit-acceptance+json');
  });

  it('rejects malformed task IDs before any storage command', async () => {
    await expect(putWorkflowEditAcceptanceObject('../edit', Buffer.from('{}'))).rejects.toThrow();
    await expect(readWorkflowEditAcceptanceObject('images/source.png')).rejects.toThrow();
    expect(commands).toEqual([]);
  });

  it('returns null for a missing task acceptance object', async () => {
    expect(await readWorkflowEditAcceptanceObject('edit-missing')).toBeNull();
  });

  it('rejects a manifest larger than 64 KiB before issuing a storage write', async () => {
    await expect(putWorkflowEditAcceptanceObject('edit-too-large', Buffer.alloc(64 * 1024 + 1)))
      .rejects.toThrow('WORKFLOW_EDIT_ACCEPTANCE_SIZE_INVALID');
    expect(commands).toEqual([]);
  });

  it.each(['mime', 'identity', 'length'] as const)('rejects %s corruption before returning accepted bytes', async mode => {
    await putWorkflowEditAcceptanceObject('edit-direct-outage', Buffer.from('{"accepted":true}'));
    corruptResponse = mode;
    await expect(readWorkflowEditAcceptanceObject('edit-direct-outage')).rejects.toThrow();
    if (mode === 'length') expect(commands.filter(command => command instanceof GetObjectCommand)).toHaveLength(0);
  });

  it('stores validated image bytes privately and recovers the exact digest for one task output', async () => {
    const image = await sharp({ create: { width: 2, height: 2, channels: 4,
      background: { r: 1, g: 2, b: 3, alpha: 1 } } }).png().toBuffer();
    const digest = createHash('sha256').update(image).digest('hex');
    const saved = await putWorkflowEditAcceptedMedia('edit-direct-outage', 0, image, 'image/png');
    expect(saved).toEqual({
      key: `private/workflow-edit/media/edit-direct-outage/0-${digest}.png`,
      sha256: digest, created: true,
    });
    expect(await readWorkflowEditAcceptedMedia('edit-direct-outage', 0, digest, 'image/png'))
      .toEqual(image);
    expect(await putWorkflowEditAcceptedMedia('edit-direct-outage', 0, image, 'image/png'))
      .toMatchObject({ created: false, sha256: digest });
  });

  it('rejects fake image bytes and a forged expected digest before writing or reading', async () => {
    await expect(putWorkflowEditAcceptedMedia('edit-direct-outage', 0, Buffer.from('not a png'), 'image/png'))
      .rejects.toThrow();
    await expect(readWorkflowEditAcceptedMedia('edit-direct-outage', 0, '0'.repeat(64), 'text/html'))
      .rejects.toThrow();
    expect(commands).toEqual([]);
  });

  it('does not expose private acceptance keys through the public media route', async () => {
    const parts = ['private', 'workflow-edit', 'accepted', 'edit-direct-outage.json'];
    const response = await serveUpload(new NextRequest(`https://app.example/api/serve-upload/${parts.join('/')}`),
      { params: Promise.resolve({ path: parts }) });
    expect(response.status).toBe(404);
    expect(commands).toEqual([]);
  });

  it('proves private shared storage by writing and reading a fresh nonce, then removes only that probe', async () => {
    expect(await probeWorkflowEditAcceptanceStorage()).toBe(true);
    expect(commands.filter(command => command instanceof PutObjectCommand)).toHaveLength(1);
    expect(commands.filter(command => command instanceof GetObjectCommand)).toHaveLength(1);
    expect(commands.filter(command => command instanceof DeleteObjectCommand)).toHaveLength(1);
    expect(objects.size).toBe(0);
  });

  it('fails closed and removes the probe when the private readback is invalid', async () => {
    corruptResponse = 'mime';
    await expect(probeWorkflowEditAcceptanceStorage()).rejects.toThrow();
    expect(commands.filter(command => command instanceof DeleteObjectCommand)).toHaveLength(1);
    expect(objects.size).toBe(0);
  });

  it('refuses a new workflow edit when shared storage is unconfigured', async () => {
    vi.stubEnv('COZE_BUCKET_NAME', '');
    expect(await probeWorkflowEditAcceptanceStorage()).toBe(false);
    expect(commands).toEqual([]);
  });
});

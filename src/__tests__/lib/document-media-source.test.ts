import { describe, expect, it, vi } from 'vitest';
import { isAllowedRemoteMimeType } from '@/lib/safe-image-download';
vi.mock('server-only', () => ({}));
import { importedMediaIdentity, prepareUploadedMedia, prepareAdoptedMedia, mediaSourceProject, mediaSourceKind, mediaSourceLimit, assertMediaVersionSource, type PreparedImportedMedia, type MediaTaskSource } from '@/lib/collaboration/document-media-source';
import type { PoolClient } from 'pg';
import type { ReadMediaBody } from '@/lib/collaboration/document-media-request';

describe('document media source dependency contract', () => {
  it('refuses forged version tokens before database or media IO', async (): Promise<void> => {
    const fake = { sourceKind: 'version', trusted: true, source: { owner_id: 'actor', task_id: null } } as unknown as Parameters<typeof prepareAdoptedMedia>[0];
    for (const read of [mediaSourceProject, mediaSourceKind, mediaSourceLimit]) expect(() => read(fake)).toThrow('DOCUMENT_MEDIA_SOURCE_FORBIDDEN');
    const client = { query: (): never => { throw new Error('unexpected database IO'); } } as unknown as PoolClient;
    await expect(assertMediaVersionSource(client, 'actor', { projectId: 'p', sourceVersionId: 'v', idempotencyKey: 'k',
      command: { action: 'attach', transform: { x: 0, y: 0, width: 1, height: 1, rotation: 0, zIndex: 0 } } }, fake)).rejects.toThrow('DOCUMENT_MEDIA_SOURCE_FORBIDDEN');
    await expect(prepareAdoptedMedia(fake, 'actor', 'owner', 'p', new AbortController().signal)).rejects.toThrow('DOCUMENT_MEDIA_SOURCE_FORBIDDEN');
  });
  it('permits a BMP task output through the existing safe downloader when explicitly requested', (): void => {
    expect(isAllowedRemoteMimeType('image/bmp', ['image/bmp'])).toBe(true);
  });
  it('rejects structural objects and HTTP-like validation flags as media capabilities', async (): Promise<void> => {
    const fake = { validated: true, bytes: Buffer.from('not media'), ownerId: 'owner', projectId: 'p', file: { availability: 'ready' } };
    expect(() => importedMediaIdentity(fake as unknown as PreparedImportedMedia)).toThrow('DOCUMENT_MEDIA_CONFLICT');
    await expect(prepareUploadedMedia(fake as unknown as ReadMediaBody, 'image/png', 'a.png', 'actor', 'owner', 'p', new AbortController().signal))
      .rejects.toThrow('DOCUMENT_MEDIA_INVALID');
    await expect(prepareAdoptedMedia(fake as unknown as MediaTaskSource, 'actor', 'owner', 'p', new AbortController().signal))
      .rejects.toThrow('DOCUMENT_MEDIA_SOURCE_FORBIDDEN');
  });
});

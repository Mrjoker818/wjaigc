import { describe, expect, it, vi } from 'vitest';

import { CanvasShareError } from '@/lib/canvas-share/errors';
import {
  createCanvasShareToken,
  hashCanvasShareToken,
  redactCanvasShareToken,
} from '@/lib/canvas-share/token';
import type { CanvasShareRecord } from '@/lib/canvas-share/types';

describe('canvas share token contract', () => {
  it('requests exactly 32 bytes from node:crypto for every token', async () => {
    vi.resetModules();
    const actualCrypto = await vi.importActual<typeof import('node:crypto')>('node:crypto');
    const randomBytes = vi.fn((size: number) => actualCrypto.randomBytes(size));
    vi.doMock('node:crypto', () => ({
      ...actualCrypto,
      randomBytes,
    }));

    try {
      const tokenModule = await import('@/lib/canvas-share/token');
      const token = tokenModule.createCanvasShareToken();

      expect(randomBytes).toHaveBeenCalledOnce();
      expect(randomBytes).toHaveBeenCalledWith(32);
      expect(Buffer.from(token, 'base64url')).toHaveLength(32);
    } finally {
      vi.doUnmock('node:crypto');
      vi.resetModules();
    }
  });

  it('generates URL-safe tokens backed by at least 32 random bytes', () => {
    const tokens = Array.from({ length: 32 }, () => createCanvasShareToken());

    expect(new Set(tokens)).toHaveLength(tokens.length);
    for (const token of tokens) {
      expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(Buffer.from(token, 'base64url').byteLength).toBeGreaterThanOrEqual(32);
    }
  });

  it('hashes the same raw token to the same SHA-256 digest', () => {
    expect(hashCanvasShareToken('canvas-share-test-token')).toBe(
      '881756059236c13eb7acf407d9ceb18f5714374d62a70dfb7cc196c01138acc7',
    );
    expect(hashCanvasShareToken('canvas-share-test-token')).toBe(
      hashCanvasShareToken('canvas-share-test-token'),
    );
  });

  it('does not collapse different raw tokens to one digest', () => {
    expect(hashCanvasShareToken('canvas-share-token-a')).not.toBe(
      hashCanvasShareToken('canvas-share-token-b'),
    );
  });

  it('keeps the raw token out of redaction, serialized records, and errors', () => {
    const rawToken = createCanvasShareToken();
    const tokenHash = hashCanvasShareToken(rawToken);
    const record: CanvasShareRecord = {
      id: 'share-1',
      ownerId: 'owner-1',
      projectId: 'project-1',
      projectRevision: 7,
      tokenHash,
      title: '只读画布',
      status: 'active',
      expiresAt: '2026-10-19T00:00:00.000Z',
      allowDownload: false,
      viewport: { offsetX: 0, offsetY: 0, zoom: 1 },
      snapshotDigest: 'a'.repeat(64),
      viewCount: 0,
      lastViewedAt: null,
      createdAt: '2026-09-19T00:00:00.000Z',
      revokedAt: null,
    };
    const redacted = redactCanvasShareToken(rawToken);
    const error = new CanvasShareError('CANVAS_SHARE_NOT_FOUND');
    const serialized = JSON.stringify({ record, error, redacted });

    expect(tokenHash).not.toContain(rawToken);
    expect(redacted).not.toBe(rawToken);
    expect(redacted).not.toContain(rawToken);
    expect(serialized).not.toContain(rawToken);
    expect(serialized).toContain(tokenHash);
    expect(error).toMatchObject({
      code: 'CANVAS_SHARE_NOT_FOUND',
      status: 404,
      message: '画布分享不存在或已失效',
    });
  });
});

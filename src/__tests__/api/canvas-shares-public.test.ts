import { createHash } from 'node:crypto';

import { NextRequest } from 'next/server';
import type { Pool } from 'pg';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Asset, AssetVersion } from '@/lib/asset-core/types';
import { CanvasShareError } from '@/lib/canvas-share/errors';
import {
  assertCanvasShareSnapshotIntegrity,
  createCanvasSharePublicItemRef,
  projectCanvasShareForPublic,
} from '@/lib/canvas-share/public-projection';
import {
  CanvasSharePublicRateLimitError,
} from '@/lib/canvas-share/public-rate-limit';
import type {
  CanvasShareItemRecord,
  CanvasSharePublicDocument,
  CanvasShareRecord,
} from '@/lib/canvas-share/types';
import { withActiveCanvasShareSnapshot } from '@/lib/canvas-share/storage';

const mocks = vi.hoisted(() => ({
  readPublicCanvasShare: vi.fn(),
  readPublicCanvasShareMedia: vi.fn(),
  enforceCanvasSharePublicRateLimit: vi.fn(),
}));
const transactionDatabase = { query: vi.fn() };

vi.mock('@/lib/canvas-share/service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/canvas-share/service')>()),
  readPublicCanvasShare: mocks.readPublicCanvasShare,
  readPublicCanvasShareMedia: mocks.readPublicCanvasShareMedia,
}));

vi.mock('@/lib/canvas-share/public-rate-limit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/canvas-share/public-rate-limit')>()),
  enforceCanvasSharePublicRateLimit: mocks.enforceCanvasSharePublicRateLimit,
}));

import { GET as getPublicShare } from '@/app/api/public/canvas-shares/[token]/route';
import { GET as getPublicMedia } from '@/app/api/public/canvas-shares/[token]/media/[itemId]/route';
import { GET as downloadPublicMedia } from '@/app/api/public/canvas-shares/[token]/media/[itemId]/download/route';

const rawToken = 'A'.repeat(43);
const tokenDigest = createHash('sha256').update(rawToken).digest('hex');
const now = '2026-09-19T12:00:00.000Z';

const record: CanvasShareRecord = {
  id: 'share-internal-private',
  ownerId: 'owner-private',
  projectId: 'project-private',
  projectRevision: 7,
  tokenHash: tokenDigest,
  title: '客户审阅画布',
  status: 'active',
  expiresAt: '2026-10-19T00:00:00.000Z',
  allowDownload: false,
  viewport: { offsetX: 12, offsetY: 34, zoom: 1.25 },
  snapshotDigest: 'snapshot-private',
  viewCount: 0,
  lastViewedAt: null,
  createdAt: '2026-09-19T00:00:00.000Z',
  revokedAt: null,
};

const item: CanvasShareItemRecord = {
  id: 'item-internal-private',
  shareId: record.id,
  placementId: 'placement-private',
  assetId: 'asset-private',
  assetVersionId: 'version-private',
  entityType: 'canvas-image',
  assetKind: 'image',
  transform: { x: 10, y: 20, width: 640, height: 480, rotation: 0, zIndex: 2 },
  displayMetadata: { label: '主视觉', altText: '蓝色产品海报' },
  mimeType: 'image/png',
  width: 640,
  height: 480,
  byteSize: 4,
  checksum: 'checksum-private',
  availability: 'ready',
  sortOrder: 0,
  createdAt: record.createdAt,
};

const itemRef = createCanvasSharePublicItemRef(tokenDigest, item.id);
const publicDocument: CanvasSharePublicDocument = {
  title: record.title,
  revisionLabel: '修订 7',
  createdAt: record.createdAt,
  allowDownload: false,
  viewport: record.viewport,
  items: [{
    itemRef,
    entityType: item.entityType,
    assetKind: item.assetKind,
    transform: item.transform,
    display: item.displayMetadata,
    mimeType: item.mimeType,
    width: item.width,
    height: item.height,
    mediaPath: `media/${itemRef}`,
  }],
};

function expectNoRecursiveToken(value: unknown, token: string): void {
  if (typeof value === 'string') {
    expect(value).not.toContain(token);
    return;
  }
  if (Array.isArray(value)) {
    for (const itemValue of value) expectNoRecursiveToken(itemValue, token);
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const [key, nestedValue] of Object.entries(value)) {
      expect(key).not.toContain(token);
      expectNoRecursiveToken(nestedValue, token);
    }
  }
}

function routeContext(token = rawToken) {
  return { params: Promise.resolve({ token }) };
}

function mediaRouteContext(token = rawToken, scopedItemRef = itemRef) {
  return { params: Promise.resolve({ token, itemId: scopedItemRef }) };
}

function assertPublicHeaders(response: Response): void {
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow, noarchive');
  expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  expect(response.headers.get('access-control-allow-origin')).toBeNull();
}

async function invalidResponseSignature(response: Response): Promise<unknown> {
  const body = await response.json() as Record<string, unknown>;
  const { requestId: _requestId, ...stableBody } = body;
  const stableHeaders = [...response.headers.entries()]
    .filter(([name]) => name !== 'x-request-id');
  return { status: response.status, body: stableBody, headers: stableHeaders };
}

describe('canvas-share explicit public projection', () => {
  it('returns only the documented allowlist with a share-scoped item reference', () => {
    const projected = projectCanvasShareForPublic(record, [{
      ...item,
      displayMetadata: {
        ...item.displayMetadata,
        prompt: 'private prompt',
        provider: 'private provider',
      },
      storageKey: 'private/storage/key.png',
      sourceUrl: 'https://private.example/source.png',
      metadata: { billing: 99, apiKey: 'sk-private' },
    } as CanvasShareItemRecord]);

    expect(projected).toEqual(publicDocument);
    expect(Object.keys(projected).sort()).toEqual([
      'allowDownload', 'createdAt', 'items', 'revisionLabel', 'title', 'viewport',
    ]);
    expect(Object.keys(projected.items[0]).sort()).toEqual([
      'assetKind', 'display', 'entityType', 'height', 'itemRef', 'mediaPath',
      'mimeType', 'transform', 'width',
    ]);
    expect(projected.items[0].itemRef).not.toBe(item.id);
    expect(projected.items[0].itemRef).toMatch(/^csr_[A-Za-z0-9_-]{43}$/u);
    expect(projected.items[0].mediaPath).toBe(`media/${itemRef}`);
    expect(projected.items[0].mediaPath).not.toMatch(/^(?:[a-z][a-z\d+.-]*:|\/|\.\.)/iu);
    expectNoRecursiveToken(projected, rawToken);
  });

  it('never exposes private keys or values from records and JSON metadata', () => {
    const projected = projectCanvasShareForPublic(record, [item]);
    const serialized = JSON.stringify(projected);
    const forbiddenValues = [
      record.id,
      record.ownerId,
      record.projectId,
      record.tokenHash,
      record.snapshotDigest,
      rawToken,
      item.id,
      item.shareId,
      item.placementId,
      item.assetId,
      item.assetVersionId,
      item.checksum,
    ];
    for (const value of forbiddenValues) expect(serialized).not.toContain(value);
    expect(serialized).not.toMatch(
      /"(?:owner|user|project|placement|assetId|assetVersion|versionId|task|provider|model|prompt|apiKey|billing|storageKey|sourceUrl|metadata)"/iu,
    );
  });

  it('removes unsafe URLs, controls, bidi controls, and HTML-like display text', () => {
    const projected = projectCanvasShareForPublic({
      ...record,
      title: 'https://private.example/<script>secret</script>',
    }, [{
      ...item,
      displayMetadata: {
        label: '<img src=x onerror=alert(1)>',
        altText: '正常\u0000中\u200B文\u2060\u202E说明',
      },
    }]);

    expect(projected.title).toBe('共享画布');
    expect(projected.items[0].display).toEqual({ altText: '正常 中文说明' });
    const serialized = JSON.stringify(projected);
    for (const forbidden of [
      'https://private.example/', '<script>', '</script>', '<img', 'onerror',
      '\u0000', '\u200B', '\u2060', '\u202E',
    ]) expect(serialized).not.toContain(forbidden);
  });

  it.each([
    ['scheme without slashes', 'https:private-secret'],
    ['arbitrary absolute scheme', 'ftp:private-secret'],
    ['custom compact scheme', 'custom:private-secret'],
    ['javascript scheme', 'javascript:alert(1)'],
    ['data scheme', 'data:text/html,private-secret'],
    ['bidi-hidden scheme', 'java\u202Escript:alert(1)'],
    ['zero-width-hidden scheme', 'https\u200B:private-secret'],
    ['word-joiner-hidden scheme', 'java\u2060script:alert(1)'],
    ['generic format-hidden scheme', 'https\u0600:private-secret'],
    ['scheme-relative URL', '//private.example/secret'],
    ['URL-like host', 'www.private.example/secret'],
    ['Unicode IDN host', '例子.公司/private-secret'],
    ['Unicode IDNA ideographic dot host', '例子。公司/private-secret'],
    ['Unicode IDNA fullwidth dot host', '例子．公司/private-secret'],
    ['Unicode IDNA halfwidth dot host', '例子｡公司/private-secret'],
    ['ASCII host before comma', 'visit example.com, private-secret'],
    ['ASCII host before closing parenthesis', 'visit (example.com) private-secret'],
    ['ASCII host before sentence period', 'visit example.com. private-secret'],
    ['bracketed IPv6 host', '[::1]/private-secret'],
    ['HTML-like markup', '<svg onload=alert(1)>'],
  ])('rejects normalized public text containing %s', (_caseName, unsafeText) => {
    const projected = projectCanvasShareForPublic({
      ...record,
      title: unsafeText,
    }, [{
      ...item,
      displayMetadata: { label: unsafeText, altText: unsafeText },
    }]);

    expect(projected.title).toBe('共享画布');
    expect(projected.items[0].display).toEqual({});
    expect(JSON.stringify(projected)).not.toContain('private-secret');
    expect(JSON.stringify(projected)).not.toContain('alert(1)');
  });

  it.each([
    'http', 'https', 'ftp', 'ftps', 'file', 'data', 'javascript', 'vbscript',
    'blob', 'ws', 'wss', 'irc', 'ircs', 'mailto', 'tel', 'ssh', 'sftp',
    'ldap', 'ldaps', 'news', 'nntp', 'magnet', 'intent', 'about',
  ])('rejects known network or executable scheme %s even with spaced payload', scheme => {
    const unsafeText = `${scheme}: public-secret`;
    const projected = projectCanvasShareForPublic({
      ...record,
      title: unsafeText,
    }, [{
      ...item,
      displayMetadata: { label: unsafeText, altText: unsafeText },
    }]);

    expect(projected.title).toBe('共享画布');
    expect(projected.items[0].display).toEqual({});
    expect(JSON.stringify(projected)).not.toContain('public-secret');
  });

  it('preserves spaced prose colons, ordinary multilingual alt text, numeric colons, and emoji graphemes', () => {
    const projected = projectCanvasShareForPublic({
      ...record,
      title: '版本 A: 正式稿，版本 1.2 正式稿 👩‍💻 ❤️ 1️⃣ 🇨🇳 👍🏽',
    }, [{
      ...item,
      displayMetadata: {
        label: 'Poster: blue product ❤️',
        altText: '蓝色产品海报 Blue product poster，画面比例 16:9，时间 10:30',
      },
    }]);

    expect(projected.title).toBe('版本 A: 正式稿，版本 1.2 正式稿 👩‍💻 ❤️ 1️⃣ 🇨🇳 👍🏽');
    expect(projected.items[0].display).toEqual({
      label: 'Poster: blue product ❤️',
      altText: '蓝色产品海报 Blue product poster，画面比例 16:9，时间 10:30',
    });
  });

  it('removes invalid emoji tags and leading, trailing, or repeated ZWJ while keeping base glyphs', () => {
    const projected = projectCanvasShareForPublic({
      ...record,
      title: '🏴\u{E0061}\u{E007F} 👩\u200D',
    }, [{
      ...item,
      displayMetadata: {
        label: '\u200D👩 👩\u200D\u200D💻',
      },
    }]);

    expect(projected.title).toBe('🏴 👩');
    expect(projected.items[0].display).toEqual({ label: '👩 👩💻' });
    expect(JSON.stringify(projected)).not.toMatch(/[\u200D\u{E0020}-\u{E007F}]/u);
  });

  it('removes standalone emoji-only components without removing ordinary text or punctuation', () => {
    const unsafeComponents = '中文 🏽 🇨 \u20E3 English 123 !?';
    const projected = projectCanvasShareForPublic({
      ...record,
      title: unsafeComponents,
    }, [{
      ...item,
      displayMetadata: {
        label: unsafeComponents,
        altText: unsafeComponents,
      },
    }]);

    expect(projected.title).toBe('中文 English 123 !?');
    expect(projected.items[0].display).toEqual({
      label: '中文 English 123 !?',
      altText: '中文 English 123 !?',
    });
    expect(JSON.stringify(projected)).not.toMatch(/[\p{Emoji_Modifier}\p{Regional_Indicator}\u20E3]/u);
  });

  it('truncates title, label, and alt text only at grapheme boundaries', () => {
    const titlePrefix = '中'.repeat(197);
    const labelPrefix = 'L'.repeat(198);
    const altPrefix = '文'.repeat(998);
    const legalEmojiSet = '👩‍💻 ❤️ 1️⃣ 🇨🇳 👍🏽';
    const projected = projectCanvasShareForPublic({
      ...record,
      title: `${titlePrefix}${legalEmojiSet} title-tail`,
    }, [{
      ...item,
      displayMetadata: {
        label: `${labelPrefix}1️⃣ 👩‍💻 ❤️ 🇨🇳 👍🏽 label-tail`,
        altText: `${altPrefix}🇨🇳 👩‍💻 ❤️ 1️⃣ 👍🏽 alt-tail`,
      },
    }]);

    expect(projected.title).toBe(titlePrefix);
    expect(projected.items[0].display).toEqual({
      label: labelPrefix,
      altText: altPrefix,
    });
    expect(projected.title.length).toBeLessThanOrEqual(200);
    expect(projected.items[0].display.label?.length).toBeLessThanOrEqual(200);
    expect(projected.items[0].display.altText?.length).toBeLessThanOrEqual(1_000);
    const serialized = JSON.stringify(projected);
    expect(serialized).not.toMatch(/[\u200D\uFE0F\p{Emoji_Modifier}\p{Regional_Indicator}\u20E3]/u);
    expect(serialized).not.toMatch(
      /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u,
    );

    for (const emoji of ['👩‍💻', '❤️', '1️⃣', '🇨🇳', '👍🏽']) {
      const exactTitlePrefix = '中'.repeat(200 - emoji.length);
      const overflowTitlePrefix = '中'.repeat(201 - emoji.length);
      expect(projectCanvasShareForPublic({
        ...record,
        title: `${exactTitlePrefix}${emoji}`,
      }, [item]).title).toBe(`${exactTitlePrefix}${emoji}`);
      expect(projectCanvasShareForPublic({
        ...record,
        title: `${overflowTitlePrefix}${emoji}`,
      }, [item]).title).toBe(overflowTitlePrefix);

      const exactLabelPrefix = 'L'.repeat(200 - emoji.length);
      const overflowLabelPrefix = 'L'.repeat(201 - emoji.length);
      expect(projectCanvasShareForPublic(record, [{
        ...item,
        displayMetadata: { label: `${exactLabelPrefix}${emoji}` },
      }]).items[0].display.label).toBe(`${exactLabelPrefix}${emoji}`);
      expect(projectCanvasShareForPublic(record, [{
        ...item,
        displayMetadata: { label: `${overflowLabelPrefix}${emoji}` },
      }]).items[0].display.label).toBe(overflowLabelPrefix);

      const exactAltPrefix = '文'.repeat(1_000 - emoji.length);
      const overflowAltPrefix = '文'.repeat(1_001 - emoji.length);
      expect(projectCanvasShareForPublic(record, [{
        ...item,
        displayMetadata: { altText: `${exactAltPrefix}${emoji}` },
      }]).items[0].display.altText).toBe(`${exactAltPrefix}${emoji}`);
      expect(projectCanvasShareForPublic(record, [{
        ...item,
        displayMetadata: { altText: `${overflowAltPrefix}${emoji}` },
      }]).items[0].display.altText).toBe(overflowAltPrefix);
    }
  });

  it('keeps ordinary Chinese and English text within the public schema length limits', () => {
    const title = `${'中文'.repeat(100)}尾部`;
    const label = `${'Ab'.repeat(100)}tail`;
    const altText = `${'说明'.repeat(500)}尾部`;
    const projected = projectCanvasShareForPublic({
      ...record,
      title,
    }, [{
      ...item,
      displayMetadata: { label, altText },
    }]);

    expect(projected.title).toBe('中文'.repeat(100));
    expect(projected.items[0].display).toEqual({
      label: 'Ab'.repeat(100),
      altText: '说明'.repeat(500),
    });
  });

  it('uses a different item reference for the same internal item under another share digest', () => {
    expect(createCanvasSharePublicItemRef('b'.repeat(64), item.id)).not.toBe(itemRef);
  });

  it('rejects an item-count or snapshot-digest mismatch before public projection', () => {
    expect(() => assertCanvasShareSnapshotIntegrity(record, [])).toThrowError(
      expect.objectContaining({ code: 'CANVAS_SHARE_NOT_FOUND' }),
    );
    expect(() => assertCanvasShareSnapshotIntegrity(record, [item])).toThrowError(
      expect.objectContaining({ code: 'CANVAS_SHARE_NOT_FOUND' }),
    );
  });
});

describe('canvas-share durable public rate limit', () => {
  it('takes an update-capable lifecycle lock before view counter mutation', async () => {
    const lockObserved = new Error('lock observed');
    const query = vi.fn(async (sql: string) => {
      if (sql === 'BEGIN' || sql === 'ROLLBACK') return { rows: [] };
      expect(sql).toMatch(/FOR UPDATE/iu);
      expect(sql).not.toMatch(/FOR SHARE/iu);
      throw lockObserved;
    });
    const release = vi.fn();
    const database = {
      connect: vi.fn(async () => ({ query, release })),
    } as unknown as Pool;

    await expect(withActiveCanvasShareSnapshot(
      tokenDigest,
      now,
      async () => undefined,
      database,
    )).rejects.toBe(lockObserved);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('uses a concurrent shared lifecycle lock for media without a lock upgrade', async () => {
    const actualStorage = await vi.importActual<typeof import('@/lib/canvas-share/storage')>(
      '@/lib/canvas-share/storage',
    );
    const mediaSnapshot = (
      actualStorage as typeof actualStorage & {
        withActiveCanvasShareMediaSnapshot?: typeof withActiveCanvasShareSnapshot;
      }
    ).withActiveCanvasShareMediaSnapshot;
    expect(mediaSnapshot).toBeTypeOf('function');
    if (!mediaSnapshot) return;

    const lockObserved = new Error('shared lock observed');
    const query = vi.fn(async (sql: string) => {
      if (sql === 'BEGIN' || sql === 'ROLLBACK') return { rows: [] };
      expect(sql).toMatch(/FOR SHARE/iu);
      expect(sql).not.toMatch(/FOR UPDATE/iu);
      throw lockObserved;
    });
    const release = vi.fn();
    const database = {
      connect: vi.fn(async () => ({ query, release })),
    } as unknown as Pool;

    await expect(mediaSnapshot(
      tokenDigest,
      now,
      async () => undefined,
      database,
    )).rejects.toBe(lockObserved);
    expect(query.mock.calls.map(([sql]) => sql)).toEqual([
      'BEGIN',
      expect.stringMatching(/FOR SHARE/iu),
      'ROLLBACK',
    ]);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('trusts proxy IP headers only after an explicit deployment opt-in', async () => {
    const actualRateLimit = await vi.importActual<
      typeof import('@/lib/canvas-share/public-rate-limit')
    >('@/lib/canvas-share/public-rate-limit');
    const headers = new Headers({ 'x-forwarded-for': '203.0.113.99, 10.0.0.1' });
    vi.stubEnv('WUJIE_TRUST_PROXY_IP_HEADERS', 'false');
    expect(actualRateLimit.getCanvasShareRequestIp(headers)).toBe('unknown');
    vi.stubEnv('WUJIE_TRUST_PROXY_IP_HEADERS', 'true');
    expect(actualRateLimit.getCanvasShareRequestIp(headers)).toBe('203.0.113.99');
    vi.unstubAllEnvs();
  });

  it('persists only a one-way scope digest and performs bounded retention cleanup', async () => {
    const actualRateLimit = await vi.importActual<
      typeof import('@/lib/canvas-share/public-rate-limit')
    >('@/lib/canvas-share/public-rate-limit');
    const query = vi.fn().mockResolvedValue({ rows: [{ attempt_count: 1 }] });

    await actualRateLimit.enforceCanvasSharePublicRateLimit({
      tokenDigest,
      itemScope: itemRef,
      ipAddress: '203.0.113.9',
      routeBucket: 'media',
      now: new Date(now),
      database: { query },
    });

    expect(query).toHaveBeenCalledTimes(1);
    const [sql, values] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/DELETE FROM wujie_canvas_share_rate_windows/iu);
    expect(sql).toMatch(/INSERT INTO wujie_canvas_share_rate_windows/iu);
    expect(sql).toMatch(/ON CONFLICT[\s\S]+DO UPDATE/iu);
    expect(values[0]).toMatch(/^[a-f0-9]{64}$/u);
    expect(values).not.toContain(rawToken);
    expect(values).not.toContain(itemRef);
    expect(values).not.toContain('203.0.113.9');
  });

  it('raises a stable 429 error after the atomic window count exceeds the bucket limit', async () => {
    const actualRateLimit = await vi.importActual<
      typeof import('@/lib/canvas-share/public-rate-limit')
    >('@/lib/canvas-share/public-rate-limit');
    const query = vi.fn().mockResolvedValue({ rows: [{ attempt_count: 61 }] });

    await expect(actualRateLimit.enforceCanvasSharePublicRateLimit({
      tokenDigest,
      itemScope: 'metadata',
      ipAddress: '198.51.100.20',
      routeBucket: 'metadata',
      now: new Date(now),
      database: { query },
    })).rejects.toBeInstanceOf(CanvasSharePublicRateLimitError);
  });
});

describe('canvas-share public API', () => {
  beforeEach(() => {
    Object.values(mocks).forEach(mock => mock.mockReset());
    vi.stubEnv('WUJIE_CANVAS_SHARE_ENABLED', 'true');
    vi.stubEnv('WUJIE_TRUST_PROXY_IP_HEADERS', 'true');
    mocks.enforceCanvasSharePublicRateLimit.mockResolvedValue(undefined);
    mocks.readPublicCanvasShare.mockImplementation(async (
      _token: string,
      options?: { onAuthorized?(database: typeof transactionDatabase): Promise<void> },
    ) => {
      await options?.onAuthorized?.(transactionDatabase);
      return publicDocument;
    });
    mocks.readPublicCanvasShareMedia.mockImplementation(async (
      input: { onAuthorized?(database: typeof transactionDatabase): Promise<void> },
    ) => {
      await input.onAuthorized?.(transactionDatabase);
      return {
        bytes: Buffer.from([1, 2, 3, 4]),
        mimeType: 'image/png',
        totalBytes: 4,
        contentLength: 4,
        fileName: 'main-visual.png',
      };
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('returns the safe metadata projection and counts rate scope by digest rather than raw token', async () => {
    const response = await getPublicShare(
      new NextRequest(`http://localhost/api/public/canvas-shares/${rawToken}`, {
        headers: { 'x-forwarded-for': '203.0.113.7' },
      }),
      routeContext(),
    );

    expect(response.status).toBe(200);
    assertPublicHeaders(response);
    expect(await response.json()).toEqual(publicDocument);
    expect(mocks.readPublicCanvasShare).toHaveBeenCalledWith(rawToken, expect.objectContaining({
      onAuthorized: expect.any(Function),
    }));
    expect(mocks.enforceCanvasSharePublicRateLimit).toHaveBeenCalledWith(expect.objectContaining({
      tokenDigest,
      itemScope: 'metadata',
      ipAddress: '203.0.113.7',
      routeBucket: 'metadata',
      database: transactionDatabase,
    }));
    expect(JSON.stringify(mocks.enforceCanvasSharePublicRateLimit.mock.calls)).not.toContain(rawToken);
  });

  it('keeps metadata, media, and download rate buckets isolated', async () => {
    await getPublicShare(
      new NextRequest(`http://localhost/api/public/canvas-shares/${rawToken}`),
      routeContext(),
    );
    await getPublicMedia(
      new NextRequest(
        `http://localhost/api/public/canvas-shares/${rawToken}/media/${itemRef}`,
      ),
      mediaRouteContext(),
    );
    await downloadPublicMedia(
      new NextRequest(
        `http://localhost/api/public/canvas-shares/${rawToken}/media/${itemRef}/download`,
      ),
      mediaRouteContext(),
    );

    expect(mocks.enforceCanvasSharePublicRateLimit).toHaveBeenCalledTimes(3);
    expect(mocks.enforceCanvasSharePublicRateLimit).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        routeBucket: 'metadata',
        itemScope: 'metadata',
        database: transactionDatabase,
      }),
    );
    expect(mocks.enforceCanvasSharePublicRateLimit).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        routeBucket: 'media',
        itemScope: itemRef,
        database: transactionDatabase,
      }),
    );
    expect(mocks.enforceCanvasSharePublicRateLimit).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        routeBucket: 'download',
        itemScope: itemRef,
        database: transactionDatabase,
      }),
    );
  });

  it.each([
    ['wrong token', true],
    ['revoked', true],
    ['expired', true],
  ])('normalizes %s to one viewer-facing invalid semantic', async (_name, rejectFromService) => {
    if (rejectFromService) {
      mocks.readPublicCanvasShare.mockRejectedValue(new CanvasShareError('CANVAS_SHARE_NOT_FOUND'));
    }
    const response = await getPublicShare(
      new NextRequest(`http://localhost/api/public/canvas-shares/${rawToken}`),
      routeContext(),
    );
    assertPublicHeaders(response);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual(expect.objectContaining({
      code: 'CANVAS_SHARE_NOT_FOUND',
      message: '画布分享不存在或已失效',
    }));
  });

  it('generates public request IDs server-side without reflecting a raw token header', async () => {
    mocks.readPublicCanvasShare.mockRejectedValue(
      new CanvasShareError('CANVAS_SHARE_NOT_FOUND'),
    );
    const responses = await Promise.all([1, 2].map(() => getPublicShare(
      new NextRequest(`http://localhost/api/public/canvas-shares/${rawToken}`, {
        headers: { 'x-request-id': rawToken },
      }),
      routeContext(),
    )));
    const responseIds: string[] = [];

    for (const response of responses) {
      const body = await response.json() as Record<string, unknown>;
      const responseId = response.headers.get('x-request-id');
      expect(responseId).toMatch(/^req_[a-f0-9]{16}$/u);
      expect(body.requestId).toBe(responseId);
      expectNoRecursiveToken(body, rawToken);
      expect(JSON.stringify([...response.headers.entries()])).not.toContain(rawToken);
      responseIds.push(responseId!);
    }
    expect(new Set(responseIds)).toHaveLength(2);
  });

  it('keeps the public feature flag default-off with the same invalid semantic', async () => {
    vi.stubEnv('WUJIE_CANVAS_SHARE_ENABLED', 'false');

    const response = await getPublicShare(
      new NextRequest(`http://localhost/api/public/canvas-shares/${rawToken}`),
      routeContext(),
    );

    assertPublicHeaders(response);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual(expect.objectContaining({
      code: 'CANVAS_SHARE_NOT_FOUND',
      message: '画布分享不存在或已失效',
    }));
    expect(mocks.readPublicCanvasShare).not.toHaveBeenCalled();
    expect(mocks.enforceCanvasSharePublicRateLimit).not.toHaveBeenCalled();
  });

  it('keeps every invalid lifecycle state indistinguishable and outside all rate buckets', async () => {
    const invalidCases = [
      { name: 'malformed', token: 'bad!', featureEnabled: true, rejectLookup: false },
      { name: 'random', token: rawToken, featureEnabled: true, rejectLookup: true },
      { name: 'revoked', token: rawToken, featureEnabled: true, rejectLookup: true },
      { name: 'expired', token: rawToken, featureEnabled: true, rejectLookup: true },
      { name: 'flag-off', token: rawToken, featureEnabled: false, rejectLookup: false },
    ] as const;
    let expectedSignature: unknown;

    for (const invalidCase of invalidCases) {
      vi.stubEnv('WUJIE_CANVAS_SHARE_ENABLED', String(invalidCase.featureEnabled));
      mocks.enforceCanvasSharePublicRateLimit.mockReset().mockRejectedValue(
        new CanvasSharePublicRateLimitError(60),
      );
      mocks.readPublicCanvasShare.mockReset();
      mocks.readPublicCanvasShareMedia.mockReset();
      if (invalidCase.rejectLookup) {
        const invalid = new CanvasShareError('CANVAS_SHARE_NOT_FOUND');
        mocks.readPublicCanvasShare.mockRejectedValue(invalid);
        mocks.readPublicCanvasShareMedia.mockRejectedValue(invalid);
      }
      const requests = [
        () => getPublicShare(
          new NextRequest(`http://localhost/api/public/canvas-shares/${invalidCase.token}`),
          routeContext(invalidCase.token),
        ),
        () => getPublicMedia(
          new NextRequest(
            `http://localhost/api/public/canvas-shares/${invalidCase.token}/media/${itemRef}`,
          ),
          mediaRouteContext(invalidCase.token),
        ),
        () => downloadPublicMedia(
          new NextRequest(
            `http://localhost/api/public/canvas-shares/${invalidCase.token}/media/${itemRef}/download`,
          ),
          mediaRouteContext(invalidCase.token),
        ),
      ];

      for (const request of requests) {
        for (let attempt = 0; attempt < 2; attempt += 1) {
          const signature = await invalidResponseSignature(await request());
          expectedSignature ??= signature;
          expect(signature, `${invalidCase.name} attempt ${attempt + 1}`).toEqual(
            expectedSignature,
          );
        }
      }
      expect(mocks.enforceCanvasSharePublicRateLimit, invalidCase.name).not.toHaveBeenCalled();
    }
  });

  it('serves preview bytes inline with exact safe headers', async () => {
    const response = await getPublicMedia(
      new NextRequest(
        `http://localhost/api/public/canvas-shares/${rawToken}/media/${itemRef}`,
      ),
      mediaRouteContext(),
    );

    expect(response.status).toBe(200);
    assertPublicHeaders(response);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(response.headers.get('content-length')).toBe('4');
    expect(response.headers.get('content-disposition')).toBeNull();
    expect(Buffer.from(await response.arrayBuffer())).toEqual(Buffer.from([1, 2, 3, 4]));
  });

  it('handles media and download HEAD explicitly without a response body', async () => {
    const mediaRoute = await vi.importActual<
      typeof import('@/app/api/public/canvas-shares/[token]/media/[itemId]/route')
    >('@/app/api/public/canvas-shares/[token]/media/[itemId]/route');
    const downloadRoute = await vi.importActual<
      typeof import('@/app/api/public/canvas-shares/[token]/media/[itemId]/download/route')
    >('@/app/api/public/canvas-shares/[token]/media/[itemId]/download/route');
    const mediaHead = (mediaRoute as typeof mediaRoute & { HEAD?: typeof mediaRoute.GET }).HEAD;
    const downloadHead = (
      downloadRoute as typeof downloadRoute & { HEAD?: typeof downloadRoute.GET }
    ).HEAD;
    expect(mediaHead).toBeTypeOf('function');
    expect(downloadHead).toBeTypeOf('function');
    if (!mediaHead || !downloadHead) return;

    mocks.readPublicCanvasShareMedia.mockImplementation(async (
      input: { onAuthorized?(database: typeof transactionDatabase): Promise<void> },
    ) => {
      await input.onAuthorized?.(transactionDatabase);
      return {
        bytes: null,
        mimeType: 'image/png',
        totalBytes: 4,
        contentLength: 4,
        fileName: 'main-visual.png',
      };
    });
    const preview = await mediaHead(
      new NextRequest(`http://localhost/api/public/canvas-shares/${rawToken}/media/${itemRef}`),
      mediaRouteContext(),
    );
    const download = await downloadHead(
      new NextRequest(
        `http://localhost/api/public/canvas-shares/${rawToken}/media/${itemRef}/download`,
      ),
      mediaRouteContext(),
    );

    for (const response of [preview, download]) {
      expect(response.status).toBe(200);
      assertPublicHeaders(response);
      expect(response.headers.get('content-type')).toBe('image/png');
      expect(response.headers.get('content-length')).toBe('4');
      expect(await response.text()).toBe('');
    }
    expect(preview.headers.get('content-disposition')).toBeNull();
    expect(download.headers.get('content-disposition')).toContain('attachment;');
    expect(mocks.readPublicCanvasShareMedia).toHaveBeenNthCalledWith(1, expect.objectContaining({
      headOnly: true,
      download: false,
    }));
    expect(mocks.readPublicCanvasShareMedia).toHaveBeenNthCalledWith(2, expect.objectContaining({
      headOnly: true,
      download: true,
    }));
  });

  it('does not let query IDs, URLs, source URLs, or Range redirect the server lookup', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const request = new NextRequest(
      `http://localhost/api/public/canvas-shares/${rawToken}/media/${itemRef}`
        + '?itemId=item-forged&assetId=asset-forged'
        + '&url=https%3A%2F%2Fattacker.example%2Fprivate.png'
        + '&sourceUrl=http%3A%2F%2F127.0.0.1%2Fadmin',
      { headers: { Range: 'bytes=0-3' } },
    );

    await getPublicMedia(request, mediaRouteContext());

    expect(mocks.readPublicCanvasShareMedia).toHaveBeenCalledWith(expect.objectContaining({
      token: rawToken,
      itemRef,
      download: false,
      rangeHeader: 'bytes=0-3',
    }));
    expect(JSON.stringify(mocks.readPublicCanvasShareMedia.mock.calls)).not.toMatch(
      /item-forged|asset-forged|attacker\.example|127\.0\.0\.1/iu,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('keeps preview available while download is disabled server-side', async () => {
    const preview = await getPublicMedia(
      new NextRequest(
        `http://localhost/api/public/canvas-shares/${rawToken}/media/${itemRef}`,
      ),
      mediaRouteContext(),
    );
    mocks.readPublicCanvasShareMedia.mockRejectedValueOnce(
      new CanvasShareError('CANVAS_SHARE_DOWNLOAD_DISABLED'),
    );
    const download = await downloadPublicMedia(
      new NextRequest(
        `http://localhost/api/public/canvas-shares/${rawToken}/media/${itemRef}/download`,
      ),
      mediaRouteContext(),
    );

    expect(preview.status).toBe(200);
    expect(download.status).toBe(403);
    assertPublicHeaders(download);
    expect(await download.json()).toEqual(expect.objectContaining({
      code: 'CANVAS_SHARE_DOWNLOAD_DISABLED',
    }));
  });

  it('serves an enabled download with a safe attachment filename', async () => {
    const response = await downloadPublicMedia(
      new NextRequest(
        `http://localhost/api/public/canvas-shares/${rawToken}/media/${itemRef}/download`,
      ),
      mediaRouteContext(),
    );

    expect(response.status).toBe(200);
    assertPublicHeaders(response);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(response.headers.get('content-length')).toBe('4');
    expect(response.headers.get('content-disposition')).toBe(
      `attachment; filename="main-visual.png"; filename*=UTF-8''main-visual.png`,
    );
    expect(mocks.readPublicCanvasShareMedia).toHaveBeenCalledWith(expect.objectContaining({
      token: rawToken,
      itemRef,
      download: true,
      rangeHeader: null,
    }));
  });

  it('returns stable bounded video range headers and rejects malformed ranges safely', async () => {
    mocks.readPublicCanvasShareMedia.mockResolvedValueOnce({
      bytes: Buffer.from([5, 6, 7, 8]),
      mimeType: 'video/mp4',
      totalBytes: 100,
      contentLength: 4,
      range: { start: 20, end: 23 },
      fileName: 'clip.mp4',
    });
    const partial = await getPublicMedia(
      new NextRequest(
        `http://localhost/api/public/canvas-shares/${rawToken}/media/${itemRef}`,
        { headers: { Range: 'bytes=20-23' } },
      ),
      mediaRouteContext(),
    );
    expect(partial.status).toBe(206);
    expect(partial.headers.get('accept-ranges')).toBe('bytes');
    expect(partial.headers.get('content-range')).toBe('bytes 20-23/100');
    expect(partial.headers.get('content-length')).toBe('4');

    mocks.readPublicCanvasShareMedia.mockRejectedValueOnce(
      Object.assign(new Error('range'), {
        code: 'CANVAS_SHARE_RANGE_NOT_SATISFIABLE',
        status: 416,
      }),
    );
    const rejected = await getPublicMedia(
      new NextRequest(
        `http://localhost/api/public/canvas-shares/${rawToken}/media/${itemRef}`,
        { headers: { Range: 'bytes=0-999999999' } },
      ),
      mediaRouteContext(),
    );
    expect(rejected.status).toBe(416);
    assertPublicHeaders(rejected);
    expect(JSON.stringify(await rejected.json())).not.toContain('999999999');
  });

  it('returns a stable private 429 response without reflecting token or IP', async () => {
    mocks.enforceCanvasSharePublicRateLimit.mockRejectedValueOnce(
      new CanvasSharePublicRateLimitError(37),
    );
    const response = await getPublicShare(
      new NextRequest(`http://localhost/api/public/canvas-shares/${rawToken}`, {
        headers: { 'x-forwarded-for': '203.0.113.44' },
      }),
      routeContext(),
    );

    expect(response.status).toBe(429);
    assertPublicHeaders(response);
    expect(response.headers.get('retry-after')).toBe('37');
    const serialized = JSON.stringify(await response.json());
    expect(serialized).toContain('CANVAS_SHARE_RATE_LIMITED');
    expect(serialized).not.toContain(rawToken);
    expect(serialized).not.toContain('203.0.113.44');
  });
});

describe('canvas-share public media authorization', () => {
  it('authorizes HEAD metadata without invoking the managed byte reader', async () => {
    const actualService = await vi.importActual<typeof import('@/lib/canvas-share/service')>(
      '@/lib/canvas-share/service',
    );
    const validRecord = {
      ...record,
      snapshotDigest: actualService.computeCanvasShareSnapshotDigestForRead(record, [item]),
    };
    const asset: Asset = {
      id: item.assetId,
      ownerId: record.ownerId,
      projectId: record.projectId,
      kind: item.assetKind,
      status: 'active',
      currentVersionId: item.assetVersionId,
      createdAt: record.createdAt,
      updatedAt: record.createdAt,
    };
    const version: AssetVersion = {
      id: item.assetVersionId,
      assetId: item.assetId,
      ownerId: record.ownerId,
      projectId: record.projectId,
      file: {
        url: '/api/serve-upload/uploads/ready.png',
        availability: 'ready',
        mimeType: item.mimeType,
        byteSize: item.byteSize ?? undefined,
        width: item.width ?? undefined,
        height: item.height ?? undefined,
        checksum: item.checksum ?? undefined,
      },
      parentVersionIds: [],
      createdAt: record.createdAt,
    };
    const readMedia = vi.fn();

    await expect(actualService.readPublicCanvasShareMedia({
      token: rawToken,
      itemRef,
      download: false,
      rangeHeader: null,
      headOnly: true,
    }, {
      now: () => new Date(now),
      hashToken: () => tokenDigest,
      withActiveSnapshot: async (_digest, _accessedAt, operation) => operation({
        snapshot: { record: validRecord, items: [item] },
        expectedItemCount: 1,
        database: transactionDatabase,
        incrementView: vi.fn(),
        findAsset: vi.fn().mockResolvedValue(asset),
        findVersion: vi.fn().mockResolvedValue(version),
      }),
      getMediaDescriptor: vi.fn().mockResolvedValue({
        assetVersionId: version.id,
        assetKind: asset.kind,
        mimeType: item.mimeType,
        byteSize: item.byteSize,
        width: item.width,
        height: item.height,
        checksum: item.checksum,
        source: { kind: 'local', absolutePath: 'managed', dataRoot: 'managed-root' },
      }),
      readMedia,
    })).resolves.toMatchObject({
      bytes: null,
      contentLength: 4,
      mimeType: 'image/png',
      totalBytes: 4,
    });
    expect(readMedia).not.toHaveBeenCalled();
  });

  it('binds the scoped item to authoritative asset/version/descriptor data and never fetches source URLs', async () => {
    const actualService = await vi.importActual<typeof import('@/lib/canvas-share/service')>(
      '@/lib/canvas-share/service',
    );
    const version: AssetVersion = {
      id: item.assetVersionId,
      assetId: item.assetId,
      ownerId: record.ownerId,
      projectId: record.projectId,
      file: {
        url: '/api/serve-upload/uploads/ready.png',
        recoverySourceUrl: 'http://127.0.0.1/private',
        availability: 'ready',
        mimeType: item.mimeType,
        byteSize: item.byteSize ?? undefined,
        width: item.width ?? undefined,
        height: item.height ?? undefined,
        checksum: item.checksum ?? undefined,
      },
      parentVersionIds: [],
      createdAt: record.createdAt,
    };
    const asset: Asset = {
      id: item.assetId,
      ownerId: record.ownerId,
      projectId: record.projectId,
      kind: item.assetKind,
      status: 'active',
      currentVersionId: item.assetVersionId,
      createdAt: record.createdAt,
      updatedAt: record.createdAt,
    };
    const readMedia = vi.fn().mockResolvedValue({
      bytes: Buffer.from([1, 2, 3, 4]),
      mimeType: item.mimeType,
      totalBytes: item.byteSize,
    });
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const context = {
      snapshot: { record: { ...record, snapshotDigest: '' }, items: [item] },
      expectedItemCount: 1,
      database: transactionDatabase,
      incrementView: vi.fn(),
      findAsset: vi.fn().mockResolvedValue(asset),
      findVersion: vi.fn().mockResolvedValue(version),
    };
    context.snapshot.record.snapshotDigest = actualService.computeCanvasShareSnapshotDigestForRead(
      context.snapshot.record,
      context.snapshot.items,
    );

    const result = await actualService.readPublicCanvasShareMedia({
      token: rawToken,
      itemRef,
      download: false,
      rangeHeader: null,
    }, {
      now: () => new Date(now),
      hashToken: () => tokenDigest,
      withActiveSnapshot: async (_digest, _accessedAt, operation) => operation(context),
      getMediaDescriptor: vi.fn().mockResolvedValue({
        assetVersionId: version.id,
        assetKind: asset.kind,
        mimeType: item.mimeType,
        byteSize: item.byteSize,
        width: item.width,
        height: item.height,
        checksum: item.checksum,
        source: { kind: 'local', absolutePath: 'managed', dataRoot: 'managed-root' },
      }),
      readMedia,
    });

    expect(result.bytes).toEqual(Buffer.from([1, 2, 3, 4]));
    expect(context.findAsset).toHaveBeenCalledWith(record.ownerId, record.projectId, item.assetId);
    expect(context.findVersion).toHaveBeenCalledWith(
      record.ownerId,
      record.projectId,
      item.assetVersionId,
    );
    expect(readMedia).toHaveBeenCalledWith(version, item.assetKind, expect.objectContaining({
      maxBytes: 32 * 1024 * 1024,
    }));
    expect(fetchSpy).not.toHaveBeenCalled();

    asset.status = 'trashed';
    await expect(actualService.readPublicCanvasShareMedia({
      token: rawToken,
      itemRef,
      download: false,
      rangeHeader: null,
    }, {
      now: () => new Date(now),
      hashToken: () => tokenDigest,
      withActiveSnapshot: async (_digest, _accessedAt, operation) => operation(context),
      getMediaDescriptor: vi.fn().mockResolvedValue({
        assetVersionId: version.id,
        assetKind: asset.kind,
        mimeType: item.mimeType,
        byteSize: item.byteSize,
        width: item.width,
        height: item.height,
        checksum: item.checksum,
        source: { kind: 'local', absolutePath: 'managed', dataRoot: 'managed-root' },
      }),
      readMedia,
    })).resolves.toMatchObject({ bytes: Buffer.from([1, 2, 3, 4]) });
  });

  it('rejects a foreign scoped item before any asset/version lookup', async () => {
    const actualService = await vi.importActual<typeof import('@/lib/canvas-share/service')>(
      '@/lib/canvas-share/service',
    );
    const context = {
      snapshot: { record: { ...record, snapshotDigest: '' }, items: [item] },
      expectedItemCount: 1,
      database: transactionDatabase,
      incrementView: vi.fn(),
      findAsset: vi.fn(),
      findVersion: vi.fn(),
    };
    context.snapshot.record.snapshotDigest = actualService.computeCanvasShareSnapshotDigestForRead(
      context.snapshot.record,
      context.snapshot.items,
    );

    await expect(actualService.readPublicCanvasShareMedia({
      token: rawToken,
      itemRef: createCanvasSharePublicItemRef('b'.repeat(64), item.id),
      download: false,
      rangeHeader: null,
    }, {
      now: () => new Date(now),
      hashToken: () => tokenDigest,
      withActiveSnapshot: async (_digest, _accessedAt, operation) => operation(context),
      getMediaDescriptor: vi.fn(),
      readMedia: vi.fn(),
    })).rejects.toMatchObject({ code: 'CANVAS_SHARE_NOT_FOUND' });
    expect(context.findAsset).not.toHaveBeenCalled();
    expect(context.findVersion).not.toHaveBeenCalled();
  });

  it('maps a missing authoritative asset/version to one safe media-unavailable semantic', async () => {
    const actualService = await vi.importActual<typeof import('@/lib/canvas-share/service')>(
      '@/lib/canvas-share/service',
    );
    const validRecord = {
      ...record,
      snapshotDigest: actualService.computeCanvasShareSnapshotDigestForRead(record, [item]),
    };

    await expect(actualService.readPublicCanvasShareMedia({
      token: rawToken,
      itemRef,
      download: false,
      rangeHeader: null,
    }, {
      now: () => new Date(now),
      hashToken: () => tokenDigest,
      withActiveSnapshot: async (_digest, _accessedAt, operation) => operation({
        snapshot: { record: validRecord, items: [item] },
        expectedItemCount: 1,
        database: transactionDatabase,
        incrementView: vi.fn(),
        findAsset: vi.fn().mockResolvedValue(null),
        findVersion: vi.fn().mockResolvedValue(null),
      }),
      getMediaDescriptor: vi.fn(),
      readMedia: vi.fn(),
    })).rejects.toMatchObject({ code: 'CANVAS_SHARE_MEDIA_UNAVAILABLE' });
  });

  it('normalizes a managed descriptor failure without exposing storage details', async () => {
    const actualService = await vi.importActual<typeof import('@/lib/canvas-share/service')>(
      '@/lib/canvas-share/service',
    );
    const validRecord = {
      ...record,
      snapshotDigest: actualService.computeCanvasShareSnapshotDigestForRead(record, [item]),
    };
    const asset: Asset = {
      id: item.assetId,
      ownerId: record.ownerId,
      projectId: record.projectId,
      kind: item.assetKind,
      status: 'active',
      currentVersionId: item.assetVersionId,
      createdAt: record.createdAt,
      updatedAt: record.createdAt,
    };
    const version: AssetVersion = {
      id: item.assetVersionId,
      assetId: item.assetId,
      ownerId: record.ownerId,
      projectId: record.projectId,
      file: {
        url: '/api/serve-upload/uploads/missing.png',
        availability: 'ready',
        mimeType: item.mimeType,
        byteSize: item.byteSize ?? undefined,
      },
      parentVersionIds: [],
      createdAt: record.createdAt,
    };

    await expect(actualService.readPublicCanvasShareMedia({
      token: rawToken,
      itemRef,
      download: false,
      rangeHeader: null,
    }, {
      now: () => new Date(now),
      hashToken: () => tokenDigest,
      withActiveSnapshot: async (_digest, _accessedAt, operation) => operation({
        snapshot: { record: validRecord, items: [item] },
        expectedItemCount: 1,
        database: transactionDatabase,
        incrementView: vi.fn(),
        findAsset: vi.fn().mockResolvedValue(asset),
        findVersion: vi.fn().mockResolvedValue(version),
      }),
      getMediaDescriptor: vi.fn().mockRejectedValue(
        new CanvasShareError('CANVAS_SHARE_MEDIA_NOT_READY'),
      ),
      readMedia: vi.fn(),
    })).rejects.toMatchObject({
      code: 'CANVAS_SHARE_MEDIA_UNAVAILABLE',
      message: '此分享内容暂不可用',
    });
  });
});

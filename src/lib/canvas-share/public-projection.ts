import { createHash, timingSafeEqual } from 'node:crypto';

import { canvasSharePublicDocumentSchema } from './schema';
import { hashCanonicalJson } from './canonical-json';
import { CanvasShareError } from './errors';
import type {
  CanvasShareItemRecord,
  CanvasSharePublicDocument,
  CanvasShareRecord,
} from './types';

const PUBLIC_ITEM_REF_PREFIX = 'csr_';
const PUBLIC_ITEM_REF_PATTERN = /^csr_[A-Za-z0-9_-]{43}$/u;

function invalidShare(): never {
  throw new CanvasShareError('CANVAS_SHARE_NOT_FOUND');
}

function snapshotDigestInput(
  record: Pick<CanvasShareRecord, 'projectRevision' | 'viewport'>,
  items: readonly CanvasShareItemRecord[],
): object {
  return {
    projectRevision: record.projectRevision,
    viewport: record.viewport,
    items: items.map(item => ({
      placementId: item.placementId,
      assetId: item.assetId,
      assetVersionId: item.assetVersionId,
      entityType: item.entityType,
      assetKind: item.assetKind,
      transform: item.transform,
      displayMetadata: item.displayMetadata,
      mimeType: item.mimeType,
      width: item.width,
      height: item.height,
      byteSize: item.byteSize,
      checksum: item.checksum,
      availability: item.availability,
      sortOrder: item.sortOrder,
    })),
  };
}

export function computeCanvasShareSnapshotDigestForRead(
  record: Pick<CanvasShareRecord, 'projectRevision' | 'viewport'>,
  items: readonly CanvasShareItemRecord[],
): string {
  return hashCanonicalJson(snapshotDigestInput(record, items));
}

export function assertCanvasShareSnapshotIntegrity(
  record: CanvasShareRecord,
  items: readonly CanvasShareItemRecord[],
  expectedItemCount = items.length,
): void {
  if (!Number.isSafeInteger(expectedItemCount) || expectedItemCount < 0) invalidShare();
  if (items.length !== expectedItemCount) invalidShare();
  if (items.some((item, index) => (
    item.shareId !== record.id
    || item.sortOrder !== index
    || item.availability !== 'ready'
  ))) invalidShare();
  const actualDigest = computeCanvasShareSnapshotDigestForRead(record, items);
  const expected = Buffer.from(record.snapshotDigest, 'utf8');
  const actual = Buffer.from(actualDigest, 'utf8');
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) invalidShare();
}

export function createCanvasSharePublicItemRef(
  tokenDigest: string,
  internalItemId: string,
): string {
  if (!/^[a-f0-9]{64}$/u.test(tokenDigest) || !internalItemId) invalidShare();
  const digest = createHash('sha256')
    .update('canvas-share-item-ref:v1\0', 'utf8')
    .update(tokenDigest, 'utf8')
    .update('\0', 'utf8')
    .update(internalItemId, 'utf8')
    .digest('base64url');
  return `${PUBLIC_ITEM_REF_PREFIX}${digest}`;
}

export function parseCanvasSharePublicToken(value: string): string {
  if (!/^[A-Za-z0-9_-]{43,128}$/u.test(value)) invalidShare();
  return value;
}

export function parseCanvasSharePublicItemRef(value: string): string {
  if (!PUBLIC_ITEM_REF_PATTERN.test(value)) invalidShare();
  return value;
}

export function resolveCanvasSharePublicItem(
  record: CanvasShareRecord,
  items: readonly CanvasShareItemRecord[],
  itemRef: string,
): CanvasShareItemRecord {
  const parsedRef = parseCanvasSharePublicItemRef(itemRef);
  const expected = Buffer.from(parsedRef, 'utf8');
  for (const item of items) {
    const candidate = Buffer.from(
      createCanvasSharePublicItemRef(record.tokenHash, item.id),
      'utf8',
    );
    if (candidate.length === expected.length && timingSafeEqual(candidate, expected)) return item;
  }
  return invalidShare();
}

export function projectCanvasShareForPublic(
  record: CanvasShareRecord,
  items: readonly CanvasShareItemRecord[],
  token: string,
): CanvasSharePublicDocument {
  const publicToken = parseCanvasSharePublicToken(token);
  const projected: CanvasSharePublicDocument = {
    title: record.title,
    revisionLabel: `修订 ${record.projectRevision}`,
    createdAt: record.createdAt,
    allowDownload: record.allowDownload,
    viewport: {
      offsetX: record.viewport.offsetX,
      offsetY: record.viewport.offsetY,
      zoom: record.viewport.zoom,
    },
    items: items.map(item => {
      const itemRef = createCanvasSharePublicItemRef(record.tokenHash, item.id);
      const mediaPath = `/api/public/canvas-shares/${publicToken}/media/${itemRef}`;
      return {
        itemRef,
        entityType: item.entityType,
        assetKind: item.assetKind,
        transform: {
          x: item.transform.x,
          y: item.transform.y,
          width: item.transform.width,
          height: item.transform.height,
          rotation: item.transform.rotation,
          zIndex: item.transform.zIndex,
        },
        display: {
          ...(item.displayMetadata.label === undefined
            ? {}
            : { label: item.displayMetadata.label }),
          ...(item.displayMetadata.altText === undefined
            ? {}
            : { altText: item.displayMetadata.altText }),
        },
        mimeType: item.mimeType,
        width: item.width,
        height: item.height,
        mediaPath,
        ...(record.allowDownload ? { downloadPath: `${mediaPath}/download` } : {}),
      };
    }),
  };
  const parsed = canvasSharePublicDocumentSchema.safeParse(projected);
  if (!parsed.success) return invalidShare();
  return parsed.data;
}

const MIME_EXTENSIONS: Readonly<Record<string, string>> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
  'image/bmp': 'bmp',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
  'video/x-m4v': 'm4v',
};

export function createCanvasShareDownloadFileName(
  record: Pick<CanvasShareRecord, 'title'>,
  item: Pick<CanvasShareItemRecord, 'displayMetadata' | 'mimeType' | 'sortOrder'>,
): string {
  const base = item.displayMetadata.label?.trim() || record.title.trim() || 'wujie-canvas-share';
  const safeBase = base
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9._-]+/gu, '-')
    .replace(/^[._-]+|[._-]+$/gu, '')
    .slice(0, 80) || `canvas-item-${item.sortOrder + 1}`;
  const extension = MIME_EXTENSIONS[item.mimeType] ?? 'bin';
  return `${safeBase}.${extension}`;
}

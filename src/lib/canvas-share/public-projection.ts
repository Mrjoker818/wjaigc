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
const PUBLIC_TEXT_CONTROL_PATTERN = /[\u0000-\u001f\u007f-\u009f]/gu;
const PUBLIC_TEXT_BIDI_PATTERN = /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu;
const PUBLIC_TEXT_SCHEME_PATTERN = /\b[a-z][a-z\d+.-]*:/iu;
const PUBLIC_TEXT_SCHEME_RELATIVE_PATTERN = /\/\//u;
const PUBLIC_TEXT_HOST_PATTERN = /(?:\bwww\.|\b(?:[a-z\d](?:[a-z\d-]{0,62}[a-z\d])?\.)+[a-z]{2,63}(?::\d{1,5})?(?:[/?#]|\b)|\b(?:\d{1,3}\.){3}\d{1,3}(?::\d{1,5})?(?:[/?#]|\b))/iu;
const PUBLIC_TEXT_HTML_PATTERN = /[<>]|&(?:lt|gt|#0*60|#0*62|#x0*3c|#x0*3e);/iu;

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

function publicSafeText(value: string | undefined, maxLength: number): string | undefined {
  if (value === undefined) return undefined;
  const normalized = value
    .normalize('NFC')
    .replace(PUBLIC_TEXT_CONTROL_PATTERN, ' ')
    .replace(PUBLIC_TEXT_BIDI_PATTERN, '')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, maxLength)
    .trim();
  const inspectionValue = normalized.normalize('NFKC');
  if (
    PUBLIC_TEXT_SCHEME_PATTERN.test(inspectionValue)
    || PUBLIC_TEXT_SCHEME_RELATIVE_PATTERN.test(inspectionValue)
    || PUBLIC_TEXT_HOST_PATTERN.test(inspectionValue)
    || PUBLIC_TEXT_HTML_PATTERN.test(inspectionValue)
  ) return undefined;
  return normalized || undefined;
}

export function projectCanvasShareForPublic(
  record: CanvasShareRecord,
  items: readonly CanvasShareItemRecord[],
): CanvasSharePublicDocument {
  const title = publicSafeText(record.title, 200) ?? '共享画布';
  const projected: CanvasSharePublicDocument = {
    title,
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
      const mediaPath = `media/${itemRef}`;
      const label = publicSafeText(item.displayMetadata.label, 200);
      const altText = publicSafeText(item.displayMetadata.altText, 1_000);
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
          ...(label === undefined ? {} : { label }),
          ...(altText === undefined ? {} : { altText }),
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

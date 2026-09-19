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
const PUBLIC_TEXT_IGNORABLE_OR_FORMAT_PATTERN = /[\p{Cf}\p{Default_Ignorable_Code_Point}]/gu;
const PUBLIC_TEXT_EMOJI_ONLY_COMPONENT_PATTERN =
  /[\p{Emoji_Modifier}\p{Regional_Indicator}\u20E3]/gu;
const PUBLIC_TEXT_EMOJI_TAG_PATTERN = /[\u{e0020}-\u{e007f}]/gu;
const PUBLIC_TEXT_EMOJI_ATOM = String.raw`(?:\p{Emoji_Modifier_Base}(?:\uFE0E|\uFE0F)?\p{Emoji_Modifier}|\p{Extended_Pictographic}(?:\uFE0E|\uFE0F)?)`;
const PUBLIC_TEXT_STRUCTURED_EMOJI_PATTERN = new RegExp(
  String.raw`^(?:[#*0-9]\uFE0F?\u20E3|\p{Regional_Indicator}{2}|${PUBLIC_TEXT_EMOJI_ATOM}(?:\u200D${PUBLIC_TEXT_EMOJI_ATOM})*)$`,
  'u',
);
const PUBLIC_TEXT_DANGEROUS_SCHEME_PATTERN = /\b(?:https?|ftps?|file|data|javascript|vbscript|blob|wss?|ircs?|mailto|tel|ssh|sftp|ldaps?|news|nntp|magnet|intent|about|git):/iu;
const PUBLIC_TEXT_COMPACT_SCHEME_PATTERN = /\b[a-z][a-z\d+.-]*:[^\s]/iu;
const PUBLIC_TEXT_SCHEME_RELATIVE_PATTERN = /\/\//u;
const PUBLIC_TEXT_DOMAIN_LABEL = String.raw`[\p{L}\p{N}](?:[\p{L}\p{N}-]{0,61}[\p{L}\p{N}])?`;
const PUBLIC_TEXT_DOMAIN_CANDIDATE_PATTERN = new RegExp(
  String.raw`(?:^|[^\p{L}\p{N}_-])((?:www\.)?(?:${PUBLIC_TEXT_DOMAIN_LABEL}\.)+${PUBLIC_TEXT_DOMAIN_LABEL}(?::\d{1,5})?)`,
  'giu',
);
const PUBLIC_TEXT_LETTER_PATTERN = /\p{L}/u;
const PUBLIC_TEXT_IPV4_PATTERN = /(?:^|[^\d.])(?:\d{1,3}\.){3}\d{1,3}(?::\d{1,5})?/u;
const PUBLIC_TEXT_BRACKETED_IPV6_PATTERN = /\[[0-9a-f:.]*:[0-9a-f:.]*\](?::\d{1,5})?/iu;
const PUBLIC_TEXT_HTML_PATTERN = /[<>]|&(?:lt|gt|#0*60|#0*62|#x0*3c|#x0*3e);/iu;
const PUBLIC_TEXT_IDNA_DOT_PATTERN = /[\u3002\uff0e\uff61]/gu;
const PUBLIC_TEXT_GRAPHEME_SEGMENTER = new Intl.Segmenter('und', { granularity: 'grapheme' });

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

function sanitizePublicTextGrapheme(segment: string): string {
  const withoutTags = segment.replace(PUBLIC_TEXT_EMOJI_TAG_PATTERN, '');
  if (PUBLIC_TEXT_STRUCTURED_EMOJI_PATTERN.test(withoutTags)) return withoutTags;
  return withoutTags
    .replace(PUBLIC_TEXT_IGNORABLE_OR_FORMAT_PATTERN, '')
    .replace(PUBLIC_TEXT_EMOJI_ONLY_COMPONENT_PATTERN, '');
}

function truncatePublicTextAtGraphemeBoundary(value: string, maxLength: number): string {
  let candidate = '';

  for (const { segment } of PUBLIC_TEXT_GRAPHEME_SEGMENTER.segment(value)) {
    if (candidate.length + segment.length > maxLength) {
      break;
    }

    candidate += segment;
  }

  return candidate.trim();
}

function sanitizePublicTextGraphemes(value: string): string {
  return Array.from(PUBLIC_TEXT_GRAPHEME_SEGMENTER.segment(value), ({ segment }) => {
    return sanitizePublicTextGrapheme(segment);
  }).join('');
}

function publicTextInspectionValue(value: string): string {
  return value
    .replace(PUBLIC_TEXT_IGNORABLE_OR_FORMAT_PATTERN, '')
    .normalize('NFKC')
    .replace(PUBLIC_TEXT_IDNA_DOT_PATTERN, '.');
}

function containsPublicTextDomain(value: string): boolean {
  for (const match of value.matchAll(PUBLIC_TEXT_DOMAIN_CANDIDATE_PATTERN)) {
    const candidate = match[1];
    if (!candidate) continue;
    const host = candidate.replace(/:\d{1,5}$/u, '');
    const finalLabel = host.split('.').at(-1);
    if (finalLabel && PUBLIC_TEXT_LETTER_PATTERN.test(finalLabel)) return true;
  }
  return false;
}

function containsUnsafePublicText(value: string): boolean {
  return PUBLIC_TEXT_DANGEROUS_SCHEME_PATTERN.test(value)
    || PUBLIC_TEXT_COMPACT_SCHEME_PATTERN.test(value)
    || PUBLIC_TEXT_SCHEME_RELATIVE_PATTERN.test(value)
    || containsPublicTextDomain(value)
    || PUBLIC_TEXT_IPV4_PATTERN.test(value)
    || PUBLIC_TEXT_BRACKETED_IPV6_PATTERN.test(value)
    || PUBLIC_TEXT_HTML_PATTERN.test(value);
}

function publicSafeText(value: string | undefined, maxLength: number): string | undefined {
  if (value === undefined) return undefined;
  const normalized = sanitizePublicTextGraphemes(value.normalize('NFC'))
    .replace(PUBLIC_TEXT_CONTROL_PATTERN, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
  if (containsUnsafePublicText(publicTextInspectionValue(normalized))) return undefined;
  const candidate = truncatePublicTextAtGraphemeBoundary(normalized, maxLength);
  if (!candidate || containsUnsafePublicText(publicTextInspectionValue(candidate))) return undefined;
  return candidate;
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

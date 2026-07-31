import { createHash } from 'node:crypto';

import { resolveLayerSourceImage } from '@/lib/layer-decomposition/source-image';
import { saveImageFile } from '@/lib/server-data-root';
import type {
  ElementDecomposeRequest,
  FrozenElementSource,
} from '@/lib/element-decomposition/types';

export async function freezeElementSource(
  request: ElementDecomposeRequest,
  options: { signal?: AbortSignal } = {},
): Promise<FrozenElementSource> {
  const sourceImageId = request.sourceImageId.trim();
  if (!sourceImageId) {
    throw new Error('sourceImageId is required');
  }

  const resolved = await resolveLayerSourceImage(request.imageUrl, {
    signal: options.signal,
  });
  const buffer = Buffer.from(resolved.buffer);

  return Object.freeze({
    sourceImageId,
    sourceVersionId: request.sourceVersionId?.trim() || undefined,
    canonicalUrl: request.imageUrl,
    sha256: createHash('sha256').update(buffer).digest('hex'),
    width: resolved.width,
    height: resolved.height,
    mimeType: resolved.mimeType,
    buffer,
  });
}

export async function persistFrozenElementSource(
  source: FrozenElementSource,
): Promise<{ managedUrl: string; sha256: string }> {
  const extension = source.mimeType === 'image/jpeg'
    ? 'jpg'
    : source.mimeType === 'image/webp'
      ? 'webp'
      : 'png';
  const managedUrl = saveImageFile(
    source.buffer,
    `${source.sha256}.${extension}`,
    'element-sources',
  );
  return { managedUrl, sha256: source.sha256 };
}

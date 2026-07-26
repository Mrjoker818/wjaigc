function stableFingerprint(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

export function buildAnnotationSourceVersionId(
  imageId: string,
  createdAt?: number,
  imageUrl?: string,
): string {
  const trimmedId = imageId.trim();
  const compactImageId = (
    trimmedId.length > 0
    && trimmedId.length <= 64
    && !/^(?:data:|https?:|blob:)/i.test(trimmedId)
  )
    ? trimmedId
    : `image-${stableFingerprint(trimmedId)}`;
  const compactCreatedAt = Number.isFinite(createdAt)
    ? Math.max(0, Math.trunc(createdAt as number))
    : 0;
  const compactUrlFingerprint = imageUrl?.trim()
    ? stableFingerprint(imageUrl.trim())
    : 'no-url';
  return `${compactImageId}:${compactCreatedAt}:${compactUrlFingerprint}`.slice(0, 96);
}

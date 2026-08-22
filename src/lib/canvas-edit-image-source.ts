const SAFE_LOCAL_IMAGE_PREFIXES = [
  '/',
  'data:image/',
  'blob:',
] as const;

export function getCanvasEditImageSource(source: string): string {
  const normalized = source.trim();
  if (!normalized) return '';

  if (SAFE_LOCAL_IMAGE_PREFIXES.some((prefix) => normalized.startsWith(prefix))) {
    return normalized;
  }

  let remoteUrl: URL;
  try {
    remoteUrl = new URL(normalized);
  } catch {
    return '';
  }

  if (!['http:', 'https:'].includes(remoteUrl.protocol)) return '';
  return `/api/image/source?url=${encodeURIComponent(normalized)}`;
}
